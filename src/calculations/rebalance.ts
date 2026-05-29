import type { InvestHoldings, InvestAllocTargets, RebalanceResult, InvestKey } from '../models/types';

export interface RebalanceCashPools {
  cnyAvail: number;    // 人民币理财账户可用
  usdAvail: number;    // 美元理财账户折算成 CNY 的可用
  usdKeys: InvestKey[]; // 计价为美元的品类
}

export function calcRebalance(
  holdings: InvestHoldings,
  targets: InvestAllocTargets,
  newFunds: number,
  allowSell = false,
  cashPools?: RebalanceCashPools,
): RebalanceResult {
  const keys = Object.keys(holdings) as InvestKey[];
  const currentTotal = keys.reduce((s, k) => s + holdings[k], 0);
  const totalAfter = currentTotal + newFunds;

  const diffs: Record<InvestKey, number> = {} as Record<InvestKey, number>;
  for (const k of keys) {
    diffs[k] = totalAfter * targets[k] - holdings[k];
  }

  const result: RebalanceResult = {} as RebalanceResult;

  if (allowSell) {
    for (const k of keys) {
      result[k] = diffs[k];
    }
    return result;
  }

  if (newFunds > 0) {
    if (cashPools) {
      // 币种隔离加仓：CNY 资产只吃 CNY 池；USD 资产先吃 USD 理财，
      // 不够时由 CNY 池补差。生活/消费/心愿美元只影响执行时的置换路径，
      // 不增加本次真正可投入的资金总额。
      const { cnyAvail, usdAvail, usdKeys } = cashPools;
      const isUsd = (k: InvestKey) => usdKeys.includes(k);
      const usdUnder = keys.reduce((s, k) => s + (isUsd(k) && diffs[k] > 0 ? diffs[k] : 0), 0);
      const cnyUnder = keys.reduce((s, k) => s + (!isUsd(k) && diffs[k] > 0 ? diffs[k] : 0), 0);
      const totalUnder = usdUnder + cnyUnder;
      const cnyCash = Math.max(cnyAvail, 0);
      const usdCash = Math.max(usdAvail, 0);

      let cnyAlloc = totalUnder > 0 ? Math.min(cnyUnder, newFunds * (cnyUnder / totalUnder)) : 0;
      let usdAlloc = totalUnder > 0 ? Math.min(usdUnder, newFunds * (usdUnder / totalUnder)) : 0;

      if (cnyAlloc > cnyCash) {
        const released = cnyAlloc - cnyCash;
        cnyAlloc = cnyCash;
        usdAlloc = Math.min(usdUnder, usdAlloc + released);
      }

      const maxUsdAlloc = usdCash + Math.max(cnyCash - cnyAlloc, 0);
      if (usdAlloc > maxUsdAlloc) {
        const released = usdAlloc - maxUsdAlloc;
        usdAlloc = maxUsdAlloc;
        cnyAlloc = Math.min(cnyUnder, cnyAlloc + Math.min(released, Math.max(cnyCash - cnyAlloc, 0)));
      }

      const cnyFactor = cnyUnder > 0 ? cnyAlloc / cnyUnder : 0;
      const usdFactor = usdUnder > 0 ? usdAlloc / usdUnder : 0;

      for (const k of keys) {
        if (diffs[k] <= 0) { result[k] = 0; continue; }
        result[k] = diffs[k] * (isUsd(k) ? usdFactor : cnyFactor);
      }
      return result;
    }

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
