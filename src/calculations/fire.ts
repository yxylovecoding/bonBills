import type { AppConfig, CurrentStats } from '../models/types';
import {
  getFireEmploymentStartYears,
  getFullHousingFundWithdrawalEndYears,
  getHousingFundAnnualRentWithdrawalLimit,
  HOUSING_FUND_EXIT_WAIT_YEARS,
} from './fireHousingFund';
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
  projectedHousingFundBalance: number;
  housingFundExitWithdrawal: number;
  housingFundExitValueAtFire: number;
  housingFundRentWithdrawalTotal: number;
  housingFundRentWithdrawalFutureValue: number;
  projectedLiquidAssets: number;
  employmentStartYears: number;
  preCareerFundingGap: number;
  /** 年薪反推有解；在读期间的资金缺口另行提示。 */
  hasSalarySolution: boolean;
  canReachTarget: boolean;
  salaryComparisonSavingsRates: (number | null)[];
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
  /** 在当前目标、支出与公积金条件下，比较给定首年年薪对应的储蓄比例。 */
  salaryComparisonGrossIncomes?: readonly number[];
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
  const savingsFutureValueFactor = calcFutureSavingsFactor(investAnnualGrowthRate, targetYears);
  const futureValueFactor = (start: number, end: number, horizon = targetYears) =>
    calcFutureSavingsFactor(investAnnualGrowthRate, horizon - start)
      - calcFutureSavingsFactor(investAnnualGrowthRate, horizon - end);
  const configuredAnnualEssentialExpense = options?.annualEssentialExpense;
  const fallbackAnnualExpense = typeof configuredAnnualEssentialExpense === 'number'
    && Number.isFinite(configuredAnnualEssentialExpense)
    ? Math.max(configuredAnnualEssentialExpense, 0)
    : annualExpense;
  const essentialExpenses = calcEssentialExpenses(fallbackAnnualExpense, options?.essentialExpenseStages, now, targetYears, investAnnualGrowthRate);
  const employmentStartYears = getFireEmploymentStartYears(config, now);
  const careerStart = Math.min(employmentStartYears, targetYears);
  const workingYears = targetYears - careerStart;
  const firstWorkingYearEnd = Math.min(careerStart + 1, targetYears);
  const firstWorkingYearFactor = calcFutureSavingsFactor(investAnnualGrowthRate, Math.min(workingYears, 1));
  let workExpensesFutureValue = 0;
  let firstYearExpensesFutureValue = 0;
  let preCareerCashFutureValue = 0;
  let preCareerAssets = investTotal;
  let preCareerFundingGap = 0;
  const studentAnnualIncome = Math.max(Number.isFinite(stats.monthlyIncomeAvg) ? stats.monthlyIncomeAvg * 12 : 0, 0);
  for (const period of essentialExpenses.periods) {
    const preEnd = Math.min(period.endYear, careerStart);
    if (period.startYear < preEnd) {
      const duration = preEnd - period.startYear;
      const surplus = studentAnnualIncome - period.annualExpense;
      preCareerCashFutureValue += surplus * futureValueFactor(period.startYear, preEnd);
      preCareerAssets = preCareerAssets * (1 + investAnnualGrowthRate) ** duration
        + surplus * calcFutureSavingsFactor(investAnnualGrowthRate, duration);
      preCareerFundingGap = Math.max(preCareerFundingGap, -preCareerAssets);
    }
    const start = Math.max(period.startYear, careerStart);
    if (start >= period.endYear) continue;
    workExpensesFutureValue += period.annualExpense * futureValueFactor(start, period.endYear);
    const end = Math.min(period.endYear, firstWorkingYearEnd);
    if (start < end) firstYearExpensesFutureValue += period.annualExpense * futureValueFactor(start, end, firstWorkingYearEnd);
  }
  // 等额字段用于“生活同薪”比较；首年字段仅指毕业后的首个就业年度。
  const annualEssentialExpense = workExpensesFutureValue / savingsFutureValueFactor;
  const firstYearAnnualEssentialExpense = firstWorkingYearFactor > 0 ? firstYearExpensesFutureValue / firstWorkingYearFactor : 0;
  const remainingTargetBeforeTalentSubsidy = Math.max(fireTarget - projectedCurrentInvest - preCareerCashFutureValue, 0);
  const talentSubsidyFutureValue = Math.min(talentSubsidy.futureValue, remainingTargetBeforeTalentSubsidy);
  const remainingTarget = Math.max(remainingTargetBeforeTalentSubsidy - talentSubsidyFutureValue, 0);
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
  const housingFundEnabled = config.fireHousingFundRentWithdrawalEnabled !== false;
  const rentalEligible = housingFundEnabled && config.fireHasHangzhouHome !== true && annualRentExpense > 0;
  const initialHousingFundBalance = Number.isFinite(config.fireHousingFundBalance)
    ? Math.max(config.fireHousingFundBalance ?? 0, 0) : 0;
  const fullWithdrawalEnd = getFullHousingFundWithdrawalEndYears(config, now);
  // 按月累计缴存与提取；在毕业、资格变化、涨薪和支出阶段边界处分段。
  const boundaries = new Set([careerStart, targetYears]);
  for (let month = 1; month / 12 < workingYears; month++) boundaries.add(careerStart + month / 12);
  if (fullWithdrawalEnd > careerStart && fullWithdrawalEnd < targetYears) boundaries.add(fullWithdrawalEnd);
  for (const period of essentialExpenses.periods) {
    if (period.endYear > careerStart && period.endYear < targetYears) boundaries.add(period.endYear);
  }
  const orderedBoundaries = [...boundaries].sort((a, b) => a - b);
  const salaryPeriods = orderedBoundaries.slice(0, -1).map((startYear, index) => {
    const endYear = orderedBoundaries[index + 1];
    return {
      startYear,
      endYear,
      salaryYear: Math.min(Math.floor(startYear - careerStart + 1e-9), Math.ceil(workingYears) - 1),
      duration: endYear - startYear,
      futureValueFactor: futureValueFactor(startYear, endYear),
      withdrawalFutureValueFactor: (1 + investAnnualGrowthRate) ** (targetYears - endYear),
      minimumResources: Math.max(0, ...essentialExpenses.periods
        .filter((period) => period.startYear < endYear && period.endYear > startYear)
        .map((period) => period.annualExpense)),
    };
  });
  const projectSalary = (firstYearGross: number) => {
    const annualTaxes = Array.from({ length: Math.ceil(workingYears) }, (_, year) =>
      calculateAnnualComprehensiveTax(firstYearGross * (1 + SALARY_ANNUAL_GROWTH_RATE) ** year, contributionPolicy));
    let futureValue = 0;
    let coversExpenses = true;
    let housingFundBalance = initialHousingFundBalance;
    let rentWithdrawalTotal = 0;
    let rentWithdrawalFutureValue = 0;
    let firstYearWithdrawalTotal = 0;
    let pendingRentAllowance = 0;
    for (const period of salaryPeriods) {
      const tax = annualTaxes[period.salaryYear];
      const annualContribution = tax.housingFundAmount * 2;
      housingFundBalance += annualContribution * period.duration;
      const annualRentLimit = rentalEligible
        ? getHousingFundAnnualRentWithdrawalLimit(annualContribution, period.startYear < fullWithdrawalEnd)
        : 0;
      pendingRentAllowance += annualRentLimit * period.duration;
      // 新就业连续缴存满3个月后申请；补提此前合资格月份，绝不透支账户。
      const canWithdraw = employmentStartYears <= 0 || period.endYear - careerStart >= 0.25 - 1e-9;
      const withdrawal = canWithdraw ? Math.min(housingFundBalance, pendingRentAllowance) : 0;
      if (canWithdraw) pendingRentAllowance = 0;
      housingFundBalance -= withdrawal;
      rentWithdrawalTotal += withdrawal;
      rentWithdrawalFutureValue += withdrawal * period.withdrawalFutureValueFactor;
      futureValue += tax.netAnnualIncome * period.futureValueFactor + withdrawal * period.withdrawalFutureValueFactor;
      if (period.endYear <= firstWorkingYearEnd + 1e-9) {
        firstYearWithdrawalTotal += withdrawal;
      }
      const sustainableWithdrawal = canWithdraw ? Math.min(annualContribution, annualRentLimit) : 0;
      if (tax.netAnnualIncome + sustainableWithdrawal < period.minimumResources - 1e-7) coversExpenses = false;
    }
    // 未提取余额不预估利息；离职后封存半年再取，不能提前按投资收益复利。
    const exitWithdrawal = housingFundEnabled && workingYears > 0 ? housingFundBalance : 0;
    const exitValueAtFire = exitWithdrawal / (1 + Math.max(investAnnualGrowthRate, 0)) ** HOUSING_FUND_EXIT_WAIT_YEARS;
    return {
      futureValue, coversExpenses, housingFundBalance, exitWithdrawal, exitValueAtFire,
      rentWithdrawalTotal, rentWithdrawalFutureValue, firstYearWithdrawalTotal,
    };
  };
  const otherLiquidAssets = projectedCurrentInvest + preCareerCashFutureValue + talentSubsidyFutureValue;
  const bridgeReserve = Math.min(fireTarget, majorWishTotal + annualExpense * HOUSING_FUND_EXIT_WAIT_YEARS);
  const liquidAssetsFor = (projection: ReturnType<typeof projectSalary>) => otherLiquidAssets
    + (projection.futureValue - workExpensesFutureValue) * postEssentialSavingsRate;
  const salaryComparisonSavingsRates = (options?.salaryComparisonGrossIncomes ?? []).map((gross) => {
    if (!Number.isFinite(gross) || gross < 0 || workingYears <= 0) return null;
    const projection = projectSalary(gross);
    if (!projection.coversExpenses) return null;
    const needed = Math.max(fireTarget - otherLiquidAssets - projection.exitValueAtFire, bridgeReserve - otherLiquidAssets, 0);
    const surplus = projection.futureValue - workExpensesFutureValue;
    if (needed === 0) return 0;
    if (surplus <= 0) return null;
    // 超过100%表示该年薪无法在分配范围内达到当前目标，不能钳成一个假的同薪刻度。
    return needed / surplus;
  });
  const meetsTarget = (firstYearGross: number) => {
    const projection = projectSalary(firstYearGross);
    const liquidAssets = liquidAssetsFor(projection);
    return projection.coversExpenses
      && liquidAssets + projection.exitValueAtFire >= fireTarget - 1e-7
      && liquidAssets >= bridgeReserve - 1e-7;
  };
  let firstYearGross = 0;
  if (workingYears > 0 && !meetsTarget(0)) {
    let low = 0;
    let high = Math.max(annualEssentialExpense + remainingTarget / workingYears / postEssentialSavingsRate, 1);
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
  const salaryProjection = projectSalary(firstYearGross);
  const hasSalarySolution = meetsTarget(firstYearGross);
  const equivalentAnnualNetIncome = salaryProjection.futureValue / savingsFutureValueFactor;
  const requiredAnnualSavings = Math.max(remainingTarget - salaryProjection.exitValueAtFire, bridgeReserve - otherLiquidAssets, 0)
    / savingsFutureValueFactor;
  const requiredAnnualSavingsBeforeTalentSubsidy = Math.max(remainingTargetBeforeTalentSubsidy - salaryProjection.exitValueAtFire, 0)
    / savingsFutureValueFactor;
  const requiredAnnualGrossIncome = requiredIncomeTax.grossAnnualIncome;
  const requiredAnnualTax = requiredIncomeTax.taxAmount;
  const requiredAnnualSocialInsurance = requiredIncomeTax.socialInsuranceAmount;
  const requiredAnnualHousingFund = requiredIncomeTax.housingFundAmount;
  const requiredAnnualSocialContribution = requiredIncomeTax.socialContributionAmount;
  const requiredAnnualHousingFundRentWithdrawal = workingYears > 0
    ? salaryProjection.firstYearWithdrawalTotal / Math.min(workingYears, 1) : 0;
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
    projectedHousingFundBalance: salaryProjection.housingFundBalance,
    housingFundExitWithdrawal: salaryProjection.exitWithdrawal,
    housingFundExitValueAtFire: salaryProjection.exitValueAtFire,
    housingFundRentWithdrawalTotal: salaryProjection.rentWithdrawalTotal,
    housingFundRentWithdrawalFutureValue: salaryProjection.rentWithdrawalFutureValue,
    projectedLiquidAssets: liquidAssetsFor(salaryProjection),
    employmentStartYears,
    preCareerFundingGap,
    hasSalarySolution,
    canReachTarget: preCareerFundingGap <= 0 && hasSalarySolution,
    salaryComparisonSavingsRates,
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
