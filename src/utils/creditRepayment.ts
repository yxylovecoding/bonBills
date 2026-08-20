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
