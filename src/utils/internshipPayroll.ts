import type { InternshipRules, TagKind } from '../models/types.js';
import { calculateIncomeTax } from './tax.js';
import { companyWorkingDate, dateRange, migratedProfiles, periodReady, resolveDailyContext, sameCity, shiftDay, showsCompanyPayrollCutoff, type InternshipContext } from './internship.js';
import type { HolidayDataByYear } from './holidays.js';

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function monthDate(year: number, month0: number, day = 1) {
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(day, last.getUTCDate()))).toISOString().slice(0, 10);
}
function payDateForMonth(rules: InternshipRules, year: number, month0: number, holidays: HolidayDataByYear) {
  let date = monthDate(year, month0, rules.payKind === 'fixed' ? rules.payDay : 31);
  if (rules.payKind === 'lastWorkingDay') while (!companyWorkingDate(date, rules, holidays)) date = shiftDay(date, -1);
  if (rules.payAdjustment !== 'none') {
    const direction = rules.payAdjustment === 'previous' ? -1 : 1;
    while (!companyWorkingDate(date, rules, holidays)) date = shiftDay(date, direction);
  }
  return date;
}
export function internshipSchedule(rules: InternshipRules, year: number, month0: number, holidays: HolidayDataByYear = {}) {
  const payDate = payDateForMonth(rules, year, month0 + rules.payMonthOffset, holidays);
  const cutoff = (y: number, m: number) => rules.cycle === 'beforePay'
    ? shiftDay(payDateForMonth(rules, y, m + rules.payMonthOffset, holidays), -rules.cutoffOffset)
    : monthDate(y, m, rules.cycle === 'calendar' ? 31 : rules.cutoffDay);
  return { payDate, startDate: shiftDay(cutoff(year, month0 - 1), 1), endDate: cutoff(year, month0) };
}
export interface InternshipPayroll {
  id: string;
  profileId: string;
  revision: number;
  name: string;
  rules: InternshipRules;
  startDate: string;
  endDate: string;
  payDate: string;
  employedDates: string[];
  workDates: string[];
  residenceDates: string[];
  salaryAmount: number;
  housingAmount: number;
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  taxRuleError?: string;
}
export function payrollAmount(rules: InternshipRules, cycleDates: string[], employedDays: number, workDays: number, residenceDays: number, holidays: HolidayDataByYear = {}) {
  const divisor = rules.monthlyDivisor ?? cycleDates.filter(date => companyWorkingDate(date, rules, holidays)).length;
  const salaryAmount = money(rules.salaryKind === 'daily' ? (rules.salary ?? 0) * workDays
    : divisor > 0 ? (rules.salary ?? 0) * workDays / divisor : 0);
  const housingAmount = money(rules.housingKind === 'monthly' ? employedDays > 0
    ? rules.housingAmount * (rules.housingProrated ? employedDays / cycleDates.length : 1) : 0
    : rules.housingKind === 'residence' ? rules.housingAmount * residenceDays
    : rules.housingKind === 'attendance' ? rules.housingAmount * workDays : 0);
  const tax = calculateIncomeTax(salaryAmount + (rules.housingTaxable ? housingAmount : 0), rules.taxRuleText);
  return { salaryAmount, housingAmount, grossAmount: money(salaryAmount + housingAmount), taxAmount: tax.taxAmount,
    netAmount: money(tax.netAmount + (rules.housingTaxable ? 0 : housingAmount)), taxRuleError: tax.ruleError };
}
/** All periods are grouped before tax. The window refers to earned dates, not payout dates. */
export function internshipPayrolls(input: InternshipContext, tags: Record<string, TagKind>, from: string, to: string): InternshipPayroll[] {
  const periods = (input.config.internshipPeriods ?? []).filter(periodReady);
  const holidays = input.holidayDataByYear ?? {};
  const groups = new Map<string, InternshipPayroll>();
  for (const period of periods) {
    const start = period.startDate > from ? period.startDate : from, end = period.endDate < to ? period.endDate : to;
    if (start > end) continue;
    const first = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`);
    // Cutoffs relative to a next-month payout can straddle either adjacent month.
    for (let month = first.getUTCFullYear() * 12 + first.getUTCMonth() - 2; month <= last.getUTCFullYear() * 12 + last.getUTCMonth() + 2; month++) {
      const schedule = internshipSchedule(period.rules, Math.floor(month / 12), month % 12, holidays);
      if (schedule.endDate < start || schedule.startDate > end) continue;
      const key = `${period.profileId}:${period.revision}:${schedule.startDate}:${JSON.stringify(period.rules)}`;
      if (groups.has(key)) continue;
      const cycleDates = dateRange(schedule.startDate, schedule.endDate);
      const employedDates: string[] = [], workDates: string[] = [], residenceDates: string[] = [];
      for (const date of cycleDates) {
        const context = resolveDailyContext(date, tags[date], input), p = context.period;
        if (!p || p.profileId !== period.profileId || p.revision !== period.revision || JSON.stringify(p.rules) !== JSON.stringify(period.rules)) continue;
        employedDates.push(date);
        if (context.paid) workDates.push(date);
        if (sameCity(context.city, p.city)) residenceDates.push(date);
      }
      if (!employedDates.length) continue;
      groups.set(key, { id: key, profileId: period.profileId, revision: period.revision, name: period.profileName,
        rules: period.rules, ...schedule, employedDates, workDates, residenceDates,
        ...payrollAmount(period.rules, cycleDates, employedDates.length, workDates.length, residenceDates.length, holidays) });
    }
  }
  return [...groups.values()].sort((a, b) => a.payDate.localeCompare(b.payDate) || a.id.localeCompare(b.id));
}
export function internshipPayrollsPaidInMonth(input: InternshipContext, tags: Record<string, TagKind>, year: number, month0: number) {
  const from = monthDate(year, month0), to = monthDate(year, month0, 31);
  return internshipPayrolls(input, tags, monthDate(year, month0 - 3), monthDate(year, month0 + 2, 31))
    .filter(p => p.payDate >= from && p.payDate <= to);
}

export function internshipCutoffDates(input: InternshipContext, tags: Record<string, TagKind>, year: number, month0: number, legacyPreference = true) {
  const from = monthDate(year, month0), to = monthDate(year, month0, 31);
  const profiles = new Map(migratedProfiles(input.config).map(profile => [profile.id, profile]));
  return internshipPayrolls(input, tags, monthDate(year, month0 - 2), monthDate(year, month0 + 2, 31))
    .filter(p => showsCompanyPayrollCutoff(profiles.get(p.profileId), legacyPreference))
    .map(p => p.endDate).filter(date => date >= from && date <= to);
}
