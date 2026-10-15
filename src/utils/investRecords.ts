import type { InvestKey, MonthlyRecord } from '../models/types';
import { summarizeInvestPositionItems } from './investPositionItems';

export interface InvestTotalForRate {
  value: number;
  estimated: boolean;
  beforeMonth?: string;
  afterMonth?: string;
}

export function getManualAccumulatedProfit(record: MonthlyRecord | undefined): number {
  if (!record) return 0;
  return typeof record.manualAccumulatedProfit === 'number'
    && Number.isFinite(record.manualAccumulatedProfit)
    ? record.manualAccumulatedProfit
    : record.accumulatedProfit;
}

export function isInvestAccumulatedProfitAuto(yearMonth: string, startMonth?: string): boolean {
  return Boolean(startMonth && /^\d{4}-\d{2}$/.test(startMonth) && yearMonth >= startMonth);
}

export function applyInvestAutoSumStartMonth(
  records: MonthlyRecord[],
  startMonth?: string,
): MonthlyRecord[] {
  return records.map((record) => {
    const manualAccumulatedProfit = getManualAccumulatedProfit(record);
    const shouldAutoSum = isInvestAccumulatedProfitAuto(record.yearMonth, startMonth)
      && record.investPositionItems !== undefined;
    return {
      ...record,
      accumulatedProfit: shouldAutoSum
        ? summarizeInvestPositionItems(record.investPositionItems ?? {}).totalProfitCny
        : manualAccumulatedProfit,
      manualAccumulatedProfit,
      isBaseline: undefined,
    };
  });
}

export function getInvestTotalForRate(
  yearMonth: string,
  storedTotal: number | undefined,
  records: MonthlyRecord[],
): InvestTotalForRate | null {
  const ownTotal = Number(storedTotal);
  if (Number.isFinite(ownTotal) && ownTotal > 0) {
    return { value: ownTotal, estimated: false };
  }

  const validRecords = records
    .filter((record) => record.yearMonth !== yearMonth && Number.isFinite(record.investTotal) && record.investTotal > 0)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const before = [...validRecords].reverse().find((record) => record.yearMonth < yearMonth);
  const after = validRecords.find((record) => record.yearMonth > yearMonth);
  if (!before || !after) return null;

  return {
    value: (before.investTotal + after.investTotal) / 2,
    estimated: true,
    beforeMonth: before.yearMonth,
    afterMonth: after.yearMonth,
  };
}

// 某品类当月累计收益 = now（当前持仓）+ past（已清仓）；两者皆空时返回 null
export function getCategoryProfit(
  record: MonthlyRecord | undefined,
  key: InvestKey,
): number | null {
  const now = record?.investBreakdownProfit?.[key];
  const past = record?.investBreakdownPastProfit?.[key];
  if ((now === undefined || now === null) && (past === undefined || past === null)) return null;
  return (now ?? 0) + (past ?? 0);
}

function previousYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
}

export interface YearInvestmentReturn {
  income: number;
  weightedCapital: number;
  rate: number;
  annualizedRate: number;
}

// 修正 Dietz：净投入由月度市值变化扣除收益推算，发生时间估在该月观测区间中点。
// asOfDate 当天计入已过天数；当前月只观察到当天，日期差按 UTC 日历计算以避开夏令时。
export function getYearInvestmentReturn(
  records: readonly MonthlyRecord[],
  asOfDate: string,
): YearInvestmentReturn | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;
  const [year, month, day] = asOfDate.split('-').map(Number);
  const asOfTime = Date.UTC(year, month - 1, day);
  if (new Date(asOfTime).toISOString().slice(0, 10) !== asOfDate) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const start = Date.UTC(year, 0, 1);
  const end = asOfTime + dayMs;
  const elapsedDays = (end - start) / dayMs;
  const yearDays = (Date.UTC(year + 1, 0, 1) - start) / dayMs;
  const byMonth = new Map(records.map((record) => [record.yearMonth, record]));
  const isValid = (record: MonthlyRecord | undefined): record is MonthlyRecord => Boolean(record
    && Number.isFinite(record.investTotal) && record.investTotal >= 0
    && Number.isFinite(record.accumulatedProfit));
  const baseline = byMonth.get(`${year - 1}-12`);
  if (!isValid(baseline)) return null;

  let previous = baseline;
  let weightedCapital = baseline.investTotal;
  for (let currentMonth = 1; currentMonth <= month; currentMonth += 1) {
    const current = byMonth.get(`${year}-${String(currentMonth).padStart(2, '0')}`);
    // 缺少月度资金数据时不插值或跳月，避免将未知资金进出当作零。
    if (!isValid(current)) return null;
    const income = current.accumulatedProfit - previous.accumulatedProfit;
    const netContribution = current.investTotal - previous.investTotal - income;
    const monthStart = Date.UTC(year, currentMonth - 1, 1);
    const monthEnd = Math.min(Date.UTC(year, currentMonth, 1), end);
    const estimatedFlowTime = (monthStart + monthEnd) / 2;
    const weight = (end - estimatedFlowTime) / (end - start);
    weightedCapital += netContribution * weight;
    previous = current;
  }
  if (!Number.isFinite(weightedCapital) || weightedCapital <= 0) return null;

  const income = previous.accumulatedProfit - baseline.accumulatedProfit;
  const rate = income / weightedCapital;
  const annualizedRate = rate / elapsedDays * yearDays;
  return Number.isFinite(rate) && Number.isFinite(annualizedRate)
    ? { income, weightedCapital, rate, annualizedRate }
    : null;
}

export function getAverageAnnualizedRate(records: MonthlyRecord[]): number | null {
  const recordsByMonth = new Map(records.map((record) => [record.yearMonth, record]));
  const monthlyRates = records.map((record) => {
    const previousRecord = recordsByMonth.get(previousYearMonth(record.yearMonth));
    const investTotalForRate = getInvestTotalForRate(record.yearMonth, record.investTotal, records);
    if (!previousRecord || investTotalForRate === null) return null;
    return (record.accumulatedProfit - (previousRecord.accumulatedProfit ?? 0)) / investTotalForRate.value;
  }).filter((rate): rate is number => rate !== null && Number.isFinite(rate));
  if (monthlyRates.length === 0) return null;
  const average = (monthlyRates.reduce((sum, rate) => sum + rate, 0) / monthlyRates.length) * 12;
  return Number.isFinite(average) ? average : null;
}

export function getGroupAverageAnnualizedRate(
  records: MonthlyRecord[],
  keys: readonly InvestKey[],
): number | null {
  const groupRecords = records.flatMap((record) => {
    const summary = record.investPositionItems !== undefined
      ? summarizeInvestPositionItems(record.investPositionItems)
      : null;
    let investTotal = 0;
    let accumulatedProfit = 0;
    let hasProfit = false;
    for (const key of keys) {
      const holding = summary
        ? summary.marketValueByCategory[key]
        : record.investBreakdown?.[key] ?? 0;
      const profit = summary
        ? (record.investPositionItems?.[key]?.length ?? 0) > 0
          ? summary.holdingProfitByCategory[key] + summary.historicalProfitByCategory[key]
          : null
        : getCategoryProfit(record, key);
      if (!Number.isFinite(holding) || holding < 0) return [];
      // 有持仓却缺少收益时跳过该月，避免把未知收益当作零收益。
      if (profit === null) {
        if (holding > 0) return [];
        continue;
      }
      if (!Number.isFinite(profit)) return [];
      investTotal += holding;
      accumulatedProfit += profit;
      hasProfit = true;
    }
    return hasProfit ? [{ ...record, investTotal, accumulatedProfit }] : [];
  });
  return getAverageAnnualizedRate(groupRecords);
}

export interface CategoryCumulativeRateSummary {
  rate: number;
  startYearMonth: string;
  monthCount: number;
}

// 某品类累计收益率 = 各有效月份（本月收益 ÷ 本月持仓）的加总。
export function getCategoryCumulativeRateSummary(
  records: MonthlyRecord[],
  key: InvestKey,
): CategoryCumulativeRateSummary | null {
  const recordsByMonth = new Map<string, MonthlyRecord>();
  for (const record of records) recordsByMonth.set(record.yearMonth, record);

  let cumulativeRate = 0;
  let validMonthCount = 0;
  let startYearMonth = '';
  const sortedRecords = [...recordsByMonth.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  for (const record of sortedRecords) {
    const previousRecord = recordsByMonth.get(previousYearMonth(record.yearMonth));
    if (!previousRecord) continue;

    const currentProfit = getCategoryProfit(record, key);
    const previousProfit = getCategoryProfit(previousRecord, key);
    const currentHolding = Number(record.investBreakdown?.[key]);
    if (
      currentProfit === null
      || previousProfit === null
      || !Number.isFinite(currentHolding)
      || currentHolding <= 0
    ) continue;

    cumulativeRate += (currentProfit - previousProfit) / currentHolding;
    if (validMonthCount === 0) startYearMonth = record.yearMonth;
    validMonthCount += 1;
  }

  return validMonthCount > 0
    ? { rate: cumulativeRate, startYearMonth, monthCount: validMonthCount }
    : null;
}
