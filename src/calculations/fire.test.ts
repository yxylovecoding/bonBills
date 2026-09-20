import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../stores/configStore';
import { calcHistoryStats } from './history';
import { calcFire } from './fire';
import { calcPreFireExpenses, getFireGraduationDate } from './fireExpenses';

const config = { ...DEFAULT_CONFIG, fireTargetYears: 8, fireTalentSubsidyEnabled: false };
const stats = { ...calcHistoryStats([]), totalExpenseAvg: 2000, monthlyIncomeAvg: 5000 };
const now = new Date(2025, 0, 1);
const stages = [
  { endDate: '2029-01-01', annualExpense: 12000 },
  { annualExpense: 24000 },
];

describe('FIRE 前后分段支出', () => {
  it.each([0, 0.08, -0.1])('年化 %s 时，按两个阶段实际收支累积可达退休目标', (rate) => {
    const result = calcFire({ ...config, investAnnualGrowthRate: rate }, stats, 10000, { now, essentialExpenseStages: stages });
    let assets = 10000;
    for (let year = 0; year < 8; year++) {
      assets = assets * (1 + rate) + result.requiredAnnualNetIncome - (year < 4 ? 12000 : 24000);
    }
    expect(assets).toBeCloseTo(result.fireTarget, 6);
    expect(result.fireTarget).toBe(600000);
    expect(result.monthlySurplus).toBe(4000);
  });

  it('零收益时按各阶段时长加权，改变毕业日期会改变所需收入', () => {
    const zeroRateConfig = { ...config, investAnnualGrowthRate: 0 };
    const earlier = calcFire(zeroRateConfig, stats, 0, { now, essentialExpenseStages: stages });
    const later = calcFire(zeroRateConfig, stats, 0, {
      now,
      essentialExpenseStages: [{ endDate: '2031-01-01', annualExpense: 12000 }, stages[1]],
    });
    const beforeYears = (new Date(2031, 0, 1).getTime() - now.getTime()) / (365.25 * 86400000);
    expect(earlier.annualEssentialExpense).toBe(18000);
    expect(later.annualEssentialExpense).toBeCloseTo((12000 * beforeYears + 24000 * (8 - beforeYears)) / 8, 8);
    expect(later.requiredAnnualNetIncome).toBeLessThan(earlier.requiredAnnualNetIncome);
    expect(later.fireTarget).toBe(earlier.fireTarget);
  });

  it.each([0.5, 1, 4])('在毕业前 %s 年达标时，不计毕业后的支出', (targetYears) => {
    const result = calcFire({ ...config, fireTargetYears: targetYears }, stats, 0, { now, essentialExpenseStages: stages });
    expect(result.annualEssentialExpense).toBeCloseTo(12000, 8);
  });

  it('毕业当天及毕业后只使用班＋游阶段', () => {
    for (const date of [new Date(2029, 0, 1), new Date(2030, 0, 1)]) {
      const result = calcFire(config, stats, 0, { now: date, essentialExpenseStages: stages });
      expect(result.annualEssentialExpense).toBeCloseTo(24000, 8);
      expect(result.monthlySurplus).toBe(3000);
    }
  });

  it('退休选择改变目标与储蓄，不改变退休前支出', () => {
    const home = calcFire(config, stats, 0, { now, essentialExpenseStages: stages });
    const schoolTravel = calcFire(config, { ...stats, totalExpenseAvg: 4000 }, 0, { now, essentialExpenseStages: stages });
    expect(schoolTravel.fireTarget).toBe(home.fireTarget * 2);
    expect(schoolTravel.annualEssentialExpense).toBe(home.annualEssentialExpense);
    expect(schoolTravel.monthlySurplus).toBe(home.monthlySurplus);
    expect(schoolTravel.requiredAnnualNetIncome - home.requiredAnnualNetIncome)
      .toBeCloseTo(schoolTravel.requiredAnnualSavings - home.requiredAnnualSavings, 8);
  });

  it('分配模式使用退休前消费，使“与生活相同”刻度仍对应同一年薪', () => {
    const living = calcFire(config, stats, 0, {
      now,
      essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 18000 }, { annualExpense: 36000 }],
    });
    const life = calcFire(config, stats, 0, { now, essentialExpenseStages: stages });
    const savingRate = living.requiredAnnualSavings
      / (living.requiredAnnualSavings + living.annualEssentialExpense - life.annualEssentialExpense);
    const allocation = calcFire(config, stats, 0, { now, essentialExpenseStages: stages, postEssentialSavingsRate: savingRate });
    expect(allocation.requiredAnnualGrossIncome).toBeCloseTo(living.requiredAnnualGrossIncome, 5);
    expect(allocation.requiredAnnualWishAllocation + allocation.requiredAnnualConsumptionAllocation)
      .toBeCloseTo(living.annualEssentialExpense - life.annualEssentialExpense, 8);
  });

  it('未提供分段时保留旧的单一支出行为', () => {
    const result = calcFire(config, stats, 0, { now, annualEssentialExpense: 15000 });
    expect(result.annualEssentialExpense).toBeCloseTo(15000, 8);
    expect(result.requiredAnnualNetIncome).toBeCloseTo(15000 + result.requiredAnnualSavings, 8);
  });
});

describe('FIRE 场景与毕业日期', () => {
  const sample = {
    ...stats,
    stateDailyConfidence: { school: 120, intern: 180, home: 40, travel: 25 },
    stateDailyAvg: { school: 30, intern: 80, home: 20, travel: 200 },
    stateConsumptionDailyAvg: { school: 10, intern: 30, home: 5, travel: 100 },
  };

  it('毕业前按四种场景的天数加权，毕业后只保留班和游', () => {
    const result = calcPreFireExpenses(sample, 1000);
    expect(result.beforeGraduation.lifeAnnualExpense).toBeCloseTo(35800, 8);
    expect(result.beforeGraduation.consumptionAnnualExpense).toBeCloseTo(9300, 8);
    expect(result.working.lifeAnnualExpense).toBeCloseTo(44200, 8);
    expect(result.working.consumptionAnnualExpense).toBeCloseTo(12700, 8);
    expect(result.workSample).toBe('intern');
  });

  it('无旅行时毕业后只用班；无班样本时回退到校', () => {
    const result = calcPreFireExpenses({ ...sample, stateDailyConfidence: { school: 30, intern: 0, home: 0, travel: 0 } }, 0);
    expect(result.workSample).toBe('school');
    expect(result.working.lifeAnnualExpense).toBe(30 * 365);
    expect(result.working.consumptionAnnualExpense).toBe(5 * 730);
  });

  it('无场景样本时沿用月均费用，空数据结果有限', () => {
    const result = calcPreFireExpenses({ ...stats, periodicLifeAvg: 1000, volatileLifeAvg: 500, consumptionAvg: 200 }, 100);
    expect(result.beforeGraduation.lifeAnnualExpense).toBeCloseTo(19200, 8);
    expect(result.working.lifeAnnualExpense).toBeCloseTo(19200, 8);
    expect(result.working.consumptionAnnualExpense).toBeCloseTo(2400, 8);
    expect(calcPreFireExpenses(calcHistoryStats([]), 0).working.lifeAnnualExpense).toBe(0);
  });

  it('毕业日期优先使用已同步日期，再用毕业里程碑与默认日期', () => {
    expect(getFireGraduationDate({ ...config, fireGraduationDate: '2028-07-01' })).toBe('2028-07-01');
    expect(getFireGraduationDate({ ...config, fireGraduationDate: null, wishDeadlineMilestones: [{ id: 'milestone_graduation', name: '毕业前', date: '2028-07-10' }] })).toBe('2028-07-10');
    expect(getFireGraduationDate({ ...config, fireGraduationDate: '2028-02-31', wishDeadlineMilestones: [] })).toBe('2028-06-20');
  });
});
