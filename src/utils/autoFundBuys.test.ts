import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { InvestmentTransactionRecord, MonthlyRecord, PendingInvestmentBuy } from '../models/types';
import { normalizeMonthlyRecords, useMonthlyStore } from '../stores/monthlyStore';
import { bookPendingFundBuy, reconcileAutoFundBuy } from './autoFundBuys';
import { applyInvestmentTransaction, createInvestmentRolloverRecord, emptyMonthlyRecord, pendingInvestmentAmounts } from './investmentRollover';
import { syncInvestPositionItems, summarizeInvestPositionItems } from './investPositionItems';
import { importInvestmentFileIntoStores, parseInvestmentFileDetails } from './importInvestments';
import { confirmFinanceImport, diffInvestmentOperations, prepareFinanceImport } from './importPreview';
import { inferInvestmentProfitFromBaseline } from './investTransactionProfit';

function pending(id = 'order-1', date = '2026-09-17'): PendingInvestmentBuy {
  return {
    id, orderId: id, matchKey: `order:${id}`, baseMatchKey: `${date}T09:18:00|中国银行1721|symbol:017641`,
    operationAt: `${date}T09:18:00`, amount: 10, currency: 'CNY', account: '中国银行1721',
    symbol: '017641', name: '摩根标普500指数A', groupKey: 'us',
  };
}
function baseRecord(): MonthlyRecord {
  return syncInvestPositionItems({
    ...emptyMonthlyRecord('2026-09'), investmentEditedAt: '2026-09-20T00:00:00+08:00', investmentCategoryRepairVersion: 2,
  }, { us: [{
    id: 'fund', name: '摩根标普A', symbol: '017641', quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY',
    status: 'active', shares: 10, costPrice: 1.5, historicalProfitCny: 0, profitInputMode: 'historical',
    lastPrice: 2, lastCurrency: 'CNY', lastFxRateToCny: 1, pendingBuys: [pending()],
  }] });
}
const estimate = { navDate: '2026-09-17', price: 2, shares: 5, beforeFee: true };
const fund = (record: MonthlyRecord) => record.investPositionItems!.us![0];
const current = () => useMonthlyStore.getState().records.find((record) => record.yearMonth === '2026-09')!;
function actual(id = 'order-1', shares = 4.9): InvestmentTransactionRecord {
  const order = pending(id);
  return {
    id: `mail:${id}`, date: '2026-09-18', confirmationAt: '2026-09-18T10:00:00', operationAt: order.operationAt,
    side: 'buy', symbol: order.symbol, name: order.name, orderId: id, account: order.account, groupKey: 'us',
    shares, price: 2, amount: 10, fee: Math.round((10 - shares * 2) * 100) / 100, currency: 'CNY', quoteSource: 'eastmoney-fund',
    pendingMatchKey: order.matchKey, pendingBaseMatchKey: order.baseMatchKey,
  };
}
function statement(status = '交易成功', orderId = 'order-1', shares: number | string = 4.9, date = '2026-09-18') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['流水号', '操作日期', '确认日期', '类型', '基金名称', '基金代码', '总金额', '份额', '单位净值', '手续费', '交易账户', '状态'],
    [orderId, '2026-09-17 09:18', date, '买入', '摩根标普500指数A', '017641', 10, shares, 2, 0.2, '中国银行1721', status],
  ]), '理财');
  return new File([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], '理财.xlsx');
}

beforeEach(() => { localStorage.clear(); useMonthlyStore.setState({ records: [] }); });

describe('基金自动入账与账单校对', () => {
  it('净值确定后立即计入份额和成本，刷新不重复入账，也不再计为在途金额', () => {
    const before = baseRecord();
    const booked = bookPendingFundBuy(before, 'order-1', estimate);
    expect(fund(booked)).toMatchObject({ shares: 15, costPrice: 1.6667 });
    expect(booked.investTotal).toBe(30);
    expect(fund(booked).pendingBuys?.[0].booking).toMatchObject({ shares: 5, price: 2, beforeFee: true });
    expect(pendingInvestmentAmounts(booked.investPositionItems, 7).us).toBe(0);
    expect(booked.investmentEditedAt).toBe(before.investmentEditedAt);
    const reloaded = normalizeMonthlyRecords(JSON.parse(JSON.stringify([booked])))[0];
    expect(bookPendingFundBuy(reloaded, 'order-1', estimate)).toBe(reloaded);
    expect(fund(before).shares).toBe(10);
  });

  it('实际账单以同一交易校正净值份额手续费，重复导入和旧待确认账单不再增加份额', async () => {
    useMonthlyStore.setState({ records: [bookPendingFundBuy(baseRecord(), 'order-1', estimate)] });
    const result = await importInvestmentFileIntoStores(statement());
    expect(result.reconciledTransactions).toBe(1);
    expect(result.eligibleTransactions).toBe(0);
    expect(result.formalImportedTransactions).toBe(0);
    expect(fund(current())).toMatchObject({ shares: 14.9, costPrice: 1.6779 });
    expect(fund(current()).pendingBuys).toBeUndefined();
    expect(current().investmentTransactions).toHaveLength(1);
    expect(current().investmentTransactions?.[0]).toMatchObject({
      id: 'auto-invest:order-1', shares: 4.9, price: 2, fee: 0.2, amount: 10, autoBuy: { status: 'reconciled' },
    });
    const once = structuredClone(current());
    await importInvestmentFileIntoStores(statement());
    await importInvestmentFileIntoStores(statement('待确认', 'order-1', ''));
    expect(current()).toEqual(once);
  });

  it('无流水号时用操作时间、基金和账户匹配，新账单提供流水号仍可校对', async () => {
    const parsed = await parseInvestmentFileDetails(statement('待确认', '', ''));
    const record = baseRecord();
    fund(record).pendingBuys = parsed.pendingBuys;
    useMonthlyStore.setState({ records: [bookPendingFundBuy(record, parsed.pendingBuys[0].id, estimate)] });
    await importInvestmentFileIntoStores(statement('交易成功', 'new-bank-order'));
    expect(fund(current()).shares).toBe(14.9);
    expect(current().investmentTransactions).toHaveLength(1);
    expect(fund(current()).pendingBuys).toBeUndefined();
  });

  it('相同时间账户的多笔无流水号订单继续等待，不自动猜测', () => {
    const record = baseRecord();
    const first = { ...pending(), orderId: undefined };
    fund(record).pendingBuys = [first, { ...first, id: 'duplicate' }];
    expect(bookPendingFundBuy(record, first.id, estimate)).toBe(record);
  });

  it('两笔已入账订单先后校对，后面的成本基准跟随修正', () => {
    const record = baseRecord();
    fund(record).pendingBuys!.push(pending('order-2', '2026-09-18'));
    let booked = bookPendingFundBuy(record, 'order-1', estimate);
    booked = bookPendingFundBuy(booked, 'order-2', { ...estimate, navDate: '2026-09-18' });
    const first = reconcileAutoFundBuy([booked], actual()).records;
    const visibleChanges = diffInvestmentOperations([booked], first);
    expect(visibleChanges).toHaveLength(1);
    expect(visibleChanges[0]).toMatchObject({ kind: 'transaction', item: { id: 'auto-invest:order-1' } });
    const second = reconcileAutoFundBuy(first, actual('order-2', 4.8)).records[0];
    expect(fund(second).shares).toBe(19.7);
    expect(fund(second).costPrice).toBeCloseTo(35 / 19.7, 3);
    expect(fund(second).pendingBuys).toBeUndefined();
    expect(second.investmentTransactions).toHaveLength(2);
  });

  it('入账后卖出过，校对同时重算剩余份额与平均成本', () => {
    const record = baseRecord();
    fund(record).shares = 100;
    fund(record).costPrice = 1;
    const booked = bookPendingFundBuy(record, 'order-1', { ...estimate, price: 1, shares: 10 });
    const sell: InvestmentTransactionRecord = { ...actual('sell'), id: 'sell', side: 'sell', shares: 55, price: 2, amount: 110, fee: 0, applicationOrder: 2 };
    applyInvestmentTransaction(booked.investPositionItems!, sell);
    booked.investmentTransactions!.push(sell);
    const result = reconcileAutoFundBuy([booked], { ...actual(), shares: 9, price: 1, fee: 1 }).records[0];
    expect(fund(result).shares).toBe(54);
    expect(fund(result).costPrice).toBeCloseTo(110 / 109, 4);
  });

  it('跨月校对同步已继承的持仓，银行确认日期晚于入账月份也不另加一笔', async () => {
    const september = bookPendingFundBuy(baseRecord(), 'order-1', estimate);
    const october = createInvestmentRolloverRecord(september, '2026-10');
    useMonthlyStore.setState({ records: [october, september] });
    await importInvestmentFileIntoStores(statement('交易成功', 'order-1', 4.9, '2026-10-01'));
    expect(useMonthlyStore.getState().records.map((record) => fund(record).shares)).toEqual([14.9, 14.9]);
    expect(useMonthlyStore.getState().records.flatMap((record) => record.investmentTransactions ?? [])).toHaveLength(1);
    expect(current().investmentTransactions?.[0].confirmationAt).toBe('2026-10-01');
    expect(useMonthlyStore.getState().records[0].investPositionItems?.us?.[0].pendingBuys).toBeUndefined();
  });

  it('迟发净值在本月入账，上月待确认快照保持不变', () => {
    const august = { ...baseRecord(), yearMonth: '2026-08' };
    fund(august).pendingBuys = [pending('late', '2026-08-31')];
    const september = createInvestmentRolloverRecord(august, '2026-09');
    const booked = bookPendingFundBuy(september, 'late', { ...estimate, navDate: '2026-08-31' });
    expect(booked.investmentTransactions?.[0].date).toBe('2026-09-01');
    expect(fund(booked).shares).toBe(15);
    expect(fund(august).shares).toBe(10);
    expect(fund(august).pendingBuys?.[0].booking).toBeUndefined();
  });

  it('父月持仓修正后重放自动入账，后续校对使用更新后的基准', () => {
    const august = { ...baseRecord(), yearMonth: '2026-08' };
    const september = bookPendingFundBuy(createInvestmentRolloverRecord(august, '2026-09'), 'order-1', estimate);
    useMonthlyStore.setState({ records: [september, august] });
    const updated = structuredClone(august);
    fund(updated).shares = 20;
    useMonthlyStore.getState().upsert(updated, { investmentSource: 'import' });
    expect(fund(current()).shares).toBe(25);
    const corrected = reconcileAutoFundBuy(useMonthlyStore.getState().records, actual()).records.find((record) => record.yearMonth === '2026-09')!;
    expect(fund(corrected).shares).toBe(24.9);
    expect(fund(corrected).costPrice).toBeCloseTo(40 / 24.9, 3);
  });

  it('校对跨月手工快照时只改这笔交易的差额，保留其他手工持仓', () => {
    const september = bookPendingFundBuy(baseRecord(), 'order-1', estimate);
    const october = createInvestmentRolloverRecord(september, '2026-10');
    october.investmentRolledOverFrom = undefined;
    fund(october).shares = 115;
    fund(october).costPrice = 1.9;
    const corrected = reconcileAutoFundBuy([october, september], actual()).records.find((record) => record.yearMonth === '2026-10')!;
    expect(fund(corrected).shares).toBe(114.9);
    expect(fund(corrected).costPrice).toBeCloseTo(218.5 / 114.9, 3);
  });

  it('收益使用实际扣款，费用和份额舍入不会多算成本', () => {
    const initial = baseRecord();
    const booked = bookPendingFundBuy(initial, 'order-1', { ...estimate, price: 1.6939, shares: 5.9 });
    const profit = inferInvestmentProfitFromBaseline({ date: '2026-09-16', yearMonth: '2026-09', createdAt: '2026-09-16', positionItems: initial.investPositionItems! },
      booked.investPositionItems!, summarizeInvestPositionItems(booked.investPositionItems!), booked.investmentTransactions!, '2026-09-22');
    expect(profit.totalProfitCny).toBe(6.8);
    expect(profit.mismatchedItems).toEqual([]);
  });

  it('账单校对预览可取消，确认后才替换已入账份额', async () => {
    useMonthlyStore.setState({ records: [bookPendingFundBuy(baseRecord(), 'order-1', estimate)] });
    const draft = await prepareFinanceImport(async () => {
      const result = await importInvestmentFileIntoStores(statement(), { deferUpload: true });
      return { title: '校对预览', lines: [], investmentMonths: result.months, billMonths: [], successMessage: '已校对' };
    });
    expect(fund(current()).shares).toBe(15);
    expect(fund(draft.after.records[0]).shares).toBe(14.9);
    await confirmFinanceImport(draft);
    expect(fund(current()).shares).toBe(14.9);
  });
});
