import type { InvestKey, InvestProfitBackfill, MonthlyRecord } from '../models/types';

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

export function getInvestProfitBackfillTotal(
  backfills: InvestProfitBackfill[],
  key: InvestKey,
) {
  return backfills
    .filter((item) => item.investKey === key)
    .reduce((sum, item) => sum + item.amount, 0);
}

export function getAdjustedInvestProfit(
  record: MonthlyRecord | undefined,
  key: InvestKey,
  backfills: InvestProfitBackfill[],
) {
  const raw = record?.investBreakdownProfit?.[key];
  const backfillTotal = getInvestProfitBackfillTotal(backfills, key);
  if ((raw === undefined || raw === null) && backfillTotal === 0) return null;
  return (raw ?? 0) + backfillTotal;
}
