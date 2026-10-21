import { describe, expect, it } from 'vitest';
import type { IncomeItem, InternshipPeriod, WishItem } from '../models/types';
import { BEIJING, DEFAULT_INTERNSHIP_RULES } from './internship';
import { calculateWishInternPlan, type WishInternPlanOptions } from './wishInternPlan';
import { calculateWishMilestonePlan } from './wishMilestonePlan';
import { calculateWishPlan } from './wishes';
import { chooseInternDays } from './datedWishInternPlan';
import { reserveWishIncomeGroups, wishMonthlyRaiseSavings, wishRequiredIncome } from './wishRaiseSavings';

const fixedIncome = (amount: number, id = 'fixed'): IncomeItem => ({ id, name: id, amount, payDay: 2, isActive: true });
const dailyIncome: IncomeItem = { ...fixedIncome(0, 'intern'), dailyRate: 1000, tagKind: 'intern' };
const wish: WishItem = { id: 'wish', name: '心愿', targetAmount: 2400, savedAmount: 0, isActive: true, deadline: '2026-11-20' };
const period: InternshipPeriod = { id: 'company', profileId: 'company', profileName: '实习', revision: 1,
  startDate: '2026-11-02', endDate: '2026-12-31', city: BEIJING, schoolCity: BEIJING,
  rules: { ...DEFAULT_INTERNSHIP_RULES, salary: 1000, cycle: 'calendar', payMonthOffset: 0, taxRuleText: '', workweek: 'weekdays' } };
const base: WishInternPlanOptions = { today: new Date(2026, 10, 2), deadline: wish.deadline!, wishes: [], incomeItems: [], tagMap: {},
  stateDailyAvg: { intern: 0, school: 0, home: 0, travel: 0 }, repaymentsByMonth: {}, holidayDataByYear: {} };

for (const dated of [false, true]) {
  const options: WishInternPlanOptions = { ...base, ...(dated ? { internship: { config: { schoolCity: BEIJING, internshipPeriods: [period] } } } : {}) };
  describe(`${dated ? '实习期' : '旧日薪'}心愿涨薪存半`, () => {
    it('先从周期收入存一半涨幅，再分配生活开支和余款；理财汇总包含预留', () => {
      const result = calculateWishInternPlan({ ...options, incomeItems: [fixedIncome(6060)], repaymentsByMonth: { '2026-11': 2000 } });
      expect(result).toMatchObject({ recommendedIncome: 6060, projectedRaiseSavings: 1000, projectedSurplus: 3060,
        projectedWishSaving: 1224, projectedConsumption: 306, projectedInvestmentSaving: 2530, projectedTotalSaving: 3754 });
      expect(result.recommendedIncome).toBe(result.totalLivingExpense + result.projectedWishSaving + result.projectedConsumption + result.projectedInvestmentSaving);
    });
    it('收入低于基本线时不预留，允许明确设置基本线为零', () => {
      expect(calculateWishInternPlan({ ...options, incomeItems: [fixedIncome(3060)] }).projectedRaiseSavings).toBe(0);
      expect(calculateWishInternPlan({ ...options, incomeItems: [fixedIncome(3060)], recurringIncomeBaseline: 0 }).projectedRaiseSavings).toBe(1530);
    });
    it('推荐实习天数包含预留，手动增加天数重新计算', () => {
      const incomeItems = dated ? [] : [dailyIncome];
      const result = calculateWishInternPlan({ ...options, incomeItems, wishes: [wish] });
      // 8,000 - (8,000 - 4,060)/2 = 6,030，40% 可覆盖 2,400。
      expect(result).toMatchObject({ minimumInternDays: 8, selectedInternDays: 8, recommendedIncome: 8000,
        projectedRaiseSavings: 1970, projectedWishSaving: 2412, projectedInvestmentSaving: 4985, shortfall: 0 });
      expect(calculateWishInternPlan({ ...options, incomeItems, wishes: [wish], selectedInternDays: 9 }))
        .toMatchObject({ selectedInternDays: 9, projectedRaiseSavings: 2470, projectedWishSaving: 2612 });
    });
    it('同月固定收入和实习收入共用基本线，采用税后收入', () => {
      const incomeItems = [fixedIncome(4060), ...(dated ? [] : [{ ...dailyIncome, taxRuleText: '税=x*20%' }])];
      const internship = dated ? { config: { schoolCity: BEIJING, internshipPeriods: [{ ...period, rules: { ...period.rules, taxRuleText: '税=x*20%' } }] } } : undefined;
      expect(calculateWishInternPlan({ ...options, internship, incomeItems, selectedInternDays: 2 }))
        .toMatchObject({ recommendedIncome: 5660, projectedRaiseSavings: 800, projectedWishSaving: 1944, projectedInvestmentSaving: 3230 });
    });
    it('跨月分别计算，未来月份的基本线不会抵消本月涨薪', () => {
      const incomeItems = dated ? [] : [dailyIncome];
      const result = calculateWishInternPlan({ ...options, today: new Date(2026, 10, 30), deadline: '2026-12-03',
        incomeItems: [fixedIncome(6060)], selectedInternDays: 0 });
      expect(result).toMatchObject({ recommendedIncome: 6060, projectedRaiseSavings: 1000 });
      const sameIncomeEachMonth = calculateWishInternPlan({ ...options, deadline: '2026-12-20', incomeItems: [fixedIncome(6060), ...incomeItems], selectedInternDays: 0 });
      expect(sameIncomeEachMonth).toMatchObject({ recommendedIncome: 12120, projectedRaiseSavings: 2000 });
    });
    it('生活费或心愿不足时保留缺口，不取用已预留理财', () => {
      const result = calculateWishInternPlan({ ...options, deadline: '2026-11-02', incomeItems: [fixedIncome(6060)], tagMap: { '2026-11-02': 'home' },
        wishes: [{ ...wish, deadline: '2026-11-02', targetAmount: 4000 }], repaymentsByMonth: { '2026-11': 6000 } });
      expect(result).toMatchObject({ projectedRaiseSavings: 1000, projectedSurplus: -940, projectedWishSaving: 0,
        projectedInvestmentSaving: 1000, shortfall: 4000 });
    });
    it('首页的截止日计划与心愿规划使用同一基本线', () => {
      const incomeItems = dated ? [] : [dailyIncome];
      const result = calculateWishMilestonePlan({ ...options, incomeItems, wishes: [wish], repaymentDues: [], recurringIncomeBaseline: 0 });
      expect(result.segmentByWishId.wish.cumulativePlan).toMatchObject({ minimumInternDays: 12, projectedRaiseSavings: 6000, shortfall: 0 });
      expect(result.recommendedDates).toHaveLength(12);
    });
  });
}

describe('按月预留与推荐日期', () => {
  it('月度所需收入反推包含预留，并保留分位精度', () => {
    expect(wishMonthlyRaiseSavings(4060.01)).toBe(0.01);
    expect(wishRequiredIncome(5060)).toBe(6060);
    expect(wishRequiredIncome(3060)).toBe(3060);
    expect(wishRequiredIncome(0.01, 0)).toBe(0.02);
    const plan = calculateWishPlan([{ ...wish, targetAmount: 2024 }], { today: base.today });
    expect(plan.months[0].requiredNetIncome).toBe(6060);
    expect(calculateWishPlan([{ ...wish, targetAmount: 2024 }], { today: base.today, recurringIncomeBaseline: 0 })
      .months[0].requiredNetIncome).toBe(10120);
  });
  it('同月多份实习合计预留；比较天数时保留收入和生活成本的不同组合', () => {
    const groups = reserveWishIncomeGroups([
      { yearMonth: '2026-11', dates: ['2026-11-02'], gains: [0, 5000], income: n => n * 10000 },
      { yearMonth: '2026-11', dates: ['2026-11-03'], gains: [0, 4000], income: n => n * 4000 },
    ], {}, 4060);
    const chosen = chooseInternDays(groups.groups, 3000);
    // 税后收入 10,000 / 成本 5,000 的净收益更高，但存半后仅剩 2,030；4,000 无预留。
    expect(chosen.dates).toEqual(['2026-11-03']);
    const full = chooseInternDays(groups.groups, 0, 2);
    expect(groups.savings(full.counts)).toBe(4970);
  });
  it('低收入月份不抵扣其他月份，实习日优先选可用于心愿的收益高的月份', () => {
    const groups = reserveWishIncomeGroups([
      { yearMonth: '2026-11', dates: ['2026-11-02'], gains: [0, 1000], income: n => n * 1000 },
      { yearMonth: '2026-12', dates: ['2026-12-01'], gains: [0, 1000], income: n => n * 1000 },
    ], { '2026-11': 6060, '2026-12': 0 });
    expect(groups.baseSavings).toBe(1000);
    expect(chooseInternDays(groups.groups, 750).dates).toEqual(['2026-12-01']);
  });
  it.each([false, true])('多个截止日累计只扣一次预留，已分配日期继续保留（实习期：%s）', dated => {
    const wishes = [{ ...wish, id: 'early', deadline: '2026-11-06', targetAmount: 1600 }, { ...wish, id: 'later', targetAmount: 800 }];
    const options = { ...base, ...(dated ? { internship: { config: { schoolCity: BEIJING, internshipPeriods: [period] } } } : { incomeItems: [dailyIncome] }), wishes, repaymentDues: [] };
    const result = calculateWishMilestonePlan(options);
    expect(result.segments[0].cumulativePlan.minimumInternDays).toBe(4);
    expect(result.segments[1].cumulativePlan).toMatchObject({ selectedInternDays: 8, projectedRaiseSavings: 1970, projectedWishSaving: 2412, shortfall: 0 });
    for (const date of result.segments[0].minimumInternDateKeys) expect(result.segments[1].minimumInternDateKeys).toContain(date);
  });
});
