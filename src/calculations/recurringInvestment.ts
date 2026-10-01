import type { InvestKey, RebalanceResult } from '../models/types';
import type { HolidayDataByYear } from '../utils/holidays';

export type RecurringInvestments = Partial<Record<InvestKey, number>>;

export function calcRemainingRecurringInvestments(
  today: Date,
  holidays: HolidayDataByYear = {},
): RecurringInvestments {
  const year = today.getFullYear();
  const month = today.getMonth();
  const cursor = new Date(year, month, today.getDate());
  let days = 0;
  for (; cursor.getMonth() === month; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    // 基金周末不申购，调休上班也不增加定投次数。
    if (weekday !== 0 && weekday !== 6 && !holidays[year]?.[key]?.isOffDay) days++;
  }
  return { us: days * 20, asia: days * 20 };
}

export function deductRecurringInvestments(
  suggested: RebalanceResult,
  recurring: RecurringInvestments,
): RebalanceResult {
  const keys = Object.keys(suggested) as InvestKey[];
  const result = { ...suggested };
  const recurringTotal = keys.reduce((sum, key) => sum + (recurring[key] ?? 0), 0);
  const buyBudget = Math.max(keys.reduce((sum, key) => sum + Math.max(suggested[key], 0), 0) - recurringTotal, 0);
  for (const key of keys) {
    // 定投覆盖加仓时归零，原有赎回建议不受影响。
    if (result[key] > 0) result[key] = Math.max(result[key] - (recurring[key] ?? 0), 0);
  }
  const manualBuys = keys.reduce((sum, key) => sum + Math.max(result[key], 0), 0);
  if (manualBuys > buyBudget) {
    // 定投超过某品类需加时，仍预留完整定投，避免其余加仓超出本次投入。
    const longBond = Math.max(result.longBond, 0);
    const reservedLongBond = Math.min(longBond, buyBudget);
    const otherBuys = manualBuys - longBond;
    const factor = otherBuys > 0 ? (buyBudget - reservedLongBond) / otherBuys : 0;
    for (const key of keys) {
      if (result[key] > 0) result[key] = key === 'longBond' ? reservedLongBond : result[key] * factor;
    }
  }
  return result;
}
