import { describe, expect, it } from 'vitest';
import { restoreMonthlyInvestmentState } from './_restoreMonthlyInvestment';

describe('restoreMonthlyInvestmentState', () => {
  it('只恢复指定月份的理财字段，并保留同期账单与其他月份', () => {
    const current = {
      records: [
        {
          yearMonth: '2026-09',
          income: 900,
          investTotal: 90,
        },
        {
          yearMonth: '2026-08',
          income: 800,
          totalExpense: 600,
          investTotal: 1,
          investBreakdown: { us: 1 },
          investmentTransactions: [{ id: 'lost' }],
        },
      ],
    };
    const backup = {
      records: [{
        yearMonth: '2026-08',
        income: 700,
        totalExpense: 500,
        investTotal: 30,
        investBreakdown: { us: 10, gold: 20 },
        investBreakdownPastProfit: { us: 2 },
        investPositionItems: { us: [{ id: 'restored' }] },
      }],
    };

    const result = restoreMonthlyInvestmentState(current, backup, '2026-08');

    expect(result.restored).toBe(true);
    expect(result.state).toEqual({
      records: [
        current.records[0],
        {
          yearMonth: '2026-08',
          income: 800,
          totalExpense: 600,
          investTotal: 30,
          investBreakdown: { us: 10, gold: 20 },
          investBreakdownPastProfit: { us: 2 },
          investPositionItems: { us: [{ id: 'restored' }] },
          investmentCategoryRepairVersion: 2,
        },
      ],
    });
  });
});
