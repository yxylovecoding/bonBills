import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../stores/configStore';
import { calcHistoryStats } from './history';
import { calcFire } from './fire';
import { calcPreFireExpenses, getFireGraduationDate } from './fireExpenses';
import {
  calculateAnnualComprehensiveTax,
  estimateGrossAnnualIncomeForResources,
  HANGZHOU_DEFAULT_HOUSING_FUND_RATE,
  HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN,
} from '../utils/tax';

const salaryTaxPolicy = {
  socialInsuranceRate: HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE,
  socialInsuranceMonthlyBaseMin: HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN,
  socialInsuranceMonthlyBaseMax: HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX,
  housingFundRate: HANGZHOU_DEFAULT_HOUSING_FUND_RATE,
  housingFundMonthlyBaseMin: HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN,
  housingFundMonthlyBaseMax: HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX,
};
const netSalary = (gross: number) => calculateAnnualComprehensiveTax(gross, salaryTaxPolicy).netAnnualIncome;

// 年薪按分向上取整，逐年计税也按分舍入，累计资产允许不足一元的余量。
function expectTargetReached(assets: number, target: number) {
  expect(assets).toBeGreaterThanOrEqual(target - 1e-7);
  expect(assets - target).toBeLessThan(1);
}

const config = { ...DEFAULT_CONFIG, fireTargetYears: 8, fireTalentSubsidyEnabled: false, fireHousingFundRentWithdrawalEnabled: false };
const stats = { ...calcHistoryStats([]), totalExpenseAvg: 2000, monthlyIncomeAvg: 5000 };
const now = new Date(2025, 0, 1);
const stages = [
  { endDate: '2029-01-01', annualExpense: 12000 },
  { annualExpense: 24000 },
];

describe('FIRE 前后分段支出', () => {
  it.each([0, 0.08, 0.1, -0.1])('年化 %s 时，按逐年涨薪和两个支出阶段可达退休目标', (rate) => {
    const result = calcFire({ ...config, investAnnualGrowthRate: rate }, stats, 10000, { now, essentialExpenseStages: stages });
    let assets = 10000;
    for (let year = 0; year < 8; year++) {
      const income = netSalary(result.requiredAnnualGrossIncome * 1.1 ** year);
      assets = assets * (1 + rate) + income - (year < 4 ? 12000 : 24000);
    }
    expectTargetReached(assets, result.fireTarget);
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
      .toBeCloseTo(schoolTravel.firstYearAnnualSavings - home.firstYearAnnualSavings, 8);
  });

  it('分配模式使用退休前消费，使“与生活相同”刻度仍对应同一年薪', () => {
    const living = calcFire(config, stats, 0, {
      now,
      essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 18000 }, { annualExpense: 36000 }],
    });
    const life = calcFire(config, stats, 0, { now, essentialExpenseStages: stages });
    const savingRate = living.requiredAnnualSavings
      / (living.equivalentAnnualNetIncome - life.annualEssentialExpense);
    const allocation = calcFire(config, stats, 0, { now, essentialExpenseStages: stages, postEssentialSavingsRate: savingRate });
    expect(allocation.requiredAnnualGrossIncome).toBeCloseTo(living.requiredAnnualGrossIncome, 5);
    expect(allocation.requiredAnnualWishAllocation + allocation.requiredAnnualConsumptionAllocation
      + allocation.firstYearAnnualSavings + allocation.firstYearAnnualEssentialExpense)
      .toBeCloseTo(living.requiredAnnualNetIncome, 8);
  });

  it('未提供分段时采用固定支出，首年收入覆盖支出与首年储蓄', () => {
    const result = calcFire(config, stats, 0, { now, annualEssentialExpense: 15000 });
    expect(result.annualEssentialExpense).toBeCloseTo(15000, 8);
    expect(result.requiredAnnualNetIncome).toBeCloseTo(15000 + result.firstYearAnnualSavings, 8);
  });
});

describe('FIRE 年薪每年普调 10%', () => {
  it('首年最低年薪低于固定年薪方案，减少首年工资后不能达标', () => {
    const result = calcFire(config, stats, 10000, { now });
    const fixedSalary = estimateGrossAnnualIncomeForResources(
      24000 + result.requiredAnnualSavings, salaryTaxPolicy,
    ).grossAnnualIncome;
    expect(result.salaryAnnualGrowthRate).toBe(0.1);
    expect(result.requiredAnnualGrossIncome).toBeLessThan(fixedSalary);
    expect(result.requiredAnnualSalaryNetIncome).toBe(netSalary(result.requiredAnnualGrossIncome));
    expect(result.monthlyNeeded * 12).toBeCloseTo(result.firstYearAnnualSavings, 8);
    let assets = 10000;
    for (let year = 0; year < 8; year++) {
      assets = assets * 1.04 + netSalary((result.requiredAnnualGrossIncome - 0.1) * 1.1 ** year) - 24000;
    }
    expect(assets).toBeLessThan(result.fireTarget);
  });

  it.each([0.5, 1, 1.5])('%s 年目标只计已经发生的年度涨薪', (targetYears) => {
    const result = calcFire({ ...config, fireTargetYears: targetYears, investAnnualGrowthRate: 0 }, stats, 0, { now });
    const firstYearSavings = netSalary(result.requiredAnnualGrossIncome) - 24000;
    const secondYearSavings = netSalary(result.requiredAnnualGrossIncome * 1.1) - 24000;
    const assets = firstYearSavings * Math.min(targetYears, 1) + secondYearSavings * Math.max(targetYears - 1, 0);
    expectTargetReached(assets, result.fireTarget);
    if (targetYears <= 1) {
      expect(result.requiredAnnualGrossIncome).toBe(estimateGrossAnnualIncomeForResources(
        24000 + result.fireTarget / targetYears, salaryTaxPolicy,
      ).grossAnnualIncome);
    }
  });

  it.each([0.04, -0.1])('不足整年的末期以年化 %s 累积实际收入', (rate) => {
    const result = calcFire({ ...config, fireTargetYears: 1.5, investAnnualGrowthRate: rate }, stats, 10000, { now });
    const afterFirstYear = 10000 * (1 + rate) + netSalary(result.requiredAnnualGrossIncome) - 24000;
    const halfYearSavings = (netSalary(result.requiredAnnualGrossIncome * 1.1) - 24000)
      * ((1 + rate) ** 0.5 - 1) / rate;
    expectTargetReached(afterFirstYear * (1 + rate) ** 0.5 + halfYearSavings, result.fireTarget);
  });

  it('分配模式逐年覆盖支出后分配储蓄、消费和心愿', () => {
    const result = calcFire(config, stats, 10000, {
      now, essentialExpenseStages: stages, postEssentialSavingsRate: 0.5, wishShare: 0.8,
    });
    let assets = 10000;
    for (let year = 0; year < 8; year++) {
      const surplus = netSalary(result.requiredAnnualGrossIncome * 1.1 ** year) - (year < 4 ? 12000 : 24000);
      assets = assets * 1.04 + surplus * 0.5;
    }
    expectTargetReached(assets, result.fireTarget);
    const surplus = result.requiredAnnualNetIncome - 12000;
    expect(result.firstYearAnnualSavings).toBeCloseTo(surplus * 0.5, 8);
    expect(result.requiredAnnualWishAllocation).toBeCloseTo(surplus * 0.5 * 0.8, 8);
    expect(result.requiredAnnualConsumptionAllocation).toBeCloseTo(surplus * 0.5 * 0.2, 8);
  });

  it('首年内毕业时，首年支出与月存入按两个阶段折算', () => {
    const endDate = new Date(2025, 6, 1);
    const firstStageYears = (endDate.getTime() - now.getTime()) / (365.25 * 86400000);
    const result = calcFire({ ...config, investAnnualGrowthRate: 0 }, stats, 0, {
      now, essentialExpenseStages: [{ endDate: '2025-07-01', annualExpense: 12000 }, { annualExpense: 24000 }],
    });
    const firstYearExpenses = 12000 * firstStageYears + 24000 * (1 - firstStageYears);
    expect(result.firstYearAnnualEssentialExpense).toBeCloseTo(firstYearExpenses, 8);
    expect(result.monthlyNeeded * 12).toBeCloseTo(result.requiredAnnualNetIncome - firstYearExpenses, 8);
  });

  it.each([true, false])('逐年重算租金抵扣、五险一金和抵租，抵租启用 %s', (withdrawalEnabled) => {
    const rentConfig = {
      ...config,
      fireTalentSubsidyEnabled: true,
      fireGraduationDate: '2024-01-01',
      fireHousingFundRate: 0.05,
      fireHousingFundRentWithdrawalEnabled: withdrawalEnabled,
      futureFireExpenses: [{ id: 'rent', name: '租房', monthlyAmount: 1500, isActive: true }],
    };
    const result = calcFire(rentConfig, { ...stats, totalExpenseAvg: 10000 }, 10000, { now });
    let assets = 10000;
    let firstYearTax = 0;
    let lastYearTax = 0;
    let lastYearHousingFund = 0;
    for (let year = 0; year < 8; year++) {
      const tax = calculateAnnualComprehensiveTax(result.requiredAnnualGrossIncome * 1.1 ** year, {
        ...salaryTaxPolicy, housingFundRate: 0.05, annualSpecialAdditionalDeduction: 18000,
      });
      const subsidy = (year === 0 ? 30000 : 0) + (year >= 2 && year <= 6 ? 30000 : 0);
      assets = assets * 1.04 + tax.netAnnualIncome - 120000 + subsidy;
      if (year === 0) firstYearTax = tax.taxAmount;
      lastYearTax = tax.taxAmount;
      lastYearHousingFund = tax.housingFundAmount;
    }
    expectTargetReached(assets + result.housingFundRentWithdrawalFutureValue + result.housingFundExitValueAtFire, result.fireTarget);
    expect(result.talentSubsidyNominalTotal).toBe(180000);
    expect(result.requiredAnnualTax).toBe(firstYearTax);
    expect(lastYearTax).toBeGreaterThan(firstYearTax);
    expect(lastYearHousingFund).toBe(Math.round(HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX * 12 * 0.05 * 100) / 100);
    expect(result.requiredAnnualNetIncome).toBeCloseTo(
      result.requiredAnnualSalaryNetIncome + result.requiredAnnualHousingFundRentWithdrawal, 8,
    );
  });

  it('已有资产足够时，逐年工资仍覆盖各阶段生活支出', () => {
    const result = calcFire({ ...config, fireTargetYears: 20 }, stats, 1000000, {
      now, essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 12000 }, { annualExpense: 120000 }],
    });
    expect(result.requiredAnnualSavings).toBe(0);
    for (let year = 0; year < 20; year++) {
      expect(netSalary(result.requiredAnnualGrossIncome * 1.1 ** year)).toBeGreaterThanOrEqual(year < 4 ? 12000 : 120000);
    }
    expect(result.monthlyNeeded).toBeGreaterThanOrEqual(0);
  });

  it('没有资产目标和支出时，无需工资或储蓄', () => {
    const result = calcFire(config, { ...stats, totalExpenseAvg: 0 }, 0, { now });
    expect(result.requiredAnnualGrossIncome).toBe(0);
    expect(result.requiredAnnualNetIncome).toBe(0);
    expect(result.monthlyNeeded).toBe(0);
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
