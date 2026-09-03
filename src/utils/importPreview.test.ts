import { beforeEach, describe, expect, it } from 'vitest';
import type { MonthlyRecord } from '../models/types';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { DEFAULT_SNAPSHOT, useSnapshotStore } from '../stores/snapshotStore';
import { confirmFinanceImport, prepareFinanceImport } from './importPreview';

function monthlyRecord(): MonthlyRecord {
  return {
    yearMonth: '2026-09',
    income: 100,
    totalExpense: 50,
    accumulatedProfit: 10,
    investTotal: 500,
    investmentTransactions: [{
      id: 'existing-trade',
      date: '2026-09-01',
      side: 'buy',
      name: 'TLT',
      symbol: 'TLT',
      groupKey: 'usBond',
      shares: 1,
      price: 90,
      fee: 0,
      currency: 'USD',
    }],
    volatileLife: 10,
    periodicLife: 20,
    consumption: 15,
    school: 5,
    homeDays: 0,
    travelDays: 0,
  };
}

describe('财务导入预览', () => {
  beforeEach(() => {
    useMonthlyStore.setState({ records: [monthlyRecord()] });
    useBillDetailStore.setState({
      tagStats: {},
      aggregates: {},
      expenseItems: {},
      incomeItems: {},
      hasOverride: false,
    });
    useSnapshotStore.setState({
      current: structuredClone(DEFAULT_SNAPSHOT),
      history: [],
    });
    useSnapshotStore.getState().updateAccounts({ livingBank: 100 });
  });

  it('生成预览时已保留全量账单，确认前不改账户和理财', async () => {
    const draft = await prepareFinanceImport(async () => {
      const nextRecord: MonthlyRecord = {
        ...monthlyRecord(),
        income: 300,
        totalExpense: 200,
        periodicLife: 80,
        investTotal: 900,
        investmentTransactions: [
          ...(monthlyRecord().investmentTransactions ?? []),
          {
            id: 'new-trade',
            date: '2026-09-03',
            side: 'buy',
            name: '标普',
            symbol: 'SPY',
            groupKey: 'us',
            shares: 1,
            price: 100,
            fee: 0,
            currency: 'USD',
          },
        ],
      };
      useMonthlyStore.setState({ records: [nextRecord] });
      useBillDetailStore.setState({
        tagStats: {},
        aggregates: {
          '2026-09': {
            income: 300,
            totalExpense: 200,
            periodicLife: 80,
            volatileLife: 10,
            consumption: 15,
            school: 5,
          },
        },
        expenseItems: {
          '2026-09': [{
            date: '2026-09-03', category: '日用', subcategory: '洗漱', amount: 150,
            account: '建设银行', tags: '周期生活', note: '',
          }],
        },
        incomeItems: {},
        hasOverride: true,
      });
      useSnapshotStore.getState().updateAccounts({ livingBank: 80 });
      return {
        title: '导入预览',
        lines: [],
        investmentMonths: ['2026-09'],
        billMonths: ['2026-09'],
        successMessage: '已导入',
        changesOnly: true,
      };
    });

    const previewState = useMonthlyStore.getState().records[0];
    expect(previewState).toMatchObject({ income: 300, totalExpense: 200, periodicLife: 80, investTotal: 500 });
    expect(previewState.investmentTransactions?.map((item) => item.id)).toEqual(['existing-trade']);
    expect(useBillDetailStore.getState().expenseItems['2026-09']).toHaveLength(1);
    expect(useSnapshotStore.getState().current.accounts.livingBank).toBe(100);

    await confirmFinanceImport(draft);
    expect(useMonthlyStore.getState().records[0].investTotal).toBe(900);
    expect(useMonthlyStore.getState().records[0].investmentTransactions?.map((item) => item.id))
      .toEqual(['existing-trade', 'new-trade']);
    expect(useSnapshotStore.getState().current.accounts.livingBank).toBe(80);
  });
});
