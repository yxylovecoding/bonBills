export const LONG_BOND_REPAY_THRESHOLD = 10000;

export interface CreditRepaymentPlan {
  longBondTotalForRepay: number;
  longBondExcess: number;
  creditMonthlyAfterSavings: number;
  longBondRepay: number;
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
  const longBondExcess = Math.max(longBondTotalForRepay - LONG_BOND_REPAY_THRESHOLD, 0);
  const creditMonthlyAfterSavings = Math.max(creditMonthly - savingsCard, 0);
  const longBondRepay = Math.min(longBondExcess, creditMonthlyAfterSavings);

  return {
    longBondTotalForRepay,
    longBondExcess,
    creditMonthlyAfterSavings,
    longBondRepay,
    effectiveCreditMonthly: Math.max(creditMonthlyAfterSavings - longBondRepay, 0),
    effectiveCreditNext: Math.max(creditTotal - Math.max(savingsCard, creditMonthly), 0),
  };
}
