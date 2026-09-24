import type { TagKind, WishExtraExpenseItem, WishItem } from '../models/types';
import { roundToSitePrecision } from './numberInput';
import type { TripSegment } from './trips';

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

export function calculateWishFunding(wish: WishItem, lifeAmount = 0) {
  const spentAmount = roundToSitePrecision((wish.spentItems ?? []).reduce(
    (sum, item) => sum + normalizedAmount(item.amount), 0,
  ));
  const savedAmount = normalizedAmount(wish.savedAmount);
  const repaidAmount = Math.min(normalizedAmount(wish.repaidAmount), spentAmount);
  const fundingTarget = Math.max(normalizedAmount(wish.targetAmount) - normalizedAmount(lifeAmount), spentAmount, 0);
  const fundedAmount = roundToSitePrecision(savedAmount + repaidAmount);
  return {
    spentAmount,
    savedAmount,
    repaidAmount,
    fundingTarget,
    fundedAmount,
    debtAmount: roundToSitePrecision(spentAmount - repaidAmount),
    remainingAmount: roundToSitePrecision(Math.max(fundingTarget - fundedAmount, 0)),
    progress: fundingTarget > 0 ? Math.min(fundedAmount / fundingTarget, 1) : 0,
  };
}

export function calculateWishDebtSummary(wishes: readonly WishItem[], total?: number) {
  const spentAmount = roundToSitePrecision(wishes.reduce(
    (sum, wish) => sum + calculateWishFunding(wish).spentAmount, 0,
  ));
  const totalAmount = total === undefined ? spentAmount : roundToSitePrecision(normalizedAmount(total));
  return {
    totalAmount,
    assignedAmount: Math.min(spentAmount, totalAmount),
    unassignedAmount: roundToSitePrecision(Math.max(totalAmount - spentAmount, 0)),
    repaidAmount: roundToSitePrecision(Math.max(spentAmount - totalAmount, 0)),
  };
}

/** 仅根据当前总欠款和已花推算，按截止日分配；不依赖已攒、旧已还或录入历史。 */
export function resolveWishRepayments(wishes: readonly WishItem[], total?: number): WishItem[] {
  let remaining = calculateWishDebtSummary(wishes, total).repaidAmount;
  const repayments = new Map<string, number>();
  const ordered = [...wishes].sort((first, second) => (
    (first.deadline || '9999-12-31').localeCompare(second.deadline || '9999-12-31')
    || first.id.localeCompare(second.id)
  ));
  for (const wish of ordered) {
    if (remaining <= 0) break;
    const amount = Math.min(calculateWishFunding(wish).spentAmount, remaining);
    if (amount <= 0) continue;
    repayments.set(wish.id, amount);
    remaining = roundToSitePrecision(remaining - amount);
  }
  return wishes.map((wish) => ({ ...wish, repaidAmount: repayments.get(wish.id) ?? 0 }));
}

export function wishTravelLifeAmount(wish: WishItem, dailyLifeAmount: number, tripDatesByStart?: Record<string, string[]>) {
  const days = (wish.linkedTripStartDate ? tripDatesByStart?.[wish.linkedTripStartDate]?.length : undefined)
    ?? Math.max(Math.round(wish.plannedTravelDays ?? 0), 0);
  return Math.max(days * normalizedAmount(dailyLifeAmount) - normalizedAmount(wish.travelLifeCorrectionAmount), 0);
}

export function sortWishesForDisplay<T extends WishItem>(wishes: readonly T[], trips: readonly TripSegment[], today: string): T[] {
  const ongoingTrips = new Map(trips
    .filter((trip) => trip.startDate <= today && trip.endDate >= today)
    .map((trip) => [trip.startDate, trip]));
  // A trip's funding deadline is before departure; it does not mark the end of the wish.
  return wishes.map((wish) => {
    const ongoingTrip = wish.linkedTripStartDate ? ongoingTrips.get(wish.linkedTripStartDate) : undefined;
    return { wish, ongoing: Boolean(ongoingTrip), date: ongoingTrip?.endDate
      ?? (wish.deadline && wish.deadline >= today ? wish.deadline : '9999-12-31') };
  }).sort((a, b) => Number(b.ongoing) - Number(a.ongoing)
    || a.date.localeCompare(b.date) || a.wish.id.localeCompare(b.wish.id))
    .map(({ wish }) => wish);
}

function expenseName(value: string) {
  return value.trim().replace(/\s*[/／]\s*/g, '/');
}

/** 保留原预估，按名称把同一项目的多笔已花合并覆盖；撤销明细后自然恢复预估。 */
export function resolveWishTravelBudget(wish: WishItem, days: number, dailyLifeAmount: number) {
  const actuals = new Map<string, number>();
  for (const item of wish.spentItems ?? []) {
    const name = expenseName(item.name);
    if (!name) continue;
    const key = ['机票', '高铁', '机票/高铁'].includes(name) ? '机票/高铁' : name;
    actuals.set(key, roundToSitePrecision((actuals.get(key) ?? 0) + normalizedAmount(item.amount)));
  }
  const lodgingDaily = Number.isFinite(wish.travelLodgingDailyAmount)
    ? normalizedAmount(wish.travelLodgingDailyAmount)
    : normalizedAmount(wish.travelLodgingAmount) / Math.max(days - 1, 1);
  const original = calculateTravelWishEstimate(days, dailyLifeAmount, wish.travelTicketAmount, lodgingDaily);
  const ticketActual = actuals.get('机票/高铁');
  const lodgingActual = actuals.get('酒店');
  // 重名额外预算在锁定时合并显示，防止同一笔实际支出被重复计入预估。
  const extras: Array<WishExtraExpenseItem & { actualAmount?: number; sourceIds: string[] }> = [];
  for (const item of resolveWishExtraExpenseItems(wish)) {
    const name = expenseName(item.name);
    const actualAmount = ['机票/高铁', '机票', '高铁', '酒店'].includes(name) ? undefined : actuals.get(name);
    const existing = actualAmount !== undefined ? extras.find((extra) => expenseName(extra.name) === name) : undefined;
    if (existing) {
      existing.amount += item.amount;
      existing.sourceIds.push(item.id);
    } else {
      extras.push({ ...item, actualAmount, sourceIds: [item.id] });
    }
  }
  const ticketAmount = ticketActual ?? original.ticketAmount;
  const lodgingAmount = lodgingActual ?? original.lodgingAmount;
  const extraExpenseAmount = extras.reduce((sum, item) => sum + (item.actualAmount ?? item.amount), 0);
  return {
    ticketActual,
    lodgingActual,
    original,
    extras,
    estimate: {
      ...original,
      ticketAmount,
      lodgingAmount,
      extraExpenseAmount,
      targetAmount: roundToSitePrecision(Math.max(ticketAmount + lodgingAmount + extraExpenseAmount + original.lifeAmount, 0)),
    },
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
  tripDatesByStart?: Record<string, string[]>;
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
    const funding = calculateWishFunding(wish, wishTravelLifeAmount(wish, stateDailyAvg.travel, options.tripDatesByStart));
    const remainingAmount = funding.remainingAmount;
    const monthsRemaining = wish.deadline ? monthsUntilWishDeadline(wish.deadline, today) : null;
    const completed = remainingAmount <= 0 && funding.fundingTarget > 0;
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
