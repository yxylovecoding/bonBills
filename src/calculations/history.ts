import type { MonthlyRecord, CurrentStats } from '../models/types';

export function calcHistoryStats(records: MonthlyRecord[]): CurrentStats {
  const n = records.length;
  if (n === 0) {
    return {
      periodicLifeAvg: 0, volatileLifeAvg: 0, consumptionAvg: 0,
      totalExpenseAvg: 0, monthlyIncomeAvg: 0, schoolDailyAvg: 0,
      stateDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
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

  // 非在校日均：(周期生活 + 波动生活) / 非校天数，按月计算后取均值
  const nonSchoolDailySum = records.reduce((s, r) => {
    const [yr, mo] = r.yearMonth.split('-').map(Number);
    const totalDays = new Date(yr, mo, 0).getDate();
    const nonSchoolDays = Math.max(totalDays - (r.schoolDays ?? 0), 1);
    return s + (r.periodicLife + r.volatileLife) / nonSchoolDays;
  }, 0);
  const nonSchoolDailyAvg = nonSchoolDailySum / n;

  const totalIncome  = sum('income');
  const totalExpense = sum('totalExpense');
  const savingsRate  = totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0;

  return {
    periodicLifeAvg, volatileLifeAvg, consumptionAvg,
    totalExpenseAvg, monthlyIncomeAvg, schoolDailyAvg,
    stateDailyAvg: {
      school: schoolDailyAvg,
      intern: nonSchoolDailyAvg,
      home:   nonSchoolDailyAvg,
      travel: nonSchoolDailyAvg,
    },
    savingsRate, totalLife: periodicLifeAvg + volatileLifeAvg,
  };
}
