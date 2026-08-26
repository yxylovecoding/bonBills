import type { AppConfig, CurrentStats } from '../models/types';
import {
  estimateGrossAnnualIncomeForResources,
  HANGZHOU_DEFAULT_HOUSING_FUND_RATE,
  HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX,
  HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX,
  HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN,
} from '../utils/tax';

const DEFAULT_INVEST_ANNUAL_GROWTH_RATE = 0.04;
const MIN_INVEST_ANNUAL_GROWTH_RATE = -0.99;

export function getAge(birthDate: string): number {
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
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
  projectedCurrentInvest: number;
  projectedInvestmentGrowth: number;
  monthlyNeeded: number;
  monthlySurplus: number;
  requiredAnnualSavings: number;
  requiredAnnualSavingsBeforeTalentSubsidy: number;
  postEssentialSavingsRate: number;
  requiredAnnualFlexibleSpending: number;
  requiredAnnualWishAllocation: number;
  requiredAnnualConsumptionAllocation: number;
  requiredAnnualNetIncome: number;
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
  const now = new Date();
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
  const age = getAge(config.birthDate);
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
  const talentSubsidy = calcTalentSubsidies(config, annualRentExpense, targetYears, investAnnualGrowthRate);
  const remainingTargetBeforeTalentSubsidy = Math.max(fireTarget - projectedCurrentInvest, 0);
  const talentSubsidyFutureValue = Math.min(talentSubsidy.futureValue, remainingTargetBeforeTalentSubsidy);
  const remainingTarget = Math.max(remainingTargetBeforeTalentSubsidy - talentSubsidyFutureValue, 0);
  const savingsFutureValueFactor = calcFutureSavingsFactor(investAnnualGrowthRate, targetYears);
  const requiredAnnualSavingsBeforeTalentSubsidy = savingsFutureValueFactor > 0
    ? remainingTargetBeforeTalentSubsidy / savingsFutureValueFactor
    : remainingTargetBeforeTalentSubsidy / targetYears;
  const requiredAnnualSavings = savingsFutureValueFactor > 0 ? remainingTarget / savingsFutureValueFactor : remainingTarget / targetYears;
  const monthlyNeeded = requiredAnnualSavings / 12;
  const configuredAnnualEssentialExpense = options?.annualEssentialExpense;
  const annualEssentialExpense = typeof configuredAnnualEssentialExpense === 'number'
    && Number.isFinite(configuredAnnualEssentialExpense)
    ? Math.max(configuredAnnualEssentialExpense, 0)
    : annualExpense;
  const monthlySurplus = stats.monthlyIncomeAvg - annualEssentialExpense / 12;
  const configuredSavingsRate = options?.postEssentialSavingsRate ?? 1;
  const postEssentialSavingsRate = Number.isFinite(configuredSavingsRate)
    ? Math.min(Math.max(configuredSavingsRate, 0.01), 1)
    : 1;
  const configuredWishShare = options?.wishShare ?? 0.8;
  const wishShare = Number.isFinite(configuredWishShare)
    ? Math.min(Math.max(configuredWishShare, 0), 1)
    : 0.8;
  // “分配”模式先覆盖刚需，再按比例分配剩余收入。为了仍能存下达标所需金额，
  // 反推覆盖刚需后的总收入，并将非储蓄部分拆给消费/心愿。
  const requiredAnnualPostEssentialIncome = requiredAnnualSavings / postEssentialSavingsRate;
  const requiredAnnualFlexibleSpending = Math.max(requiredAnnualPostEssentialIncome - requiredAnnualSavings, 0);
  const requiredAnnualWishAllocation = requiredAnnualFlexibleSpending * wishShare;
  const requiredAnnualConsumptionAllocation = requiredAnnualFlexibleSpending - requiredAnnualWishAllocation;
  const requiredAnnualNetIncome = annualEssentialExpense + requiredAnnualPostEssentialIncome;
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
  const requiredIncomeTax = estimateGrossAnnualIncomeForResources(
    requiredAnnualNetIncome,
    contributionPolicy,
    (result) => housingFundRentCredit(result.housingFundAmount),
  );
  const requiredAnnualGrossIncome = requiredIncomeTax.grossAnnualIncome;
  const requiredAnnualTax = requiredIncomeTax.taxAmount;
  const requiredAnnualSocialInsurance = requiredIncomeTax.socialInsuranceAmount;
  const requiredAnnualHousingFund = requiredIncomeTax.housingFundAmount;
  const requiredAnnualSocialContribution = requiredIncomeTax.socialContributionAmount;
  const requiredAnnualHousingFundRentWithdrawal = housingFundRentCredit(requiredAnnualHousingFund);
  const requiredAnnualSalaryNetIncome = requiredIncomeTax.netAnnualIncome;
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
    projectedCurrentInvest,
    projectedInvestmentGrowth,
    monthlyNeeded,
    monthlySurplus,
    requiredAnnualSavings,
    requiredAnnualSavingsBeforeTalentSubsidy,
    postEssentialSavingsRate,
    requiredAnnualFlexibleSpending,
    requiredAnnualWishAllocation,
    requiredAnnualConsumptionAllocation,
    requiredAnnualNetIncome,
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
