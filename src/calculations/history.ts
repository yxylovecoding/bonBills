import type { MonthlyRecord, CurrentStats } from '../models/types';

export function calcHistoryStats(records: MonthlyRecord[]): CurrentStats {
  const n = records.length;
  if (n === 0) {
    return {
      periodicLifeAvg: 0, volatileLifeAvg: 0, consumptionAvg: 0,
      totalExpenseAvg: 0, monthlyIncomeAvg: 0, schoolDailyAvg: 0,
      savingsRate: 0, totalLife: 0,
    };
  }

  const sum = (key: keyof MonthlyRecord) =>
    records.reduce((s, r) => s + ((r[key] as number) ?? 0), 0);

  const periodicLifeAvg = sum('periodicLife') / n;
  const volatileLifeAvg = sum('volatileLife') / n;
  const consumptionAvg  = sum('consumption') / n;
  const totalExpenseAvg = sum('totalExpense') / n;
  const monthlyIncomeAvg = sum('income') / n;

  // 在校日均：只取有在校天数的月份
  const schoolMonths = records.filter((r) => (r.schoolDays ?? 0) > 0);
  const schoolDailyAvg = schoolMonths.length > 0
    ? schoolMonths.reduce((s, r) => s + r.school / (r.schoolDays ?? 1), 0) / schoolMonths.length
    : sum('school') / n / 20; // fallback

  const totalIncome  = sum('income');
  const totalExpense = sum('totalExpense');
  const savingsRate  = totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0;

  return {
    periodicLifeAvg, volatileLifeAvg, consumptionAvg,
    totalExpenseAvg, monthlyIncomeAvg, schoolDailyAvg,
    savingsRate, totalLife: periodicLifeAvg + volatileLifeAvg,
  };
}
