import type { MonthlyRecord } from '../models/types';

type MonthlyCashFlow = Pick<MonthlyRecord, 'income'>;
type MonthlyAssets = Pick<MonthlyRecord, 'totalAssets'>;
type MonthlyInvestmentAssets = Pick<MonthlyRecord, 'investTotal'>;
type MonthlyInvestment = Pick<MonthlyRecord, 'accumulatedProfit' | 'isBaseline'>;
type MonthlySavings = MonthlyCashFlow & MonthlyInvestmentAssets & MonthlyInvestment;

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

export function getMonthlyInvestmentAssetChange(
  record: MonthlyInvestmentAssets,
  previous?: MonthlyInvestmentAssets,
): number | null {
  if (!previous) return null;
  return record.investTotal - previous.investTotal;
}

export function getMonthlySavedAmount(
  record: MonthlyInvestmentAssets & MonthlyInvestment,
  previous?: MonthlyInvestmentAssets & MonthlyInvestment,
): number | null {
  const investmentAssetChange = getMonthlyInvestmentAssetChange(record, previous);
  const investmentIncome = getMonthlyInvestmentIncome(record, previous);
  if (investmentAssetChange === null || investmentIncome === null) return null;
  return investmentAssetChange - investmentIncome;
}

export function getMonthlySavingsRate(
  record: MonthlySavings,
  previous?: MonthlyInvestmentAssets & MonthlyInvestment,
): number | null {
  const savedAmount = getMonthlySavedAmount(record, previous);
  return savedAmount !== null && record.income > 0
    ? savedAmount / record.income
    : null;
}
