import { resolvePayDay } from '../calculations/budget';
import type { IncomeItem, TagKind } from '../models/types';
import type { HolidayDataByYear } from './holidays';
import { calculateIncomeTax } from './tax';
import { internshipStart, migratedProfiles, showsCompanyPayrollCutoff, type InternshipContext } from './internship';
import { internshipCutoffDates, internshipPayrollsPaidInMonth, type InternshipPayroll } from './internshipPayroll';

export interface InternPayrollCycle {
  payDate: string;
  cutoffDate: string;
  periodStartExclusive: string;
  periodEndInclusive: string;
  internDays: number;
  effectiveAmount: number;
}

export interface ResolvedIncomeItem extends IncomeItem {
  resolvedAmount: number;
  grossAmount: number;
  taxAmount: number;
  taxRuleSummary?: string;
  taxRuleError?: string;
  resolvedPayDate: string;
  isInternPayroll: boolean;
  resolvedDayCount?: number;
  payrollCycle?: InternPayrollCycle;
  internshipPayroll?: InternshipPayroll;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(key: string, delta: number) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + delta);
  return formatDateKey(date);
}

export function isWeekendDate(key: string) {
  const day = parseDateKey(key).getDay();
  return day === 0 || day === 6;
}

export function isWorkingDate(key: string, holidayDataByYear: HolidayDataByYear) {
  const year = Number(key.slice(0, 4));
  const holiday = holidayDataByYear[year]?.[key];
  if (holiday) return !holiday.isOffDay;
  return !isWeekendDate(key);
}

export function getLastWorkingDay(year: number, month0: number, holidayDataByYear: HolidayDataByYear) {
  const cursor = new Date(year, month0 + 1, 0);
  while (true) {
    const key = formatDateKey(cursor);
    if (isWorkingDate(key, holidayDataByYear)) return key;
    cursor.setDate(cursor.getDate() - 1);
  }
}

export function getPayrollScheduleForMonth(year: number, month0: number, holidayDataByYear: HolidayDataByYear) {
  const payDate = getLastWorkingDay(year, month0, holidayDataByYear);
  const cutoffDate = addDays(payDate, -6);
  return { payDate, cutoffDate };
}

/** Shared by the record and wish calendars; preferences never enter payroll calculations. */
export function payrollCutoffMarkerDates(input: InternshipContext, tags: Record<string, TagKind>, year: number, month0: number, legacyPreference = true): string[] {
  const dates = internshipCutoffDates(input, tags, year, month0, legacyPreference);
  const start = internshipStart(input.config);
  const { cutoffDate } = getPayrollScheduleForMonth(year, month0, input.holidayDataByYear ?? {});
  const legacyVisible = migratedProfiles(input.config).some(profile => profile.legacyIncomeId && showsCompanyPayrollCutoff(profile, legacyPreference));
  if (legacyVisible && (!start || cutoffDate < start)) dates.push(cutoffDate);
  return [...new Set(dates)].sort();
}

function countMonthTags(tagMap: Record<string, TagKind>, year: number, month0: number, tagKind: TagKind) {
  const yearMonth = `${year}-${pad(month0 + 1)}`;
  let count = 0;
  for (const [date, tag] of Object.entries(tagMap)) {
    if (date.startsWith(yearMonth) && tag === tagKind) count++;
  }
  return count;
}

export function getInternPayrollCycleForMonth(
  item: IncomeItem,
  year: number,
  month0: number,
  tagMap: Record<string, TagKind>,
  holidayDataByYear: HolidayDataByYear,
): InternPayrollCycle {
  const current = getPayrollScheduleForMonth(year, month0, holidayDataByYear);
  const prevYear = month0 === 0 ? year - 1 : year;
  const prevMonth0 = month0 === 0 ? 11 : month0 - 1;
  const previous = getPayrollScheduleForMonth(prevYear, prevMonth0, holidayDataByYear);

  let internDays = 0;
  for (const [date, tag] of Object.entries(tagMap)) {
    if (tag !== 'intern') continue;
    if (date > previous.cutoffDate && date <= current.cutoffDate) internDays += 1;
  }

  return {
    payDate: current.payDate,
    cutoffDate: current.cutoffDate,
    periodStartExclusive: previous.cutoffDate,
    periodEndInclusive: current.cutoffDate,
    internDays,
    effectiveAmount: (item.dailyRate ?? 0) * internDays,
  };
}

export function resolveIncomeForMonth(
  item: IncomeItem,
  year: number,
  month0: number,
  tagMap: Record<string, TagKind>,
  holidayDataByYear: HolidayDataByYear,
): ResolvedIncomeItem {
  const isInternPayroll = item.dailyRate !== undefined && item.tagKind === 'intern';
  if (isInternPayroll) {
    const payrollCycle = getInternPayrollCycleForMonth(item, year, month0, tagMap, holidayDataByYear);
    const tax = calculateIncomeTax(payrollCycle.effectiveAmount, item.taxRuleText);
    return {
      ...item,
      amount: payrollCycle.effectiveAmount,
      resolvedAmount: tax.netAmount,
      grossAmount: tax.grossAmount,
      taxAmount: tax.taxAmount,
      taxRuleSummary: tax.ruleSummary,
      taxRuleError: tax.ruleError,
      resolvedPayDate: payrollCycle.payDate,
      isInternPayroll: true,
      resolvedDayCount: payrollCycle.internDays,
      payrollCycle,
    };
  }

  const resolvedDayCount = item.dailyRate !== undefined && item.tagKind
    ? countMonthTags(tagMap, year, month0, item.tagKind)
    : undefined;
  const resolvedAmount = item.dailyRate !== undefined && item.tagKind
    ? item.dailyRate * (resolvedDayCount ?? 0)
    : item.amount;
  const tax = calculateIncomeTax(resolvedAmount, item.taxRuleText);
  const payDay = resolvePayDay(item.payDay, year, month0);
  return {
    ...item,
    amount: resolvedAmount,
    resolvedAmount: tax.netAmount,
    grossAmount: tax.grossAmount,
    taxAmount: tax.taxAmount,
    taxRuleSummary: tax.ruleSummary,
    taxRuleError: tax.ruleError,
    resolvedPayDate: `${year}-${pad(month0 + 1)}-${pad(payDay)}`,
    isInternPayroll: false,
    resolvedDayCount,
  };
}

export function dateLabel(dateKey: string) {
  return `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
}

export function daysUntilDate(targetDate: string, fromDate: Date) {
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const end = parseDateKey(targetDate);
  const diff = end.getTime() - start.getTime();
  return Math.round(diff / 86400000);
}

export function resolveAllIncomeForMonth(
  items: IncomeItem[], year: number, month0: number, tagMap: Record<string, TagKind>,
  holidays: HolidayDataByYear, context?: InternshipContext,
): ResolvedIncomeItem[] {
  const start = context ? internshipStart(context.config) : undefined;
  const legacyTags = start ? Object.fromEntries(Object.entries(tagMap).filter(([date]) => date < start)) : tagMap;
  const legacy = items.map(item => resolveIncomeForMonth(item, year, month0,
    item.tagKind === 'intern' && item.dailyRate !== undefined ? legacyTags : tagMap, holidays));
  if (!context || !start) return legacy;
  const payrolls = internshipPayrollsPaidInMonth({ ...context, holidayDataByYear: { ...context.holidayDataByYear, ...holidays } }, tagMap, year, month0);
  return [...legacy, ...payrolls.map(p => ({
    id: `internship:${p.id}`, name: p.name, amount: p.grossAmount, payDay: Number(p.payDate.slice(8, 10)),
    isActive: true, resolvedAmount: p.netAmount, grossAmount: p.grossAmount, taxAmount: p.taxAmount,
    resolvedPayDate: p.payDate, isInternPayroll: true, resolvedDayCount: p.workDates.length,
    taxRuleError: p.taxRuleError, internshipPayroll: p,
  }))];
}
