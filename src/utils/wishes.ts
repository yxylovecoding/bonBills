import type { WishItem } from '../models/types';

export const POST_LIFE_FLEXIBLE_SHARE = 0.5;
export const FLEXIBLE_WISH_SHARE = 0.8;
export const POST_LIFE_WISH_SHARE = POST_LIFE_FLEXIBLE_SHARE * FLEXIBLE_WISH_SHARE;

export type WishDeadlineState = 'none' | 'scheduled' | 'overdue' | 'completed';

export interface WishPlanItem extends WishItem {
  remainingAmount: number;
  monthsRemaining: number | null;
  monthlyWishAmount: number;
  deadlineState: WishDeadlineState;
}

export interface WishPlan {
  items: WishPlanItem[];
  monthlyWishAmount: number;
  requiredMonthlyNetIncome: number;
  activeDeadlineCount: number;
}

function parseLocalDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 以“今天到下个同日”为一个月；不足一个月也按一个月计，方便按月安排转入。
 */
export function monthsUntilWishDeadline(deadline: string, today = new Date()): number | null {
  const target = parseLocalDate(deadline);
  if (!target) return null;
  const current = startOfDay(today);
  if (target < current) return 0;

  let months = (target.getFullYear() - current.getFullYear()) * 12
    + target.getMonth() - current.getMonth();
  if (target.getDate() > current.getDate()) months += 1;
  return Math.max(months, 1);
}

export function calculateWishPlan(
  wishes: WishItem[],
  monthlyLifeExpense: number,
  today = new Date(),
): WishPlan {
  const safeMonthlyLifeExpense = Number.isFinite(monthlyLifeExpense)
    ? Math.max(monthlyLifeExpense, 0)
    : 0;

  const items = wishes.map<WishPlanItem>((wish) => {
    const targetAmount = Number.isFinite(wish.targetAmount) ? Math.max(wish.targetAmount, 0) : 0;
    const savedAmount = Number.isFinite(wish.savedAmount) ? Math.max(wish.savedAmount, 0) : 0;
    const remainingAmount = Math.max(targetAmount - savedAmount, 0);
    const monthsRemaining = wish.deadline ? monthsUntilWishDeadline(wish.deadline, today) : null;
    const completed = remainingAmount <= 0 && targetAmount > 0;
    const overdue = monthsRemaining === 0 && !completed;
    const deadlineState: WishDeadlineState = completed
      ? 'completed'
      : overdue
        ? 'overdue'
        : monthsRemaining === null
          ? 'none'
          : 'scheduled';
    const monthlyWishAmount = wish.isActive && remainingAmount > 0 && monthsRemaining !== null
      ? remainingAmount / Math.max(monthsRemaining, 1)
      : 0;

    return {
      ...wish,
      targetAmount,
      savedAmount,
      remainingAmount,
      monthsRemaining,
      monthlyWishAmount,
      deadlineState,
    };
  });

  const monthlyWishAmount = items.reduce((sum, item) => sum + item.monthlyWishAmount, 0);
  const requiredMonthlyNetIncome = safeMonthlyLifeExpense + monthlyWishAmount / POST_LIFE_WISH_SHARE;
  const activeDeadlineCount = items.filter((item) => item.isActive && item.monthsRemaining !== null && item.remainingAmount > 0).length;

  return { items, monthlyWishAmount, requiredMonthlyNetIncome, activeDeadlineCount };
}
