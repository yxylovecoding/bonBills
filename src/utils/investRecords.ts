import type { InvestKey, InvestProfitStatus, MonthlyRecord } from '../models/types';

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

export function isProfitStatusPartial(
  status: Partial<Record<InvestKey, InvestProfitStatus>> | undefined,
  key: InvestKey,
) {
  return status?.[key] === 'partial';
}

export function isInvestProfitPartial(record: MonthlyRecord | undefined, key: InvestKey) {
  return isProfitStatusPartial(record?.investBreakdownProfitStatus, key);
}
