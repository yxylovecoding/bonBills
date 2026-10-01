import { describe, expect, it } from 'vitest';
import type { RebalanceResult } from '../models/types';
import { calcRemainingRecurringInvestments, deductRecurringInvestments } from './recurringInvestment';

const suggestions = (values: Partial<RebalanceResult> = {}): RebalanceResult => ({
  us: 0, eu: 0, asia: 0, a: 0, longBond: 0, usBond: 0, gold: 0, ...values,
});

describe('calcRemainingRecurringInvestments', () => {
  it('从今天到月底含首尾，每个工作日美股和日股各定投20元', () => {
    // 2026年9月24、25、28、29、30日，共5天。
    expect(calcRemainingRecurringInvestments(new Date(2026, 8, 24, 23, 59))).toEqual({ us: 100, asia: 100 });
  });

  it('跳过周末，月底是工作日时仍包含当天', () => {
    expect(calcRemainingRecurringInvestments(new Date(2026, 8, 26))).toEqual({ us: 60, asia: 60 });
    expect(calcRemainingRecurringInvestments(new Date(2026, 8, 30))).toEqual({ us: 20, asia: 20 });
    expect(calcRemainingRecurringInvestments(new Date(2026, 9, 31))).toEqual({ us: 0, asia: 0 });
  });

  it('排除已知节假日，周末调休也不增加基金申购', () => {
    const holidays = { 2026: {
      '2026-09-25': { date: '2026-09-25', isOffDay: true },
      '2026-09-26': { date: '2026-09-26', isOffDay: false },
    } };
    expect(calcRemainingRecurringInvestments(new Date(2026, 8, 24), holidays)).toEqual({ us: 80, asia: 80 });
  });

  it('二月和跨年月底不计入下一月', () => {
    expect(calcRemainingRecurringInvestments(new Date(2024, 1, 28))).toEqual({ us: 40, asia: 40 });
    expect(calcRemainingRecurringInvestments(new Date(2026, 11, 31))).toEqual({ us: 20, asia: 20 });
  });
});

describe('deductRecurringInvestments', () => {
  it('原需加40美元、汇率7、定投210元后只需加10美元', () => {
    const before = suggestions({ us: 280, asia: 350, usBond: 140, eu: 70 });
    const after = deductRecurringInvestments(before, { us: 210, asia: 210 });
    expect(after).toEqual(suggestions({ us: 70, asia: 140, usBond: 140, eu: 70 }));
    expect(after.us / 7).toBe(10);
    expect(before.us).toBe(280);
  });

  it('美股定投留在人民币侧，减少美元购买需求且总投入守恒', () => {
    const before = suggestions({ us: 280, asia: 350, usBond: 140, eu: 70 });
    const after = deductRecurringInvestments(before, { us: 210, asia: 210 });
    const usdNeedBefore = (before.us + before.usBond) / 7;
    const usdNeedAfter = (after.us + after.usBond) / 7;
    const cnyNeedAfter = after.asia + after.eu + 420;
    expect(usdNeedBefore).toBe(60);
    expect(usdNeedAfter).toBe(30);
    expect(cnyNeedAfter).toBe(630);
    expect(cnyNeedAfter + usdNeedAfter * 7).toBe(840);
  });

  it('定投超过品类需加时不产生赎回，并保留长债补足额度', () => {
    const after = deductRecurringInvestments(
      suggestions({ us: 100, asia: 300, eu: 300, longBond: 200 }),
      { us: 200, asia: 200 },
    );
    expect(after).toEqual(suggestions({ us: 0, asia: 75, eu: 225, longBond: 200 }));
    expect(Object.values(after).reduce((sum, amount) => sum + amount, 400)).toBe(900);
  });

  it('定投覆盖全部投入时不再建议手动加仓', () => {
    const after = deductRecurringInvestments(suggestions({ us: 10, asia: 20, longBond: 20 }), { us: 100, asia: 100 });
    expect(after).toEqual(suggestions());
    expect(deductRecurringInvestments(suggestions(), { us: 100, asia: 100 })).toEqual(suggestions());
  });

  it('保留原有赎回建议，零定投时保留全部建议', () => {
    const before = suggestions({ us: -70, asia: 300, eu: 350 });
    const after = deductRecurringInvestments(before, { us: 100, asia: 100 });
    expect(after.us).toBe(-70);
    expect(after.asia + after.eu).toBeCloseTo(450);
    expect(deductRecurringInvestments(before, { us: 0, asia: 0 })).toEqual(before);
  });
});
