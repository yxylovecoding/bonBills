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
