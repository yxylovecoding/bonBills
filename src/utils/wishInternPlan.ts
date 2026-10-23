import { wishTripStarts } from './wishAssociations';
import { internshipStart, type InternshipContext } from './internship';
import { reserveWishIncomeGroups } from './wishRaiseSavings';
import { calculateDatedWishInternPlan, chooseInternDays } from './datedWishInternPlan';
import type { CurrentStats } from '../models/types';
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
  calculateWishFunding,
  wishTravelLifeAmount,
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
  projectedRaiseSavings: number;
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
  projectedWishBalance: number;
  spentWishAmount: number;
  spentWishNames: string[];
  consumptionTransferredToWish: number;
  consumptionTransferWishNames: string[];
  usesConsumptionTransfer: boolean;
  excludedLivingDays: number;
  excludedLifeExpense: number;
  shortfall: number;
  shortfallWorkDays: number | null;
}

export interface WishInternPlanOptions {
  internship?: InternshipContext;
  cityLivingStats?: CurrentStats['cityLivingStats'];
  requiredDates?: string[];
  today: Date;
  deadline: string;
  wishes: WishItem[];
  incomeItems: IncomeItem[];
  recurringIncomeBaseline?: number;
  raiseSavings?: import('../models/types').RaiseSavingsSettings;
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
  fixedDates: string[];
  marginalIncome: number[];
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
): { total: number; items: WishIncomeBreakdownItem[]; byMonth: Record<string, number> } {
  let total = 0;
  const byMonth: Record<string, number> = {};
  const breakdownById = new Map<string, WishIncomeBreakdownItem>();
  for (const { year, month0 } of months) {
    for (const item of incomeItems) {
      if (!item.isActive) continue;
      // 心愿规划中的实习日薪按实际实习日计入，不能再按工资到账日重复计算。
      if (item.dailyRate !== undefined && item.tagKind === 'intern') continue;
      const resolved = resolveIncomeForMonth(item, year, month0, tagMap, holidayDataByYear);
      if (resolved.resolvedPayDate < startDate || resolved.resolvedPayDate > deadline) continue;
      total += resolved.resolvedAmount;
      const yearMonth = resolved.resolvedPayDate.slice(0, 7);
      byMonth[yearMonth] = (byMonth[yearMonth] ?? 0) + resolved.resolvedAmount;
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
  return { total, items: [...breakdownById.values()], byMonth };
}

function normalizedDailyAverage(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

export function calculateWishInternPlan(options: WishInternPlanOptions): WishInternPlan {
  if (options.internship && internshipStart(options.internship.config)) return calculateDatedWishInternPlan(options);
  const today = startOfDay(options.today);
  const requestedDeadline = parseDateKey(options.deadline);
  const end = requestedDeadline && requestedDeadline >= today ? requestedDeadline : today;
  const startDate = formatDateKey(today);
  const deadline = formatDateKey(end);
  const dates = enumerateDates(today, end);
  const months = enumerateMonths(today, end);
  const baselineTagMap = { ...options.tagMap };
  const flexibleWorkingDates: string[] = [];
  const requiredDates = new Set(options.requiredDates ?? []);
  const fixedWorkingDates: string[] = [];
  let baselineLifeExpense = 0;

  for (const date of dates) {
    const existing = options.tagMap[date];
    const fixedTag = existing === 'home' || existing === 'travel' ? existing : null;
    const fixedWork = !fixedTag && requiredDates.has(date) && isWorkingDate(date, options.holidayDataByYear);
    if (fixedWork) fixedWorkingDates.push(date);
    const baselineTag: TagKind = fixedTag ?? (fixedWork ? 'intern' : 'school');
    baselineTagMap[date] = baselineTag;
    baselineLifeExpense += normalizedDailyAverage(options.stateDailyAvg[baselineTag]);
    if (!fixedTag && isWorkingDate(date, options.holidayDataByYear)) flexibleWorkingDates.push(date);
  }

  const includedWishes = options.wishes.filter((wish) => {
    if (!wish.isActive || !wish.deadline || wish.deadline > deadline) return false;
    return calculateWishFunding(wish, wishTravelLifeAmount(wish, options.stateDailyAvg.travel, options.tripDatesByStart)).remainingAmount > 0;
  }).sort((first, second) => (
    (first.deadline ?? '').localeCompare(second.deadline ?? '') || first.id.localeCompare(second.id)
  ));
  const linkedTravelDates = new Set<string>();
  const travelLifeDaily = normalizedDailyAverage(options.stateDailyAvg.travel);
  let requestedManualTravelDays = 0;
  const wishFundingRequirements = includedWishes.map((wish) => {
    const amountIncludingLife = calculateWishFunding(wish).remainingAmount;
    const amount = calculateWishFunding(wish, wishTravelLifeAmount(wish, travelLifeDaily, options.tripDatesByStart)).remainingAmount;
    const excludedLifeExpense = Math.max(amountIncludingLife - amount, 0);
    const linkedDates = [...new Set(wishTripStarts(wish).flatMap((start) => options.tripDatesByStart?.[start] ?? []))];
    if (linkedDates && linkedDates.length > 0) {
      for (const date of linkedDates) linkedTravelDates.add(date);
      return {
        wish,
        amountIncludingLife,
        excludedLifeExpense,
        amount,
      };
    }
    const manualDays = Number.isFinite(wish.plannedTravelDays)
      ? Math.max(Math.round(wish.plannedTravelDays ?? 0), 0)
      : 0;
    requestedManualTravelDays += manualDays;
    return {
      wish,
      amountIncludingLife,
      excludedLifeExpense,
      amount,
    };
  });
  const manualTravelDays = requestedManualTravelDays;

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
        (date) => !requiredDates.has(date) && !assignedDates.has(date) && date > previous.cutoffDate && date <= schedule.cutoffDate,
      );
      const fixedDates = fixedWorkingDates.filter(date => date > previous.cutoffDate && date <= schedule.cutoffDate);
      if (candidateDates.length === 0 && fixedDates.length === 0) continue;
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
      groups.push({ id: month.yearMonth, year: month.year, month0: month.month0, dates: candidateDates, fixedDates, marginalIncome });
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
  let minimumIncome = incomeInRangeResult.total;
  for (const group of groups) {
    const fixedIncome = activeInternIncome.reduce((sum, item) => {
      const cycle = getInternPayrollCycleForMonth(item, group.year, group.month0, baselineTagMap, options.holidayDataByYear);
      return sum + calculateIncomeTax(cycle.internDays * item.dailyRate!, item.taxRuleText).netAmount
        - calculateIncomeTax((cycle.internDays - group.fixedDates.length) * item.dailyRate!, item.taxRuleText).netAmount;
    }, 0);
    minimumIncome += fixedIncome;
    incomeInRangeResult.byMonth[group.id] = (incomeInRangeResult.byMonth[group.id] ?? 0) + fixedIncome;
  }
  const allMarginalIncome = groups.flatMap((group) => group.marginalIncome);
  const maximumIncome = minimumIncome + allMarginalIncome.reduce((sum, amount) => sum + amount, 0);
  const repayment = months.reduce((sum, month) => {
    const amount = options.repaymentsByMonth[month.yearMonth];
    return sum + (Number.isFinite(amount) ? Math.max(amount, 0) : 0);
  }, 0);
  const wishAmountIncludingLife = wishFundingRequirements.reduce(
    (sum, requirement) => sum + requirement.amountIncludingLife,
    0,
  );
  const excludedLifeExpense = wishFundingRequirements.reduce(
    (sum, requirement) => sum + requirement.excludedLifeExpense,
    0,
  );
  const wishAmount = wishFundingRequirements.reduce(
    (sum, requirement) => sum + requirement.amount,
    0,
  );
  const expenseDeltaPerInternDay = normalizedDailyAverage(options.stateDailyAvg.intern)
    - normalizedDailyAverage(options.stateDailyAvg.school);
  const requiredCoreSurplus = wishAmount / POST_LIFE_WISH_SHARE;
  const savingsPlan = reserveWishIncomeGroups(groups.map(group => {
    const cumulative = [0];
    group.marginalIncome.forEach(amount => cumulative.push(cumulative[cumulative.length - 1] + amount));
    return { yearMonth: group.id, dates: group.dates, income: (count: number) => cumulative[count],
      gains: cumulative.map((amount, count) => amount - count * expenseDeltaPerInternDay) };
  }), incomeInRangeResult.byMonth, options.recurringIncomeBaseline, options.raiseSavings, months.map(month => month.yearMonth));
  const baselineCoreSurplus = minimumIncome - savingsPlan.baseSavings - baselineLifeExpense - repayment;
  const chosen = chooseInternDays(savingsPlan.groups, requiredCoreSurplus - baselineCoreSurplus,
    options.selectedInternDays == null ? null : options.selectedInternDays - fixedWorkingDates.length);
  const projectedRaiseSavings = savingsPlan.savings(chosen.counts);
  let minimumInternDays = chosen.minimum === null ? null : chosen.minimum + fixedWorkingDates.length;
  let usesConsumptionTransfer = false;
  // Preserve the full-attendance fallback when the normal wish share cannot cover the target.
  const recommendedDates = minimumInternDays === null ? [...flexibleWorkingDates] : [...fixedWorkingDates, ...chosen.dates];

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
      const chosenDays = group.fixedDates.length + group.dates.filter((date) => selectedInternDateSet.has(date)).length;
      if (chosenDays === 0) continue;
      const dailyRate = item.dailyRate ?? 0;
      const baseCycle = getInternPayrollCycleForMonth(
        item,
        group.year,
        group.month0,
        baselineTagMap,
        options.holidayDataByYear,
      );
      const previousDays = baseCycle.internDays - group.fixedDates.length;
      const previousNet = calculateIncomeTax(previousDays * dailyRate, item.taxRuleText).netAmount;
      const nextNet = calculateIncomeTax((previousDays + chosenDays) * dailyRate, item.taxRuleText).netAmount;
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
  const recommendedCoreSurplus = recommendedIncome - projectedRaiseSavings - recommendedLifeExpense - repayment;
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
  const spentWishRequirements = wishFundingRequirements.filter(
    ({ wish }) => Boolean(wish.deadline && wish.deadline < deadline),
  );
  const spentWishAmount = spentWishRequirements.reduce(
    (sum, requirement) => sum + requirement.amount,
    0,
  );
  const spentWishNames = [...new Set(spentWishRequirements.map(({ wish }) => wish.name.trim()).filter(Boolean))];
  const projectedWishBalance = Math.max(projectedWishSaving - spentWishAmount, 0);
  let normalWishSavingRemaining = normalWishSaving;
  let consumptionTransferRemaining = consumptionTransferredToWish;
  const consumptionTransferWishNames: string[] = [];
  for (const { wish, amount } of wishFundingRequirements) {
    const normalCovered = Math.min(normalWishSavingRemaining, amount);
    normalWishSavingRemaining -= normalCovered;
    const uncovered = amount - normalCovered;
    if (uncovered <= 0 || consumptionTransferRemaining <= 0) continue;
    const transferred = Math.min(uncovered, consumptionTransferRemaining);
    consumptionTransferRemaining -= transferred;
    const name = wish.name.trim();
    if (name && !consumptionTransferWishNames.includes(name)) consumptionTransferWishNames.push(name);
  }
  const projectedConsumption = Math.max(
    positiveRecommendedSurplus * POST_LIFE_CONSUMPTION_SHARE - consumptionTransferredToWish,
    0,
  );
  const projectedInvestmentSaving = projectedRaiseSavings + positiveRecommendedSurplus * POST_LIFE_INVESTMENT_SHARE;
  const projectedTotalSaving = projectedWishBalance + projectedInvestmentSaving;
  const shortfall = Math.max(wishAmount - projectedWishSaving, 0);
  const positiveFullAttendanceGains = savingsPlan.groups.flatMap(group => group.gains.slice(1).map((gain, i) => gain - group.gains[i]))
    .filter((amount) => amount > 1e-7);
  const averageAdditionalCoreSurplus = positiveFullAttendanceGains.length > 0
    ? positiveFullAttendanceGains.reduce((sum, amount) => sum + amount, 0) / positiveFullAttendanceGains.length
    : 0;
  const additionalWishShare = POST_LIFE_WISH_SHARE + POST_LIFE_CONSUMPTION_SHARE;
  const shortfallWorkDays = shortfall <= 1e-7
    ? 0
    : averageAdditionalCoreSurplus > 1e-7 && additionalWishShare > 0
      ? Math.ceil(shortfall / (averageAdditionalCoreSurplus * additionalWishShare))
      : null;
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
    requiredIncome: projectedRaiseSavings + recommendedLifeExpense + repayment + requiredCoreSurplus,
    baselineLifeExpense,
    recommendedLifeExpense,
    lifeExpenseBreakdown,
    repayment,
    totalLivingExpense: recommendedLifeExpense + repayment,
    projectedRaiseSavings,
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
    projectedWishBalance,
    spentWishAmount,
    spentWishNames,
    consumptionTransferredToWish,
    consumptionTransferWishNames,
    usesConsumptionTransfer,
    excludedLivingDays: linkedTravelDates.size + manualTravelDays,
    excludedLifeExpense,
    shortfall,
    shortfallWorkDays,
  };
}
