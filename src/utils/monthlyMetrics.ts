import type { MonthlyRecord } from '../models/types';

type MonthlyCashFlow = Pick<MonthlyRecord, 'income'>;
type MonthlyAssets = Pick<MonthlyRecord, 'totalAssets'>;
type MonthlyInvestment = Pick<MonthlyRecord, 'accumulatedProfit' | 'isBaseline'>;
type MonthlySavings = MonthlyCashFlow & MonthlyAssets & MonthlyInvestment;

export function getMonthlyAssetChange(
  record: MonthlyAssets,
  previous?: MonthlyAssets,
): number | null {
  if (record.totalAssets === undefined || previous?.totalAssets === undefined) return null;
  return record.totalAssets - previous.totalAssets;
}

export function getMonthlyInvestmentIncome(
  record: MonthlyInvestment,
  previous?: MonthlyInvestment,
): number | null {
  if (!previous || record.isBaseline) return null;
  return record.accumulatedProfit - previous.accumulatedProfit;
}

export function getMonthlySavedAmount(
  record: MonthlyAssets & MonthlyInvestment,
  previous?: MonthlyAssets & MonthlyInvestment,
): number | null {
  const assetChange = getMonthlyAssetChange(record, previous);
  const investmentIncome = getMonthlyInvestmentIncome(record, previous);
  if (assetChange === null || investmentIncome === null) return null;
  return assetChange - investmentIncome;
}

export function getMonthlySavingsRate(
  record: MonthlySavings,
  previous?: MonthlyAssets & MonthlyInvestment,
): number | null {
  const savedAmount = getMonthlySavedAmount(record, previous);
  return savedAmount !== null && record.income > 0
    ? savedAmount / record.income
    : null;
}
