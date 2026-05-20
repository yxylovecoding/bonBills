import type { AppConfig, CurrentStats } from '../models/types';
import { estimateGrossAnnualIncomeForNet } from '../utils/tax';

const DEFAULT_INVEST_ANNUAL_GROWTH_RATE = 0.04;
const MIN_INVEST_ANNUAL_GROWTH_RATE = -0.99;

export function getAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export interface FireResult {
  age: number;
  fireTarget: number;
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
  requiredAnnualNetIncome: number;
  requiredAnnualGrossIncome: number;
  requiredAnnualTax: number;
  requiredMonthlyNetIncome: number;
  requiredMarginalTaxRate: number;
  lifeProgress: number;
  lifeClockStr: string;
  lifeClockPeriod: string;
}

function normalizeInvestAnnualGrowthRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return DEFAULT_INVEST_ANNUAL_GROWTH_RATE;
  return Math.max(rate, MIN_INVEST_ANNUAL_GROWTH_RATE);
}

function calcFutureSavingsFactor(annualGrowthRate: number, years: number): number {
  if (Math.abs(annualGrowthRate) < 1e-9) return years;
  return (Math.pow(1 + annualGrowthRate, years) - 1) / annualGrowthRate;
}

export function calcFire(
  config: AppConfig,
  stats: CurrentStats,
  investTotal: number,
): FireResult {
  const age = getAge(config.birthDate);
  const annualExpense = stats.totalExpenseAvg * 12;

  const target4pct = annualExpense / config.safeWithdrawRate;
  const targetAge  = annualExpense * Math.max(config.retireAge - age, 1);
  const fireTarget = Math.min(target4pct, targetAge);

  const progress = fireTarget > 0 ? investTotal / fireTarget : 0;
  const retireYearsLeft = Math.max(config.retireAge - age, 1);
  const configuredTargetYears = config.fireTargetYears && config.fireTargetYears > 0
    ? config.fireTargetYears
    : retireYearsLeft;
  const targetYears = Math.min(configuredTargetYears, retireYearsLeft);
  const investAnnualGrowthRate = normalizeInvestAnnualGrowthRate(config.investAnnualGrowthRate);
  const projectedCurrentInvest = investTotal * Math.pow(1 + investAnnualGrowthRate, targetYears);
  const projectedInvestmentGrowth = projectedCurrentInvest - investTotal;
  const remainingTarget = Math.max(fireTarget - projectedCurrentInvest, 0);
  const savingsFutureValueFactor = calcFutureSavingsFactor(investAnnualGrowthRate, targetYears);
  const requiredAnnualSavings = savingsFutureValueFactor > 0 ? remainingTarget / savingsFutureValueFactor : remainingTarget / targetYears;
  const monthlyNeeded = requiredAnnualSavings / 12;
  const monthlySurplus = stats.monthlyIncomeAvg - stats.totalExpenseAvg;
  const requiredAnnualNetIncome = annualExpense + requiredAnnualSavings;
  const requiredIncomeTax = estimateGrossAnnualIncomeForNet(requiredAnnualNetIncome);
  const requiredAnnualGrossIncome = requiredIncomeTax.grossAnnualIncome;
  const requiredAnnualTax = requiredIncomeTax.taxAmount;
  const requiredMonthlyNetIncome = requiredAnnualNetIncome / 12;
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
    requiredAnnualNetIncome,
    requiredAnnualGrossIncome,
    requiredAnnualTax,
    requiredMonthlyNetIncome,
    requiredMarginalTaxRate,
    lifeProgress,
    lifeClockStr,
    lifeClockPeriod,
  };
}
