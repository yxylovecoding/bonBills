import { describe, expect, it } from 'vitest';
import type { MonthlyRecord } from '../models/types';
import { getAverageAnnualizedRate, getYearInvestmentReturn } from './investRecords';

function record(yearMonth: string, investTotal: number, accumulatedProfit: number): MonthlyRecord {
  return {
    yearMonth, investTotal, accumulatedProfit,
    income: 0, totalExpense: 0, volatileLife: 0, periodicLife: 0,
    consumption: 0, school: 0, homeDays: 0, travelDays: 0,
  };
}

describe('今年理财收益率', () => {
  it('收益金额为负时，不再被小资金月份的正收益率平均成正年化', () => {
    const records = [
      record('2025-12', 10000, 500),
      record('2026-01', 10100, 600),
      record('2026-02', 99600, 100),
    ];
    // 二月净追加 9 万，按月中投入，在今年已过的 59 天中参与 14 天。
    const result = getYearInvestmentReturn(records, '2026-02-28');
    const capital = 10000 + 90000 * 14 / 59;
    expect(getAverageAnnualizedRate(records)).toBeGreaterThan(0);
    expect(result?.income).toBe(-400);
    expect(result?.weightedCapital).toBeCloseTo(capital, 8);
    expect(result?.rate).toBeCloseTo(-400 / capital, 10);
    expect(result?.annualizedRate).toBeCloseTo(-400 / capital / 59 * 365, 10);
  });

  it('没有资金进出时以年初市值为分母，扣除以前年度的累计收益', () => {
    const result = getYearInvestmentReturn([
      record('2025-12', 10000, 2000),
      record('2026-01', 10100, 2100),
      record('2026-02', 10300, 2300),
    ], '2026-02-28');
    expect(result).toMatchObject({ income: 300, weightedCapital: 10000, rate: 0.03 });
    expect(result?.annualizedRate).toBeCloseTo(0.03 / 59 * 365, 10);
  });

  it('取出资金按参与时长减少分母，清仓后仍可计算已实现收益', () => {
    const result = getYearInvestmentReturn([
      record('2025-12', 20000, 7000),
      record('2026-01', 0, 6500),
    ], '2026-01-31');
    // 亏损 500 后取出剩余的 19500，月中取出后平均占用 10250。
    expect(result?.income).toBe(-500);
    expect(result?.weightedCapital).toBe(10250);
    expect(result?.annualizedRate).toBeCloseTo(-500 / 10250 / 31 * 365, 10);
  });

  it('当前月只按截至今天的观测区间估算净投入时间', () => {
    const result = getYearInvestmentReturn([
      record('2025-12', 10000, 500),
      record('2026-01', 10100, 600),
      record('2026-02', 99600, 100),
    ], '2026-02-10');
    // 二月只过了 10 天，追加资金估算参与 5 天，而非按未来的整月月中计算。
    const capital = 10000 + 90000 * 5 / 41;
    expect(result?.weightedCapital).toBeCloseTo(capital, 8);
    expect(result?.annualizedRate).toBeCloseTo(-400 / capital / 41 * 365, 10);
  });

  it.each([
    ['2026', '02-28', 59, 365],
    ['2024', '02-29', 60, 366],
  ] as const)('按 %s 年的实际天数简单年化', (year, end, elapsedDays, yearDays) => {
    const result = getYearInvestmentReturn([
      record(`${Number(year) - 1}-12`, 10000, 0),
      record(`${year}-01`, 10000, 0),
      record(`${year}-02`, 10100, 100),
    ], `${year}-${end}`);
    expect(result?.rate).toBe(0.01);
    expect(result?.annualizedRate).toBeCloseTo(0.01 / elapsedDays * yearDays, 10);
  });

  it('元旦计为一天，不发生除零', () => {
    const result = getYearInvestmentReturn([
      record('2025-12', 10000, 0),
      record('2026-01', 10001, 1),
    ], '2026-01-01');
    expect(result?.annualizedRate).toBeCloseTo(0.0365, 10);
  });

  it('完整年度的年化等于今年收益率，不受记录顺序和未来年份影响', () => {
    const records = [record('2023-12', 10000, 500), ...Array.from({ length: 12 }, (_, index) =>
      record(`2024-${String(index + 1).padStart(2, '0')}`, 10100 + index * 100, 600 + index * 100)),
    record('2025-01', 900000, 800000)];
    const result = getYearInvestmentReturn(records.reverse(), '2024-12-31');
    expect(result).toMatchObject({ income: 1200, weightedCapital: 10000, rate: 0.12 });
    expect(result?.annualizedRate).toBeCloseTo(0.12, 10);
  });

  it('不把今年未来月份的记录计入收益或资金', () => {
    const result = getYearInvestmentReturn([
      record('2025-12', 10000, 0),
      record('2026-01', 10100, 100),
      record('2026-02', 900000, 800000),
    ], '2026-01-31');
    expect(result).toMatchObject({ income: 100, weightedCapital: 10000, rate: 0.01 });
  });

  it('年初余额为零但年内追加资金时仍能计算', () => {
    const result = getYearInvestmentReturn([
      record('2025-12', 0, 0),
      record('2026-01', 10200, 200),
    ], '2026-01-31');
    expect(result).toMatchObject({ income: 200, weightedCapital: 5000, rate: 0.04 });
  });

  it('缺少年初、期间或当前月份时不猜测资金投入', () => {
    const records = [
      record('2025-12', 10000, 0),
      record('2026-01', 10100, 100),
      record('2026-02', 10200, 200),
    ];
    for (const missing of records) {
      expect(getYearInvestmentReturn(records.filter((item) => item !== missing), '2026-02-28')).toBeNull();
    }
  });

  it('资金分母非正或数据不完整时不展示误导收益率', () => {
    expect(getYearInvestmentReturn([
      record('2025-12', 0, 0), record('2026-01', 0, 0),
    ], '2026-01-31')).toBeNull();
    expect(getYearInvestmentReturn([
      record('2025-12', 100, 0), record('2026-01', 0, 1000),
    ], '2026-01-31')).toBeNull();
    for (const invalid of [-1, NaN, Infinity]) {
      expect(getYearInvestmentReturn([
        record('2025-12', 10000, 0), record('2026-01', invalid, 100),
      ], '2026-01-31')).toBeNull();
    }
    expect(getYearInvestmentReturn([
      record('2025-12', 10000, NaN), record('2026-01', 10100, 100),
    ], '2026-01-31')).toBeNull();
  });

  it.each(['2026-02-29', '2026-13-01', '2026-01-00', '2026-1-1', ''])('拒绝无效日期 %s', (date) => {
    expect(getYearInvestmentReturn([], date)).toBeNull();
  });
});
