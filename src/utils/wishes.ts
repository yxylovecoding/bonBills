import type { TagKind, WishExtraExpenseItem, WishItem } from '../models/types';

export const POST_LIFE_FLEXIBLE_SHARE = 0.5;
export const FLEXIBLE_WISH_SHARE = 0.8;
export const POST_LIFE_WISH_SHARE = POST_LIFE_FLEXIBLE_SHARE * FLEXIBLE_WISH_SHARE;
export const POST_LIFE_CONSUMPTION_SHARE = 0.1;
export const POST_LIFE_INVESTMENT_SHARE = 0.5;

export interface TravelWishEstimate {
  days: number;
  dailyLifeAmount: number;
  lifeAmount: number;
  ticketAmount: number;
  lodgingDailyAmount: number;
  lodgingAmount: number;
  extraExpenseAmount: number;
  targetAmount: number;
}

function normalizedAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

function normalizedSignedAmount(value: number | undefined): number {
  return Number.isFinite(value) ? (value ?? 0) : 0;
}

export function resolveWishExtraExpenseItems(
  wish: Pick<WishItem, 'id' | 'travelExtraExpenseItems' | 'travelExtraExpenseAmount'>,
): WishExtraExpenseItem[] {
  if (Array.isArray(wish.travelExtraExpenseItems)) {
    return wish.travelExtraExpenseItems.map((item, index) => ({
      id: item.id || `extra_${wish.id}_${index}`,
      name: typeof item.name === 'string' ? item.name : '',
      amount: normalizedSignedAmount(item.amount),
    }));
  }
  const legacyAmount = normalizedSignedAmount(wish.travelExtraExpenseAmount);
  return legacyAmount !== 0
    ? [{ id: `legacy_extra_${wish.id}`, name: '其他消费', amount: legacyAmount }]
    : [];
}

export function totalWishExtraExpenseAmount(items: WishExtraExpenseItem[]): number {
  return items.reduce((sum, item) => sum + normalizedSignedAmount(item.amount), 0);
}

export function calculateTravelWishEstimate(
  days: number,
  dailyLifeAmount: number,
  ticketAmount?: number,
  lodgingDailyAmount?: number,
  extraExpenseAmount?: number,
): TravelWishEstimate {
  const normalizedDays = Number.isFinite(days) ? Math.max(Math.round(days), 0) : 0;
  const normalizedDailyLifeAmount = normalizedAmount(dailyLifeAmount);
  const normalizedTicketAmount = normalizedAmount(ticketAmount);
  const normalizedLodgingDailyAmount = normalizedAmount(lodgingDailyAmount);
  const normalizedExtraExpenseAmount = normalizedSignedAmount(extraExpenseAmount);
  const lodgingAmount = Math.max(normalizedDays - 1, 0) * normalizedLodgingDailyAmount;
  const lifeAmount = normalizedDays * normalizedDailyLifeAmount;
  return {
    days: normalizedDays,
    dailyLifeAmount: normalizedDailyLifeAmount,
    lifeAmount,
    ticketAmount: normalizedTicketAmount,
    lodgingDailyAmount: normalizedLodgingDailyAmount,
    lodgingAmount,
    extraExpenseAmount: normalizedExtraExpenseAmount,
    targetAmount: Math.max(normalizedTicketAmount + lodgingAmount + normalizedExtraExpenseAmount + lifeAmount, 0),
  };
}

export type WishDeadlineState = 'none' | 'scheduled' | 'overdue' | 'completed';

export interface WishPlanItem extends WishItem {
  remainingAmount: number;
  monthsRemaining: number | null;
  monthlyWishAmount: number;
  deadlineState: WishDeadlineState;
}

export interface WishMonthForecast {
  yearMonth: string;
  taggedDays: number;
  availableDays: number;
  lifeExpense: number;
  repayment: number;
  wishAmount: number;
  requiredNetIncome: number;
}

export interface WishPlan {
  items: WishPlanItem[];
  months: WishMonthForecast[];
  averageMonthlyWishAmount: number;
  averageRequiredMonthlyNetIncome: number;
  activeDeadlineCount: number;
}

export interface WishPlanOptions {
  today?: Date;
  tagMap?: Record<string, TagKind>;
  stateDailyAvg?: Record<TagKind, number>;
  repaymentsByMonth?: Record<string, number>;
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

function yearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthIndex(value: string): number {
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthsBetweenInclusive(from: string, to: string): string[] {
  const start = monthIndex(from);
  const end = monthIndex(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  // 防止异常的远期日期一次生成过多行；50 年已覆盖实际可用规划区间。
  const count = Math.min(end - start + 1, 600);
  return Array.from({ length: count }, (_, offset) => monthFromIndex(start + offset));
}

/** 当前月和 DDL 所在月都参与分摊；逾期心愿全部计入当前月。 */
export function monthsUntilWishDeadline(deadline: string, today = new Date()): number | null {
  const target = parseLocalDate(deadline);
  if (!target) return null;
  const current = startOfDay(today);
  if (target < current) return 0;
  return monthIndex(yearMonth(target)) - monthIndex(yearMonth(current)) + 1;
}

function countAvailableDays(value: string, today: Date): number {
  const [year, month] = value.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();
  return value === yearMonth(today) ? Math.max(totalDays - today.getDate() + 1, 0) : totalDays;
}

function calculateCalendarLife(
  value: string,
  today: Date,
  tagMap: Record<string, TagKind>,
  stateDailyAvg: Record<TagKind, number>,
): { taggedDays: number; lifeExpense: number } {
  const todayKey = `${yearMonth(today)}-${String(today.getDate()).padStart(2, '0')}`;
  let taggedDays = 0;
  let lifeExpense = 0;
  for (const [date, tag] of Object.entries(tagMap)) {
    if (!date.startsWith(`${value}-`)) continue;
    if (value === yearMonth(today) && date < todayKey) continue;
    taggedDays += 1;
    const daily = stateDailyAvg[tag];
    if (Number.isFinite(daily)) lifeExpense += Math.max(daily, 0);
  }
  return { taggedDays, lifeExpense };
}

export function calculateWishPlan(wishes: WishItem[], options: WishPlanOptions = {}): WishPlan {
  const today = startOfDay(options.today ?? new Date());
  const currentYearMonth = yearMonth(today);
  const tagMap = options.tagMap ?? {};
  const stateDailyAvg = options.stateDailyAvg ?? { intern: 0, school: 0, home: 0, travel: 0 };
  const repaymentsByMonth = options.repaymentsByMonth ?? {};

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

  const activeDeadlineItems = items.filter(
    (item) => item.isActive && item.remainingAmount > 0 && item.monthsRemaining !== null,
  );
  const lastYearMonth = activeDeadlineItems.reduce((latest, item) => {
    const deadline = parseLocalDate(item.deadline);
    const itemYearMonth = deadline && deadline >= today ? yearMonth(deadline) : currentYearMonth;
    return itemYearMonth > latest ? itemYearMonth : latest;
  }, currentYearMonth);
  const forecastMonthKeys = activeDeadlineItems.length > 0
    ? monthsBetweenInclusive(currentYearMonth, lastYearMonth)
    : [];

  const months = forecastMonthKeys.map<WishMonthForecast>((value) => {
    const { taggedDays, lifeExpense } = calculateCalendarLife(value, today, tagMap, stateDailyAvg);
    const wishAmount = activeDeadlineItems.reduce((sum, item) => {
      const deadline = parseLocalDate(item.deadline);
      const lastContributionMonth = deadline && deadline >= today ? yearMonth(deadline) : currentYearMonth;
      return value <= lastContributionMonth ? sum + item.monthlyWishAmount : sum;
    }, 0);
    const repayment = Number.isFinite(repaymentsByMonth[value]) ? Math.max(repaymentsByMonth[value], 0) : 0;
    return {
      yearMonth: value,
      taggedDays,
      availableDays: countAvailableDays(value, today),
      lifeExpense,
      repayment,
      wishAmount,
      requiredNetIncome: lifeExpense + repayment + wishAmount / POST_LIFE_WISH_SHARE,
    };
  });

  const averageMonthlyWishAmount = months.length > 0
    ? months.reduce((sum, month) => sum + month.wishAmount, 0) / months.length
    : 0;
  const averageRequiredMonthlyNetIncome = months.length > 0
    ? months.reduce((sum, month) => sum + month.requiredNetIncome, 0) / months.length
    : 0;

  return {
    items,
    months,
    averageMonthlyWishAmount,
    averageRequiredMonthlyNetIncome,
    activeDeadlineCount: activeDeadlineItems.length,
  };
}
