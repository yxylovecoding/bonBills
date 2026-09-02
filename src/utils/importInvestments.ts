import * as XLSX from 'xlsx';
import type {
  InvestKey,
  InvestQuoteSource,
  InvestmentTransactionRecord,
  MonthlyRecord,
} from '../models/types';
import { useMonthlyStore } from '../stores/monthlyStore';
import { syncInvestPositionItems } from './investPositionItems';
import { normalizeBillDate } from './importBill';
import {
  applyInvestmentTransaction,
  cloneInvestPositionItems,
  createInvestmentRolloverRecord,
  emptyMonthlyRecord,
  hasInvestmentEndingState,
  investmentPositionItemsForRecord,
} from './investmentRollover';
import { triggerUpload } from './syncEngine';

type InvestmentSide = 'buy' | 'sell';

export type InvestmentTransaction = InvestmentTransactionRecord;

const HEADER_ALIASES = {
  transactionId: ['流水号', '交易流水号', '业务流水号', '订单号', '成交编号', '委托编号'],
  date: ['日期', '交易日期', '成交日期', '发生日期', '操作日期', '确认日期', '时间'],
  side: ['操作', '交易类型', '业务名称', '买卖方向', '交易', '类型'],
  name: ['名称', '证券名称', '基金名称', '股票名称', '产品名称', '标的名称', '理财账户'],
  symbol: ['代码', '证券代码', '基金代码', '股票代码', '产品代码', '标的代码', '理财代码'],
  shares: ['份额', '数量', '成交数量', '发生份额', '成交份额', '交易份额'],
  price: ['成交价', '成交价格', '净值', '价格', '单位净值'],
  amount: ['金额', '成交金额', '发生金额', '交易金额', '总金额'],
  fee: ['手续费', '费用', '交易费用', '佣金'],
  currency: ['币种', '货币', '交易币种'],
  category: ['品类', '类别', '市场', '资产类别', '投资类型'],
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
    if (indexes.date !== undefined && indexes.side !== undefined && (indexes.name !== undefined || indexes.symbol !== undefined)) {
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

function normalizeInstrumentSymbol(raw: string, category: string, name: string, currency: string) {
  const symbol = raw.trim().toUpperCase().replace(/\.0+$/, '');
  if (!/^\d+$/.test(symbol)) return symbol;
  if (currency === 'HKD' || /港股|香港/.test(category)) return symbol.padStart(5, '0');
  if (currency === 'CNY' || /基金|A股|沪深|上证|深证/i.test(`${category} ${name}`)) return symbol.padStart(6, '0');
  return symbol;
}

function inferGroupKey(category: string, symbol: string, name: string, currency: string): InvestKey {
  const text = `${category} ${name}`.toLowerCase();
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
  if (transaction.occurredAt?.includes('T')) return transaction.occurredAt > edit;
  // 账表只有日期时保留同日的新流水，交易 ID 会负责防重。
  return transaction.date >= edit.slice(0, 10);
}

export async function parseInvestmentFile(file: File): Promise<InvestmentTransaction[]> {
  const isCsv = /\.csv$/i.test(file.name) || file.type.toLowerCase().includes('csv');
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string', cellDates: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const transactions: InvestmentTransaction[] = [];
  const identityOccurrences = new Map<string, number>();
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    const header = findHeaderRow(rows);
    if (!header) continue;
    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rawDate = row[header.indexes.date!];
      const date = normalizeTransactionDate(rawDate);
      const sideText = stringCell(row, header.indexes.side);
      const side = parseSide(sideText);
      const name = stringCell(row, header.indexes.name);
      const rawSymbol = stringCell(row, header.indexes.symbol);
      const category = stringCell(row, header.indexes.category);
      const rawCurrency = stringCell(row, header.indexes.currency).toUpperCase();
      const symbol = normalizeInstrumentSymbol(rawSymbol, category, name, rawCurrency);
      if (!date || !side || (!name && !symbol)) continue;
      const amount = numberCell(row, header.indexes.amount);
      const rawShares = numberCell(row, header.indexes.shares);
      const rawPrice = numberCell(row, header.indexes.price);
      const shares = rawShares || (rawPrice > 0 ? amount / rawPrice : 0);
      const price = rawPrice || (shares > 0 ? amount / shares : 0);
      if (!(shares > 0) || !(price > 0)) continue;
      const preliminaryGroup = inferGroupKey(category, symbol, name, rawCurrency);
      const currency = rawCurrency || (preliminaryGroup === 'us' || preliminaryGroup === 'usBond' ? 'USD' : 'CNY');
      const groupKey = inferGroupKey(category, symbol, name, currency);
      const fee = numberCell(row, header.indexes.fee);
      const transactionId = stringCell(row, header.indexes.transactionId);
      const dateIdentity = rawDate instanceof Date && Number.isFinite(rawDate.getTime())
        ? rawDate.toISOString()
        : String(rawDate ?? '').trim();
      const identity = [transactionId || dateIdentity || date, side, symbol, name, shares.toFixed(6), price.toFixed(6), fee.toFixed(2), currency].join('|');
      const occurrence = identityOccurrences.get(identity) ?? 0;
      identityOccurrences.set(identity, occurrence + 1);
      transactions.push({
        id: `mail-invest:${stableHash(`${identity}|${occurrence}`)}`,
        date,
        occurredAt: normalizeTransactionOccurredAt(rawDate, date),
        side,
        name: name || symbol,
        symbol,
        groupKey,
        shares,
        price,
        fee,
        currency,
        quoteSource: inferQuoteSource(symbol, name),
      });
    }
  }
  return transactions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export async function importInvestmentFileIntoStores(file: File, options?: { mailUid?: number }) {
  const parsedTransactions = await parseInvestmentFile(file);
  if (parsedTransactions.length === 0) throw new Error('未识别到理财买入或卖出记录');
  const editedAt = useMonthlyStore.getState().records.reduce<string | undefined>(
    (latest, record) => record.investmentEditedAt && (!latest || record.investmentEditedAt > latest)
      ? record.investmentEditedAt
      : latest,
    undefined,
  );
  const transactions = editedAt
    ? parsedTransactions.filter((transaction) => transactionIsAfterEdit(transaction, editedAt))
    : parsedTransactions;
  let importedTransactions = 0;
  const pendingRecords: MonthlyRecord[] = [];
  const workingRecords = new Map(
    useMonthlyStore.getState().records.map((record) => [record.yearMonth, record]),
  );
  const months = [...new Set(transactions.map((transaction) => transaction.date.slice(0, 7)))].sort();
  for (const yearMonth of months) {
    const existing = workingRecords.get(yearMonth);
    const previous = [...workingRecords.values()]
      .filter((record) => record.yearMonth < yearMonth && hasInvestmentEndingState(record))
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0];
    const base = existing && hasInvestmentEndingState(existing)
      ? existing
      : previous
        ? createInvestmentRolloverRecord(previous, yearMonth, existing)
        : existing ?? emptyMonthlyRecord(yearMonth);
    let record = { ...base };
    const items = cloneInvestPositionItems(investmentPositionItemsForRecord(record));
    const importedIds = new Set(record.importedInvestmentTransactionIds ?? []);
    const transactionLedger = new Map(
      (record.investmentTransactions ?? []).map((transaction) => [transaction.id, transaction]),
    );
    for (const transaction of transactions.filter((item) => item.date.startsWith(yearMonth))) {
      transactionLedger.set(transaction.id, transaction);
      if (importedIds.has(transaction.id)) continue;
      applyInvestmentTransaction(items, transaction);
      importedIds.add(transaction.id);
      importedTransactions += 1;
    }
    record = syncInvestPositionItems(record, items);
    record.investmentTransactions = [...transactionLedger.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    record.importedInvestmentTransactionIds = [...importedIds];
    if (options?.mailUid && options.mailUid > (record.lastInvestmentMailUid ?? 0)) {
      record.lastInvestmentMailUid = options.mailUid;
    }
    workingRecords.set(yearMonth, record);
    pendingRecords.push(record);
  }
  const store = useMonthlyStore.getState();
  store.upsertMany(pendingRecords, { investmentSource: 'import' });
  if (months.length === 0 && options?.mailUid) {
    const latest = [...useMonthlyStore.getState().records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0];
    if (latest && options.mailUid > (latest.lastInvestmentMailUid ?? 0)) {
      useMonthlyStore.getState().upsert({ ...latest, lastInvestmentMailUid: options.mailUid });
    }
  }
  await triggerUpload();
  return { fileName: file.name, importedTransactions, updatedMonths: months.length, editedAt };
}
