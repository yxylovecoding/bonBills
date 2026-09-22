import type { InvestKey, InvestPositionItem, InvestPositionItems, InvestmentTransactionRecord, MonthlyRecord, PendingInvestmentBuy } from '../models/types';
import { canonicalInvestmentSymbol } from './investmentInstrument';
import { syncInvestPositionItems } from './investPositionItems';
import { applyInvestmentTransaction, cloneInvestPositionItems, investmentApplicationOrder, nextInvestmentApplicationOrder, updatePendingBuyFromTransaction } from './investmentRollover';
import type { PendingFundEstimate } from './pendingFundEstimate';

const roundShares = (value: number) => Math.round(value * 10_000) / 10_000;
const sameSymbol = (left: string, right: string) => canonicalInvestmentSymbol(left) === canonicalInvestmentSymbol(right);

export function matchesInvestmentOrder(
  transaction: InvestmentTransactionRecord,
  entry: PendingInvestmentBuy | InvestmentTransactionRecord,
  allowAmountChange = false,
) {
  if (transaction.side !== 'buy' || !sameSymbol(transaction.symbol, entry.symbol)
    || transaction.currency.toUpperCase() !== entry.currency.toUpperCase()) return false;
  if (transaction.orderId && entry.orderId) return transaction.orderId === entry.orderId;
  const baseKey = 'baseMatchKey' in entry ? entry.baseMatchKey : entry.pendingBaseMatchKey;
  const matchKey = 'matchKey' in entry ? entry.matchKey : entry.pendingMatchKey;
  return Boolean((matchKey && transaction.pendingMatchKey === matchKey)
    || (allowAmountChange && baseKey && transaction.pendingBaseMatchKey === baseKey));
}

export function bookPendingFundBuy(
  record: MonthlyRecord,
  pendingId: string,
  estimate: PendingFundEstimate,
): MonthlyRecord {
  const items = cloneInvestPositionItems(record.investPositionItems);
  const found = Object.entries(items).flatMap(([groupKey, group]) => (group ?? []).flatMap((item) =>
    (item.pendingBuys ?? []).filter((pending) => pending.id === pendingId).map((pending) => ({ groupKey, item, pending }))));
  if (found.length !== 1) return record;
  const { pending, item, groupKey } = found[0];
  if (pending.booking || groupKey === 'account' || groupKey === 'aggregate'
    || !(pending.amount && pending.amount > 0) || !(estimate.shares > 0) || !(estimate.price > 0)) return record;
  const ledger = record.investmentTransactions ?? [];
  if (ledger.some((transaction) => matchesInvestmentOrder(transaction, pending))) return record;
  const sameOrders = Object.values(items).flatMap((group) => (group ?? []).flatMap((position) => position.pendingBuys ?? []))
    .filter((candidate) => pending.orderId ? candidate.orderId === pending.orderId : candidate.baseMatchKey === pending.baseMatchKey);
  if (sameOrders.length !== 1) return record;
  // Late-published NAVs enter the current open month; closed monthly snapshots keep their pending state.
  const date = estimate.navDate < `${record.yearMonth}-01` ? `${record.yearMonth}-01` : estimate.navDate;
  if (date.slice(0, 7) !== record.yearMonth) return record;
  const transaction: InvestmentTransactionRecord = {
    id: `auto-invest:${pending.id}`, date, side: 'buy', name: pending.name, symbol: canonicalInvestmentSymbol(pending.symbol),
    groupKey: groupKey as InvestKey, shares: estimate.shares, price: estimate.price, fee: pending.fee ?? 0,
    currency: pending.currency, quoteSource: 'eastmoney-fund', amount: pending.amount, costFromAmount: true,
    operationAt: pending.operationAt, occurredAt: pending.operationAt, account: pending.account, orderId: pending.orderId,
    pendingMatchKey: pending.matchKey, pendingBaseMatchKey: pending.baseMatchKey,
    applicationOrder: nextInvestmentApplicationOrder(ledger),
    autoBuy: {
      pendingId, status: 'estimated', navDate: estimate.navDate, beforeFee: estimate.beforeFee,
      beforeShares: item.shares ?? 0, beforeCostPrice: item.costPrice ?? 0,
      previousTransactionIds: ledger.map((entry) => entry.id),
    },
  };
  applyInvestmentTransaction(items, transaction);
  updatePendingBuyFromTransaction(items, transaction);
  return {
    ...syncInvestPositionItems(record, items),
    investmentTransactions: [...ledger, transaction],
    investmentInheritanceRevision: (record.investmentInheritanceRevision ?? 0) + 1,
  };
}

function positionForSymbol(items: InvestPositionItems | undefined, symbol: string) {
  for (const [key, group] of Object.entries(items ?? {})) {
    if (key === 'account' || key === 'aggregate') continue;
    const item = group?.find((candidate) => sameSymbol(candidate.symbol, symbol));
    if (item) return { key: key as InvestKey, item };
  }
  return null;
}

/** Replace the existing booking and replay its later buys/sells to calculate only the correction. */
export function reconcileAutoFundBuy(records: MonthlyRecord[], actual: InvestmentTransactionRecord) {
  const allBookings = records.flatMap((record) => (record.investmentTransactions ?? [])
    .filter((transaction) => transaction.autoBuy)
    .map((transaction) => ({ record, transaction })));
  const exact = allBookings.filter(({ transaction }) => matchesInvestmentOrder(transaction, actual));
  const candidates = exact.length ? exact : allBookings.filter(({ transaction }) => matchesInvestmentOrder(transaction, actual, true));
  if (candidates.length !== 1) return { matched: candidates.length > 0, records, changedMonths: [] as string[] };
  const { record: owner, transaction: booked } = candidates[0];
  const meta = booked.autoBuy!;
  const replacement: InvestmentTransactionRecord = {
    ...actual, id: booked.id, date: booked.date, groupKey: booked.groupKey, costFromAmount: true,
    applicationOrder: booked.applicationOrder, autoBuy: { ...meta, status: 'reconciled' },
  };
  const previousIds = new Set(meta.previousTransactionIds);
  const following = records.filter((record) => record.yearMonth >= owner.yearMonth)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
    .flatMap((record) => [...(record.investmentTransactions ?? [])].sort(investmentApplicationOrder)
      .filter((transaction) => transaction.id !== booked.id && !previousIds.has(transaction.id)
        && sameSymbol(transaction.symbol, booked.symbol))
      .map((transaction) => ({ month: record.yearMonth, transaction })));
  const oldItems: InvestPositionItems = { [booked.groupKey]: [{
    id: 'replay', name: booked.name, symbol: booked.symbol, quoteCurrency: booked.currency,
    status: 'active', shares: meta.beforeShares, costPrice: meta.beforeCostPrice, historicalProfitCny: 0,
  }] };
  const newItems = cloneInvestPositionItems(oldItems);
  applyInvestmentTransaction(oldItems, booked);
  applyInvestmentTransaction(newItems, replacement);
  const replacements = new Map([[booked.id, replacement]]);
  const changedMonths: string[] = [];
  let cursor = 0;
  const result = new Map(records.map((record) => [record.yearMonth, record]));
  for (const record of [...records].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))) {
    if (record.yearMonth < owner.yearMonth) continue;
    while (cursor < following.length && following[cursor].month <= record.yearMonth) {
      const transaction = following[cursor++].transaction;
      const before = positionForSymbol(newItems, booked.symbol)!.item;
      const updated = transaction.autoBuy ? {
        ...transaction, autoBuy: { ...transaction.autoBuy, beforeShares: before.shares ?? 0, beforeCostPrice: before.costPrice ?? 0 },
      } : transaction;
      replacements.set(transaction.id, updated);
      // Simulations use one group even when the position was moved between categories later.
      applyInvestmentTransaction(oldItems, { ...transaction, groupKey: booked.groupKey });
      applyInvestmentTransaction(newItems, { ...updated, groupKey: booked.groupKey });
    }
    const position = positionForSymbol(record.investPositionItems, booked.symbol);
    const hasBooking = position?.item.pendingBuys?.some((pending) => pending.booking?.transactionId === booked.id);
    if (record.yearMonth !== owner.yearMonth && !hasBooking) continue;
    const items = cloneInvestPositionItems(record.investPositionItems);
    if (position) {
      const oldEnd = positionForSymbol(oldItems, booked.symbol)!.item;
      const newEnd = positionForSymbol(newItems, booked.symbol)!.item;
      const shares = roundShares(Math.max(0, (position.item.shares ?? 0) + (newEnd.shares ?? 0) - (oldEnd.shares ?? 0)));
      const cost = (position.item.shares ?? 0) * (position.item.costPrice ?? 0)
        + (newEnd.shares ?? 0) * (newEnd.costPrice ?? 0) - (oldEnd.shares ?? 0) * (oldEnd.costPrice ?? 0);
      const pendingBuys = (position.item.pendingBuys ?? []).filter((pending) => pending.booking?.transactionId !== booked.id);
      const corrected: InvestPositionItem = {
        ...position.item, shares, costPrice: shares > 0 ? roundShares(Math.max(0, cost) / shares) : position.item.costPrice,
        status: shares > 0 ? position.item.status : 'paused', pendingBuys: pendingBuys.length ? pendingBuys : undefined,
      };
      items[position.key] = items[position.key]?.map((item) => item.id === corrected.id ? corrected : item);
    }
    const next = {
      ...syncInvestPositionItems(record, items),
      investmentTransactions: record.investmentTransactions?.map((transaction) => replacements.get(transaction.id) ?? transaction),
      importedInvestmentTransactionIds: record.yearMonth === owner.yearMonth
        ? [...new Set([...(record.importedInvestmentTransactionIds ?? []), actual.id])]
        : record.importedInvestmentTransactionIds,
    };
    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    result.set(record.yearMonth, { ...next, investmentInheritanceRevision: (record.investmentInheritanceRevision ?? 0) + 1 });
    changedMonths.push(record.yearMonth);
  }
  return { matched: true, records: [...result.values()], changedMonths };
}
