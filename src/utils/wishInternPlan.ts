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
import {
  POST_LIFE_CONSUMPTION_SHARE,
  POST_LIFE_INVESTMENT_SHARE,
  POST_LIFE_WISH_SHARE,
} from './wishes';

export interface WishInternMonthPlan {
  yearMonth: string;
  internDays: number;
  availableInternDays: number;
}

export interface WishLifeExpenseBreakdownItem {
  days: number;
  dailyAverage: number;
  amount: number;
}

export type WishLifeExpenseBreakdown = Record<TagKind, WishLifeExpenseBreakdownItem>;

export interface WishIncomeBreakdownItem {
  id: string;
  name: string;
  kind: 'fixed' | 'intern';
  grossAmount: number;
  taxAmount: number;
  amount: number;
  days?: number;
  dailyRate?: number;
}

export interface WishInternPlan {
  startDate: string;
  deadline: string;
  wishAmountIncludingLife: number;
  wishAmount: number;
  minimumIncome: number;
  maximumIncome: number;
  recommendedIncome: number;
  incomeBreakdown: WishIncomeBreakdownItem[];
  requiredIncome: number;
  baselineLifeExpense: number;
  recommendedLifeExpense: number;
  lifeExpenseBreakdown: WishLifeExpenseBreakdown;
  repayment: number;
  totalLivingExpense: number;
  projectedSurplus: number;
  projectedConsumption: number;
  projectedInvestmentSaving: number;
  projectedTotalSaving: number;
  availableInternDays: number;
  scheduledInternDays: number;
  minimumInternDays: number | null;
  selectedInternDays: number;
  additionalInternDays: number;
  reducibleInternDays: number;
  availableInternDateKeys: string[];
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
  selectedInternDays?: number | null;
}

interface PayrollCandidateGroup {
  id: string;
  year: number;
  month0: number;
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
): { total: number; items: WishIncomeBreakdownItem[] } {
  let total = 0;
  const breakdownById = new Map<string, WishIncomeBreakdownItem>();
  for (const { year, month0 } of months) {
    for (const item of incomeItems) {
      if (!item.isActive) continue;
      // 心愿规划中的实习日薪按实际实习日计入，不能再按工资到账日重复计算。
      if (item.dailyRate !== undefined && item.tagKind === 'intern') continue;
      const resolved = resolveIncomeForMonth(item, year, month0, tagMap, holidayDataByYear);
      if (resolved.resolvedPayDate < startDate || resolved.resolvedPayDate > deadline) continue;
      total += resolved.resolvedAmount;
      const detail = breakdownById.get(item.id) ?? {
        id: item.id,
        name: item.name,
        kind: 'fixed' as const,
        grossAmount: 0,
        taxAmount: 0,
        amount: 0,
        days: item.dailyRate !== undefined ? 0 : undefined,
        dailyRate: item.dailyRate,
      };
      detail.grossAmount += resolved.grossAmount;
      detail.taxAmount += resolved.taxAmount;
      detail.amount += resolved.resolvedAmount;
      if (detail.days !== undefined) detail.days += resolved.resolvedDayCount ?? 0;
      breakdownById.set(item.id, detail);
    }
  }
  return { total, items: [...breakdownById.values()] };
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
    // 最后几个实习日可能属于下一个发薪周期；即使到账日晚于 DDL，收入也在实习发生日计入。
    const payrollMonths = enumerateMonths(today, new Date(end.getFullYear(), end.getMonth() + 1, 1));
    for (const month of payrollMonths) {
      const schedule = getPayrollScheduleForMonth(month.year, month.month0, options.holidayDataByYear);
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
      groups.push({ id: month.yearMonth, year: month.year, month0: month.month0, dates: candidateDates, marginalIncome, chosen: 0 });
    }
  }

  const incomeInRangeResult = incomeInRange(
    options.incomeItems,
    months,
    baselineTagMap,
    options.holidayDataByYear,
    startDate,
    deadline,
  );
  const minimumIncome = incomeInRangeResult.total;
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

  const selectNextInternDate = (requirePositiveGain: boolean): boolean => {
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
    if (!bestGroup || (requirePositiveGain && bestGain <= 0)) return false;
    recommendedCoreSurplus += bestGain;
    recommendedDates.push(bestGroup.dates[bestGroup.chosen]);
    bestGroup.chosen += 1;
    return true;
  };

  while (recommendedCoreSurplus + 1e-7 < requiredCoreSurplus) {
    if (!selectNextInternDate(true)) break;
  }

  let minimumInternDays: number | null = recommendedCoreSurplus + 1e-7 >= requiredCoreSurplus
    ? recommendedDates.length
    : null;
  let usesConsumptionTransfer = false;

  if (minimumInternDays === null) {
    for (const group of groups) group.chosen = group.dates.length;
    // 常规心愿份额仍不足时，按用户定义把所有“非家非游”的中国法定工作日拉满。
    recommendedDates = [...flexibleWorkingDates];
  } else {
    const requestedInternDays = Number.isFinite(options.selectedInternDays)
      ? Math.round(options.selectedInternDays ?? minimumInternDays)
      : minimumInternDays;
    const selectedInternDays = Math.min(
      Math.max(requestedInternDays, minimumInternDays),
      flexibleWorkingDates.length,
    );
    while (recommendedDates.length < selectedInternDays && selectNextInternDate(false)) {
      // 优先补入扣税后边际收益更高的实习日。
    }
    if (recommendedDates.length < selectedInternDays) {
      const selectedDates = new Set(recommendedDates);
      for (const date of flexibleWorkingDates) {
        if (selectedDates.has(date)) continue;
        recommendedDates.push(date);
        if (recommendedDates.length >= selectedInternDays) break;
      }
    }
  }

  const selectedInternDateSet = new Set(recommendedDates);
  const lifeExpenseBreakdown: WishLifeExpenseBreakdown = {
    home: { days: 0, dailyAverage: normalizedDailyAverage(options.stateDailyAvg.home), amount: 0 },
    travel: { days: 0, dailyAverage: normalizedDailyAverage(options.stateDailyAvg.travel), amount: 0 },
    intern: { days: 0, dailyAverage: normalizedDailyAverage(options.stateDailyAvg.intern), amount: 0 },
    school: { days: 0, dailyAverage: normalizedDailyAverage(options.stateDailyAvg.school), amount: 0 },
  };
  for (const date of dates) {
    const tagKind: TagKind = selectedInternDateSet.has(date) ? 'intern' : baselineTagMap[date];
    lifeExpenseBreakdown[tagKind].days += 1;
  }
  for (const item of Object.values(lifeExpenseBreakdown)) {
    item.amount = item.days * item.dailyAverage;
  }
  const recommendedLifeExpense = Object.values(lifeExpenseBreakdown)
    .reduce((sum, item) => sum + item.amount, 0);
  const internIncomeBreakdown: WishIncomeBreakdownItem[] = activeInternIncome.map((item) => {
    let days = 0;
    let grossAmount = 0;
    let amount = 0;
    for (const group of groups) {
      const chosenDays = group.dates.filter((date) => selectedInternDateSet.has(date)).length;
      if (chosenDays === 0) continue;
      const dailyRate = item.dailyRate ?? 0;
      const baseCycle = getInternPayrollCycleForMonth(
        item,
        group.year,
        group.month0,
        baselineTagMap,
        options.holidayDataByYear,
      );
      const previousNet = calculateIncomeTax(baseCycle.internDays * dailyRate, item.taxRuleText).netAmount;
      const nextNet = calculateIncomeTax((baseCycle.internDays + chosenDays) * dailyRate, item.taxRuleText).netAmount;
      days += chosenDays;
      grossAmount += chosenDays * dailyRate;
      amount += nextNet - previousNet;
    }
    return {
      id: item.id,
      name: item.name,
      kind: 'intern' as const,
      grossAmount,
      taxAmount: Math.max(grossAmount - amount, 0),
      amount,
      days,
      dailyRate: item.dailyRate,
    };
  }).filter((item) => item.days > 0 || item.amount !== 0);
  const incomeBreakdown = [...incomeInRangeResult.items, ...internIncomeBreakdown];
  const recommendedIncome = incomeBreakdown.reduce((sum, item) => sum + item.amount, 0);
  recommendedCoreSurplus = recommendedIncome - recommendedLifeExpense - repayment;
  const positiveRecommendedSurplus = Math.max(recommendedCoreSurplus, 0);
  const normalWishSaving = Math.max(
    positiveRecommendedSurplus * POST_LIFE_WISH_SHARE,
    0,
  );
  const normalWishShortfall = Math.max(wishAmount - normalWishSaving, 0);
  const consumptionPool = minimumInternDays === null
    ? Math.max(recommendedCoreSurplus * POST_LIFE_CONSUMPTION_SHARE, 0)
    : 0;
  const consumptionTransferredToWish = Math.min(normalWishShortfall, consumptionPool);
  const projectedWishSaving = normalWishSaving + consumptionTransferredToWish;
  const projectedConsumption = Math.max(
    positiveRecommendedSurplus * POST_LIFE_CONSUMPTION_SHARE - consumptionTransferredToWish,
    0,
  );
  const projectedInvestmentSaving = positiveRecommendedSurplus * POST_LIFE_INVESTMENT_SHARE;
  const projectedTotalSaving = projectedWishSaving + projectedInvestmentSaving;
  const shortfall = Math.max(wishAmount - projectedWishSaving, 0);
  if (minimumInternDays === null && consumptionTransferredToWish > 0) usesConsumptionTransfer = true;
  if (minimumInternDays === null && shortfall <= 1e-7) minimumInternDays = recommendedDates.length;
  const scheduledInternDays = flexibleWorkingDates.filter((date) => options.tagMap[date] === 'intern').length;
  const targetInternDays = minimumInternDays ?? flexibleWorkingDates.length;
  const additionalInternDays = Math.max(targetInternDays - scheduledInternDays, 0);
  const reducibleInternDays = minimumInternDays === null
    ? 0
    : Math.max(scheduledInternDays - minimumInternDays, 0);
  const monthPlans = months.map((month) => ({
    yearMonth: month.yearMonth,
    internDays: recommendedDates.filter((date) => date.startsWith(`${month.yearMonth}-`)).length,
    availableInternDays: flexibleWorkingDates.filter((date) => date.startsWith(`${month.yearMonth}-`)).length,
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
    recommendedIncome,
    incomeBreakdown,
    requiredIncome: recommendedLifeExpense + repayment + requiredCoreSurplus,
    baselineLifeExpense,
    recommendedLifeExpense,
    lifeExpenseBreakdown,
    repayment,
    totalLivingExpense: recommendedLifeExpense + repayment,
    projectedSurplus: recommendedCoreSurplus,
    projectedConsumption,
    projectedInvestmentSaving,
    projectedTotalSaving,
    availableInternDays: flexibleWorkingDates.length,
    scheduledInternDays,
    minimumInternDays,
    selectedInternDays: recommendedDates.length,
    additionalInternDays,
    reducibleInternDays,
    availableInternDateKeys: flexibleWorkingDates,
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
