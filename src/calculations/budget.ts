import type { AppConfig, CurrentStats, DailyTag, BudgetResult } from '../models/types';

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function countFutureTagDays(tags: DailyTag[], tagKind: string, today: Date): number {
  return tags.filter((t) => {
    const d = new Date(t.date);
    return t.tag === tagKind && d > today;
  }).length;
}

export function calcBudget(
  config: AppConfig,
  stats: CurrentStats,
  transfersDone: { campusCard: number; living: number; consumption: number; wishJar: number; invest: number },
  tags: DailyTag[],
  today: Date,
): BudgetResult {
  const year = today.getFullYear();
  const month = today.getMonth();
  const dayOfMonth = today.getDate();
  const totalDays = getDaysInMonth(year, month);
  const daysLeftInMonth = totalDays - dayOfMonth;

  // 从日历 tag 推算剩余天数
  const schoolDaysLeft = Math.max(
    countFutureTagDays(tags, 'school', today),
    Math.round(daysLeftInMonth * 0.7), // fallback：没有 tag 时估算
  );
  const homeDaysLeft = countFutureTagDays(tags, 'home', today);

  const dailyLife = (stats.periodicLifeAvg + stats.volatileLifeAvg) / 30;

  // === 周内预算（最近7天）===
  const weekDays = Math.min(daysLeftInMonth, 7);
  const weeklyExpense = dailyLife * weekDays + stats.volatileLifeAvg * (weekDays / 30);
  const weeklyIncome = config.incomeItems
    .filter((i) => i.isActive)
    .reduce((s, i) => s + i.amount, 0) * (weekDays / 30);

  // === 月内预算（本月剩余）===
  const monthlyExpense = stats.periodicLifeAvg + (stats.volatileLifeAvg * daysLeftInMonth / 30);
  const monthlyIncome = config.incomeItems
    .filter((i) => i.isActive)
    .reduce((s, i) => s + i.amount, 0) * (daysLeftInMonth / 30);

  // === 月外预算（跨月）===
  const monthlyTotal = config.incomeItems.filter((i) => i.isActive).reduce((s, i) => s + i.amount, 0);
  const beyondIncome = monthlyTotal;
  const beyondExpense = stats.periodicLifeAvg + homeDaysLeft * 100;

  // === 建议转账 ===
  const campusCard = Math.max(
    Math.ceil(stats.schoolDailyAvg * schoolDaysLeft) - transfersDone.campusCard,
    0,
  );
  const living = Math.max(Math.ceil(weeklyExpense) - transfersDone.living, 0);
  const consumption = Math.max(
    Math.ceil(stats.consumptionAvg * (daysLeftInMonth / 30)) - transfersDone.consumption,
    0,
  );
  const wishJar = Math.max(200 - transfersDone.wishJar, 0);

  const totalExpBudget = weeklyExpense + monthlyExpense + beyondExpense;
  const totalIncomeBudget = weeklyIncome + monthlyIncome + beyondIncome;
  const availableForInvest = Math.max(
    Math.floor(totalIncomeBudget - totalExpBudget - campusCard - living - consumption - wishJar - transfersDone.invest),
    0,
  );

  return {
    daysLeftInMonth,
    schoolDaysLeft,
    homeDaysLeft,
    weekly: { income: Math.round(weeklyIncome * 100) / 100, expense: Math.round(weeklyExpense * 100) / 100 },
    monthly: { income: Math.round(monthlyIncome * 100) / 100, expense: Math.round(monthlyExpense * 100) / 100 },
    beyond: { income: Math.round(beyondIncome * 100) / 100, expense: Math.round(beyondExpense * 100) / 100 },
    recommended: { campusCard, living, consumption, wishJar, invest: availableForInvest },
  };
}
