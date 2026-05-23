import type { PossessionItem, PossessionTxn, TagKind } from '../models/types';
import type { ExpenseScope } from '../stores/expenseScopeOverrideStore';

export interface PossessionSplit {
  cost: number;
  qty: number;
  share: number;
}

export interface ConsumableStats {
  totalQty: number;
  totalCost: number;
  activeQty: number;
  consumedQty: number;
  firstDate: string | null;
  activeStartDate: string | null;
  latestDoneDate: string | null;
  days: number;
  avgPricePerUnit: number;
  minPricePerUnit: number;
  latestPricePerUnit: number;
  avgUsagePerDay: number;
  avgUsagePerMonth: number;
  monthlyCost: number;
  estimatedUsedQty: number;
  estimatedRemainingQty: number;
  progress: number;
  runoutDate: string | null;
  byScope: Record<ExpenseScope, PossessionSplit>;
  byScene: Record<TagKind, PossessionSplit>;
}

export interface DurableStats {
  purchase: PossessionTxn | null;
  resale: PossessionTxn | null;
  startDate: string | null;
  endDate: string;
  days: number;
  netCost: number;
  costPerDay: number;
  label: string;
}

const SCENE_KEYS: TagKind[] = ['intern', 'school', 'home', 'travel'];

function emptySplit(): PossessionSplit {
  return { cost: 0, qty: 0, share: 0 };
}

function dateMs(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function daysBetween(from: string, to: string) {
  const diff = Math.round((dateMs(to) - dateMs(from)) / 86_400_000);
  return Number.isFinite(diff) ? diff : 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function addDays(date: string, days: number) {
  const next = new Date(dateMs(date) + Math.round(days) * 86_400_000);
  return next.toISOString().slice(0, 10);
}

function unitPrice(txn: PossessionTxn) {
  const qty = txn.quantity ?? 0;
  return qty > 0 ? txn.amount / qty : 0;
}

function withShares<T extends Record<string, PossessionSplit>>(splits: T, totalCost: number): T {
  for (const split of Object.values(splits)) {
    split.cost = round2(split.cost);
    split.qty = round2(split.qty);
    split.share = totalCost > 0 ? split.cost / totalCost : 0;
  }
  return splits;
}

export function calcConsumableStats(item: PossessionItem, today: string): ConsumableStats {
  const purchaseTxns = item.txns.filter((txn) => txn.kind === 'purchase');
  const totalQty = purchaseTxns.reduce((sum, txn) => sum + (txn.quantity ?? 0), 0);
  const totalCost = purchaseTxns.reduce((sum, txn) => sum + txn.amount, 0);
  const activeTxns = purchaseTxns.filter((txn) => !txn.done);
  const doneTxns = purchaseTxns.filter((txn) => txn.done);
  const activeQty = activeTxns.reduce((sum, txn) => sum + (txn.quantity ?? 0), 0);
  const consumedQty = doneTxns.reduce((sum, txn) => sum + (txn.quantity ?? 0), 0);
  const firstDate = purchaseTxns.reduce<string | null>((min, txn) => (
    !min || txn.date < min ? txn.date : min
  ), null);
  const activeStartDate = activeTxns.reduce<string | null>((min, txn) => (
    !min || txn.date < min ? txn.date : min
  ), null);
  const latestDoneDate = doneTxns.reduce<string | null>((max, txn) => {
    const date = txn.doneAt ?? txn.date;
    return !max || date > max ? date : max;
  }, null);
  const usageStartDate = doneTxns.length > 0 ? firstDate : firstDate;
  const usageEndDate = doneTxns.length > 0 ? latestDoneDate : today;
  const days = usageStartDate && usageEndDate ? Math.max(1, daysBetween(usageStartDate, usageEndDate)) : 1;
  const avgPricePerUnit = totalQty > 0 ? totalCost / totalQty : 0;
  const pricedTxns = purchaseTxns.filter((txn) => (txn.quantity ?? 0) > 0);
  const prices = pricedTxns.map(unitPrice).filter((price) => price > 0);
  const latestPricePerUnit = pricedTxns.length > 0 ? unitPrice([...pricedTxns].sort((a, b) => b.date.localeCompare(a.date))[0]) : 0;
  const minPricePerUnit = prices.length > 0 ? Math.min(...prices) : 0;
  const usageQty = doneTxns.length > 0 ? consumedQty : totalQty;
  const avgUsagePerDay = usageQty / days;
  const avgUsagePerMonth = avgUsagePerDay * 30;
  const monthlyCost = avgUsagePerMonth * avgPricePerUnit;
  const activeDays = activeStartDate ? Math.max(0, daysBetween(activeStartDate, today)) : 0;
  const estimatedUsedQty = Math.min(activeQty, avgUsagePerDay > 0 ? activeDays * avgUsagePerDay : 0);
  const estimatedRemainingQty = Math.max(0, activeQty - estimatedUsedQty);
  const progress = activeQty > 0 ? estimatedUsedQty / activeQty : 0;
  const runoutDate = avgUsagePerDay > 0 && estimatedRemainingQty > 0 ? addDays(today, estimatedRemainingQty / avgUsagePerDay) : null;
  const byScope: Record<ExpenseScope, PossessionSplit> = {
    local: emptySplit(),
    shared: emptySplit(),
  };
  const byScene = Object.fromEntries(SCENE_KEYS.map((key) => [key, emptySplit()])) as Record<TagKind, PossessionSplit>;

  for (const txn of purchaseTxns) {
    const qty = txn.quantity ?? 0;
    if (txn.scope === 'local' || txn.scope === 'shared') {
      byScope[txn.scope].cost += txn.amount;
      byScope[txn.scope].qty += qty;
    }
    if (txn.scope === 'local' && txn.scene) {
      byScene[txn.scene].cost += txn.amount;
      byScene[txn.scene].qty += qty;
    }
  }

  return {
    totalQty: round2(totalQty),
    totalCost: round2(totalCost),
    activeQty: round2(activeQty),
    consumedQty: round2(consumedQty),
    firstDate,
    activeStartDate,
    latestDoneDate,
    days,
    avgPricePerUnit: round2(avgPricePerUnit),
    minPricePerUnit: round2(minPricePerUnit),
    latestPricePerUnit: round2(latestPricePerUnit),
    avgUsagePerDay: round2(avgUsagePerDay),
    avgUsagePerMonth: round2(avgUsagePerMonth),
    monthlyCost: round2(monthlyCost),
    estimatedUsedQty: round2(estimatedUsedQty),
    estimatedRemainingQty: round2(estimatedRemainingQty),
    progress: Math.min(1, Math.max(0, progress)),
    runoutDate,
    byScope: withShares(byScope, totalCost),
    byScene: withShares(byScene, totalCost),
  };
}

export function calcDurableStats(item: PossessionItem, today: string): DurableStats {
  const purchases = item.txns.filter((txn) => txn.kind === 'purchase');
  const resales = item.txns.filter((txn) => txn.kind === 'resale');
  const purchase = purchases[0] ?? null;
  const resale = resales[resales.length - 1] ?? null;
  const startDate = purchase?.date ?? item.txns[0]?.date ?? null;
  const endDate = resale?.date ?? today;
  const days = startDate ? Math.max(1, daysBetween(startDate, endDate)) : 1;
  const netCost = purchases.reduce((sum, txn) => sum + txn.amount, 0) - resales.reduce((sum, txn) => sum + txn.amount, 0);
  const costPerDay = netCost / days;
  const label = item.status === 'retired' && resale ? '已卖出，实际日均' : '持有中，当前日均';

  return {
    purchase,
    resale,
    startDate,
    endDate,
    days,
    netCost: round2(netCost),
    costPerDay: round2(costPerDay),
    label,
  };
}
