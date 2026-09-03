import type {
  InvestKey,
  InvestPositionItem,
  InvestPositionItems,
  InvestmentTransactionRecord,
  MonthlyRecord,
} from '../models/types';
import {
  INVEST_POSITION_GROUP_KEYS,
  migrateLegacyInvestPositionItems,
  syncInvestPositionItems,
} from './investPositionItems';
import { canonicalInvestmentSymbol, isPrefixedFundSymbol } from './investmentInstrument';

const INVESTMENT_LABELS: Record<InvestKey, string> = {
  us: '美股',
  eu: '欧股',
  asia: '亚股',
  a: 'A股',
  longBond: '长债',
  usBond: '美债',
  gold: '黄金',
};

const round = (value: number, decimalPlaces: number) => {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const cloneComponents = <T extends Record<string, { cny: number; rate: number; usd: number }> | undefined>(
  components: T,
): T => (components
  ? Object.fromEntries(Object.entries(components).map(([key, value]) => [key, { ...value }])) as T
  : components);

export function cloneInvestPositionItems(items: InvestPositionItems | undefined): InvestPositionItems {
  const next: InvestPositionItems = {};
  for (const [key, group] of Object.entries(items ?? {})) {
    next[key as keyof InvestPositionItems] = group?.map((item) => ({
      ...item,
      pendingBuys: item.pendingBuys?.map((pending) => ({ ...pending })),
    }));
  }
  return next;
}

export function pendingInvestmentAmounts(
  items: InvestPositionItems | undefined,
  usdFxRate: number | null,
) {
  const amounts = Object.fromEntries(
    (['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'] as InvestKey[]).map((key) => [key, 0]),
  ) as Record<InvestKey, number>;
  for (const groupKey of Object.keys(amounts) as InvestKey[]) {
    for (const item of items?.[groupKey] ?? []) {
      for (const pending of item.pendingBuys ?? []) {
        if (!(pending.amount && pending.amount > 0)) continue;
        const currency = pending.currency.toUpperCase();
        const fxRate = ['CNY', 'CNH'].includes(currency)
          ? 1
          : currency === 'USD'
            ? usdFxRate ?? item.lastFxRateToCny
            : item.lastFxRateToCny;
        if (!(fxRate && fxRate > 0)) continue;
        amounts[groupKey] = round(amounts[groupKey] + pending.amount * fxRate, 2);
      }
    }
  }
  return amounts;
}

function sameInstrument(item: InvestPositionItem, transaction: InvestmentTransactionRecord) {
  if (transaction.symbol) return canonicalInvestmentSymbol(item.symbol) === canonicalInvestmentSymbol(transaction.symbol);
  return item.name.trim().toLowerCase() === transaction.name.trim().toLowerCase();
}

function positionQuality(item: InvestPositionItem) {
  let quality = 0;
  if (item.symbol === canonicalInvestmentSymbol(item.symbol)) quality += 2;
  if (item.quoteSource === 'eastmoney-fund') quality += 2;
  if (item.lastPrice && item.lastPrice > 0) quality += 1;
  return quality;
}

function mergeSamePosition(left: InvestPositionItem, right: InvestPositionItem): InvestPositionItem {
  const leftShares = Math.max(Number(left.shares) || 0, 0);
  const rightShares = Math.max(Number(right.shares) || 0, 0);
  const shares = round(leftShares + rightShares, 4);
  const costPrice = shares > 0
    ? round((leftShares * Math.max(Number(left.costPrice) || 0, 0)
      + rightShares * Math.max(Number(right.costPrice) || 0, 0)) / shares, 4)
    : Math.max(Number(left.costPrice) || Number(right.costPrice) || 0, 0);
  const preferred = positionQuality(right) > positionQuality(left) ? right : left;
  const fallback = preferred === left ? right : left;
  const symbol = canonicalInvestmentSymbol(preferred.symbol || fallback.symbol);
  const pendingById = new Map(
    [...(left.pendingBuys ?? []), ...(right.pendingBuys ?? [])]
      .map((pending) => [pending.id, { ...pending }]),
  );
  return {
    ...fallback,
    ...preferred,
    symbol,
    quoteSource: /^\d{6}$/.test(symbol) ? 'eastmoney-fund' : preferred.quoteSource ?? fallback.quoteSource,
    quoteCurrency: /^\d{6}$/.test(symbol) ? 'CNY' : preferred.quoteCurrency ?? fallback.quoteCurrency,
    status: shares > 0.0000001 ? 'active' : preferred.status,
    shares,
    costPrice,
    historicalProfitCny: round(
      (Number(left.historicalProfitCny) || 0) + (Number(right.historicalProfitCny) || 0),
      2,
    ),
    pendingBuys: pendingById.size > 0 ? [...pendingById.values()] : undefined,
  };
}

function inferFundUnderlyingGroup(text: string): InvestKey | undefined {
  const normalized = text.trim().toLowerCase();
  if (/黄金|gold/.test(normalized)) return 'gold';
  if (/美债|美国(?:国债|公债)|us\s*(?:bond|treasury)/.test(normalized)) return 'usBond';
  if (/长债|长期债|国债|债券/.test(normalized)) return 'longBond';
  if (/欧股|欧洲|欧(?:a|c)?(?:\s|$)|europe|euro/.test(normalized)) return 'eu';
  if (/亚股|亚洲|日经|日本|日股|港股|香港|asia/.test(normalized)) return 'asia';
  if (/美股|美国|标普|纳指|nasdaq|s&p|us\s*stock/.test(normalized)) return 'us';
  return undefined;
}

export function normalizeInvestmentRecordInstruments(record: MonthlyRecord): MonthlyRecord {
  if (!record.investPositionItems && !record.investmentTransactions) return record;
  const shouldRepairCategories = (record.investmentCategoryRepairVersion ?? 0) < 1;
  const normalizedItems: InvestPositionItems = {};
  const itemIndexes = new Map<string, { groupKey: keyof InvestPositionItems; index: number }>();
  const itemGroupBySymbol = new Map<string, InvestKey>();
  const transactionNamesBySymbol = new Map<string, string[]>();
  for (const transaction of record.investmentTransactions ?? []) {
    const symbol = canonicalInvestmentSymbol(transaction.symbol);
    if (!symbol) continue;
    transactionNamesBySymbol.set(symbol, [...(transactionNamesBySymbol.get(symbol) ?? []), transaction.name]);
  }
  const groupOrder = ['a', ...INVEST_POSITION_GROUP_KEYS.filter((key) => key !== 'a')] as const;
  for (const groupKey of groupOrder) {
    for (const item of record.investPositionItems?.[groupKey] ?? []) {
      const originalSymbol = item.symbol;
      const symbol = canonicalInvestmentSymbol(originalSymbol);
      const isFund = /^\d{6}$/.test(symbol)
        && (isPrefixedFundSymbol(originalSymbol) || item.quoteSource === 'eastmoney-fund');
      const inferredGroup = shouldRepairCategories && groupKey === 'a' && isFund
        ? inferFundUnderlyingGroup([item.name, ...(transactionNamesBySymbol.get(symbol) ?? [])].join(' '))
        : undefined;
      const targetGroup = inferredGroup ?? groupKey;
      const normalizedItem: InvestPositionItem = {
        ...item,
        symbol,
        quoteSource: isPrefixedFundSymbol(originalSymbol) ? 'eastmoney-fund' : item.quoteSource,
        quoteCurrency: isPrefixedFundSymbol(originalSymbol) ? 'CNY' : item.quoteCurrency,
        pendingBuys: targetGroup !== 'account' && targetGroup !== 'aggregate'
          ? item.pendingBuys?.map((pending) => ({ ...pending, groupKey: targetGroup }))
          : item.pendingBuys,
      };
      const comparisonKey = symbol && targetGroup !== 'account' && targetGroup !== 'aggregate'
        ? `symbol:${symbol}`
        : `name:${targetGroup}:${item.name.trim().toLowerCase()}:${item.id}`;
      const existing = itemIndexes.get(comparisonKey);
      if (!existing) {
        const group = normalizedItems[targetGroup] ?? [];
        itemIndexes.set(comparisonKey, { groupKey: targetGroup, index: group.length });
        if (symbol && targetGroup !== 'account' && targetGroup !== 'aggregate') itemGroupBySymbol.set(symbol, targetGroup);
        normalizedItems[targetGroup] = [...group, normalizedItem];
        continue;
      }
      const group = [...(normalizedItems[existing.groupKey] ?? [])];
      group[existing.index] = mergeSamePosition(group[existing.index], normalizedItem);
      normalizedItems[existing.groupKey] = group;
    }
  }
  const transactions = record.investmentTransactions?.map((transaction) => {
    const originalSymbol = transaction.symbol;
    const symbol = canonicalInvestmentSymbol(originalSymbol);
    const isFundAlias = isPrefixedFundSymbol(originalSymbol) && /^\d{6}$/.test(symbol);
    const inferredGroup = shouldRepairCategories && transaction.groupKey === 'a'
      && (isFundAlias || transaction.quoteSource === 'eastmoney-fund')
      ? inferFundUnderlyingGroup(transaction.name)
      : undefined;
    return {
      ...transaction,
      symbol,
      groupKey: itemGroupBySymbol.get(symbol) ?? inferredGroup ?? transaction.groupKey,
      currency: isFundAlias ? 'CNY' : transaction.currency,
      quoteSource: isFundAlias ? 'eastmoney-fund' as const : transaction.quoteSource,
    };
  });
  if (!record.investPositionItems) {
    return { ...record, investmentTransactions: transactions, investmentCategoryRepairVersion: 1 };
  }
  const normalizedRecord = syncInvestPositionItems(record, normalizedItems);
  return { ...normalizedRecord, investmentTransactions: transactions, investmentCategoryRepairVersion: 1 };
}

export function applyInvestmentTransaction(
  items: InvestPositionItems,
  transaction: InvestmentTransactionRecord,
) {
  const group = [...(items[transaction.groupKey] ?? [])];
  const existingIndex = group.findIndex((item) => sameInstrument(item, transaction));
  const existing = existingIndex >= 0 ? group[existingIndex] : undefined;
  const currentShares = Math.max(existing?.shares ?? 0, 0);
  const currentCost = Math.max(existing?.costPrice ?? 0, 0);
  const currentHistory = Number(existing?.historicalProfitCny) || 0;
  const nextShares = transaction.side === 'buy'
    ? currentShares + transaction.shares
    : Math.max(currentShares - transaction.shares, 0);
  const addedCost = transaction.costFromAmount && transaction.amount !== undefined
    ? transaction.amount
    : transaction.shares * transaction.price + transaction.fee;
  const nextCost = transaction.side === 'buy'
    ? (currentShares * currentCost + addedCost)
      / Math.max(nextShares, transaction.shares)
    : currentCost;
  const transactionAmount = Math.max(transaction.amount ?? transaction.shares * transaction.price, 0);
  const fallbackFxRate = ['CNY', 'CNH'].includes(transaction.currency.toUpperCase())
    ? 1
    : Math.max(existing?.lastFxRateToCny ?? 0, 1);
  const fallbackMarketValue = transaction.side === 'buy'
    ? Math.max(existing?.marketValueCny ?? 0, 0) + transactionAmount * fallbackFxRate
    : Math.max((existing?.marketValueCny ?? 0) - transactionAmount * fallbackFxRate, 0);
  const nextItem: InvestPositionItem = {
    ...(existing ?? {}),
    id: existing?.id ?? `mail-position:${stableHash(`${transaction.groupKey}:${transaction.symbol || transaction.name}`)}`,
    name: existing?.name || transaction.name,
    symbol: transaction.symbol,
    quoteSource: existing?.quoteSource ?? transaction.quoteSource,
    quoteCurrency: existing?.quoteCurrency ?? transaction.currency,
    status: nextShares > 0.0000001 ? 'active' : 'paused',
    shares: round(nextShares, 4),
    costPrice: round(nextCost, 4),
    historicalProfitCny: round(currentHistory, 2),
    historicalProfitCurrency: existing?.historicalProfitCurrency ?? transaction.currency,
    profitInputMode: existing?.profitInputMode ?? (existing ? undefined : 'historical'),
    marketValueCny: existing?.lastPrice ? existing.marketValueCny : round(fallbackMarketValue, 2),
  };
  if (existingIndex >= 0) group[existingIndex] = nextItem;
  else group.push(nextItem);
  items[transaction.groupKey] = group;
}

export function investmentPositionItemsForRecord(record: MonthlyRecord): InvestPositionItems {
  return cloneInvestPositionItems(migrateLegacyInvestPositionItems(record, INVESTMENT_LABELS));
}

function copyInvestmentEnding(parent: MonthlyRecord, child: MonthlyRecord): MonthlyRecord {
  const items = investmentPositionItemsForRecord(parent);
  const synced = syncInvestPositionItems({ ...child }, items);
  return {
    ...synced,
    accumulatedProfit: parent.accumulatedProfit,
    manualAccumulatedProfit: parent.manualAccumulatedProfit,
    investProfitComponents: cloneComponents(parent.investProfitComponents),
    investPastProfitComponents: cloneComponents(parent.investPastProfitComponents),
    investmentEditedAt: parent.investmentEditedAt,
  };
}

function investmentStateFingerprint(record: MonthlyRecord) {
  return JSON.stringify({
    accumulatedProfit: record.accumulatedProfit,
    manualAccumulatedProfit: record.manualAccumulatedProfit,
    investTotal: record.investTotal,
    investBreakdown: record.investBreakdown,
    investBreakdownProfit: record.investBreakdownProfit,
    investProfitComponents: record.investProfitComponents,
    investBreakdownPastProfit: record.investBreakdownPastProfit,
    investPastProfitComponents: record.investPastProfitComponents,
    investPositionItems: record.investPositionItems,
    investmentEditedAt: record.investmentEditedAt,
  });
}

export function hasSameInvestmentEnding(left: MonthlyRecord, right: MonthlyRecord) {
  return investmentStateFingerprint(left) === investmentStateFingerprint(right);
}

export function emptyMonthlyRecord(yearMonth: string): MonthlyRecord {
  return {
    yearMonth,
    income: 0,
    totalExpense: 0,
    accumulatedProfit: 0,
    investTotal: 0,
    volatileLife: 0,
    periodicLife: 0,
    consumption: 0,
    school: 0,
    homeDays: 0,
    travelDays: 0,
    majorExpenses: [],
  };
}

export function hasInvestmentEndingState(record: MonthlyRecord | undefined) {
  if (!record) return false;
  return record.investPositionItems !== undefined
    || record.investBreakdown !== undefined
    || record.investBreakdownProfit !== undefined
    || record.investBreakdownPastProfit !== undefined
    || Math.abs(Number(record.investTotal) || 0) > 0.005
    || Math.abs(Number(record.accumulatedProfit) || 0) > 0.005
    || Boolean(record.investmentEditedAt)
    || (record.investmentTransactions?.length ?? 0) > 0;
}

export function createInvestmentRolloverRecord(
  parent: MonthlyRecord,
  yearMonth: string,
  existing?: MonthlyRecord,
): MonthlyRecord {
  const child = {
    ...(existing ?? emptyMonthlyRecord(yearMonth)),
    yearMonth,
    investmentTransactions: existing?.investmentTransactions?.map((transaction) => ({ ...transaction })) ?? [],
    importedInvestmentTransactionIds: [...(existing?.importedInvestmentTransactionIds ?? [])],
    investmentRolledOverFrom: parent.yearMonth,
  };
  return replayInvestmentRecord(parent, child);
}

function removeResolvedPendingBuy(items: InvestPositionItems, transaction: InvestmentTransactionRecord) {
  if (transaction.side !== 'buy' || (!transaction.orderId && !transaction.pendingMatchKey)) return;
  const matches: { groupKey: InvestKey; itemIndex: number; pendingIndex: number }[] = [];
  for (const groupKey of INVEST_POSITION_GROUP_KEYS) {
    if (groupKey === 'account' || groupKey === 'aggregate') continue;
    (items[groupKey] ?? []).forEach((item, itemIndex) => {
      (item.pendingBuys ?? []).forEach((pending, pendingIndex) => {
        const exact = transaction.orderId
          ? pending.orderId === transaction.orderId
          : pending.matchKey === transaction.pendingMatchKey;
        const missingAmountFallback = !transaction.orderId
          && !pending.amount
          && pending.baseMatchKey === transaction.pendingBaseMatchKey;
        if (exact || missingAmountFallback) matches.push({ groupKey, itemIndex, pendingIndex });
      });
    });
  }
  if (matches.length !== 1) return;
  const match = matches[0];
  const group = [...(items[match.groupKey] ?? [])];
  const item = group[match.itemIndex];
  const pendingBuys = (item.pendingBuys ?? []).filter((_, index) => index !== match.pendingIndex);
  group[match.itemIndex] = { ...item, pendingBuys: pendingBuys.length > 0 ? pendingBuys : undefined };
  items[match.groupKey] = group;
}

export function replayInvestmentRecord(parent: MonthlyRecord, child: MonthlyRecord): MonthlyRecord {
  const copied = copyInvestmentEnding(parent, child);
  const items = cloneInvestPositionItems(copied.investPositionItems);
  const transactions = [...new Map(
    (child.investmentTransactions ?? [])
      .filter((transaction) => transaction.date.slice(0, 7) === child.yearMonth)
      .map((transaction) => [transaction.id, transaction]),
  ).values()]
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const transaction of transactions) {
    removeResolvedPendingBuy(items, transaction);
    applyInvestmentTransaction(items, transaction);
  }
  const replayed = syncInvestPositionItems(copied, items);
  const candidate: MonthlyRecord = {
    ...replayed,
    accumulatedProfit: copied.accumulatedProfit,
    manualAccumulatedProfit: copied.manualAccumulatedProfit,
    investmentTransactions: child.investmentTransactions,
    importedInvestmentTransactionIds: child.importedInvestmentTransactionIds,
    lastInvestmentMailUid: child.lastInvestmentMailUid,
    investmentRolledOverFrom: child.investmentRolledOverFrom,
    investmentInheritanceRevision: child.investmentInheritanceRevision,
  };
  if (investmentStateFingerprint(candidate) === investmentStateFingerprint(child)) return child;
  return {
    ...candidate,
    investmentInheritanceRevision: (child.investmentInheritanceRevision ?? 0) + 1,
  };
}

export function propagateInvestmentInheritance(
  records: MonthlyRecord[],
  changedMonths: Iterable<string>,
): MonthlyRecord[] {
  const byMonth = new Map(records.map((record) => [record.yearMonth, record]));
  const dirty = new Set(changedMonths);
  const ascending = [...byMonth.values()].sort((left, right) => left.yearMonth.localeCompare(right.yearMonth));
  for (const originalChild of ascending) {
    const child = byMonth.get(originalChild.yearMonth)!;
    const parentMonth = child.investmentRolledOverFrom;
    if (!parentMonth || parentMonth >= child.yearMonth || !dirty.has(parentMonth)) continue;
    const parent = byMonth.get(parentMonth);
    if (!parent) continue;
    const replayed = replayInvestmentRecord(parent, child);
    if (replayed === child) continue;
    byMonth.set(child.yearMonth, replayed);
    dirty.add(child.yearMonth);
  }
  return [...byMonth.values()].sort((left, right) => right.yearMonth.localeCompare(left.yearMonth));
}
