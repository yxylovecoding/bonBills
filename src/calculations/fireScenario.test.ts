import { describe, expect, it } from 'vitest';
import type { FireExpenseScenario, FutureFireExpense } from '../models/types';
import { DEFAULT_CONFIG } from '../stores/configStore';
import { calcFire } from './fire';
import { calcHistoryStats } from './history';
import { calcPreFireExpenses } from './fireExpenses';
import { calcPostFireExpenses, encodeFireScenario, getFireFixedExpenses, resolveFireScenario } from './fireScenario';

const stats = {
  ...calcHistoryStats([]),
  monthlyIncomeAvg: 2000,
  stateDailyConfidence: { school: 120, intern: 180, home: 40, travel: 25 },
  stateDailyAvg: { school: 30, intern: 80, home: 20, travel: 200 },
  stateConsumptionDailyAvg: { school: 10, intern: 30, home: 5, travel: 100 },
};
const rent: FutureFireExpense = { id: 'rent', name: '房租', monthlyAmount: 1500, isActive: true };

describe('FIRE 家与独居', () => {
  it('独居使用校支出加全年房租，房租只计入一次', () => {
    const result = calcPostFireExpenses(stats, [rent], 'independent');
    expect(result.sampleKind).toBe('school');
    expect(result.lifeAnnualExpense).toBe(30 * 365 + 1500 * 12);
    expect(result.consumptionAnnualExpense).toBe(10 * 365);
    expect(result.monthlyRentExpense).toBe(1500);
  });

  it('在家不计独居房租，其他已启用的固定费用仍计入', () => {
    const expenses = [rent, { id: 'insurance', name: '保险', monthlyAmount: 200, isActive: true }];
    const home = calcPostFireExpenses(stats, expenses, 'home');
    const independent = calcPostFireExpenses(stats, expenses, 'independent');
    expect(home.lifeAnnualExpense).toBe(20 * 365 + 200 * 12);
    expect(home.monthlyRentExpense).toBe(0);
    expect(home.monthlyFixedExpense).toBe(200);
    expect(independent.lifeAnnualExpense).toBe(30 * 365 + 1700 * 12);
    expect(home.configuredMonthlyFixedExpense).toBe(independent.configuredMonthlyFixedExpense);
    expect(calcPreFireExpenses(stats, home.configuredMonthlyFixedExpense))
      .toEqual(calcPreFireExpenses(stats, independent.configuredMonthlyFixedExpense));
  });

  it('旅行住宿与全年长期房租同时计入，出游期间不扣减房租', () => {
    const result = calcPostFireExpenses(stats, [rent], 'independentTravel');
    expect(result.annualizedTravelDays).toBeCloseTo(25, 8);
    expect(result.lifeAnnualExpense).toBeCloseTo(30 * 340 + 200 * 25 + 18000, 8);
    expect(result.consumptionAnnualExpense).toBeCloseTo(10 * 340 + 100 * 25, 8);
    const withoutRent = calcPostFireExpenses(stats, [], 'independentTravel');
    expect(result.lifeAnnualExpense - withoutRent.lifeAnnualExpense).toBe(18000);
    const home = calcPostFireExpenses(stats, [rent], 'homeTravel');
    expect(home.lifeAnnualExpense).toBeCloseTo(20 * 340 + 200 * 25, 8);
  });

  it.each([
    ['school', 'independent'], ['schoolTravel', 'independentTravel'],
    ['travel', 'independentTravel'], ['intern', 'independent'],
  ] as [FireExpenseScenario, FireExpenseScenario][])('旧场景%s沿用为%s', (legacy, current) => {
    expect(calcPostFireExpenses(stats, [rent], legacy)).toEqual(calcPostFireExpenses(stats, [rent], current));
  });

  it.each([false, true])('切换家和独居时保留旅行开关%s，再次切换可回到原场景', (includesTravel) => {
    const home = encodeFireScenario('home', includesTravel);
    const independent = encodeFireScenario('independent', resolveFireScenario(home).includesTravel);
    expect(resolveFireScenario(independent)).toEqual({ base: 'independent', includesTravel, sampleKind: 'school' });
    expect(encodeFireScenario('home', resolveFireScenario(independent).includesTravel)).toBe(home);
  });

  it('无家的样本时沿用校支出，也不会把独居房租加给家', () => {
    const result = calcPostFireExpenses({ ...stats, stateDailyConfidence: { ...stats.stateDailyConfidence, home: 0 } }, [rent], 'home');
    expect(result.fallbackSample).toBe('school');
    expect(result.lifeAnnualExpense).toBe(30 * 365);
    expect(result.monthlyRentExpense).toBe(0);
  });

  it('房租未设置或未启用时不编造金额，缺少旅行数据时使用基础样本', () => {
    const result = calcPostFireExpenses({ ...stats, stateDailyConfidence: { ...stats.stateDailyConfidence, travel: 0 } }, [{ ...rent, isActive: false }], 'independentTravel');
    expect(result.monthlyRentExpense).toBe(0);
    expect(result.lifeAnnualExpense).toBe(30 * 365);
    expect(result.consumptionAnnualExpense).toBe(10 * 365);
    expect(calcPostFireExpenses(calcHistoryStats([]), [], 'independent').lifeAnnualExpense).toBe(0);
  });

  it('房租分类与公积金沿用一致规则，负数和无效金额不会制造房租', () => {
    expect(getFireFixedExpenses([
      rent, { ...rent, id: 'rent2', name: '租房', monthlyAmount: 100 },
      { ...rent, id: 'rent3', name: '住房租金', monthlyAmount: 200 },
      { ...rent, id: 'off', monthlyAmount: 900, isActive: false },
      { ...rent, id: 'negative', monthlyAmount: -50 },
      { ...rent, id: 'invalid', monthlyAmount: NaN },
      { ...rent, id: 'insurance', name: '保险', monthlyAmount: 300 },
    ])).toEqual({ rent: 1800, other: 300, total: 2100 });
  });

  it('切换后的退休支出进入目标资产和最低年薪，工作期输入保持一致', () => {
    const config = { ...DEFAULT_CONFIG, fireTargetYears: 10, fireTalentSubsidyEnabled: false, futureFireExpenses: [rent] };
    const identicalSamples = { ...stats, stateDailyAvg: { ...stats.stateDailyAvg, home: 30 } };
    const homeExpense = calcPostFireExpenses(identicalSamples, [rent], 'home');
    const independentExpense = calcPostFireExpenses(identicalSamples, [rent], 'independent');
    const options = { now: new Date(2029, 0, 1), annualEssentialExpense: 50000 };
    const home = calcFire(config, { ...stats, totalExpenseAvg: homeExpense.lifeAnnualExpense / 12 }, 10000, options);
    const independent = calcFire(config, { ...stats, totalExpenseAvg: independentExpense.lifeAnnualExpense / 12 }, 10000, options);
    expect(independent.fireTarget - home.fireTarget).toBeCloseTo(18000 / config.safeWithdrawRate, 6);
    expect(independent.requiredAnnualGrossIncome).toBeGreaterThan(home.requiredAnnualGrossIncome);
    expect(independent.annualEssentialExpense).toBe(home.annualEssentialExpense);
  });
});
