import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../stores/configStore';
import { calcHistoryStats } from './history';
import { calcFire } from './fire';
import { getFireEmploymentStartYears, getFullHousingFundWithdrawalEndYears } from './fireHousingFund';
import {
  calculateAnnualComprehensiveTax,
  HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN,
} from '../utils/tax';

const now = new Date(2025, 0, 1);
const config = {
  ...DEFAULT_CONFIG,
  fireTalentSubsidyEnabled: false,
  fireHousingFundRentWithdrawalEnabled: true,
  fireTargetYears: 8,
  investAnnualGrowthRate: 0,
  futureFireExpenses: [{ id: 'rent', name: '租房', monthlyAmount: 1500, isActive: true }],
};
const stats = { ...calcHistoryStats([]), totalExpenseAvg: 2000, monthlyIncomeAvg: 1000 };
const taxFor = (gross: number) => calculateAnnualComprehensiveTax(gross, {
  socialInsuranceRate: HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE,
  socialInsuranceMonthlyBaseMin: HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN,
  socialInsuranceMonthlyBaseMax: HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX,
  housingFundRate: 0.12,
  housingFundMonthlyBaseMin: HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN,
  housingFundMonthlyBaseMax: HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX,
  annualSpecialAdditionalDeduction: 18000,
});

describe('在读到就业的公积金测算', () => {
  it('目标在毕业前时，不凭空产生未来工资或公积金，也不会无限反推年薪', () => {
    const result = calcFire({ ...config, fireGraduationDate: '2029-01-01', fireTargetYears: 2 }, stats, 50000, {
      now, annualEssentialExpense: 12000,
    });
    expect(result.employmentStartYears).toBe(4);
    expect(result.requiredAnnualGrossIncome).toBe(0);
    expect(result.requiredAnnualHousingFund).toBe(0);
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBe(0);
    expect(result.projectedHousingFundBalance).toBe(0);
    expect(result.projectedLiquidAssets).toBe(50000);
    expect(result.hasSalarySolution).toBe(false);
    expect(result.canReachTarget).toBe(false);
  });

  it('毕业前已有足够资产时，零工资也是有效结果', () => {
    const result = calcFire({ ...config, fireGraduationDate: '2029-01-01', fireTargetYears: 2 }, stats, 600000, {
      now, annualEssentialExpense: 12000,
    });
    expect(result.requiredAnnualGrossIncome).toBe(0);
    expect(result.projectedLiquidAssets).toBe(result.fireTarget);
    expect(result.hasSalarySolution).toBe(true);
    expect(result.canReachTarget).toBe(true);
  });

  it('毕业后才开始工资、10%普调和双边缴存，累计资产仍达到目标', () => {
    const result = calcFire({ ...config, fireGraduationDate: '2029-01-01' }, stats, 10000, {
      now, essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 12000 }, { annualExpense: 24000 }],
    });
    let assets = 10000;
    let contributions = 0;
    for (let workingYear = 0; workingYear < 4; workingYear++) {
      const tax = taxFor(result.requiredAnnualGrossIncome * 1.1 ** workingYear);
      contributions += tax.housingFundAmount * 2;
      assets += tax.netAnnualIncome + tax.housingFundAmount * 2 - 24000;
    }
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBeCloseTo(result.requiredAnnualHousingFund * 2, 6);
    expect(result.housingFundRentWithdrawalTotal).toBeCloseTo(contributions, 6);
    expect(result.housingFundExitWithdrawal).toBeCloseTo(0, 6);
    expect(assets).toBeGreaterThanOrEqual(result.fireTarget - 1e-7);
    expect(assets - result.fireTarget).toBeLessThan(1);
    expect(result.hasSalarySolution).toBe(true);
    expect(result.canReachTarget).toBe(true);
  });

  it('尚未连续缴存满三个月时不计租赁提取，余额留到离职提取', () => {
    const graduation = '2025-07-01';
    const start = (new Date(2025, 6, 1).getTime() - now.getTime()) / (365.25 * 86400000);
    const result = calcFire({ ...config, fireGraduationDate: graduation, fireTargetYears: start + 0.2 }, stats, 10000, {
      now, annualEssentialExpense: 12000,
    });
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBe(0);
    expect(result.housingFundRentWithdrawalTotal).toBe(0);
    expect(result.housingFundExitWithdrawal).toBeCloseTo(result.requiredAnnualHousingFund * 2 * 0.2, 6);
  });

  it('保留毕业前缺口，同时返回毕业后可补足目标的年薪结果', () => {
    const result = calcFire({ ...config, fireGraduationDate: '2029-01-01' }, { ...stats, monthlyIncomeAvg: 0 }, 0, {
      now, essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 12000 }, { annualExpense: 24000 }],
    });
    expect(result.preCareerFundingGap).toBe(48000);
    expect(Number.isFinite(result.requiredAnnualGrossIncome)).toBe(true);
    expect(result.requiredAnnualGrossIncome).toBeGreaterThan(0);
    expect(result.projectedLiquidAssets + result.housingFundExitValueAtFire).toBeCloseTo(result.fireTarget, 0);
    expect(result.hasSalarySolution).toBe(true);
    expect(result.canReachTarget).toBe(false);
  });
});

describe('公积金提取与账户余额', () => {
  it('非杭州户籍满36岁后仍可全额提取双边缴存，金额可高于已设置房租', () => {
    const result = calcFire({ ...config, birthDate: '1980-01-01' }, { ...stats, totalExpenseAvg: 10000 }, 0, { now });
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBeCloseTo(result.requiredAnnualHousingFund * 2, 6);
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBeGreaterThan(18000);
    expect(result.projectedHousingFundBalance).toBeCloseTo(0, 6);
    expect(result.requiredAnnualNetIncome).toBeCloseTo(result.requiredAnnualSalaryNetIncome + result.requiredAnnualHousingFund * 2, 6);
  });

  it('本地户籍且超过青年年龄时按市区每年24000元限额提取', () => {
    const result = calcFire({ ...config, birthDate: '1980-01-01', fireHasHangzhouHukou: true }, { ...stats, totalExpenseAvg: 10000 }, 0, { now });
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBeCloseTo(24000, 6);
    expect(result.housingFundRentWithdrawalTotal).toBeCloseTo(24000 * 8, 6);
    let contributions = 0;
    let assets = 0;
    for (let year = 0; year < 8; year++) {
      const tax = taxFor(result.requiredAnnualGrossIncome * 1.1 ** year);
      contributions += tax.housingFundAmount * 2;
      assets += tax.netAnnualIncome + 24000 - 120000;
    }
    expect(result.housingFundExitWithdrawal).toBeCloseTo(contributions - 24000 * 8, 6);
    expect(assets + result.housingFundExitWithdrawal).toBeCloseTo(result.fireTarget, 0);
    expect(result.projectedLiquidAssets).toBeGreaterThanOrEqual(60000);
  });

  it('满36岁的月份切换普通限额，同一笔缴存不会同时提取和留在余额', () => {
    const youthEnd = (new Date(2025, 6, 1).getTime() - now.getTime()) / (365.25 * 86400000);
    const result = calcFire({ ...config, birthDate: '1989-07-18', fireHasHangzhouHukou: true, fireTargetYears: 1 }, { ...stats, totalExpenseAvg: 10000 }, 0, { now });
    const contribution = result.requiredAnnualHousingFund * 2;
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBeCloseTo(contribution * youthEnd + 24000 * (1 - youthEnd), 6);
    expect(result.housingFundRentWithdrawalTotal + result.housingFundExitWithdrawal).toBeCloseTo(contribution, 6);
  });

  it('普通额度允许使用已有余额，但不能超出实际账户余额', () => {
    const result = calcFire({ ...config, birthDate: '1980-01-01', fireHasHangzhouHukou: true, fireHousingFundBalance: 1000, fireTargetYears: 1 }, stats, 600000, { now });
    const available = 1000 + result.requiredAnnualHousingFund * 2;
    expect(result.housingFundRentWithdrawalTotal).toBeCloseTo(Math.min(24000, available), 6);
    expect(result.housingFundRentWithdrawalTotal + result.projectedHousingFundBalance).toBeCloseTo(available, 6);
  });

  it.each([{ fireHasHangzhouHome: true }, { futureFireExpenses: [] }])('不满足租房条件时，只在离职后计入余额提取：%j', (change) => {
    const result = calcFire({ ...config, ...change }, stats, 0, { now });
    expect(result.requiredAnnualHousingFundRentWithdrawal).toBe(0);
    expect(result.housingFundRentWithdrawalTotal).toBe(0);
    expect(result.housingFundExitWithdrawal).toBeGreaterThan(0);
  });

  it('离职可提余额需等待半年，按折现价值计入并保留过渡现金', () => {
    const result = calcFire({ ...config, fireHasHangzhouHukou: true, birthDate: '1980-01-01', investAnnualGrowthRate: 0.04 }, { ...stats, totalExpenseAvg: 10000 }, 0, { now });
    expect(result.housingFundExitValueAtFire).toBeCloseTo(result.housingFundExitWithdrawal / Math.sqrt(1.04), 6);
    expect(result.projectedLiquidAssets).toBeGreaterThanOrEqual(60000);
    expect(result.projectedLiquidAssets + result.housingFundExitValueAtFire).toBeCloseTo(result.fireTarget, 0);
  });

  it('大额公积金余额不能替代半年生活费和到期愿望所需现金', () => {
    const result = calcFire({ ...config, futureFireExpenses: [], fireHousingFundBalance: 1000000, majorFireWishes: [{ id: 'wish', name: '愿望', amount: 100000, isActive: true }] }, stats, 0, { now });
    expect(result.projectedLiquidAssets).toBeGreaterThanOrEqual(112000 - 1e-7);
    expect(result.progress).toBe(0);
    expect(result.requiredAnnualGrossIncome).toBeGreaterThan(0);
  });

  it('关闭提取后不计任何公积金现金，开启后降低所需年薪', () => {
    const enabled = calcFire(config, stats, 0, { now });
    const disabled = calcFire({ ...config, fireHousingFundRentWithdrawalEnabled: false, fireHousingFundBalance: 1000000 }, stats, 0, { now });
    expect(disabled.housingFundRentWithdrawalTotal).toBe(0);
    expect(disabled.housingFundExitWithdrawal).toBe(0);
    expect(enabled.requiredAnnualGrossIncome).toBeLessThan(disabled.requiredAnnualGrossIncome);
  });

  it('计入离职公积金后，“生活同薪”比例仍对应相同的首年年薪', () => {
    const localConfig = { ...config, birthDate: '1980-01-01', fireHasHangzhouHukou: true };
    const highStats = { ...stats, totalExpenseAvg: 10000 };
    const living = calcFire(localConfig, highStats, 0, { now, annualEssentialExpense: 120000 });
    const life = calcFire(localConfig, highStats, 0, { now, annualEssentialExpense: 60000 });
    const savingRate = living.requiredAnnualSavings / (living.equivalentAnnualNetIncome - life.annualEssentialExpense);
    const allocation = calcFire(localConfig, highStats, 0, { now, annualEssentialExpense: 60000, postEssentialSavingsRate: savingRate });
    expect(allocation.requiredAnnualGrossIncome).toBeCloseTo(living.requiredAnnualGrossIncome, 2);
    expect(allocation.housingFundExitWithdrawal).toBeCloseTo(living.housingFundExitWithdrawal, 2);
    expect(allocation.projectedLiquidAssets + allocation.housingFundExitValueAtFire).toBeCloseTo(allocation.fireTarget, 0);
  });
});

describe('公积金资格日期', () => {
  it('本地户籍新市民资格按落户月份起算3年，青年资格可延续更久', () => {
    const local = { ...config, birthDate: '1980-01-01', fireHasHangzhouHukou: true, fireHangzhouHukouDate: '2024-07-18' };
    const expected = (new Date(2027, 6, 1).getTime() - now.getTime()) / (365.25 * 86400000);
    expect(getFullHousingFundWithdrawalEndYears(local, now)).toBe(expected);
    expect(getFullHousingFundWithdrawalEndYears({ ...local, birthDate: '2002-12-29' }, now)).toBeGreaterThan(expected);
    expect(getFullHousingFundWithdrawalEndYears({ ...local, fireHasHangzhouHukou: false }, now)).toBe(Infinity);
  });

  it('无效日期不能延长青年、新市民资格或制造就业日期', () => {
    expect(getFullHousingFundWithdrawalEndYears({ ...config, birthDate: '1989-02-31', fireHasHangzhouHukou: true, fireHangzhouHukouDate: '2024-02-31' }, now)).toBe(0);
    expect(getFireEmploymentStartYears({ ...config, fireGraduationDate: '2028-02-31' }, now)).toBe(0);
  });
});

describe('FIRE 双同薪比例', () => {
  it.each([false, true])('在读且公积金提取为%s时，活所需资产和年薪都不高于生活', (enabled) => {
    const studentConfig = { ...config, fireGraduationDate: '2029-01-01', fireHousingFundRentWithdrawalEnabled: enabled };
    const life = calcFire(studentConfig, stats, 10000, {
      now, essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 12000 }, { annualExpense: 24000 }],
    });
    const living = calcFire(studentConfig, { ...stats, totalExpenseAvg: 3000 }, 10000, {
      now, essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 18000 }, { annualExpense: 36000 }],
    });
    expect(life.fireTarget).toBeLessThan(living.fireTarget);
    expect(life.requiredAnnualGrossIncome).toBeLessThan(living.requiredAnnualGrossIncome);
  });

  it('按分配模式的目标比较活和生活年薪，活同薪超过100%时保留真实比例', () => {
    const life = calcFire(config, stats, 0, { now, annualEssentialExpense: 24000 });
    const livingStats = { ...stats, totalExpenseAvg: 3000 };
    const living = calcFire(config, livingStats, 0, { now, annualEssentialExpense: 36000 });
    expect(life.requiredAnnualGrossIncome).toBeLessThan(living.requiredAnnualGrossIncome);
    expect(life.fireTarget).toBeLessThan(living.fireTarget);
    const comparison = calcFire(config, livingStats, 0, {
      now, annualEssentialExpense: 24000,
      salaryComparisonGrossIncomes: [life.requiredAnnualGrossIncome, living.requiredAnnualGrossIncome],
    });
    const [lifeRate, livingRate] = comparison.salaryComparisonSavingsRates;
    expect(lifeRate).toBeGreaterThan(1);
    expect(livingRate).toBeGreaterThan(0.1);
    expect(livingRate).toBeLessThan(1);
    const matched = calcFire(config, livingStats, 0, {
      now, annualEssentialExpense: 24000, postEssentialSavingsRate: livingRate!,
    });
    expect(matched.requiredAnnualGrossIncome).toBeCloseTo(living.requiredAnnualGrossIncome, 2);
    expect(comparison.requiredAnnualGrossIncome).toBeGreaterThan(life.requiredAnnualGrossIncome);
  });

  it('在读支出不同且离职有公积金余额时，生活同薪仍对应实际首年年薪', () => {
    const studentConfig = { ...config, fireGraduationDate: '2029-01-01', fireHasHangzhouHukou: true, birthDate: '1990-01-01' };
    const highStats = { ...stats, totalExpenseAvg: 10000 };
    const living = calcFire(studentConfig, highStats, 10000, {
      now, essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 18000 }, { annualExpense: 120000 }],
    });
    const allocationOptions = {
      now, essentialExpenseStages: [{ endDate: '2029-01-01', annualExpense: 12000 }, { annualExpense: 60000 }],
    };
    const comparison = calcFire(studentConfig, highStats, 10000, {
      ...allocationOptions, salaryComparisonGrossIncomes: [living.requiredAnnualGrossIncome],
    });
    const rate = comparison.salaryComparisonSavingsRates[0];
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(1);
    const matched = calcFire(studentConfig, highStats, 10000, { ...allocationOptions, postEssentialSavingsRate: rate! });
    expect(matched.housingFundExitWithdrawal).toBeGreaterThan(0);
    expect(matched.requiredAnnualGrossIncome).toBeCloseTo(living.requiredAnnualGrossIncome, 2);
    expect(matched.projectedLiquidAssets + matched.housingFundExitValueAtFire).toBeCloseTo(matched.fireTarget, 0);
  });

  it('两种生活成本相同时允许两个标记在同一百分比，拖动比例不改变标记', () => {
    const reference = calcFire(config, stats, 0, { now });
    const comparisons = [0.1, 0.9].map((rate) => calcFire(config, stats, 0, {
      now, postEssentialSavingsRate: rate,
      salaryComparisonGrossIncomes: [reference.requiredAnnualGrossIncome, reference.requiredAnnualGrossIncome],
    }));
    expect(comparisons[0].salaryComparisonSavingsRates[0]).toBeCloseTo(1, 6);
    expect(comparisons[0].salaryComparisonSavingsRates[0]).toBe(comparisons[0].salaryComparisonSavingsRates[1]);
    expect(comparisons[0].salaryComparisonSavingsRates).toEqual(comparisons[1].salaryComparisonSavingsRates);
  });

  it('无法覆盖工作期支出或目标在就业前时，同薪比例不可用', () => {
    const working = calcFire(config, stats, 0, { now, salaryComparisonGrossIncomes: [0, NaN] });
    expect(working.salaryComparisonSavingsRates).toEqual([null, null]);
    const student = calcFire({ ...config, fireGraduationDate: '2040-01-01' }, stats, 0, {
      now, salaryComparisonGrossIncomes: [500000],
    });
    expect(student.salaryComparisonSavingsRates).toEqual([null]);
  });
});
