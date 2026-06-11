import type { InvestKey, InvestPastProfit, MonthlyRecord } from '../models/types';

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

export function getPastProfitTotal(
  pastProfits: InvestPastProfit[],
  key: InvestKey,
  yearMonth?: string,
) {
  return pastProfits
    .filter((item) => item.investKey === key && (!yearMonth || !item.effectiveFrom || item.effectiveFrom <= yearMonth))
    .reduce((sum, item) => sum + item.amount, 0);
}

export function getTotalInvestProfit(
  record: MonthlyRecord | undefined,
  key: InvestKey,
  pastProfits: InvestPastProfit[],
  yearMonth = record?.yearMonth,
) {
  const raw = record?.investBreakdownProfit?.[key];
  const pastTotal = getPastProfitTotal(pastProfits, key, yearMonth);
  if ((raw === undefined || raw === null) && pastTotal === 0) return null;
  return (raw ?? 0) + pastTotal;
}
