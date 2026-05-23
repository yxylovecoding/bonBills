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
  firstDate: string | null;
  days: number;
  avgPricePerUnit: number;
  avgUsagePerDay: number;
  avgUsagePerMonth: number;
  monthlyCost: number;
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
  const firstDate = purchaseTxns.reduce<string | null>((min, txn) => (
    !min || txn.date < min ? txn.date : min
  ), null);
  const days = firstDate ? Math.max(1, daysBetween(firstDate, today)) : 1;
  const avgPricePerUnit = totalQty > 0 ? totalCost / totalQty : 0;
  const avgUsagePerDay = totalQty / days;
  const avgUsagePerMonth = avgUsagePerDay * 30;
  const monthlyCost = avgUsagePerMonth * avgPricePerUnit;
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
    firstDate,
    days,
    avgPricePerUnit: round2(avgPricePerUnit),
    avgUsagePerDay: round2(avgUsagePerDay),
    avgUsagePerMonth: round2(avgUsagePerMonth),
    monthlyCost: round2(monthlyCost),
    byScope: withShares(byScope, totalCost),
    byScene: withShares(byScene, totalCost),
  };
}

export function calcDurableStats(item: PossessionItem, today: string): DurableStats {
  const purchase = item.txns.find((txn) => txn.kind === 'purchase') ?? null;
  const resale = item.txns.find((txn) => txn.kind === 'resale') ?? null;
  const startDate = purchase?.date ?? item.txns[0]?.date ?? null;
  const endDate = resale?.date ?? today;
  const days = startDate ? Math.max(1, daysBetween(startDate, endDate)) : 1;
  const netCost = (purchase?.amount ?? 0) - (resale?.amount ?? 0);
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
