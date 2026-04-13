import type { InvestHoldings, InvestAllocTargets, RebalanceResult, InvestKey } from '../models/types';

export function calcRebalance(
  holdings: InvestHoldings,
  targets: InvestAllocTargets,
  newFunds: number,
): RebalanceResult {
  const keys = Object.keys(holdings) as InvestKey[];
  const currentTotal = keys.reduce((s, k) => s + holdings[k], 0);
  const totalAfter = currentTotal + newFunds;

  const diffs: Record<InvestKey, number> = {} as Record<InvestKey, number>;
  for (const k of keys) {
    diffs[k] = totalAfter * targets[k] - holdings[k];
  }

  // 只给欠配品类分配新资金
  const underKeys = keys.filter((k) => diffs[k] > 0);
  const totalUnder = underKeys.reduce((s, k) => s + diffs[k], 0);

  const result: RebalanceResult = {} as RebalanceResult;
  for (const k of keys) {
    result[k] = totalUnder > 0 && diffs[k] > 0
      ? newFunds * (diffs[k] / totalUnder)
      : 0;
  }
  return result;
}

export function calcDeviation(
  holdings: InvestHoldings,
  targets: InvestAllocTargets,
): Record<InvestKey, number> {
  const keys = Object.keys(holdings) as InvestKey[];
  const total = keys.reduce((s, k) => s + holdings[k], 0);
  const result: Record<InvestKey, number> = {} as Record<InvestKey, number>;
  for (const k of keys) {
    result[k] = total > 0 ? holdings[k] / total - targets[k] : 0;
  }
  return result;
}
