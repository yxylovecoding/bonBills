import type { MonthlyRecord } from '../models/types';

type MonthlyCashFlow = Pick<MonthlyRecord, 'income' | 'totalExpense'>;
type MonthlyAssets = Pick<MonthlyRecord, 'totalAssets'>;

export function getMonthlySavingsRate(record: MonthlyCashFlow): number | null {
  return record.income > 0
    ? (record.income - record.totalExpense) / record.income
    : null;
}

export function getMonthlyAssetChange(
  record: MonthlyAssets,
  previous?: MonthlyAssets,
): number | null {
  if (record.totalAssets === undefined || previous?.totalAssets === undefined) return null;
  return record.totalAssets - previous.totalAssets;
}
