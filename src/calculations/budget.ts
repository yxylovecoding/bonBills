import type { AppConfig, CurrentStats, DailyTag, BudgetResult } from '../models/types';

// payDay === 0 means last day of month
export function resolvePayDay(payDay: number, year: number, month: number): number {
  if (payDay === 0) return new Date(year, month + 1, 0).getDate();
  return payDay;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function countFutureTagDays(tags: DailyTag[], tagKind: string, today: Date): number {
  return tags.filter((t) => {
    const d = new Date(t.date);
    return t.tag === tagKind && d > today;
  }).length;
}

export interface AccountBalances {
  incomeBank: number;
  campusCard: number;
  livingBank: number;
  consumptionBank: number;
}

export function calcBudget(
  config: AppConfig,
  stats: CurrentStats,
  transfersDone: { campusCard: number; living: number; consumption: number; wishJar: number; invest: number },
  tags: DailyTag[],
  today: Date,
  accounts?: Partial<AccountBalances>,
): BudgetResult {
  const year = today.getFullYear();
  const month = today.getMonth();
  const dayOfMonth = today.getDate();
  const totalDays = getDaysInMonth(year, month);
  const daysLeftInMonth = totalDays - dayOfMonth;

  // 从日历 tag 推算剩余天数
  const schoolDaysLeft = Math.max(
    countFutureTagDays(tags, 'school', today),
    Math.round(daysLeftInMonth * 0.7),
  );
  const homeDaysLeft = countFutureTagDays(tags, 'home', today);

  const dailyLife = (stats.periodicLifeAvg + stats.volatileLifeAvg) / 30;

  // === 周内预算（最近7天）===
  const weekDays = Math.min(daysLeftInMonth, 7);
  const weekEnd = dayOfMonth + weekDays;
  const weeklyExpense = dailyLife * weekDays + stats.volatileLifeAvg * (weekDays / 30);
  const weeklyIncome = config.incomeItems
    .filter((i) => {
      if (!i.isActive) return false;
      const pd = resolvePayDay(i.payDay, year, month);
      return pd > dayOfMonth && pd <= weekEnd;
    })
    .reduce((s, i) => s + i.amount, 0);

  // === 月内预算（本月剩余）===
  const monthlyExpense = stats.periodicLifeAvg + (stats.volatileLifeAvg * daysLeftInMonth / 30);
  const monthlyIncome = config.incomeItems
    .filter((i) => {
      if (!i.isActive) return false;
      const pd = resolvePayDay(i.payDay, year, month);
      return pd > dayOfMonth;
    })
    .reduce((s, i) => s + i.amount, 0);

  // === 月外预算（跨月）===
  const beyondIncome = config.incomeItems.filter((i) => i.isActive).reduce((s, i) => s + i.amount, 0);
  const beyondExpense = stats.periodicLifeAvg + homeDaysLeft * 100;

  // === 各账户本月预计需求 ===
  const campusNeed = Math.ceil(stats.schoolDailyAvg * schoolDaysLeft);
  const livingNeed = Math.ceil(stats.periodicLifeAvg + stats.volatileLifeAvg);

  // 当前余额（若未提供则按 0 处理）
  const accIncome      = accounts?.incomeBank      ?? 0;
  const accCampus      = accounts?.campusCard      ?? 0;
  const accLiving      = accounts?.livingBank      ?? 0;
  const accConsumption = accounts?.consumptionBank ?? 0;

  // 已确认转账后实际余额
  const campusEffective = accCampus + transfersDone.campusCard;
  const livingEffective = accLiving + transfersDone.living;
  const consumptionEffective = accConsumption + transfersDone.consumption;

  // 各账户缺口（需要补充的金额）
  const campusShortfall = Math.max(campusNeed - campusEffective, 0);
  const livingShortfall = Math.max(livingNeed - livingEffective, 0);
  const totalEssential  = campusShortfall + livingShortfall;

  // === 收入优先逻辑 ===
  const incomeAvailable = accIncome; // 收入账户余额

  let campusTransfer: number;
  let livingTransfer: number;
  let consumptionTransfer: number;
  let wishJarTransfer: number;
  let investTransfer: number;
  let needsRedemption: number;
  let incomeAfterEssentials: number;

  if (totalEssential <= 0) {
    // 所有必要账户已满足，全部收入用于分配
    campusTransfer = 0;
    livingTransfer = 0;
    incomeAfterEssentials = incomeAvailable;
    const consumptionTarget = Math.max(Math.ceil(stats.consumptionAvg) - consumptionEffective, 0);
    const wishTarget = Math.max(200 - transfersDone.wishJar, 0);
    consumptionTransfer = Math.min(consumptionTarget, incomeAfterEssentials);
    wishJarTransfer = Math.min(wishTarget, Math.max(incomeAfterEssentials - consumptionTransfer, 0));
    investTransfer = Math.max(incomeAfterEssentials - consumptionTransfer - wishJarTransfer - transfersDone.invest, 0);
    needsRedemption = 0;
  } else if (incomeAvailable >= totalEssential) {
    // 收入充足，先补必要账户，剩余按比例分配
    campusTransfer = campusShortfall;
    livingTransfer = livingShortfall;
    incomeAfterEssentials = incomeAvailable - totalEssential;
    const consumptionTarget = Math.max(Math.ceil(stats.consumptionAvg) - consumptionEffective, 0);
    const wishTarget = Math.max(200 - transfersDone.wishJar, 0);
    consumptionTransfer = Math.min(consumptionTarget, incomeAfterEssentials);
    wishJarTransfer = Math.min(wishTarget, Math.max(incomeAfterEssentials - consumptionTransfer, 0));
    investTransfer = Math.max(incomeAfterEssentials - consumptionTransfer - wishJarTransfer - transfersDone.invest, 0);
    needsRedemption = 0;
  } else {
    // 收入不足以覆盖必要账户，按比例分配，其余需赎回理财
    if (totalEssential > 0) {
      campusTransfer = Math.floor(campusShortfall * incomeAvailable / totalEssential);
      livingTransfer = Math.floor(livingShortfall * incomeAvailable / totalEssential);
    } else {
      campusTransfer = 0;
      livingTransfer = 0;
    }
    incomeAfterEssentials = 0;
    consumptionTransfer = 0;
    wishJarTransfer = 0;
    investTransfer = 0;
    needsRedemption = totalEssential - incomeAvailable;
  }

  return {
    daysLeftInMonth,
    schoolDaysLeft,
    homeDaysLeft,
    weekly:  { income: Math.round(weeklyIncome * 100) / 100,  expense: Math.round(weeklyExpense * 100) / 100 },
    monthly: { income: Math.round(monthlyIncome * 100) / 100, expense: Math.round(monthlyExpense * 100) / 100 },
    beyond:  { income: Math.round(beyondIncome * 100) / 100,  expense: Math.round(beyondExpense * 100) / 100 },
    recommended: {
      campusCard:   campusTransfer,
      living:       livingTransfer,
      consumption:  consumptionTransfer,
      wishJar:      wishJarTransfer,
      invest:       investTransfer,
      needsRedemption: Math.round(needsRedemption),
      incomeAfterEssentials: Math.round(incomeAfterEssentials),
    },
    needs: {
      campusCard: campusNeed,
      living:     livingNeed,
    },
  };
}
