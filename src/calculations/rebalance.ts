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

  const result: RebalanceResult = {} as RebalanceResult;

  if (newFunds > 0) {
    // 加仓：只给欠配品类分配，按欠配额比例
    const totalUnder = keys.reduce((s, k) => s + (diffs[k] > 0 ? diffs[k] : 0), 0);
    for (const k of keys) {
      result[k] = totalUnder > 0 && diffs[k] > 0
        ? newFunds * (diffs[k] / totalUnder)
        : 0;
    }
  } else if (newFunds < 0) {
    // 赎回：只从超配品类减仓，按超配额绝对值比例
    const totalOverAbs = keys.reduce((s, k) => s + (diffs[k] < 0 ? -diffs[k] : 0), 0);
    if (totalOverAbs > 0) {
      for (const k of keys) {
        result[k] = diffs[k] < 0
          ? newFunds * ((-diffs[k]) / totalOverAbs)
          : 0;
      }
    } else {
      // 持仓已贴近目标、无超配品类：按目标比例等比赎回
      for (const k of keys) {
        result[k] = newFunds * targets[k];
      }
    }
  } else {
    for (const k of keys) {
      result[k] = 0;
    }
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
