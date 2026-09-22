import type { AppConfig, CurrentStats } from '../models/types';
import {
  calculateAnnualComprehensiveTax,
  HANGZHOU_DEFAULT_HOUSING_FUND_RATE,
  HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN,
} from '../utils/tax';

const DEFAULT_INVEST_ANNUAL_GROWTH_RATE = 0.04;
const MIN_INVEST_ANNUAL_GROWTH_RATE = -0.99;
const SALARY_ANNUAL_GROWTH_RATE = 0.1;

export function getAge(birthDate: string, now = new Date()): number {
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return 0;
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export interface FireResult {
  age: number;
  fireTarget: number;
  retirementTarget: number;
  majorWishTotal: number;
  target4pct: number;
  targetAge: number;
  progress: number;
  targetYears: number;
  retireYearsLeft: number;
  investAnnualGrowthRate: number;
  salaryAnnualGrowthRate: number;
  projectedCurrentInvest: number;
  projectedInvestmentGrowth: number;
  monthlyNeeded: number;
  monthlySurplus: number;
  annualEssentialExpense: number;
  firstYearAnnualEssentialExpense: number;
  firstYearAnnualSavings: number;
  /** 用于跨模式比较的等额年储蓄需求。 */
  requiredAnnualSavings: number;
  requiredAnnualSavingsBeforeTalentSubsidy: number;
  postEssentialSavingsRate: number;
  requiredAnnualFlexibleSpending: number;
  requiredAnnualWishAllocation: number;
  requiredAnnualConsumptionAllocation: number;
  requiredAnnualNetIncome: number;
  /** 逐年涨薪后的可用收入，按投资终值权重折成等额年收入。 */
  equivalentAnnualNetIncome: number;
  requiredAnnualSalaryNetIncome: number;
  requiredAnnualGrossIncome: number;
  requiredAnnualTax: number;
  requiredAnnualSocialInsurance: number;
  requiredAnnualHousingFund: number;
  requiredAnnualSocialContribution: number;
  requiredAnnualHousingFundRentWithdrawal: number;
  annualRentExpense: number;
  annualRentTaxDeduction: number;
  talentSubsidyNominalTotal: number;
  talentSubsidyFutureValue: number;
  graduateLifeSubsidyTotal: number;
  graduateRentSubsidyTotal: number;
  eTalentRentSubsidyTotal: number;
  housingFundRate: number;
  requiredMonthlyNetIncome: number;
  requiredMarginalTaxRate: number;
  lifeProgress: number;
  lifeClockStr: string;
  lifeClockPeriod: string;
}

export interface FireCalculationOptions {
  /** 覆盖刚需支出后，剩余收入中用于储蓄的比例；默认 100%。 */
  postEssentialSavingsRate?: number;
  /** 工作期每年需先覆盖的刚需；默认与退休目标使用同一支出口径。 */
  annualEssentialExpense?: number;
  /** 按日期分段的 FIRE 前支出；末段不设结束日，延续到 FIRE。 */
  essentialExpenseStages?: readonly { endDate?: string; annualExpense: number }[];
  now?: Date;
  /** 弹性分配中进入心愿账户的比例；默认沿用“建议转账”的 80%。 */
  wishShare?: number;
}

function normalizeInvestAnnualGrowthRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return DEFAULT_INVEST_ANNUAL_GROWTH_RATE;
  return Math.max(rate, MIN_INVEST_ANNUAL_GROWTH_RATE);
}

function calcFutureSavingsFactor(annualGrowthRate: number, years: number): number {
  if (Math.abs(annualGrowthRate) < 1e-9) return years;
  return (Math.pow(1 + annualGrowthRate, years) - 1) / annualGrowthRate;
}

function calcEssentialExpenses(
  fallback: number,
  stages: FireCalculationOptions['essentialExpenseStages'],
  now: Date,
  targetYears: number,
  annualGrowthRate: number,
) {
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const totalFactor = calcFutureSavingsFactor(annualGrowthRate, targetYears);
  let elapsedYears = 0;
  let futureValue = 0;
  let currentAnnualExpense = fallback;
  const periods: { startYear: number; endYear: number; annualExpense: number }[] = [];
  for (const stage of stages ?? []) {
    const endDate = stage.endDate ? new Date(`${stage.endDate}T00:00:00`) : null;
    if (endDate && Number.isNaN(endDate.getTime())) continue;
    const endYears = endDate
      ? Math.min(Math.max((endDate.getTime() - startDate.getTime()) / (365.25 * 86400000), 0), targetYears)
      : targetYears;
    if (endYears <= elapsedYears) continue;
    const annualExpense = Number.isFinite(stage.annualExpense) ? Math.max(stage.annualExpense, 0) : fallback;
    if (elapsedYears === 0) currentAnnualExpense = annualExpense;
    // 分段费用使用与储蓄相同的终值权重，保留先低后高支出对资产积累的影响。
    const factor = calcFutureSavingsFactor(annualGrowthRate, targetYears - elapsedYears)
      - calcFutureSavingsFactor(annualGrowthRate, targetYears - endYears);
    futureValue += annualExpense * factor;
    periods.push({ startYear: elapsedYears, endYear: endYears, annualExpense });
    elapsedYears = endYears;
    if (elapsedYears >= targetYears) break;
  }
  futureValue += fallback * calcFutureSavingsFactor(annualGrowthRate, targetYears - elapsedYears);
  if (elapsedYears < targetYears) periods.push({ startYear: elapsedYears, endYear: targetYears, annualExpense: fallback });
  return { annualExpense: futureValue / totalFactor, currentAnnualExpense, periods };
}

const HANGZHOU_ANNUAL_RENT_TAX_DEDUCTION = 1500 * 12;
const HANGZHOU_ANNUAL_GRADUATE_RENT_SUBSIDY = 10000;
const HANGZHOU_GRADUATE_RENT_SUBSIDY_YEARS = 3;
const HANGZHOU_E_TALENT_ANNUAL_RENT_SUBSIDY = 2500 * 12;
const HANGZHOU_E_TALENT_RENT_SUBSIDY_YEARS = 5;
const HANGZHOU_E_TALENT_ANNUAL_WAGE_THRESHOLD = 500000;

function getGraduateLifeSubsidy(config: AppConfig): number {
  if (config.fireTalentSubsidyEnabled === false) return 0;
  switch (config.fireTalentDegree ?? 'master') {
    case 'bachelor': return 10000;
    case 'master': return 30000;
    case 'doctor': return 100000;
    default: return 0;
  }
}

function getAnnualRentExpense(config: AppConfig): number {
  return (config.futureFireExpenses ?? [])
    .filter((item) => item.isActive && /\u79df\u623f|\u623f\u79df|\u4f4f\u623f\u79df\u91d1/.test(item.name))
    .reduce((sum, item) => sum + Math.max(Number.isFinite(item.monthlyAmount) ? item.monthlyAmount : 0, 0) * 12, 0);
}

function calcTalentSubsidies(
  config: AppConfig,
  annualRentExpense: number,
  targetYears: number,
  annualGrowthRate: number,
  now: Date,
) {
  const enabled = config.fireTalentSubsidyEnabled !== false;
  const degreeEligible = (config.fireTalentDegree ?? 'master') !== 'none';
  const lifeSubsidy = getGraduateLifeSubsidy(config);
  const housingSubsidyEligible = enabled && degreeEligible && config.fireHasHangzhouHome !== true && annualRentExpense > 0;
  const expectedAnnualWageIncome = config.fireExpectedAnnualWageIncome ?? HANGZHOU_E_TALENT_ANNUAL_WAGE_THRESHOLD;
  const expectsETalent = config.fireExpectedTalentClass !== 'none'
    && expectedAnnualWageIncome >= HANGZHOU_E_TALENT_ANNUAL_WAGE_THRESHOLD;
  const eTalentRecognitionYear = Math.min(Math.max(Math.round(config.fireETalentRecognitionYear ?? 3), 2), 5);
  const wholeYears = Math.max(Math.floor(targetYears), 0);
  const graduationDate = config.fireGraduationDate ? new Date(config.fireGraduationDate) : null;
  const careerStartOffsetYears = graduationDate && !Number.isNaN(graduationDate.getTime()) && graduationDate > now
    ? (graduationDate.getTime() - now.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    : 0;
  let nominalTotal = 0;
  let futureValue = 0;
  let graduateRentSubsidyTotal = 0;
  let eTalentRentSubsidyTotal = 0;
  for (let year = 1; year <= wholeYears; year += 1) {
    const employmentYear = Math.floor(year - careerStartOffsetYears);
    if (employmentYear < 1) continue;
    let housingSubsidy = 0;
    if (housingSubsidyEligible && expectsETalent) {
      if (employmentYear >= eTalentRecognitionYear && employmentYear < eTalentRecognitionYear + HANGZHOU_E_TALENT_RENT_SUBSIDY_YEARS) {
        housingSubsidy = HANGZHOU_E_TALENT_ANNUAL_RENT_SUBSIDY;
        eTalentRentSubsidyTotal += housingSubsidy;
      }
    } else if (housingSubsidyEligible && employmentYear <= HANGZHOU_GRADUATE_RENT_SUBSIDY_YEARS) {
      housingSubsidy = HANGZHOU_ANNUAL_GRADUATE_RENT_SUBSIDY;
      graduateRentSubsidyTotal += housingSubsidy;
    }
    const amount = (employmentYear === 1 ? lifeSubsidy : 0) + housingSubsidy;
    nominalTotal += amount;
    futureValue += amount * Math.pow(1 + annualGrowthRate, Math.max(targetYears - year, 0));
  }
  return {
    nominalTotal,
    futureValue,
    graduateLifeSubsidyTotal: wholeYears > careerStartOffsetYears ? lifeSubsidy : 0,
    graduateRentSubsidyTotal,
    eTalentRentSubsidyTotal,
  };
}

export function calcFire(
  config: AppConfig,
  stats: CurrentStats,
  investTotal: number,
  options?: FireCalculationOptions,
): FireResult {
  const now = options?.now ?? new Date();
  const age = getAge(config.birthDate, now);
  const annualExpense = stats.totalExpenseAvg * 12;

  const target4pct = annualExpense / config.safeWithdrawRate;
  // FIRE 目标是退休后的可持续资产，不能用“当前年龄到退休的年数”截短。
  const targetAge = target4pct;
  const retirementTarget = target4pct;
  const majorWishTotal = (config.majorFireWishes ?? [])
    .filter((wish) => wish.isActive)
    .reduce((sum, wish) => sum + (Number.isFinite(wish.amount) ? Math.max(wish.amount, 0) : 0), 0);
  const fireTarget = retirementTarget + majorWishTotal;

  const progress = fireTarget > 0 ? investTotal / fireTarget : 0;
  const retireYearsLeft = Math.max(config.retireAge - age, 1);
  const configuredTargetYears = config.fireTargetYears && config.fireTargetYears > 0
    ? config.fireTargetYears
    : retireYearsLeft;
  const targetYears = Math.min(configuredTargetYears, retireYearsLeft);
  const investAnnualGrowthRate = normalizeInvestAnnualGrowthRate(config.investAnnualGrowthRate);
  const projectedCurrentInvest = investTotal * Math.pow(1 + investAnnualGrowthRate, targetYears);
  const projectedInvestmentGrowth = projectedCurrentInvest - investTotal;
  const annualRentExpense = getAnnualRentExpense(config);
  const talentSubsidy = calcTalentSubsidies(config, annualRentExpense, targetYears, investAnnualGrowthRate, now);
  const remainingTargetBeforeTalentSubsidy = Math.max(fireTarget - projectedCurrentInvest, 0);
  const talentSubsidyFutureValue = Math.min(talentSubsidy.futureValue, remainingTargetBeforeTalentSubsidy);
  const remainingTarget = Math.max(remainingTargetBeforeTalentSubsidy - talentSubsidyFutureValue, 0);
  const savingsFutureValueFactor = calcFutureSavingsFactor(investAnnualGrowthRate, targetYears);
  const requiredAnnualSavingsBeforeTalentSubsidy = savingsFutureValueFactor > 0
    ? remainingTargetBeforeTalentSubsidy / savingsFutureValueFactor
    : remainingTargetBeforeTalentSubsidy / targetYears;
  const requiredAnnualSavings = savingsFutureValueFactor > 0 ? remainingTarget / savingsFutureValueFactor : remainingTarget / targetYears;
  const configuredAnnualEssentialExpense = options?.annualEssentialExpense;
  const fallbackAnnualExpense = typeof configuredAnnualEssentialExpense === 'number'
    && Number.isFinite(configuredAnnualEssentialExpense)
    ? Math.max(configuredAnnualEssentialExpense, 0)
    : annualExpense;
  const essentialExpenses = calcEssentialExpenses(fallbackAnnualExpense, options?.essentialExpenseStages, now, targetYears, investAnnualGrowthRate);
  const annualEssentialExpense = essentialExpenses.annualExpense;
  const firstYearAnnualEssentialExpense = calcEssentialExpenses(
    fallbackAnnualExpense, options?.essentialExpenseStages, now, Math.min(targetYears, 1), investAnnualGrowthRate,
  ).annualExpense;
  const monthlySurplus = stats.monthlyIncomeAvg - essentialExpenses.currentAnnualExpense / 12;
  const configuredSavingsRate = options?.postEssentialSavingsRate ?? 1;
  const postEssentialSavingsRate = Number.isFinite(configuredSavingsRate)
    ? Math.min(Math.max(configuredSavingsRate, 0.01), 1)
    : 1;
  const configuredWishShare = options?.wishShare ?? 0.8;
  const wishShare = Number.isFinite(configuredWishShare)
    ? Math.min(Math.max(configuredWishShare, 0), 1)
    : 0.8;
  const housingFundRate = typeof config.fireHousingFundRate === 'number'
    && Number.isFinite(config.fireHousingFundRate)
    ? Math.min(Math.max(config.fireHousingFundRate, 0.05), 0.12)
    : HANGZHOU_DEFAULT_HOUSING_FUND_RATE;
  const annualRentTaxDeduction = config.fireHasHangzhouHome !== true
    && config.fireRentTaxDeductionEnabled !== false
    && annualRentExpense > 0
    ? HANGZHOU_ANNUAL_RENT_TAX_DEDUCTION
    : 0;
  const contributionPolicy = {
    socialInsuranceRate: HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE,
    socialInsuranceMonthlyBaseMin: HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN,
    socialInsuranceMonthlyBaseMax: HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX,
    housingFundRate,
    housingFundMonthlyBaseMin: HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN,
    housingFundMonthlyBaseMax: HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX,
    annualSpecialAdditionalDeduction: annualRentTaxDeduction,
  };
  const housingFundRentCredit = (housingFundAmount: number) => config.fireHasHangzhouHome !== true
    && config.fireHousingFundRentWithdrawalEnabled !== false
    && annualRentExpense > 0
    ? Math.min(annualRentExpense, housingFundAmount * 2)
    : 0;
  // 首年工资不涨薪；每满一年增长 10%，逐年重新计算个税、缴存上限与抵租金额。
  const salaryPeriods = Array.from({ length: Math.ceil(targetYears) }, (_, year) => {
    const endYear = Math.min(year + 1, targetYears);
    return {
      growthFactor: Math.pow(1 + SALARY_ANNUAL_GROWTH_RATE, year),
      futureValueFactor: calcFutureSavingsFactor(investAnnualGrowthRate, targetYears - year)
        - calcFutureSavingsFactor(investAnnualGrowthRate, targetYears - endYear),
      minimumResources: Math.max(0, ...essentialExpenses.periods
        .filter((period) => period.startYear < endYear && period.endYear > year)
        .map((period) => period.annualExpense)),
    };
  });
  const projectSalary = (firstYearGross: number) => {
    let futureValue = 0;
    let coversExpenses = true;
    for (const period of salaryPeriods) {
      const tax = calculateAnnualComprehensiveTax(firstYearGross * period.growthFactor, contributionPolicy);
      const resources = tax.netAnnualIncome + housingFundRentCredit(tax.housingFundAmount);
      futureValue += resources * period.futureValueFactor;
      if (resources < period.minimumResources) coversExpenses = false;
    }
    return { futureValue, coversExpenses };
  };
  const requiredResourcesFutureValue = annualEssentialExpense * savingsFutureValueFactor
    + remainingTarget / postEssentialSavingsRate;
  const meetsTarget = (firstYearGross: number) => {
    const projection = projectSalary(firstYearGross);
    return projection.coversExpenses && projection.futureValue >= requiredResourcesFutureValue;
  };
  let firstYearGross = 0;
  if (!meetsTarget(0)) {
    let low = 0;
    let high = Math.max(annualEssentialExpense + requiredAnnualSavings / postEssentialSavingsRate, 1);
    while (!meetsTarget(high)) high *= 2;
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      if (meetsTarget(mid)) high = mid;
      else low = mid;
    }
    firstYearGross = Math.ceil(high * 100) / 100;
    // 五险一金与税额分别舍入，向上取整后再确认最终报价仍可达标。
    while (!meetsTarget(firstYearGross)) firstYearGross = Math.round(firstYearGross * 100 + 1) / 100;
  }
  const requiredIncomeTax = calculateAnnualComprehensiveTax(firstYearGross, contributionPolicy);
  const equivalentAnnualNetIncome = projectSalary(firstYearGross).futureValue / savingsFutureValueFactor;
  const requiredAnnualGrossIncome = requiredIncomeTax.grossAnnualIncome;
  const requiredAnnualTax = requiredIncomeTax.taxAmount;
  const requiredAnnualSocialInsurance = requiredIncomeTax.socialInsuranceAmount;
  const requiredAnnualHousingFund = requiredIncomeTax.housingFundAmount;
  const requiredAnnualSocialContribution = requiredIncomeTax.socialContributionAmount;
  const requiredAnnualHousingFundRentWithdrawal = housingFundRentCredit(requiredAnnualHousingFund);
  const requiredAnnualSalaryNetIncome = requiredIncomeTax.netAnnualIncome;
  const requiredAnnualNetIncome = requiredAnnualSalaryNetIncome + requiredAnnualHousingFundRentWithdrawal;
  const firstYearPostEssentialIncome = Math.max(requiredAnnualNetIncome - firstYearAnnualEssentialExpense, 0);
  const firstYearAnnualSavings = firstYearPostEssentialIncome * postEssentialSavingsRate;
  const monthlyNeeded = firstYearAnnualSavings / 12;
  const requiredAnnualFlexibleSpending = firstYearPostEssentialIncome - firstYearAnnualSavings;
  const requiredAnnualWishAllocation = requiredAnnualFlexibleSpending * wishShare;
  const requiredAnnualConsumptionAllocation = requiredAnnualFlexibleSpending - requiredAnnualWishAllocation;
  const requiredMonthlyNetIncome = requiredAnnualSalaryNetIncome / 12;
  const requiredMarginalTaxRate = requiredIncomeTax.marginalTaxRate;

  // 人生时钟
  const lifeProgress = age / config.lifeExpectancy;
  const totalMin = lifeProgress * 24 * 60;
  const h = Math.floor(totalMin / 60);
  const m = Math.floor(totalMin % 60);
  const lifeClockStr = `${h}:${String(m).padStart(2, '0')}`;
  const lifeClockPeriod = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '傍晚';

  return {
    age,
    fireTarget,
    retirementTarget,
    majorWishTotal,
    target4pct,
    targetAge,
    progress,
    targetYears,
    retireYearsLeft,
    investAnnualGrowthRate,
    salaryAnnualGrowthRate: SALARY_ANNUAL_GROWTH_RATE,
    projectedCurrentInvest,
    projectedInvestmentGrowth,
    monthlyNeeded,
    monthlySurplus,
    annualEssentialExpense,
    firstYearAnnualEssentialExpense,
    firstYearAnnualSavings,
    requiredAnnualSavings,
    requiredAnnualSavingsBeforeTalentSubsidy,
    postEssentialSavingsRate,
    requiredAnnualFlexibleSpending,
    requiredAnnualWishAllocation,
    requiredAnnualConsumptionAllocation,
    requiredAnnualNetIncome,
    equivalentAnnualNetIncome,
    requiredAnnualSalaryNetIncome,
    requiredAnnualGrossIncome,
    requiredAnnualTax,
    requiredAnnualSocialInsurance,
    requiredAnnualHousingFund,
    requiredAnnualSocialContribution,
    requiredAnnualHousingFundRentWithdrawal,
    annualRentExpense,
    annualRentTaxDeduction,
    talentSubsidyNominalTotal: talentSubsidy.nominalTotal,
    talentSubsidyFutureValue,
    graduateLifeSubsidyTotal: talentSubsidy.graduateLifeSubsidyTotal,
    graduateRentSubsidyTotal: talentSubsidy.graduateRentSubsidyTotal,
    eTalentRentSubsidyTotal: talentSubsidy.eTalentRentSubsidyTotal,
    housingFundRate,
    requiredMonthlyNetIncome,
    requiredMarginalTaxRate,
    lifeProgress,
    lifeClockStr,
    lifeClockPeriod,
  };
}
