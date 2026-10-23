import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlipayActualSnapshot } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { calculateInvestPositionMetric, syncInvestPositionItems } from './investPositionItems';
import { emptyMonthlyRecord } from './investmentRollover';
import { importAlipaySnapshotToLedger } from './alipayLedgerImport';
import { fundConfirmationKey, projectAlipayHoldings } from './alipayHoldings';

vi.mock('./syncEngine', () => ({ runWithSyncPaused: async (run: () => Promise<unknown>) => run(), triggerUpload: vi.fn(async () => {}) }));
const code = '017641';
const date = '2026-09-15';
const load = async () => ({ holidays: { 2026: {} }, quotes: { holdings: {}, orders: {} } });
const snapshot = (): AlipayActualSnapshot => ({ date,
  funds: [{ code, name: '标普500', shares: 100, costPrice: 1.5, nav: 2, navDate: '2026-09-14', totalAmount: 220, holdingProfit: 50, amountKind: 'total', confirmedAmount: 200, pendingBuyAmount: 20 }],
  orders: [{ id: 'pending-1', code, operationAt: '2026-09-14T10:00:00', quantity: 20, unit: 'CNY', side: 'buy', status: 'pending', nav: 2 }],
});
const current = () => useMonthlyStore.getState().records.find((record) => record.yearMonth === '2026-09')!;
const item = () => current().investPositionItems!.us![0];
beforeEach(() => {
  useConfigStore.getState().setConfig({ alipayActualSnapshots: {} });
  useMonthlyStore.setState({ records: [syncInvestPositionItems(emptyMonthlyRecord('2026-09'), {
    us: [{ id: 'fund', name: '标普500', symbol: code, quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY', status: 'active', shares: 999, costPrice: 3,
      lastPrice: 2, lastCurrency: 'CNY', lastFxRateToCny: 1, historicalProfitCny: 7, historicalProfitCurrency: 'CNY', profitInputMode: 'historical' }],
    gold: [{ id: 'gold', name: '其他持仓', symbol: 'GLD', quoteSource: 'yahoo', status: 'active', shares: 2, costPrice: 100, lastPrice: 110, historicalProfitCny: 0 }],
  })] });
});

describe('支付宝导入写入共享账本', () => {
  it('导入后两种模式读取同一持仓，只有确认时间造成份额差异', async () => {
    const source = snapshot();
    const other = structuredClone(current().investPositionItems!.gold);
    const result = await importAlipaySnapshotToLedger(source, 'null', load);
    expect(result.updated).toBe(1);
    expect(result.unresolved).toEqual([]);
    expect(item().shares).toBe(110);
    expect(current().investPositionItems!.gold).toEqual(other);
    expect(useConfigStore.getState().config.alipayActualSnapshots?.[date]).toEqual(source);
    const options = { asOf: date, records: useMonthlyStore.getState().records, holidays: { 2026: {} }, metadata: { [fundConfirmationKey(code)]: { name: '标普500', type: 'QDII' } } };
    expect(projectAlipayHoldings(current().investPositionItems!, options).items.us![0].shares).toBe(100);
    expect(projectAlipayHoldings(current().investPositionItems!, { ...options, asOf: '2026-09-16' }).items.us![0].shares).toBe(110);
  });

  it('再次导入相同实录不累计买入，后续账本编辑不被历史实录覆盖', async () => {
    const source = snapshot();
    await importAlipaySnapshotToLedger(source, 'null', load);
    await importAlipaySnapshotToLedger(source, JSON.stringify(useConfigStore.getState().config.alipayActualSnapshots?.[date]), load);
    expect(item().shares).toBe(110);
    expect(current().investmentTransactions).toHaveLength(1);
    const items = structuredClone(current().investPositionItems!);
    items.us![0].shares = 115;
    useMonthlyStore.getState().upsert(syncInvestPositionItems(current(), items), { investmentSource: 'manual' });
    const view = projectAlipayHoldings(current().investPositionItems!, { asOf: date, records: useMonthlyStore.getState().records,
      holidays: { 2026: {} }, metadata: { [fundConfirmationKey(code)]: { name: '标普500', type: 'QDII' } } });
    expect(view.items.us![0].shares).toBe(105);
    expect(item().shares).toBe(115);
    expect(useConfigStore.getState().config.alipayActualSnapshots?.[date]).toEqual(source);
  });

  it('查询期间账本被编辑时拒绝覆盖新修改', async () => {
    const source = snapshot();
    await expect(importAlipaySnapshotToLedger(source, 'null', async () => {
      const items = structuredClone(current().investPositionItems!); items.us![0].shares = 888;
      useMonthlyStore.getState().upsert(syncInvestPositionItems(current(), items), { investmentSource: 'manual' });
      return load();
    })).rejects.toThrow('持仓已更新');
    expect(item().shares).toBe(888);
    expect(useConfigStore.getState().config.alipayActualSnapshots?.[date]).toBeUndefined();
  });

  it('基金匹配不唯一时保存导入记录并报告原因，保留现有账本', async () => {
    const source = snapshot(); source.funds[0].code = '123456'; source.orders[0].code = '123456';
    const before = structuredClone(useMonthlyStore.getState().records);
    const result = await importAlipaySnapshotToLedger(source, 'null', load);
    expect(result.updated).toBe(0);
    expect(result.unresolved[0].reason).toContain('未唯一匹配');
    expect(useMonthlyStore.getState().records).toEqual(before);
    expect(useConfigStore.getState().config.alipayActualSnapshots?.[date]).toEqual(source);
  });
});


describe('截图完整持仓更新', () => {
  it('明确份额和成本写回共享持仓，新截图报价覆盖旧缓存', async () => {
    const source: AlipayActualSnapshot = { date, funds: [{ code, name: '标普500', shares: 80, costPrice: 2.25,
      totalAmount: 200, holdingProfit: 20, amountKind: 'confirmed', nav: 2.5, navDate: '2026-09-15' }], orders: [] };
    await importAlipaySnapshotToLedger(source, 'null', load);
    expect(item()).toMatchObject({ shares: 80, costPrice: 2.25, lastPrice: 2.5, quoteAt: date, marketValueCny: 200, holdingProfitCny: 20 });
    const view = projectAlipayHoldings(current().investPositionItems!, { asOf: date, records: useMonthlyStore.getState().records, holidays: { 2026: {} }, metadata: {} });
    expect(calculateInvestPositionMetric(view.items.us![0])).toMatchObject({ marketValueCny: 200, holdingProfitCny: 20 });
  });

  it('仅有金额收益时使用对应日期净值推算份额与成本', async () => {
    const source: AlipayActualSnapshot = { date, funds: [{ code, name: '标普500', totalAmount: 200, holdingProfit: 20, amountKind: 'confirmed' }], orders: [] };
    await importAlipaySnapshotToLedger(source, 'null', async () => ({ holidays: {}, quotes: { holdings: { [code]: { code, date, nav: 2.5 } }, orders: {} } }));
    expect(item()).toMatchObject({ shares: 80, costPrice: 2.25, marketValueCny: 200, holdingProfitCny: 20 });
  });

  it('没有截图净值时以截图金额与真实份额更新报价', async () => {
    const source: AlipayActualSnapshot = { date, funds: [{ code, name: '标普500', shares: 80, costPrice: 2.25,
      totalAmount: 200, holdingProfit: 20, amountKind: 'confirmed' }], orders: [] };
    await importAlipaySnapshotToLedger(source, 'null', load);
    expect(item()).toMatchObject({ shares: 80, costPrice: 2.25, lastPrice: 2.5, marketValueCny: 200, holdingProfitCny: 20 });
  });

  it('同日追加截图不重放其他基金的旧实录覆盖后续编辑', async () => {
    const source = snapshot();
    await importAlipaySnapshotToLedger(source, 'null', load);
    const items = structuredClone(current().investPositionItems!); items.us![0].shares = 115;
    items.us!.push({ ...items.us![0], id: 'second', symbol: '123456', shares: 999, pendingBuys: [], alipayCorrection: undefined });
    useMonthlyStore.getState().upsert(syncInvestPositionItems(current(), items), { investmentSource: 'manual' });
    const edited = structuredClone(item());
    source.funds.push({ code: '123456', name: '另一只基金', totalAmount: 200, holdingProfit: 20, shares: 80, costPrice: 2.25, nav: 2.5, navDate: date, amountKind: 'confirmed' });
    const result = await importAlipaySnapshotToLedger(source, JSON.stringify(useConfigStore.getState().config.alipayActualSnapshots?.[date]), load, ['123456']);
    expect(result.updated).toBe(1);
    expect(item()).toEqual(edited);
    expect(current().investPositionItems!.us![1]).toMatchObject({ shares: 80, costPrice: 2.25, marketValueCny: 200, holdingProfitCny: 20 });
    expect(useConfigStore.getState().config.alipayActualSnapshots?.[date].funds).toHaveLength(2);
  });
});
