import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, InternshipPeriod, InternshipRules } from '../models/types';
import { BEIJING, GUANGZHOU, DEFAULT_INTERNSHIP_RULES, dateRange, migratedProfiles, normalizeDayOverrides, periodOverlap, periodReady, resolveDailyContext, resolvedTagMap } from './internship';
import { internshipPayrolls, internshipPayrollsPaidInMonth, internshipSchedule } from './internshipPayroll';
import { resolveAllIncomeForMonth, resolveIncomeForMonth } from './payroll';
import { calculateWishInternPlan, type WishInternPlanOptions } from './wishInternPlan';
import { chooseInternDays } from './datedWishInternPlan';
import { calculateWishMilestonePlan } from './wishMilestonePlan';
import { calcHistoryStats } from '../calculations/history';
import { monthlyRecords } from '../data/mockData';
import { DEFAULT_CONFIG } from '../stores/configStore';
import { calcBudget } from '../calculations/budget';
import { dailyLivingAmount } from './cityLiving';
import { applyOutlookSnapshotToState } from './outlookCalendar';
import { mergeSyncValue } from './syncMerge';

const rules: InternshipRules = { ...DEFAULT_INTERNSHIP_RULES, salary: 100, workweek: 'weekdays' };
const period: InternshipPeriod = { id: 'gz', profileId: 'company', profileName: '广州公司', revision: 1, rules,
  startDate: '2026-10-19', endDate: '2026-10-25', city: GUANGZHOU, schoolCity: BEIJING };
const config: Partial<AppConfig> = { schoolCity: BEIJING, internshipLegacyCity: BEIJING, internshipPeriods: [period] };
const context = { config };
const payroll = (r: Partial<InternshipRules> = {}, overrides = {}) => internshipPayrolls({ config: { ...config, internshipPeriods: [{ ...period, rules: { ...rules, ...r } }] }, dayOverrides: overrides }, {}, period.startDate, period.endDate)[0];
const planOptions: WishInternPlanOptions = { today: new Date(2026, 9, 19), deadline: '2026-10-25', wishes: [], incomeItems: [], tagMap: {},
  stateDailyAvg: { school: 10, intern: 20, home: 5, travel: 100 }, repaymentsByMonth: {}, holidayDataByYear: {}, internship: context };
afterEach(() => vi.useRealTimers());

describe('城市、实习期与工休独立解析', () => {
  it('北京上学、北京实习休息和广州实习休息使用不同生活分类', () => {
    expect(resolveDailyContext('2026-10-18', 'school', context)).toMatchObject({ city: BEIJING, livingKind: 'school', paid: false });
    expect(resolveDailyContext('2026-10-19', 'school', context)).toMatchObject({ city: GUANGZHOU, livingKind: 'work', paid: true });
    expect(resolveDailyContext('2026-10-24', 'intern', context)).toMatchObject({ city: GUANGZHOU, livingKind: 'rest', paid: false, label: '广州·休' });
    expect(resolveDailyContext('2026-10-24', 'intern', { config: { ...config, internshipPeriods: [{ ...period, city: BEIJING }] } }))
      .toMatchObject({ city: BEIJING, livingKind: 'school', tag: 'school', paid: false });
  });
  it('公司法定工作日含调休，固定周一至周五独立配置；单日调整优先', () => {
    const holidays = { 2026: { '2026-10-24': { date: '2026-10-24', isOffDay: false }, '2026-10-19': { date: '2026-10-19', isOffDay: true } } };
    const statutory = { config: { ...config, internshipPeriods: [{ ...period, rules: { ...rules, workweek: 'statutory' as const } }] }, holidayDataByYear: holidays };
    expect(resolveDailyContext('2026-10-24', 'intern', statutory).paid).toBe(true);
    expect(resolveDailyContext('2026-10-19', 'intern', statutory).paid).toBe(false);
    expect(resolveDailyContext('2026-10-24', 'intern', { ...context, holidayDataByYear: holidays }).paid).toBe(false);
    expect(resolveDailyContext('2026-10-19', 'intern', { ...context, dayOverrides: { '2026-10-19': { attendance: 'rest' } } }).paid).toBe(false);
  });
  it('回家和出游不计工资；实习结束后不继续计薪', () => {
    for (const tag of ['home', 'travel'] as const) expect(resolveDailyContext('2026-10-19', tag, context)).toMatchObject({ paid: false, tag });
    expect(resolveDailyContext('2026-10-26', 'intern', context)).toMatchObject({ paid: false, tag: 'school', city: BEIJING });
  });
  it('草稿不生效；边界相接不重叠；云端重叠不猜测雇主', () => {
    expect(periodReady({ ...period, rules: { ...rules, salary: null } })).toBe(false);
    expect(periodOverlap({ ...period, id: 'other', startDate: '2026-10-25' }, [period])).toBe(true);
    expect(periodOverlap({ ...period, id: 'other', startDate: '2026-10-26', endDate: '2026-10-30' }, [period])).toBe(false);
    expect(resolveDailyContext('2026-10-19', 'intern', { config: { ...config, internshipPeriods: [period, { ...period, id: 'collision' }] } }).paid).toBe(false);
  });
  it('未配置时兼容旧周末实习标记，旧公司模板保留原规则', () => {
    expect(resolveDailyContext('2026-10-24', 'intern', { config: { schoolCity: BEIJING } }).paid).toBe(true);
    const income = { id: 'old', name: '原公司', amount: 0, payDay: 1, dailyRate: 300, tagKind: 'intern' as const, isActive: true };
    expect(migratedProfiles({ incomeItems: [income] })[0].rules).toMatchObject({ salary: 300, cycle: 'beforePay', cutoffOffset: 6, payKind: 'lastWorkingDay', payMonthOffset: 0 });
    const tags = { '2026-10-10': 'intern' as const };
    expect(resolveAllIncomeForMonth([income], 2026, 9, tags, {})).toEqual([resolveIncomeForMonth(income, 2026, 9, tags, {})]);
  });
  it('城市与规则采用实习段快照，修改模板或上学城市不改旧实习', () => {
    const input = { config: { ...config, schoolCity: GUANGZHOU, internshipProfiles: [{ id: 'company', name: '新名', revision: 2, rules: { ...rules, salary: 999 } }] } };
    expect(resolveDailyContext('2026-10-24', 'intern', input).livingKind).toBe('rest');
    expect(internshipPayrolls(input, {}, period.startDate, period.endDate)[0].salaryAmount).toBe(500);
    expect(resolveDailyContext('2026-10-18', 'school', input).city).toEqual(BEIJING);
  });
});

describe('公司结算、工资及房补', () => {
  it('周末属于实习居住期，只有五天日薪，居住日补有七天', () => {
    expect(payroll({ housingKind: 'residence', housingAmount: 10 })).toMatchObject({ salaryAmount: 500, housingAmount: 70, grossAmount: 570, netAmount: 570, payDate: '2026-11-10' });
    expect(payroll({ housingKind: 'attendance', housingAmount: 10 }).housingAmount).toBe(50);
  });
  it('请假、周末加班和单日异地调整分别影响工资和居住补贴', () => {
    const row = payroll({ housingKind: 'residence', housingAmount: 10 }, { '2026-10-19': { attendance: 'rest', city: BEIJING }, '2026-10-24': { attendance: 'work' } });
    expect(row).toMatchObject({ salaryAmount: 500, housingAmount: 60 });
  });
  it('不足月按自然日房补折算，整期房补与出勤天数无关', () => {
    expect(payroll({ housingKind: 'monthly', housingAmount: 3100 }).housingAmount).toBe(700);
    expect(payroll({ housingKind: 'monthly', housingAmount: 3100, housingProrated: false }).housingAmount).toBe(3100);
    const rest = Object.fromEntries(dateRange(period.startDate, period.endDate).map(date => [date, { attendance: 'rest' as const }]));
    expect(payroll({ housingKind: 'monthly', housingAmount: 3100 }, rest)).toMatchObject({ salaryAmount: 0, housingAmount: 700 });
  });
  it('月薪按周期应工作日或指定天数折算', () => {
    expect(payroll({ salaryKind: 'monthly', salary: 2200 }).salaryAmount).toBe(500);
    expect(payroll({ salaryKind: 'monthly', salary: 2175, monthlyDivisor: 21.75 }).salaryAmount).toBe(500);
  });
  it('房补可合并扣税或税后加算', () => {
    const taxable = payroll({ taxRuleText: '税=收入*10%', housingKind: 'residence', housingAmount: 10 });
    const exempt = payroll({ taxRuleText: '税=收入*10%', housingKind: 'residence', housingAmount: 10, housingTaxable: false });
    expect(taxable).toMatchObject({ taxAmount: 57, netAmount: 513 });
    expect(exempt).toMatchObject({ taxAmount: 50, netAmount: 520 });
  });
  it('同公司同版本同周期的多个实习段合并扣税', () => {
    const p = { ...period, rules: { ...rules, taxRuleText: '税=收入*10%', housingKind: 'monthly' as const, housingAmount: 3100, housingProrated: false } };
    const rows = internshipPayrolls({ config: { ...config, internshipPeriods: [{ ...p, endDate: '2026-10-21' }, { ...p, id: 'second', startDate: '2026-10-23' }] } }, {}, period.startDate, period.endDate);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ salaryAmount: 400, housingAmount: 3100, taxAmount: 350 });
  });
  it('月末截薪日期夹到真实日期，跨年连续；发薪日顺延可以跨月', () => {
    expect(internshipSchedule({ ...rules, cycle: 'cutoff', cutoffDay: 31 }, 2027, 1)).toMatchObject({ startDate: '2027-02-01', endDate: '2027-02-28', payDate: '2027-03-10' });
    expect(internshipSchedule({ ...rules, cycle: 'cutoff', cutoffDay: 25 }, 2027, 0).startDate).toBe('2026-12-26');
    expect(internshipSchedule({ ...rules, payMonthOffset: 0, payKind: 'monthEnd', payAdjustment: 'next' }, 2026, 9).payDate).toBe('2026-11-02');
  });
  it('实习结束后仍按到账月份显示工资，旧收入不会重复计薪', () => {
    expect(internshipPayrollsPaidInMonth(context, {}, 2026, 9)).toHaveLength(0);
    expect(internshipPayrollsPaidInMonth(context, {}, 2026, 10)[0].netAmount).toBe(500);
    const old = { id: 'old', name: '原公司', amount: 0, payDay: 1, dailyRate: 300, tagKind: 'intern' as const, isActive: true };
    const tags = resolvedTagMap({}, context);
    const income = resolveAllIncomeForMonth([old], 2026, 10, tags, {}, context);
    expect(income.reduce((sum, i) => sum + i.resolvedAmount, 0)).toBe(500);
  });
});

describe('按日期的心愿规划', () => {
  it('最低出勤按净结余计算；广州周末仍产生休息日生活费', () => {
    const result = calculateWishInternPlan({ ...planOptions, wishes: [{ id: 'wish', name: '心愿', targetAmount: 100, savedAmount: 0, isActive: true, deadline: planOptions.deadline }] });
    expect(result.minimumInternDays).toBe(4);
    expect(result.recommendedIncome).toBe(400);
    expect(result.recommendedLifeExpense).toBe(110);
    expect(result.lifeExpenseBreakdown.intern.days).toBe(7);
    expect(result.recommendedDates.every(date => date <= '2026-10-23')).toBe(true);
  });
  it('没有出勤需求时也计入月房补；收入不因到账日晚于心愿截止日遗漏', () => {
    const result = calculateWishInternPlan({ ...planOptions, internship: { config: { ...config, internshipPeriods: [{ ...period, rules: { ...rules, housingKind: 'monthly', housingAmount: 3100 } }] } }, wishes: [{ id: 'wish', name: '心愿', targetAmount: 100, savedAmount: 0, isActive: true, deadline: planOptions.deadline }] });
    expect(result.minimumInternDays).toBe(0); expect(result.recommendedIncome).toBeCloseTo(700);
    expect(result.recommendedLifeExpense).toBe(70);
  });
  it('手动锁定请假不补入，手动锁定出勤保留', () => {
    const result = calculateWishInternPlan({ ...planOptions, internship: { ...context, dayOverrides: {
      '2026-10-19': { attendance: 'rest', attendanceLocked: true }, '2026-10-24': { attendance: 'work', attendanceLocked: true },
    } } });
    expect(result.availableInternDateKeys).not.toContain('2026-10-19');
    expect(result.recommendedDates).toContain('2026-10-24');
    expect(result.recommendedIncome).toBeGreaterThanOrEqual(100);
  });
  it('DP 能跨过较低的首日收益，找到全局最少天数', () => {
    const result = chooseInternDays([{ dates: ['a', 'b'], gains: [0, 1, 100] }, { dates: ['c', 'd'], gains: [0, 40, 80] }], 90);
    expect(result.minimum).toBe(2); expect(result.dates).toEqual(['a', 'b']);
  });
  it('首段开始前已为早期心愿锁定的旧公司日期仍计入收入', () => {
    const result = calculateWishInternPlan({ ...planOptions, today: new Date(2026, 9, 16), requiredDates: ['2026-10-16'],
      incomeItems: [{ id: 'old', name: '旧公司', amount: 0, dailyRate: 500, tagKind: 'intern', payDay: 0, isActive: true }] });
    expect(result.recommendedDates).toEqual(['2026-10-16']);
    expect(result.recommendedIncome).toBe(500);
    expect(result.incomeBreakdown).toEqual([expect.objectContaining({ name: '旧公司', amount: 500, days: 1 })]);
  });
  it('已发生与未来劳动分开累计，月补和税额分段相加等于整期', () => {
    const internship = { config: { ...config, internshipPeriods: [{ ...period, rules: { ...rules, housingKind: 'monthly' as const, housingAmount: 3100, taxRuleText: '税=收入*10%' } }] } };
    const full = calculateWishInternPlan({ ...planOptions, internship, selectedInternDays: 5 });
    const early = calculateWishInternPlan({ ...planOptions, internship, deadline: '2026-10-21', selectedInternDays: 3 });
    const late = calculateWishInternPlan({ ...planOptions, internship, today: new Date(2026, 9, 22), selectedInternDays: 2 });
    expect(early.recommendedIncome + late.recommendedIncome).toBeCloseTo(full.recommendedIncome);
    expect(full.recommendedIncome).toBe(1080);
  });
  it('跨公司选择实际高收益日期，保留早期心愿的日期约束', () => {
    const p2 = { ...period, id: 'next', profileId: 'high', startDate: '2026-10-26', endDate: '2026-10-30', rules: { ...rules, salary: 1000 } };
    const result = calculateWishMilestonePlan({ ...planOptions, internship: { config: { ...config, internshipPeriods: [period, p2] } }, repaymentDues: [], wishes: [
      { id: 'early', name: '早期', targetAmount: 50, savedAmount: 0, isActive: true, deadline: '2026-10-23' },
      { id: 'late', name: '后期', targetAmount: 300, savedAmount: 0, isActive: true, deadline: '2026-10-30' },
    ] });
    const early = result.segmentByWishId.early.minimumInternDateKeys, late = result.segmentByWishId.late.minimumInternDateKeys;
    expect(early.length).toBeGreaterThan(0); expect(early.every(date => date <= '2026-10-23')).toBe(true);
    expect(early.every(date => late.includes(date))).toBe(true);
    expect(late.some(date => date >= '2026-10-26')).toBe(true);
  });
});

describe('城市生活费与同步兼容', () => {
  it('只用已确认的过去日样本，零支出有效，共享均摊仅加一次', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T04:00:00Z'));
    const records = [{ ...monthlyRecords[0], yearMonth: '2026-10', periodicLife: 30, volatileLife: 0 }];
    const stats = calcHistoryStats(records, { '2026-10-19': 'intern', '2026-10-20': 'intern', '2026-10-24': 'intern' }, {
      '2026-10-19': { reviewed: true, localIds: [], sharedIds: [] }, '2026-10-20': { reviewed: true, localIds: [], sharedIds: [] },
      '2026-10-24': { reviewed: true, localIds: [], sharedIds: [] },
    }, { '2026-10': [{ date: '2026-10-19', amount: 30, tags: '周期生活', category: '餐饮', subcategory: '', note: '', account: '' }] },
    { categories: { '餐饮': 'local' }, subcategories: {}, notes: {}, tags: {} }, {}, context);
    const sample = Object.values(stats.cityLivingStats!)[0];
    expect(sample).toMatchObject({ city: GUANGZHOU, kind: 'work', days: 2, localAmount: 30, dailyAverage: 15 });
    expect(Object.values(stats.cityLivingStats!)).toHaveLength(1);
    expect(dailyLivingAmount('2026-10-21', 'intern', stats, context)).toBe(15);
    expect(dailyLivingAmount('2026-10-24', 'intern', { stateDailyAvg: { intern: 20, school: 10, home: 0, travel: 100 } }, context)).toBe(10);
  });
  it('预算和心愿采用同一城市生活费，现金流按离职后到账日计入', () => {
    const stats = { ...calcHistoryStats([]), stateDailyAvg: planOptions.stateDailyAvg, cityLivingStats: {
      work: { city: GUANGZHOU, kind: 'work' as const, days: 2, localAmount: 60, dailyAverage: 30 },
      rest: { city: GUANGZHOU, kind: 'rest' as const, days: 1, localAmount: 15, dailyAverage: 15 },
      school: { city: BEIJING, kind: 'school' as const, days: 2, localAmount: 20, dailyAverage: 10 },
    } };
    const tags = resolvedTagMap({}, context);
    const nextIncome = resolveAllIncomeForMonth([], 2026, 10, tags, {}, context);
    const budget = calcBudget({ ...DEFAULT_CONFIG, ...config, incomeItems: [] }, stats, {}, Object.entries(tags).map(([date, tag]) => ({ date, tag })), new Date(2026, 9, 18), {}, context, nextIncome);
    const wish = calculateWishInternPlan({ ...planOptions, deadline: '2026-10-31', cityLivingStats: stats.cityLivingStats, selectedInternDays: 5 });
    expect(budget.monthly.expense).toBe(240);
    expect(wish.recommendedLifeExpense).toBe(budget.monthly.expense);
    expect(budget.monthly.income).toBe(0);
    expect(budget.beyond.income).toBe(500);
    expect(budget.beyond.expense).toBe(300);
    expect(wish.recommendedIncome).toBe(500);
  });
  it('Outlook 连续实习日程保留工休与城市覆盖，JSON备份可恢复', () => {
    const state = { tagMap: {}, dayOverrides: { '2026-10-24': { city: BEIJING, attendance: 'rest', attendanceLocked: true } } };
    const next = applyOutlookSnapshotToState(state, { startDate: '2026-10-19', endDate: '2026-10-26', tags: { '2026-10-24': 'intern' } }, 'outlook');
    const restored = JSON.parse(JSON.stringify({ config, calendar: next }));
    const overrides = normalizeDayOverrides(restored.calendar.dayOverrides);
    expect(overrides).toEqual(state.dayOverrides);
    expect(resolveDailyContext('2026-10-24', restored.calendar.tagMap['2026-10-24'], { config: restored.config, dayOverrides: overrides })).toMatchObject({ paid: false, city: BEIJING });
  });
  it('不同设备修改不同实习段和不同日期不会互相覆盖', () => {
    const base = { config: { internshipPeriods: [period] }, dayOverrides: {} };
    const local = { ...base, dayOverrides: { '2026-10-24': { attendance: 'rest' } } };
    const remote = { config: { internshipPeriods: [period, { ...period, id: 'second', startDate: '2026-11-01', endDate: '2026-11-30' }] }, dayOverrides: { '2026-10-25': { city: BEIJING } } };
    const merged = mergeSyncValue(base, local, remote) as typeof remote;
    expect(merged.config.internshipPeriods).toHaveLength(2); expect(Object.keys(merged.dayOverrides)).toHaveLength(2);
  });
});
