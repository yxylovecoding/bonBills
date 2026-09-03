import { describe, expect, it } from 'vitest';
import { mergeRecoveredMonthlyInvestmentState, restoreMonthlyInvestmentState } from './_restoreMonthlyInvestment';

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

describe('mergeRecoveredMonthlyInvestmentState', () => {
  it('用恢复前的后续明细替换旧汇总，并保留备份中没有丢失的品类', () => {
    const current = {
      records: [{
        yearMonth: '2026-08',
        income: 123,
        investTotal: 17661,
        investBreakdown: { us: 9825, a: 520, gold: 7315 },
        investBreakdownProfit: { us: 337, a: 23, gold: 1678 },
        investPositionItems: {
          us: [{ id: 'legacy-us', name: '原美股汇总', symbol: '', marketValueCny: 9825 }],
          a: [{ id: 'a-fund', name: '红利低波A', symbol: '008163', marketValueCny: 520 }],
          gold: [{ id: 'gold-fund', name: '博时黄金ETF联接C', symbol: '002611', marketValueCny: 7315 }],
        },
        investmentTransactions: [{ id: 'old-trade' }],
        importedInvestmentTransactionIds: ['old-trade'],
        lastInvestmentMailUid: 100,
        investmentEditedAt: '2026-09-01T00:00:00.000Z',
      }],
    };
    const recovery = {
      records: [{
        yearMonth: '2026-08',
        investBreakdown: { us: 9830, a: 1117, gold: 7620 },
        investBreakdownProfit: { us: 340, a: 30, gold: 1685 },
        investPositionItems: {
          us: [
            { id: 'spy', name: '标普500', symbol: 'SPY', marketValueCny: 6000 },
            { id: 'qqq', name: '纳指100', symbol: 'QQQ', marketValueCny: 3830 },
          ],
          a: [{ id: 'a-fund', name: '红利低波A', symbol: '008163', marketValueCny: 1117 }],
          gold: [
            { id: 'gold-fund', name: '博时黄金ETF联接C', symbol: '002611', marketValueCny: 7315 },
            { id: 'gold-buy', name: '黄金加仓', symbol: '518880', marketValueCny: 305 },
          ],
        },
        investmentTransactions: [{ id: 'late-a-trade' }, { id: 'late-gold-trade' }],
        importedInvestmentTransactionIds: ['late-a-trade', 'late-gold-trade'],
        lastInvestmentMailUid: 120,
        investmentEditedAt: '2026-09-03T05:13:00.000Z',
      }],
    };

    const result = mergeRecoveredMonthlyInvestmentState(current, recovery, '2026-08');
    const record = (result.state as typeof current).records[0];

    expect(result.merged).toBe(true);
    expect(result.selectedRecoveryGroups).toEqual(['us', 'a', 'gold']);
    expect(record.income).toBe(123);
    expect(record.investPositionItems.us.map((item) => item.name)).toEqual(['标普500', '纳指100']);
    expect(record.investPositionItems.a[0].marketValueCny).toBe(1117);
    expect(record.investPositionItems.gold).toHaveLength(2);
    expect(record.investBreakdown).toEqual({ us: 9830, a: 1117, gold: 7620 });
    expect(record.investTotal).toBe(18567);
    expect(record.investmentTransactions.map((item) => item.id)).toEqual(['old-trade', 'late-a-trade', 'late-gold-trade']);
    expect(record.importedInvestmentTransactionIds).toEqual(['old-trade', 'late-a-trade', 'late-gold-trade']);
    expect(record.lastInvestmentMailUid).toBe(120);
    expect(record.investmentEditedAt).toBe('2026-09-03T05:13:00.000Z');
  });

  it('恢复前快照没有目标月份时不修改', () => {
    const current = { records: [{ yearMonth: '2026-08' }] };
    expect(mergeRecoveredMonthlyInvestmentState(current, { records: [] }, '2026-08')).toEqual({
      merged: false,
      state: current,
    });
  });
});
