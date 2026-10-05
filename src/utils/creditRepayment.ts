import type { MonthlyRecord } from '../models/types';
import { summarizeInvestPositionItems } from './investPositionItems';
import { roundToSitePrecision } from './numberInput';

export const LONG_BOND_REPAY_THRESHOLD = 10000;

export interface CreditRepaymentPlan {
  longBondTotalForRepay: number;
  longBondExcess: number;
  creditMonthlyAfterSavings: number;
  longBondRepay: number;
  longBondRepayNext: number;
  longBondRepayTotal: number;
  effectiveCreditMonthly: number;
  effectiveCreditNext: number;
}

function normalizedAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

export function getPlanningLongBondTotal(
  records: readonly MonthlyRecord[],
  yearMonth: string,
  fallbackLongBond?: number,
): number {
  // 规划读取记录页的最新持仓；月份尚未结转时沿用最近一期，避免读到旧账户快照。
  const record = records.reduce<MonthlyRecord | undefined>((latest, candidate) => {
    if (candidate.yearMonth > yearMonth
      || (candidate.investPositionItems === undefined && candidate.investBreakdown === undefined)) return latest;
    return !latest || candidate.yearMonth > latest.yearMonth ? candidate : latest;
  }, undefined);
  if (!record) return normalizedAmount(fallbackLongBond);
  // 显式空持仓代表已清空，不能回退到历史余额。
  if (record.investPositionItems !== undefined) {
    return summarizeInvestPositionItems(record.investPositionItems).marketValueByCategory.longBond;
  }
  return normalizedAmount(record.investBreakdown?.longBond);
}

export function calculateCreditRepaymentPlan(options: {
  creditMonthly?: number;
  creditTotal?: number;
  savingsCard?: number;
  longBond?: number;
}): CreditRepaymentPlan {
  const creditMonthly = normalizedAmount(options.creditMonthly);
  const creditTotal = normalizedAmount(options.creditTotal);
  const savingsCard = normalizedAmount(options.savingsCard);
  const longBondTotalForRepay = normalizedAmount(options.longBond);
  const longBondExcess = roundToSitePrecision(Math.max(longBondTotalForRepay - LONG_BOND_REPAY_THRESHOLD, 0));
  const creditMonthlyAfterSavings = roundToSitePrecision(Math.max(creditMonthly - savingsCard, 0));
  const longBondRepay = roundToSitePrecision(Math.min(longBondExcess, creditMonthlyAfterSavings));
  const creditNextAfterSavings = roundToSitePrecision(Math.max(creditTotal - Math.max(savingsCard, creditMonthly), 0));
  const remainingLongBondExcess = roundToSitePrecision(Math.max(longBondExcess - longBondRepay, 0));
  const longBondRepayNext = roundToSitePrecision(Math.min(remainingLongBondExcess, creditNextAfterSavings));

  return {
    longBondTotalForRepay,
    longBondExcess,
    creditMonthlyAfterSavings,
    longBondRepay,
    longBondRepayNext,
    longBondRepayTotal: roundToSitePrecision(longBondRepay + longBondRepayNext),
    effectiveCreditMonthly: roundToSitePrecision(Math.max(creditMonthlyAfterSavings - longBondRepay, 0)),
    effectiveCreditNext: roundToSitePrecision(Math.max(creditNextAfterSavings - longBondRepayNext, 0)),
  };
}
