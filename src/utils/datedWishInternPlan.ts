import type { DayOverrides, TagKind } from '../models/types';
import type { WishInternPlan, WishInternPlanOptions, WishIncomeBreakdownItem } from './wishInternPlan';
import { companyWorkingDate, dateRange, internshipStart, resolveDailyContext, shiftDay, type InternshipContext } from './internship';
import { internshipPayrolls, payrollAmount } from './internshipPayroll';
import { dailyLivingAmount } from './cityLiving';
import { calculateIncomeTax } from './tax';
import { getInternPayrollCycleForMonth, resolveIncomeForMonth } from './payroll';
import { POST_LIFE_WISH_SHARE, POST_LIFE_CONSUMPTION_SHARE, POST_LIFE_INVESTMENT_SHARE, calculateWishFunding, wishTravelLifeAmount } from './wishes';

interface Group { dates: string[]; gains: number[]; income: (n: number) => number; detail: (n: number) => WishIncomeBreakdownItem[] }
/** Exact day-count DP: the old greedy marginal order is not valid across tax brackets. */
export function chooseInternDays(groups: { dates: string[]; gains: number[] }[], target: number, requested?: number | null) {
  let states: { gain: number; counts: number[] }[] = [{ gain: 0, counts: [] }];
  for (const group of groups) {
    const next: typeof states = [];
    for (let previous = 0; previous < states.length; previous++) {
      if (!states[previous]) continue;
      for (let count = 0; count <= group.dates.length; count++) {
        const total = previous + count, gain = states[previous].gain + group.gains[count];
        if (!next[total] || gain > next[total].gain + 1e-7) next[total] = { gain, counts: [...states[previous].counts, count] };
      }
    }
    states = next;
  }
  const minimum = states.findIndex(state => state && state.gain + 1e-7 >= target);
  const count = minimum < 0 ? states.length - 1 : Math.min(states.length - 1, Math.max(minimum, Math.round(requested ?? minimum)));
  const selected = states[count] ?? { gain: 0, counts: [] };
  return { minimum: minimum < 0 ? null : minimum, counts: selected.counts, gain: selected.gain,
    dates: groups.flatMap((group, i) => group.dates.slice(0, selected.counts[i] ?? 0)).sort() };
}
export function calculateDatedWishInternPlan(o: WishInternPlanOptions): WishInternPlan {
  const start = `${o.today.getFullYear()}-${String(o.today.getMonth() + 1).padStart(2, '0')}-${String(o.today.getDate()).padStart(2, '0')}`;
  const deadline = o.deadline >= start ? o.deadline : start;
  const dates = dateRange(start, deadline), enabled = internshipStart(o.internship!.config)!;
  const holidays = { ...o.internship!.holidayDataByYear, ...o.holidayDataByYear };
  const context: InternshipContext = { ...o.internship!, holidayDataByYear: holidays };
  const required = new Set(o.requiredDates ?? []), fixed: string[] = [], candidates: string[] = [];
  const baselineTags = { ...o.tagMap }, dayOverrides: DayOverrides = { ...context.dayOverrides };
  for (const date of dates) {
    const tag = o.tagMap[date], day = resolveDailyContext(date, tag, context), override = context.dayOverrides?.[date];
    if (tag === 'home' || tag === 'travel') continue;
    const canWork = day.period ? companyWorkingDate(date, day.period.rules, holidays) || override?.attendance === 'work'
      : date < enabled && companyWorkingDate(date, { workweek: 'statutory' }, holidays);
    if (required.has(date) || (override?.attendanceLocked && override.attendance === 'work' && day.period)) fixed.push(date);
    else if (canWork && !(override?.attendanceLocked && override.attendance === 'rest')) candidates.push(date);
    if (day.period) dayOverrides[date] = { ...override, attendance: fixed.includes(date) ? 'work' : 'rest' };
    else baselineTags[date] = fixed.includes(date) ? 'intern' : 'school';
  }
  const baselineContext = { ...context, dayOverrides };
  const stats = { stateDailyAvg: o.stateDailyAvg, cityLivingStats: o.cityLivingStats };
  const expense = (date: string, work: boolean) => dailyLivingAmount(date, work ? 'intern' : baselineTags[date], stats,
    { ...baselineContext, dayOverrides: { ...dayOverrides, [date]: { ...dayOverrides[date], attendance: work ? 'work' : 'rest' } } });
  const baselineLifeExpense = dates.reduce((sum, date) => sum + expense(date, fixed.includes(date)), 0);
  const delta = (date: string) => expense(date, true) - expense(date, false);
  const orderDates = (values: string[]) => values.sort((a, b) => delta(a) - delta(b) || a.localeCompare(b));
  const groups: Group[] = [];
  const baseDetails: WishIncomeBreakdownItem[] = [];
  for (const row of internshipPayrolls(baselineContext, baselineTags, start, deadline)) {
    const eligible = orderDates(candidates.filter(date => date >= row.startDate && date <= row.endDate
      && resolveDailyContext(date, baselineTags[date], context).period?.profileId === row.profileId
      && resolveDailyContext(date, baselineTags[date], context).period?.revision === row.revision
      && JSON.stringify(resolveDailyContext(date, baselineTags[date], context).period?.rules) === JSON.stringify(row.rules)));
    const cycleDates = dateRange(row.startDate, row.endDate);
    const beforeWork = row.workDates.filter(date => date < start).length;
    const throughWork = row.workDates.filter(date => date <= deadline).length;
    const accrued = (through: string, workDays: number) => {
      const amount = payrollAmount(row.rules, cycleDates, row.employedDates.length, workDays,
        row.residenceDates.filter(date => date <= through).length, holidays);
      if (row.rules.housingKind === 'monthly') {
        amount.housingAmount *= row.employedDates.filter(date => date <= through).length / row.employedDates.length;
      }
      const gross = amount.salaryAmount + amount.housingAmount;
      const tax = calculateIncomeTax(amount.salaryAmount + (row.rules.housingTaxable ? amount.housingAmount : 0), row.rules.taxRuleText);
      return { gross, net: tax.netAmount + (row.rules.housingTaxable ? 0 : amount.housingAmount) };
    };
    const before = accrued(shiftDay(start, -1), beforeWork);
    const calculate = (n: number): WishIncomeBreakdownItem => {
      const through = accrued(deadline, throughWork + n);
      const grossAmount = through.gross - before.gross, amount = through.net - before.net;
      return { id: row.id, name: row.name, kind: 'intern', grossAmount, amount, taxAmount: grossAmount - amount,
        days: throughWork - beforeWork + n, ...(row.rules.salaryKind === 'daily' && row.rules.housingKind === 'none' ? { dailyRate: row.rules.salary ?? 0 } : {}) };
    };
    const base = calculate(0); baseDetails.push(base);
    const gains = [0];
    let costs = 0;
    for (let n = 1; n <= eligible.length; n++) { costs += delta(eligible[n - 1]); gains.push(calculate(n).amount - base.amount - costs); }
    groups.push({ dates: eligible, gains, income: n => calculate(n).amount - base.amount, detail: n => [calculate(n)] });
  }
  // Legacy dates before the first explicit period keep their original payroll and tax schedule.
  const legacyIncome = o.incomeItems.filter(i => i.isActive && i.dailyRate !== undefined && i.tagKind === 'intern');
  const assigned = new Set<string>();
  const firstMonth = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  const lastMonth = Number(deadline.slice(0, 4)) * 12 + Number(deadline.slice(5, 7));
  for (let month = firstMonth; month <= lastMonth; month++) {
    const y = Math.floor(month / 12), m = month % 12;
    for (const item of o.incomeItems.filter(i => i.isActive && !(i.dailyRate !== undefined && i.tagKind === 'intern'))) {
      const resolved = resolveIncomeForMonth(item, y, m, baselineTags, holidays);
      if (resolved.resolvedPayDate >= start && resolved.resolvedPayDate <= deadline) baseDetails.push({ id: `${item.id}:${month}`, name: item.name,
        kind: 'fixed', grossAmount: resolved.grossAmount, taxAmount: resolved.taxAmount, amount: resolved.resolvedAmount });
    }
    if (!legacyIncome.length) continue;
    const cycle = getInternPayrollCycleForMonth(legacyIncome[0], y, m, {}, holidays);
    const eligible = orderDates(candidates.filter(date => date < enabled && date > cycle.periodStartExclusive && date <= cycle.periodEndInclusive && !assigned.has(date)));
    eligible.forEach(date => assigned.add(date));
    const fixedDays = fixed.filter(date => date < enabled && date > cycle.periodStartExclusive && date <= cycle.periodEndInclusive).length;
    if (!eligible.length && !fixedDays) continue;
    const calculate = (n: number) => legacyIncome.map(item => {
      const pastTags = Object.fromEntries(Object.entries(baselineTags).filter(([date]) => date < start && date < enabled));
      const past = getInternPayrollCycleForMonth(item, y, m, pastTags, holidays);
      const previous = calculateIncomeTax(past.effectiveAmount, item.taxRuleText);
      const next = calculateIncomeTax(past.effectiveAmount + (fixedDays + n) * item.dailyRate!, item.taxRuleText);
      return { id: `${item.id}:${month}`, name: item.name, kind: 'intern' as const, grossAmount: (fixedDays + n) * item.dailyRate!,
        taxAmount: next.taxAmount - previous.taxAmount, amount: next.netAmount - previous.netAmount, days: fixedDays + n, dailyRate: item.dailyRate };
    });
    const base = calculate(0), baseAmount = base.reduce((sum, i) => sum + i.amount, 0);
    baseDetails.push(...base);
    let costs = 0; const gains = [0];
    for (let n = 1; n <= eligible.length; n++) { costs += delta(eligible[n - 1]); gains.push(calculate(n).reduce((sum, i) => sum + i.amount, 0) - baseAmount - costs); }
    groups.push({ dates: eligible, gains, income: n => calculate(n).reduce((sum, i) => sum + i.amount, 0) - baseAmount, detail: calculate });
  }
  const requirements = o.wishes.filter(w => w.isActive && w.deadline && w.deadline <= deadline).map(wish => ({ wish,
    amount: calculateWishFunding(wish, wishTravelLifeAmount(wish, o.stateDailyAvg.travel, o.tripDatesByStart)).remainingAmount,
    includingLife: calculateWishFunding(wish).remainingAmount,
  })).filter(r => r.includingLife > 0).sort((a, b) => a.wish.deadline!.localeCompare(b.wish.deadline!));
  const wishAmount = requirements.reduce((sum, r) => sum + r.amount, 0), wishAmountIncludingLife = requirements.reduce((sum, r) => sum + r.includingLife, 0);
  const repayment = Object.entries(o.repaymentsByMonth).filter(([month]) => month >= start.slice(0, 7) && month <= deadline.slice(0, 7))
    .reduce((sum, [, amount]) => sum + Math.max(0, amount || 0), 0);
  const minimumIncome = baseDetails.reduce((sum, i) => sum + i.amount, 0);
  const requiredCore = wishAmount / POST_LIFE_WISH_SHARE;
  const baselineCore = minimumIncome - baselineLifeExpense - repayment;
  const chosen = chooseInternDays(groups, requiredCore - baselineCore,
    o.selectedInternDays == null ? null : o.selectedInternDays - fixed.length);
  const recommendedDates = [...fixed, ...chosen.dates].sort(), selected = new Set(recommendedDates);
  const availableInternDateKeys = [...new Set([...fixed, ...groups.flatMap(g => g.dates)])].sort();
  const maximumIncome = minimumIncome + groups.reduce((sum, g) => sum + g.income(g.dates.length), 0);
  const groupIds = new Set(groups.flatMap(g => g.detail(0).map(i => i.id)));
  const incomeBreakdown = [...baseDetails.filter(i => !groupIds.has(i.id)), ...groups.flatMap((g, i) => g.detail(chosen.counts[i] ?? 0))].filter(i => Math.abs(i.amount) > 1e-7 || (i.days ?? 0) > 0);
  const recommendedIncome = incomeBreakdown.reduce((sum, i) => sum + i.amount, 0);
  const lifeExpenseBreakdown = Object.fromEntries((['school', 'intern', 'home', 'travel'] as TagKind[]).map(k => [k, { days: 0, dailyAverage: 0, amount: 0 }])) as WishInternPlan['lifeExpenseBreakdown'];
  for (const date of dates) {
    const dayContext = { ...baselineContext, dayOverrides: { ...dayOverrides, [date]: { ...dayOverrides[date], attendance: selected.has(date) ? 'work' as const : 'rest' as const } } };
    const tag = resolveDailyContext(date, selected.has(date) ? 'intern' : baselineTags[date], dayContext).tag;
    const entry = lifeExpenseBreakdown[tag]; entry.days++; entry.amount += expense(date, selected.has(date));
  }
  for (const entry of Object.values(lifeExpenseBreakdown)) entry.dailyAverage = entry.days ? entry.amount / entry.days : 0;
  const recommendedLifeExpense = Object.values(lifeExpenseBreakdown).reduce((sum, i) => sum + i.amount, 0);
  const projectedSurplus = recommendedIncome - recommendedLifeExpense - repayment, positive = Math.max(0, projectedSurplus);
  const normalWish = positive * POST_LIFE_WISH_SHARE;
  const consumptionTransferredToWish = chosen.minimum === null ? Math.min(Math.max(wishAmount - normalWish, 0), positive * POST_LIFE_CONSUMPTION_SHARE) : 0;
  const projectedWishSaving = normalWish + consumptionTransferredToWish;
  const spent = requirements.filter(r => r.wish.deadline! < deadline), spentWishAmount = spent.reduce((sum, r) => sum + r.amount, 0);
  const projectedWishBalance = Math.max(0, projectedWishSaving - spentWishAmount);
  const projectedInvestmentSaving = positive * POST_LIFE_INVESTMENT_SHARE;
  let covered = normalWish, transfer = consumptionTransferredToWish;
  const consumptionTransferWishNames: string[] = [];
  for (const r of requirements) { const normal = Math.min(covered, r.amount); covered -= normal; const extra = Math.min(transfer, r.amount - normal); transfer -= extra; if (extra > 0) consumptionTransferWishNames.push(r.wish.name); }
  const shortfall = Math.max(0, wishAmount - projectedWishSaving);
  const minimumInternDays = chosen.minimum !== null ? chosen.minimum + fixed.length : shortfall <= 1e-7 ? recommendedDates.length : null;
  const scheduledInternDays = availableInternDateKeys.filter(date => resolveDailyContext(date, o.tagMap[date], context).paid).length;
  const gains = groups.flatMap(g => g.gains.slice(1).map((gain, i) => gain - g.gains[i])).filter(g => g > 1e-7);
  const averageGain = gains.length ? gains.reduce((s, g) => s + g, 0) / gains.length : 0;
  const travelDates = new Set(requirements.flatMap(r => r.wish.linkedTripStartDate ? o.tripDatesByStart?.[r.wish.linkedTripStartDate] ?? [] : []));
  const manualTravel = requirements.filter(r => !r.wish.linkedTripStartDate).reduce((sum, r) => sum + Math.max(0, Math.round(r.wish.plannedTravelDays ?? 0)), 0);
  return { startDate: start, deadline, wishAmount, wishAmountIncludingLife, minimumIncome, maximumIncome, recommendedIncome, incomeBreakdown,
    requiredIncome: recommendedLifeExpense + repayment + requiredCore, baselineLifeExpense, recommendedLifeExpense, lifeExpenseBreakdown, repayment,
    totalLivingExpense: recommendedLifeExpense + repayment, projectedSurplus, projectedConsumption: positive * POST_LIFE_CONSUMPTION_SHARE - consumptionTransferredToWish,
    projectedInvestmentSaving, projectedTotalSaving: projectedWishBalance + projectedInvestmentSaving, availableInternDays: availableInternDateKeys.length,
    scheduledInternDays, minimumInternDays, selectedInternDays: recommendedDates.length, additionalInternDays: Math.max(0, (minimumInternDays ?? availableInternDateKeys.length) - scheduledInternDays),
    reducibleInternDays: minimumInternDays === null ? 0 : Math.max(0, scheduledInternDays - minimumInternDays), availableInternDateKeys, recommendedDates,
    months: [...new Set(availableInternDateKeys.map(d => d.slice(0, 7)))].map(yearMonth => ({ yearMonth, internDays: recommendedDates.filter(d => d.startsWith(yearMonth)).length, availableInternDays: availableInternDateKeys.filter(d => d.startsWith(yearMonth)).length })),
    projectedWishSaving, projectedWishBalance, spentWishAmount, spentWishNames: [...new Set(spent.map(r => r.wish.name))], consumptionTransferredToWish, consumptionTransferWishNames,
    usesConsumptionTransfer: consumptionTransferredToWish > 0, excludedLivingDays: travelDates.size + manualTravel, excludedLifeExpense: wishAmountIncludingLife - wishAmount,
    shortfall, shortfallWorkDays: shortfall <= 1e-7 ? 0 : averageGain > 0 ? Math.ceil(shortfall / (averageGain * (POST_LIFE_WISH_SHARE + POST_LIFE_CONSUMPTION_SHARE))) : null };
}
