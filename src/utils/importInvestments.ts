import * as XLSX from 'xlsx';
import type {
  InvestKey,
  InvestPositionItem,
  InvestPositionItems,
  InvestQuoteSource,
  InvestmentTransactionRecord,
  PendingInvestmentBuy,
} from '../models/types';
import { useMonthlyStore } from '../stores/monthlyStore';
import { syncInvestPositionItems } from './investPositionItems';
import { normalizeBillDate } from './importBill';
import { canonicalInvestmentSymbol } from './investmentInstrument';
import { investmentImportCutoff } from './importCutoffs';
import {
  applyInvestmentTransaction,
  cloneInvestPositionItems,
  createInvestmentRolloverRecord,
  emptyMonthlyRecord,
  hasInvestmentEndingState,
  investmentPositionItemsForRecord,
  replayInvestmentRecord,
} from './investmentRollover';
import { triggerUpload } from './syncEngine';

type InvestmentSide = 'buy' | 'sell';

export type InvestmentTransaction = InvestmentTransactionRecord;

export interface ParsedInvestmentFile {
  transactions: InvestmentTransaction[];
  pendingBuys: PendingInvestmentBuy[];
}

const HEADER_ALIASES = {
  transactionId: ['流水号', '交易流水号', '业务流水号', '订单号', '成交编号', '委托编号'],
  date: ['日期', '交易日期', '成交日期', '发生日期', '操作日期', '时间'],
  confirmationDate: ['确认日期', '确认时间', '成交时间'],
  side: ['操作', '交易类型', '业务名称', '买卖方向', '交易', '类型'],
  name: ['名称', '证券名称', '基金名称', '股票名称', '产品名称', '标的名称', '理财账户'],
  symbol: ['代码', '证券代码', '基金代码', '股票代码', '产品代码', '标的代码', '理财代码'],
  shares: ['份额', '数量', '成交数量', '发生份额', '成交份额', '交易份额'],
  price: ['成交价', '成交价格', '净值', '价格', '单位净值'],
  amount: ['金额', '成交金额', '发生金额', '交易金额', '总金额'],
  fee: ['手续费', '费用', '交易费用', '佣金'],
  currency: ['币种', '货币', '交易币种'],
  category: ['品类', '类别', '市场', '资产类别', '投资类型'],
  status: ['状态', '确认状态', '交易状态', '处理状态'],
  account: ['交易账户', '资金账户', '支付账户', '扣款账户'],
} as const;

type Field = keyof typeof HEADER_ALIASES;

function normalizeHeader(value: unknown) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().replace(/\s+/g, '').toLowerCase();
}

function findHeaderRow(rows: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
    const headers = rows[rowIndex].map(normalizeHeader);
    const indexes = {} as Partial<Record<Field, number>>;
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      const aliases = HEADER_ALIASES[field].map(normalizeHeader);
      const index = headers.findIndex((header) => aliases.includes(header));
      if (index >= 0) indexes[field] = index;
    }
    if ((indexes.date !== undefined || indexes.confirmationDate !== undefined)
      && indexes.side !== undefined
      && (indexes.name !== undefined || indexes.symbol !== undefined)) {
      return { rowIndex, indexes };
    }
  }
  return null;
}

function stringCell(row: unknown[], index: number | undefined) {
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

function numberCell(row: unknown[], index: number | undefined) {
  if (index === undefined) return 0;
  const value = Number(String(row[index] ?? '').replace(/[,，￥¥$\s]/g, ''));
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

function parseSide(value: string): InvestmentSide | null {
  if (/买入|申购|定投|认购|buy/i.test(value)) return 'buy';
  if (/卖出|赎回|清仓|sell/i.test(value)) return 'sell';
  return null;
}

function isPendingStatus(value: string) {
  return /确认中|待确认|处理中|pending/i.test(value);
}

export function normalizeInstrumentSymbol(raw: string, category: string, name: string, currency: string) {
  const symbol = canonicalInvestmentSymbol(raw);
  if (!/^\d+$/.test(symbol)) return symbol;
  if (currency === 'HKD' || /港股|香港/.test(category)) return symbol.padStart(5, '0');
  if (currency === 'CNY' || /基金|A股|沪深|上证|深证/i.test(`${category} ${name}`)) return symbol.padStart(6, '0');
  return symbol;
}

function inferGroupKey(category: string, symbol: string, name: string, currency: string): InvestKey {
  const text = `${category} ${name}`.toLowerCase();
  if (/^\d{6}$/.test(symbol) && (currency === 'CNY' || /基金|联接|指数/.test(text))) return 'a';
  if (/黄金|gold/.test(text)) return 'gold';
  if (/美债|美国债|美公债|美国公债|us\s*(?:bond|treasury)/.test(text) || /^(tlt|ief|shy)$/i.test(symbol)) return 'usBond';
  if (/长债|长期债|国债|债券/.test(text)) return 'longBond';
  if (/欧股|欧洲|europe/.test(text)) return 'eu';
  if (/亚股|港股|日股|日本|香港|asia/.test(text) || /\.hk$/i.test(symbol)) return 'asia';
  if (/a股|沪深|中国股票|上证|深证/.test(text) || /\.(ss|sz)$/i.test(symbol)) return 'a';
  if (/美股|美国|标普|纳指|nasdaq|s&p|us\s*stock/.test(text)) return 'us';
  if (currency === 'USD') return 'us';
  if (currency === 'HKD') return 'asia';
  return /^\d{6}$/.test(symbol) ? 'a' : 'us';
}

function inferQuoteSource(symbol: string, name: string): InvestQuoteSource | undefined {
  if (/^\d{6}$/.test(symbol) && /基金|qdii|联接|指数|债券/i.test(name)) return 'eastmoney-fund';
  if (symbol) return 'yahoo';
  return undefined;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeTransactionDate(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return normalizeBillDate(String(value ?? ''));
}

function normalizeTransactionOccurredAt(value: unknown, date: string) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${date}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
  }
  const time = String(value ?? '').trim().match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return date;
  return `${date}T${String(Number(time[1])).padStart(2, '0')}:${time[2]}:${time[3] ?? '00'}`;
}

function localTimestamp(iso: string) {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return iso.slice(0, 19);
  const date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return `${date}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
}

export function transactionIsAfterEdit(transaction: InvestmentTransaction, editedAt: string) {
  const edit = localTimestamp(editedAt);
  const operationAt = transaction.operationAt ?? transaction.occurredAt;
  if (operationAt?.includes('T')) return operationAt > edit;
  return transaction.date >= edit.slice(0, 10);
}

export function getInvestmentImportCutoff(records = useMonthlyStore.getState().records) {
  return investmentImportCutoff(records);
}

function normalizedIdentityPart(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function pendingKeys(operationAt: string, account: string, symbol: string, name: string, amount: number) {
  const baseMatchKey = [
    operationAt,
    normalizedIdentityPart(account),
    symbol ? `symbol:${canonicalInvestmentSymbol(symbol)}` : `name:${normalizedIdentityPart(name)}`,
  ].join('|');
  return {
    baseMatchKey,
    matchKey: `${baseMatchKey}|amount:${amount > 0 ? amount.toFixed(2) : ''}`,
  };
}

function transactionFingerprint(transaction: InvestmentTransaction) {
  return [
    transaction.orderId ? `order:${transaction.orderId}` : transaction.operationAt || transaction.occurredAt || transaction.date,
    transaction.side,
    canonicalInvestmentSymbol(transaction.symbol) || transaction.name.trim().toLowerCase(),
    transaction.shares.toFixed(6),
    transaction.price.toFixed(6),
    transaction.fee.toFixed(2),
    transaction.currency.toUpperCase(),
  ].join('|');
}

function legacyTransactionFingerprint(transaction: InvestmentTransaction) {
  return [
    transaction.operationAt || transaction.occurredAt || transaction.date,
    transaction.side,
    canonicalInvestmentSymbol(transaction.symbol) || transaction.name.trim().toLowerCase(),
    transaction.shares.toFixed(6),
    transaction.price.toFixed(6),
    transaction.fee.toFixed(2),
    transaction.currency.toUpperCase(),
  ].join('|');
}

async function readInvestmentWorkbook(file: File) {
  const isCsv = /\.csv$/i.test(file.name) || file.type.toLowerCase().includes('csv');
  return isCsv
    ? XLSX.read(await file.text(), { type: 'string', cellDates: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
}

export async function parseInvestmentFileDetails(file: File): Promise<ParsedInvestmentFile> {
  const workbook = await readInvestmentWorkbook(file);
  const transactions: InvestmentTransaction[] = [];
  const pendingBuys: PendingInvestmentBuy[] = [];
  const identityOccurrences = new Map<string, number>();

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    const header = findHeaderRow(rows);
    if (!header) continue;
    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rawOperationDate = header.indexes.date === undefined
        ? row[header.indexes.confirmationDate!]
        : row[header.indexes.date];
      const rawConfirmationDate = header.indexes.confirmationDate === undefined
        ? rawOperationDate
        : row[header.indexes.confirmationDate];
      const operationDate = normalizeTransactionDate(rawOperationDate);
      const parsedConfirmationDate = normalizeTransactionDate(rawConfirmationDate);
      const side = parseSide(stringCell(row, header.indexes.side));
      const name = stringCell(row, header.indexes.name);
      const rawSymbol = stringCell(row, header.indexes.symbol);
      const category = stringCell(row, header.indexes.category);
      const rawCurrency = stringCell(row, header.indexes.currency).toUpperCase();
      const symbol = normalizeInstrumentSymbol(rawSymbol, category, name, rawCurrency);
      if (!operationDate || !side || (!name && !symbol)) continue;
      const confirmationDate = parsedConfirmationDate ?? operationDate;

      const amount = numberCell(row, header.indexes.amount);
      const rawShares = numberCell(row, header.indexes.shares);
      const rawPrice = numberCell(row, header.indexes.price);
      const shares = rawShares || (rawPrice > 0 ? amount / rawPrice : 0);
      const price = rawPrice || (shares > 0 ? amount / shares : 0);
      const preliminaryGroup = inferGroupKey(category, symbol, name, rawCurrency);
      const currency = rawCurrency || (preliminaryGroup === 'us' || preliminaryGroup === 'usBond' ? 'USD' : 'CNY');
      const groupKey = inferGroupKey(category, symbol, name, currency);
      const fee = numberCell(row, header.indexes.fee);
      const orderId = stringCell(row, header.indexes.transactionId) || undefined;
      const account = stringCell(row, header.indexes.account) || undefined;
      const status = stringCell(row, header.indexes.status);
      const operationAt = normalizeTransactionOccurredAt(rawOperationDate, operationDate);
      const confirmationAt = normalizeTransactionOccurredAt(rawConfirmationDate, confirmationDate);
      const keys = pendingKeys(operationAt, account ?? '', symbol, name, amount);
      const occurrenceIdentity = orderId ? `order:${orderId}` : keys.matchKey;
      const occurrence = identityOccurrences.get(occurrenceIdentity) ?? 0;
      identityOccurrences.set(occurrenceIdentity, occurrence + 1);

      if (side === 'buy' && isPendingStatus(status)) {
        pendingBuys.push({
          id: `pending-invest:${stableHash(`${occurrenceIdentity}|${occurrence}`)}`,
          orderId,
          matchKey: orderId ? `order:${orderId}` : keys.matchKey,
          baseMatchKey: keys.baseMatchKey,
          operationAt,
          amount: amount > 0 ? amount : undefined,
          currency,
          account,
          name: name || symbol,
          symbol,
          groupKey,
        });
        continue;
      }
      if (!(shares > 0) || !(price > 0)) continue;

      const transactionIdentity = orderId
        ? `order:${orderId}`
        : `${keys.matchKey}|${side}|${occurrence}`;
      transactions.push({
        id: `mail-invest:${stableHash(transactionIdentity)}`,
        date: confirmationDate,
        occurredAt: operationAt,
        operationAt,
        confirmationAt,
        side,
        name: name || symbol,
        symbol,
        groupKey,
        shares,
        price,
        amount: amount > 0 ? amount : shares * price,
        fee,
        currency,
        quoteSource: inferQuoteSource(symbol, name),
        orderId,
        account,
        pendingMatchKey: orderId ? `order:${orderId}` : keys.matchKey,
        pendingBaseMatchKey: keys.baseMatchKey,
      });
    }
  }

  return {
    transactions: transactions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    pendingBuys: pendingBuys.sort((a, b) => a.operationAt.localeCompare(b.operationAt) || a.id.localeCompare(b.id)),
  };
}

export async function parseInvestmentFile(file: File): Promise<InvestmentTransaction[]> {
  return (await parseInvestmentFileDetails(file)).transactions;
}

export function formatInvestmentImportSummary(result: {
  parsedTransactions: number;
  eligibleTransactions: number;
  formalImportedTransactions: number;
  newPendingBuys: number;
  resolvedPendingBuys: number;
  remainingPendingBuys: number;
}) {
  const skipped = Math.max(result.parsedTransactions - result.eligibleTransactions - result.resolvedPendingBuys, 0);
  return [
    `正式 ${result.formalImportedTransactions} 笔`,
    result.newPendingBuys > 0 ? `新增待确认 ${result.newPendingBuys} 笔` : '',
    result.resolvedPendingBuys > 0 ? `转正 ${result.resolvedPendingBuys} 笔` : '',
    result.remainingPendingBuys > 0 ? `仍待确认 ${result.remainingPendingBuys} 笔` : '',
    skipped > 0 ? `已过滤 ${skipped} 笔` : '',
  ].filter(Boolean).join(' · ');
}

function samePendingInstrument(item: InvestPositionItem, pending: PendingInvestmentBuy) {
  if (pending.symbol) return canonicalInvestmentSymbol(item.symbol) === canonicalInvestmentSymbol(pending.symbol);
  return item.name.trim().toLowerCase() === pending.name.trim().toLowerCase();
}

function attachPendingBuy(items: InvestPositionItems, pending: PendingInvestmentBuy) {
  const group = [...(items[pending.groupKey] ?? [])];
  let itemIndex = group.findIndex((item) => samePendingInstrument(item, pending));
  if (itemIndex < 0) {
    group.push({
      id: `pending-position:${stableHash(`${pending.groupKey}:${pending.symbol || pending.name}`)}`,
      name: pending.name,
      symbol: pending.symbol,
      quoteSource: inferQuoteSource(pending.symbol, pending.name),
      quoteCurrency: pending.currency,
      status: 'paused',
      historicalProfitCny: 0,
      historicalProfitCurrency: pending.currency,
      profitInputMode: 'historical',
      pendingBuys: [],
    });
    itemIndex = group.length - 1;
  }
  const item = group[itemIndex];
  const existingPending = item.pendingBuys ?? [];
  let pendingIndex = existingPending.findIndex((candidate) => (
    pending.orderId ? candidate.orderId === pending.orderId : candidate.id === pending.id
  ));
  const hasSameIdentity = !pending.orderId
    && existingPending.some((candidate) => candidate.matchKey === pending.matchKey);
  if (pendingIndex < 0 && !pending.orderId && !hasSameIdentity) {
    const baseCandidates = existingPending
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !candidate.orderId && candidate.baseMatchKey === pending.baseMatchKey);
    if (baseCandidates.length === 1) pendingIndex = baseCandidates[0].index;
    if (baseCandidates.length > 1) return false;
  }
  const nextPending = [...existingPending];
  if (pendingIndex >= 0) nextPending[pendingIndex] = { ...pending, id: nextPending[pendingIndex].id };
  else nextPending.push({ ...pending });
  group[itemIndex] = { ...item, pendingBuys: nextPending };
  items[pending.groupKey] = group;
  return pendingIndex < 0;
}

function findPendingMatches(items: InvestPositionItems, transaction: InvestmentTransaction) {
  const matches: { groupKey: InvestKey; itemIndex: number; pendingIndex: number; pending: PendingInvestmentBuy }[] = [];
  for (const groupKey of ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'] as const) {
    (items[groupKey] ?? []).forEach((item, itemIndex) => {
      (item.pendingBuys ?? []).forEach((pending, pendingIndex) => {
        const exact = transaction.orderId
          ? pending.orderId === transaction.orderId
          : pending.matchKey === transaction.pendingMatchKey;
        const missingAmountFallback = !transaction.orderId
          && !pending.amount
          && pending.baseMatchKey === transaction.pendingBaseMatchKey;
        if (exact || missingAmountFallback) matches.push({ groupKey, itemIndex, pendingIndex, pending });
      });
    });
  }
  return matches;
}

function removePendingMatch(items: InvestPositionItems, match: ReturnType<typeof findPendingMatches>[number]) {
  const group = [...(items[match.groupKey] ?? [])];
  const item = group[match.itemIndex];
  const pendingBuys = (item.pendingBuys ?? []).filter((_, index) => index !== match.pendingIndex);
  group[match.itemIndex] = { ...item, pendingBuys: pendingBuys.length > 0 ? pendingBuys : undefined };
  items[match.groupKey] = group;
}

function countPending(items: InvestPositionItems | undefined) {
  return Object.values(items ?? {}).reduce(
    (total, group) => total + (group ?? []).reduce((sum, item) => sum + (item.pendingBuys?.length ?? 0), 0),
    0,
  );
}

export async function importInvestmentFileIntoStores(file: File, options?: { mailUid?: number; deferUpload?: boolean }) {
  const parsed = await parseInvestmentFileDetails(file);
  if (parsed.transactions.length === 0 && parsed.pendingBuys.length === 0) {
    throw new Error('未识别到理财买入或卖出记录');
  }
  const currentRecords = useMonthlyStore.getState().records;
  const editedAt = getInvestmentImportCutoff(currentRecords);
  if (!editedAt && parsed.transactions.length > 0 && currentRecords.some(hasInvestmentEndingState)) {
    throw new Error('理财增量起点尚未建立，请刷新页面后重试');
  }

  const ordinaryTransactions = editedAt
    ? parsed.transactions.filter((transaction) => transactionIsAfterEdit(transaction, editedAt))
    : parsed.transactions;
  const ordinaryIds = new Set(ordinaryTransactions.map((transaction) => transaction.id));
  const workingRecords = new Map(currentRecords.map((record) => [record.yearMonth, record]));
  const changedMonths = new Set<string>();
  let newPendingBuys = 0;
  let resolvedPendingBuys = 0;
  let formalImportedTransactions = 0;

  const ensureWorkingRecord = (yearMonth: string) => {
    const existing = workingRecords.get(yearMonth);
    const previous = [...workingRecords.values()]
      .filter((record) => record.yearMonth < yearMonth && hasInvestmentEndingState(record))
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0];
    const inheritedExisting = existing
      && previous
      && existing.investmentRolledOverFrom === previous.yearMonth
      && changedMonths.has(previous.yearMonth)
      ? replayInvestmentRecord(previous, existing)
      : existing;
    const record = inheritedExisting && hasInvestmentEndingState(inheritedExisting)
      ? inheritedExisting
      : previous
        ? createInvestmentRolloverRecord(previous, yearMonth, inheritedExisting)
        : inheritedExisting ?? emptyMonthlyRecord(yearMonth);
    workingRecords.set(yearMonth, record);
    return record;
  };

  for (const pending of parsed.pendingBuys) {
    const yearMonth = pending.operationAt.slice(0, 7);
    let record = ensureWorkingRecord(yearMonth);
    const items = cloneInvestPositionItems(investmentPositionItemsForRecord(record));
    if (attachPendingBuy(items, pending)) newPendingBuys += 1;
    record = syncInvestPositionItems(record, items);
    workingRecords.set(yearMonth, record);
    changedMonths.add(yearMonth);
  }

  for (const transaction of parsed.transactions) {
    const yearMonth = transaction.date.slice(0, 7);
    let record = ensureWorkingRecord(yearMonth);
    const items = cloneInvestPositionItems(investmentPositionItemsForRecord(record));
    const matches = transaction.side === 'buy' ? findPendingMatches(items, transaction) : [];
    const isUniquePendingResolution = matches.length === 1
      && transaction.shares > 0
      && (transaction.amount ?? 0) > 0;
    if (!ordinaryIds.has(transaction.id) && !isUniquePendingResolution) continue;
    if (!transaction.orderId && matches.length > 1) continue;

    const importedIds = new Set(record.importedInvestmentTransactionIds ?? []);
    const transactionLedger = new Map(
      (record.investmentTransactions ?? []).map((ledgerItem) => [ledgerItem.id, ledgerItem]),
    );
    const transactionFingerprints = new Set([...transactionLedger.values()].map(transactionFingerprint));
    const legacyTransactionFingerprints = new Set(
      [...transactionLedger.values()]
        .filter((ledgerItem) => !ledgerItem.orderId)
        .map(legacyTransactionFingerprint),
    );
    const fingerprint = transactionFingerprint(transaction);
    const legacyFingerprint = legacyTransactionFingerprint(transaction);

    if (isUniquePendingResolution) {
      removePendingMatch(items, matches[0]);
      resolvedPendingBuys += 1;
    }
    if (!importedIds.has(transaction.id)
      && !transactionFingerprints.has(fingerprint)
      && !legacyTransactionFingerprints.has(legacyFingerprint)) {
      const formalTransaction = isUniquePendingResolution
        ? {
            ...transaction,
            price: (transaction.amount ?? 0) / transaction.shares,
            costFromAmount: true,
          }
        : transaction;
      transactionLedger.set(formalTransaction.id, formalTransaction);
      transactionFingerprints.add(transactionFingerprint(formalTransaction));
      if (!formalTransaction.orderId) legacyTransactionFingerprints.add(legacyTransactionFingerprint(formalTransaction));
      applyInvestmentTransaction(items, formalTransaction);
      importedIds.add(formalTransaction.id);
      formalImportedTransactions += 1;
    } else {
      importedIds.add(transaction.id);
    }

    record = syncInvestPositionItems(record, items);
    record.investmentTransactions = [...transactionLedger.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    record.importedInvestmentTransactionIds = [...importedIds];
    workingRecords.set(yearMonth, record);
    changedMonths.add(yearMonth);
  }

  if (options?.mailUid) {
    const targetMonth = [...changedMonths].sort().at(-1) ?? [...workingRecords.keys()].sort().at(-1);
    if (targetMonth) {
      const record = ensureWorkingRecord(targetMonth);
      if (options.mailUid > (record.lastInvestmentMailUid ?? 0)) {
        workingRecords.set(targetMonth, { ...record, lastInvestmentMailUid: options.mailUid });
        changedMonths.add(targetMonth);
      }
    }
  }

  const months = [...changedMonths].sort();
  useMonthlyStore.getState().upsertMany(
    months.map((month) => workingRecords.get(month)!).filter(Boolean),
    { investmentSource: 'import' },
  );
  const latestChanged = months.at(-1);
  const remainingPendingBuys = latestChanged
    ? countPending(useMonthlyStore.getState().records.find((record) => record.yearMonth === latestChanged)?.investPositionItems)
    : 0;
  if (!options?.deferUpload) await triggerUpload();
  return {
    fileName: file.name,
    parsedTransactions: parsed.transactions.length,
    parsedPendingBuys: parsed.pendingBuys.length,
    eligibleTransactions: ordinaryTransactions.length,
    importedTransactions: formalImportedTransactions,
    formalImportedTransactions,
    newPendingBuys,
    resolvedPendingBuys,
    remainingPendingBuys,
    updatedMonths: months.length,
    months,
    editedAt,
  };
}
