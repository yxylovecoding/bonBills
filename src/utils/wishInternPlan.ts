import type { IncomeItem, TagKind, WishItem } from '../models/types';
import type { HolidayDataByYear } from './holidays';
import {
  formatDateKey,
  getInternPayrollCycleForMonth,
  getPayrollScheduleForMonth,
  isWorkingDate,
  resolveIncomeForMonth,
} from './payroll';
import { calculateIncomeTax } from './tax';
import { POST_LIFE_FLEXIBLE_SHARE, POST_LIFE_WISH_SHARE } from './wishes';

export interface WishInternMonthPlan {
  yearMonth: string;
  internDays: number;
  availableInternDays: number;
}

export interface WishInternPlan {
  startDate: string;
  deadline: string;
  wishAmountIncludingLife: number;
  wishAmount: number;
  minimumIncome: number;
  maximumIncome: number;
  requiredIncome: number;
  baselineLifeExpense: number;
  recommendedLifeExpense: number;
  repayment: number;
  availableInternDays: number;
  scheduledInternDays: number;
  minimumInternDays: number | null;
  additionalInternDays: number;
  reducibleInternDays: number;
  recommendedDates: string[];
  months: WishInternMonthPlan[];
  projectedWishSaving: number;
  consumptionTransferredToWish: number;
  usesConsumptionTransfer: boolean;
  excludedLivingDays: number;
  excludedLifeExpense: number;
  shortfall: number;
}

export interface WishInternPlanOptions {
  today: Date;
  deadline: string;
  wishes: WishItem[];
  incomeItems: IncomeItem[];
  tagMap: Record<string, TagKind>;
  stateDailyAvg: Record<TagKind, number>;
  repaymentsByMonth: Record<string, number>;
  holidayDataByYear: HolidayDataByYear;
  tripDatesByStart?: Record<string, string[]>;
}

interface PayrollCandidateGroup {
  id: string;
  dates: string[];
  marginalIncome: number[];
  chosen: number;
}

function parseDateKey(value: string): Date | null {
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

function addDay(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function enumerateDates(start: Date, end: Date): string[] {
  const dates: string[] = [];
  for (let cursor = startOfDay(start); cursor <= end; cursor = addDay(cursor)) dates.push(formatDateKey(cursor));
  return dates;
}

function enumerateMonths(start: Date, end: Date): Array<{ year: number; month0: number; yearMonth: string }> {
  const result: Array<{ year: number; month0: number; yearMonth: string }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    result.push({
      year: cursor.getFullYear(),
      month0: cursor.getMonth(),
      yearMonth: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

function incomeInRange(
  incomeItems: IncomeItem[],
  months: Array<{ year: number; month0: number }>,
  tagMap: Record<string, TagKind>,
  holidayDataByYear: HolidayDataByYear,
  startDate: string,
  deadline: string,
): number {
  let total = 0;
  for (const { year, month0 } of months) {
    for (const item of incomeItems) {
      if (!item.isActive) continue;
      const resolved = resolveIncomeForMonth(item, year, month0, tagMap, holidayDataByYear);
      if (resolved.resolvedPayDate < startDate || resolved.resolvedPayDate > deadline) continue;
      total += resolved.resolvedAmount;
    }
  }
  return total;
}

function normalizedDailyAverage(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

export function calculateWishInternPlan(options: WishInternPlanOptions): WishInternPlan {
  const today = startOfDay(options.today);
  const requestedDeadline = parseDateKey(options.deadline);
  const end = requestedDeadline && requestedDeadline >= today ? requestedDeadline : today;
  const startDate = formatDateKey(today);
  const deadline = formatDateKey(end);
  const dates = enumerateDates(today, end);
  const months = enumerateMonths(today, end);
  const baselineTagMap = { ...options.tagMap };
  const flexibleWorkingDates: string[] = [];
  let baselineLifeExpense = 0;

  for (const date of dates) {
    const existing = options.tagMap[date];
    const fixedTag = existing === 'home' || existing === 'travel' ? existing : null;
    const baselineTag: TagKind = fixedTag ?? 'school';
    baselineTagMap[date] = baselineTag;
    baselineLifeExpense += normalizedDailyAverage(options.stateDailyAvg[baselineTag]);
    if (!fixedTag && isWorkingDate(date, options.holidayDataByYear)) flexibleWorkingDates.push(date);
  }

  const includedWishes = options.wishes.filter((wish) => {
    if (!wish.isActive || !wish.deadline || wish.deadline > deadline) return false;
    const target = Number.isFinite(wish.targetAmount) ? Math.max(wish.targetAmount, 0) : 0;
    const saved = Number.isFinite(wish.savedAmount) ? Math.max(wish.savedAmount, 0) : 0;
    return target > saved;
  });
  const linkedTravelDates = new Set<string>();
  let requestedManualTravelDays = 0;
  for (const wish of includedWishes) {
    const linkedDates = wish.linkedTripStartDate
      ? options.tripDatesByStart?.[wish.linkedTripStartDate]
      : undefined;
    if (linkedDates && linkedDates.length > 0) {
      for (const date of linkedDates) linkedTravelDates.add(date);
      continue;
    }
    const manualDays = Number.isFinite(wish.plannedTravelDays)
      ? Math.max(Math.round(wish.plannedTravelDays ?? 0), 0)
      : 0;
    requestedManualTravelDays += manualDays;
  }
  const manualTravelDays = requestedManualTravelDays;
  const travelLifeDaily = normalizedDailyAverage(options.stateDailyAvg.travel);
  const requestedExcludedLifeExpense = (linkedTravelDates.size + manualTravelDays) * travelLifeDaily;

  const activeInternIncome = options.incomeItems.filter(
    (item) => item.isActive && item.dailyRate !== undefined && item.tagKind === 'intern',
  );
  const groups: PayrollCandidateGroup[] = [];
  const assignedDates = new Set<string>();

  if (activeInternIncome.length > 0) {
    for (const month of months) {
      const schedule = getPayrollScheduleForMonth(month.year, month.month0, options.holidayDataByYear);
      if (schedule.payDate < startDate || schedule.payDate > deadline) continue;
      const previousYear = month.month0 === 0 ? month.year - 1 : month.year;
      const previousMonth0 = month.month0 === 0 ? 11 : month.month0 - 1;
      const previous = getPayrollScheduleForMonth(previousYear, previousMonth0, options.holidayDataByYear);
      const candidateDates = flexibleWorkingDates.filter(
        (date) => !assignedDates.has(date) && date > previous.cutoffDate && date <= schedule.cutoffDate,
      );
      if (candidateDates.length === 0) continue;
      candidateDates.forEach((date) => assignedDates.add(date));

      const marginalIncome = Array.from({ length: candidateDates.length }, (_, index) => {
        const nextDayCount = index + 1;
        return activeInternIncome.reduce((sum, item) => {
          const baseCycle = getInternPayrollCycleForMonth(
            item,
            month.year,
            month.month0,
            baselineTagMap,
            options.holidayDataByYear,
          );
          const previousNet = calculateIncomeTax(
            (baseCycle.internDays + nextDayCount - 1) * (item.dailyRate ?? 0),
            item.taxRuleText,
          ).netAmount;
          const nextNet = calculateIncomeTax(
            (baseCycle.internDays + nextDayCount) * (item.dailyRate ?? 0),
            item.taxRuleText,
          ).netAmount;
          return sum + nextNet - previousNet;
        }, 0);
      });
      groups.push({ id: month.yearMonth, dates: candidateDates, marginalIncome, chosen: 0 });
    }
  }

  const minimumIncome = incomeInRange(
    options.incomeItems,
    months,
    baselineTagMap,
    options.holidayDataByYear,
    startDate,
    deadline,
  );
  const allMarginalIncome = groups.flatMap((group) => group.marginalIncome);
  const maximumIncome = minimumIncome + allMarginalIncome.reduce((sum, amount) => sum + amount, 0);
  const repayment = months.reduce((sum, month) => {
    const amount = options.repaymentsByMonth[month.yearMonth];
    return sum + (Number.isFinite(amount) ? Math.max(amount, 0) : 0);
  }, 0);
  const wishAmountIncludingLife = includedWishes.reduce((sum, wish) => {
    const target = Number.isFinite(wish.targetAmount) ? Math.max(wish.targetAmount, 0) : 0;
    const saved = Number.isFinite(wish.savedAmount) ? Math.max(wish.savedAmount, 0) : 0;
    return sum + Math.max(target - saved, 0);
  }, 0);
  const excludedLifeExpense = Math.min(requestedExcludedLifeExpense, wishAmountIncludingLife);
  const wishAmount = Math.max(wishAmountIncludingLife - excludedLifeExpense, 0);
  const expenseDeltaPerInternDay = normalizedDailyAverage(options.stateDailyAvg.intern)
    - normalizedDailyAverage(options.stateDailyAvg.school);
  const requiredCoreSurplus = wishAmount / POST_LIFE_WISH_SHARE;
  const baselineCoreSurplus = minimumIncome - baselineLifeExpense - repayment;
  let recommendedCoreSurplus = baselineCoreSurplus;
  let recommendedDates: string[] = [];

  while (recommendedCoreSurplus + 1e-7 < requiredCoreSurplus) {
    let bestGroup: PayrollCandidateGroup | null = null;
    let bestGain = Number.NEGATIVE_INFINITY;
    for (const group of groups) {
      if (group.chosen >= group.marginalIncome.length) continue;
      const gain = group.marginalIncome[group.chosen] - expenseDeltaPerInternDay;
      if (gain > bestGain) {
        bestGain = gain;
        bestGroup = group;
      }
    }
    if (!bestGroup || bestGain <= 0) break;
    recommendedCoreSurplus += bestGain;
    recommendedDates.push(bestGroup.dates[bestGroup.chosen]);
    bestGroup.chosen += 1;
  }

  let minimumInternDays: number | null = recommendedCoreSurplus + 1e-7 >= requiredCoreSurplus
    ? recommendedDates.length
    : null;
  let usesConsumptionTransfer = false;

  if (minimumInternDays === null) {
    for (const group of groups) group.chosen = group.dates.length;
    recommendedDates = groups.flatMap((group) => group.dates);
  }

  const recommendedLifeExpense = baselineLifeExpense + recommendedDates.length * expenseDeltaPerInternDay;
  const recommendedIncome = minimumIncome + groups.reduce(
    (sum, group) => sum + group.marginalIncome.slice(0, group.chosen).reduce((groupSum, amount) => groupSum + amount, 0),
    0,
  );
  recommendedCoreSurplus = recommendedIncome - recommendedLifeExpense - repayment;
  const normalWishSaving = Math.max(
    (recommendedIncome - recommendedLifeExpense - repayment) * POST_LIFE_WISH_SHARE,
    0,
  );
  const normalWishShortfall = Math.max(wishAmount - normalWishSaving, 0);
  const consumptionPool = minimumInternDays === null
    ? Math.max(recommendedCoreSurplus * (POST_LIFE_FLEXIBLE_SHARE - POST_LIFE_WISH_SHARE), 0)
    : 0;
  const consumptionTransferredToWish = Math.min(normalWishShortfall, consumptionPool);
  const projectedWishSaving = normalWishSaving + consumptionTransferredToWish;
  const shortfall = Math.max(wishAmount - projectedWishSaving, 0);
  if (minimumInternDays === null && consumptionTransferredToWish > 0) usesConsumptionTransfer = true;
  if (minimumInternDays === null && shortfall <= 1e-7) minimumInternDays = recommendedDates.length;
  const scheduledInternDays = groups.reduce(
    (sum, group) => sum + group.dates.filter((date) => options.tagMap[date] === 'intern').length,
    0,
  );
  const targetInternDays = minimumInternDays ?? recommendedDates.length;
  const additionalInternDays = Math.max(targetInternDays - scheduledInternDays, 0);
  const reducibleInternDays = minimumInternDays === null
    ? 0
    : Math.max(scheduledInternDays - minimumInternDays, 0);
  const monthPlans = months.map((month) => ({
    yearMonth: month.yearMonth,
    internDays: recommendedDates.filter((date) => date.startsWith(`${month.yearMonth}-`)).length,
    availableInternDays: flexibleWorkingDates.filter(
      (date) => assignedDates.has(date) && date.startsWith(`${month.yearMonth}-`),
    ).length,
  })).filter((month) => month.availableInternDays > 0 || month.internDays > 0);

  // 保持日期顺序，方便页面直接展示可执行安排。
  recommendedDates.sort();

  return {
    startDate,
    deadline,
    wishAmountIncludingLife,
    wishAmount,
    minimumIncome,
    maximumIncome,
    requiredIncome: recommendedLifeExpense + repayment + requiredCoreSurplus,
    baselineLifeExpense,
    recommendedLifeExpense,
    repayment,
    availableInternDays: groups.reduce((sum, group) => sum + group.dates.length, 0),
    scheduledInternDays,
    minimumInternDays,
    additionalInternDays,
    reducibleInternDays,
    recommendedDates,
    months: monthPlans,
    projectedWishSaving,
    consumptionTransferredToWish,
    usesConsumptionTransfer,
    excludedLivingDays: linkedTravelDates.size + manualTravelDays,
    excludedLifeExpense,
    shortfall,
  };
}
