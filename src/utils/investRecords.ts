import type { InvestKey, MonthlyRecord } from '../models/types';

export interface InvestTotalForRate {
  value: number;
  estimated: boolean;
  beforeMonth?: string;
  afterMonth?: string;
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
    if (record.isBaseline) continue;
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
