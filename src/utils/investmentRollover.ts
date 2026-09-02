import type {
  InvestKey,
  InvestPositionItem,
  InvestPositionItems,
  InvestmentTransactionRecord,
  MonthlyRecord,
} from '../models/types';
import {
  migrateLegacyInvestPositionItems,
  syncInvestPositionItems,
} from './investPositionItems';

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
    next[key as keyof InvestPositionItems] = group?.map((item) => ({ ...item }));
  }
  return next;
}

function sameInstrument(item: InvestPositionItem, transaction: InvestmentTransactionRecord) {
  if (transaction.symbol) return item.symbol.trim().toUpperCase() === transaction.symbol.trim().toUpperCase();
  return item.name.trim().toLowerCase() === transaction.name.trim().toLowerCase();
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
  const nextCost = transaction.side === 'buy'
    ? (currentShares * currentCost + transaction.shares * transaction.price + transaction.fee)
      / Math.max(nextShares, transaction.shares)
    : currentCost;
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

export function replayInvestmentRecord(parent: MonthlyRecord, child: MonthlyRecord): MonthlyRecord {
  const copied = copyInvestmentEnding(parent, child);
  const items = cloneInvestPositionItems(copied.investPositionItems);
  const transactions = [...new Map(
    (child.investmentTransactions ?? [])
      .filter((transaction) => transaction.date.slice(0, 7) === child.yearMonth)
      .map((transaction) => [transaction.id, transaction]),
  ).values()]
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const transaction of transactions) applyInvestmentTransaction(items, transaction);
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
