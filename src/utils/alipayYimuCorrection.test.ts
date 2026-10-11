import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { AlipayActualOrder, AlipayActualSnapshot, InvestmentTransactionRecord, MonthlyRecord } from '../models/types';
import { normalizeMonthlyRecords, useMonthlyStore } from '../stores/monthlyStore';
import { buildAlipayYimuCorrection, applyAlipayYimuCorrection, yimuCorrectionSignature } from './alipayYimuCorrection';
import { bookPendingFundBuy, reconcileAutoFundBuy } from './autoFundBuys';
import { applyInvestmentTransaction, createInvestmentRolloverRecord, emptyMonthlyRecord } from './investmentRollover';
import { syncInvestPositionItems } from './investPositionItems';
import { importInvestmentFileIntoStores } from './importInvestments';
import type { HolidayDataByYear } from './holidays';

const code = '017641';
const now = Date.parse('2026-10-11T12:00:00+08:00');
const holidays: HolidayDataByYear = { 2026: Object.fromEntries(Array.from({ length: 7 }, (_, i) => {
  const date = `2026-10-0${i + 1}`; return [date, { date, isOffDay: true }];
})), 2027: { '2027-01-01': { date: '2027-01-01', isOffDay: true } } };
function base(month = '2026-09') {
  return syncInvestPositionItems({ ...emptyMonthlyRecord(month), investmentCategoryRepairVersion: 2 }, {
    us: [{ id: 'fund', symbol: code, name: '标普测试A', quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY', status: 'active',
      shares: 999, costPrice: 3, lastPrice: 2, lastCurrency: 'CNY', lastFxRateToCny: 1,
      historicalProfitCny: 7, historicalProfitCurrency: 'CNY', profitInputMode: 'historical' }],
    longBond: [{ id: 'other', symbol: 'OTHER', name: '其他资产', quoteSource: 'yahoo', status: 'active', shares: 3, costPrice: 2, lastPrice: 3, historicalProfitCny: 0 }],
  });
}
function order(overrides: Partial<AlipayActualOrder> = {}): AlipayActualOrder {
  return { id: 'shot-1', code, operationAt: '2026-09-14T10:00:00', side: 'buy', quantity: 20, unit: 'CNY', status: 'pending', nav: 2, ...overrides };
}
function shot(date = '2026-09-15', orders = [order()]): AlipayActualSnapshot {
  const pending = orders.filter((o) => o.status === 'pending' && o.side === 'buy').reduce((n, o) => n + o.quantity, 0);
  return { date, funds: [{ code, name: '标普测试A', amountKind: 'total', totalAmount: 200 + pending,
    holdingProfit: 50, confirmedAmount: 200, shares: 100, costPrice: 1.5, nav: 2, navDate: '2026-09-14', pendingBuyAmount: pending }], orders };
}
const fund = (record: MonthlyRecord) => record.investPositionItems!.us![0];
function plan(snapshot = shot(), record = base(), calendar = holidays) {
  return buildAlipayYimuCorrection(snapshot, record.investPositionItems!, [record], calendar);
}
function correct(snapshot = shot(), record = base()) {
  const preview = plan(snapshot, record);
  expect(preview.rows[0].reason).toBeUndefined();
  return applyAlipayYimuCorrection(record, preview, [code], now);
}
function actual(shares = 9.9, operationAt = '2026-09-14T10:00:00'): InvestmentTransactionRecord {
  return { id: 'mail-invest:formal', name: '标普测试A', symbol: code, groupKey: 'us', side: 'buy', date: '2026-09-16',
    operationAt, shares, price: 2, fee: 0.2, amount: 20, currency: 'CNY', quoteSource: 'eastmoney-fund', orderId: 'formal-1' };
}
function statement(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['流水号', '操作日期', '确认日期', '类型', '基金名称', '基金代码', '总金额', '份额', '单位净值', '手续费', '交易账户', '状态'], ...rows,
  ]), '理财');
  return new File([XLSX.write(book, { bookType: 'xlsx', type: 'array' })], '理财.xlsx');
}
const formalRow = ['formal-1', '2026-09-14 10:00:00', '2026-09-16', '买入', '标普测试A', code, 20, 9.9, 2, 0.2, '测试账户', '交易成功'];
const current = () => useMonthlyStore.getState().records.find((r) => r.yearMonth === '2026-09')!;
beforeEach(() => { localStorage.clear(); useMonthlyStore.setState({ records: [] }); });

describe('支付宝矫正一木 T+1', () => {
  it('周一买入周二补入，一木采用原成交净值与含费用成本，实录不变', () => {
    const record = base(), snapshot = shot();
    const original = JSON.stringify({ record, snapshot });
    const preview = plan(snapshot, record);
    expect(preview.rows[0]).toMatchObject({ shares: 110, costPrice: 1.5455, bridgeAmount: 20, deferredAmount: 0, beforeFee: true });
    expect(preview.rows[0].bridges[0]).toMatchObject({ date: '2026-09-15', price: 2, shares: 10, amount: 20, costFromAmount: true });
    const result = applyAlipayYimuCorrection(record, preview, [code], now);
    expect(fund(result)).toMatchObject({ shares: 110, historicalProfitCny: 7 });
    expect(result.investPositionItems!.longBond).toEqual(record.investPositionItems!.longBond);
    expect(JSON.stringify({ record, snapshot })).toBe(original);
  });

  it('周一尚未到 T+1，净值已有也不提前记入；周二只入账一次', () => {
    const result = correct(shot('2026-09-14'));
    expect(fund(result).shares).toBe(100);
    const pending = fund(result).pendingBuys![0];
    expect(pending.notBefore).toBe('2026-09-15');
    const estimate = { navDate: '2026-09-14', shares: 10, price: 2, beforeFee: true };
    expect(bookPendingFundBuy(result, pending.id, estimate, Date.parse('2026-09-14T20:00:00+08:00'))).toBe(result);
    const booked = bookPendingFundBuy(result, pending.id, estimate, now);
    expect(fund(booked).shares).toBe(110);
    expect(booked.investmentTransactions?.[0].date).toBe('2026-09-15');
    expect(bookPendingFundBuy(booked, pending.id, estimate, now)).toBe(booked);
  });

  it.each([
    ['2026-09-14T14:59:59', '2026-09-15'], ['2026-09-14T15:00:00', '2026-09-16'],
    ['2026-09-18T15:00:00', '2026-09-22'], ['2026-09-19T10:00:00', '2026-09-22'],
    ['2026-10-01T15:00:14', '2026-10-09'], ['2026-10-10T10:00:00', '2026-10-13'],
    ['2026-12-31T15:01:00', '2027-01-05'],
  ])('操作时间 %s 对应一木 %s 确认，不把调休周末当交易日', (operationAt, confirmation) => {
    const date = operationAt.slice(0, 10);
    const calendar = structuredClone(holidays);
    calendar[2026]['2026-10-10'] = { date: '2026-10-10', isOffDay: false };
    const row = plan(shot(date, [order({ operationAt })]), base(date.slice(0, 7)), calendar).rows[0];
    expect(row.reason).toBeUndefined();
    expect(row.target!.pendingBuys![0].notBefore).toBe(confirmation);
  });

  it('跨月按一木确认月入账，并保留成交净值日', () => {
    const result = correct(shot('2026-09-01', [order({ operationAt: '2026-08-31T10:00:00', navDate: '2026-08-31' })]));
    expect(result.investmentTransactions![0]).toMatchObject({ date: '2026-09-01', autoBuy: { navDate: '2026-08-31' } });
  });

  it('缺少假期数据或准确成交净值不能写入，不改用后一天净值', () => {
    expect(plan(shot(), base(), {}).rows[0].reason).toContain('日期');
    const snapshot = shot('2026-09-15', [order({ nav: undefined })]);
    expect(buildAlipayYimuCorrection(snapshot, base().investPositionItems!, [], holidays, {
      orders: { [`${code}:2026-09`]: [{ date: '2026-09-15', close: 4, purchaseStatus: '开放申购' }] },
    }).rows[0].reason).toContain('成交净值');
    expect(buildAlipayYimuCorrection(snapshot, base().investPositionItems!, [], holidays, {
      orders: { [`${code}:2026-09`]: [{ date: '2026-09-14', close: 2, purchaseStatus: '暂停申购' }] },
    }).rows[0].shares).toBe(110);
  });

  it('有同日净值可由金额与收益推算；成本、份额缺一时不借用错误一木余额', () => {
    const snapshot = shot('2026-09-15', []);
    delete snapshot.funds[0].shares; delete snapshot.funds[0].costPrice;
    expect(plan(snapshot).rows[0]).toMatchObject({ shares: 100, costPrice: 1.5, estimated: true });
    delete snapshot.funds[0].nav;
    expect(plan(snapshot).rows[0].reason).toBeTruthy();
  });

  it('未匹配、重复持仓、订单状态缺失或待确认交易不完整均只阻止相关基金', () => {
    const record = base(); fund(record).symbol = '000001';
    expect(plan(shot(), record).rows[0].reason).toContain('未唯一匹配');
    record.investPositionItems!.us = [base().investPositionItems!.us![0], base().investPositionItems!.us![0]];
    expect(plan(shot(), record).rows[0].reason).toContain('未唯一匹配');
    expect(plan(shot('2026-09-15', [order({ status: 'unknown' })])).rows[0].reason).toContain('状态');
    const snapshot = shot(); snapshot.funds[0].pendingBuyAmount = 30;
    expect(plan(snapshot).rows[0].reason).toContain('不完整');
  });

  it('卖出未到账不是持仓份额；缺持有金额和份额则阻止矫正', () => {
    const snapshot = shot('2026-09-15', [order({ side: 'sell', quantity: 40 })]);
    snapshot.funds[0].totalAmount = 240;
    expect(plan(snapshot).rows[0]).toMatchObject({ shares: 100, costPrice: 1.5 });
    delete snapshot.funds[0].shares;
    expect(plan(snapshot).rows[0].reason).toContain('赎回中');
  });

  it('重复矫正覆盖基准而不累加，刷新和后续月份保留基准与待确认身份', () => {
    const first = correct();
    const second = correct(shot(), first);
    expect(fund(second)).toEqual(fund(first));
    expect(second.investmentTransactions).toHaveLength(1);
    const restored = normalizeMonthlyRecords(JSON.parse(JSON.stringify([second])))[0];
    expect(fund(restored).alipayCorrection).toEqual(fund(first).alipayCorrection);
    expect(fund(createInvestmentRolloverRecord(restored, '2026-10')).shares).toBe(110);
    expect(fund(createInvestmentRolloverRecord(restored, '2026-10')).alipayCorrection).toEqual(fund(first).alipayCorrection);
  });

  it('已经确认的支付宝实录直接校正，旧交易重放不会再增加份额', () => {
    const result = correct(shot('2026-09-16', [order({ status: 'confirmed' })]));
    expect(fund(result).shares).toBe(100);
    applyInvestmentTransaction(result.investPositionItems!, actual());
    expect(fund(result).shares).toBe(100);
  });

  it('撤销早于 T+1 的旧预估入账，重新等待一木确认日', () => {
    const record = base(); record.investmentTransactions = [{ ...actual(10), date: '2026-09-14', fee: 0 }];
    const result = correct(shot('2026-09-14'), record);
    expect(result.investmentTransactions).toHaveLength(0);
    expect(fund(result).shares).toBe(100);
    expect(fund(result).pendingBuys?.[0].booking).toBeUndefined();
  });

  it('正式确认按差额替换截图预估，真实流水号后来出现也不重复，重复矫正保留正式份额', () => {
    const result = reconcileAutoFundBuy([correct()], actual());
    expect(result.matched).toBe(true);
    expect(fund(result.records[0])).toMatchObject({ shares: 109.9, costPrice: 1.5469 });
    expect(result.records[0].investmentTransactions).toHaveLength(1);
    expect(reconcileAutoFundBuy(result.records, actual()).changedMonths).toEqual([]);
    const again = correct(shot(), result.records[0]);
    expect(fund(again).shares).toBe(109.9);
    expect(plan(shot(), result.records[0]).rows[0].beforeFee).toBe(false);
  });

  it('矫正后卖出再收到正式份额，剩余份额与成本同步校正', () => {
    const result = correct();
    const sell: InvestmentTransactionRecord = { ...actual(50), id: 'sell', side: 'sell', amount: 100, fee: 0,
      date: '2026-09-17', operationAt: '2026-09-17T10:00:00', applicationOrder: 2 };
    applyInvestmentTransaction(result.investPositionItems!, sell); result.investmentTransactions!.push(sell);
    const reconciled = reconcileAutoFundBuy([result], actual()).records[0];
    expect(fund(reconciled).shares).toBe(59.9);
    expect(fund(reconciled).costPrice).toBeCloseTo(170 / 109.9, 3);
  });

  it('多笔待确认按成交顺序衔接，先后正式确认不重复成本', () => {
    const snapshot = shot('2026-09-16', [order(), order({ id: 'shot-2', operationAt: '2026-09-15T10:00:00' })]);
    const result = correct(snapshot);
    const first = reconcileAutoFundBuy([result], actual());
    const second = reconcileAutoFundBuy(first.records, { ...actual(9.8, '2026-09-15T10:00:00'), id: 'formal2', orderId: 'formal2', fee: 0.4 }).records[0];
    expect(fund(second).shares).toBe(119.7);
    expect(fund(second).costPrice).toBeCloseTo(190 / 119.7, 3);
  });

  it('真实 Excel 重复导入和旧待确认导入不会累计截图桥接交易', async () => {
    useMonthlyStore.setState({ records: [correct()] });
    await importInvestmentFileIntoStores(statement([formalRow]), { deferUpload: true });
    expect(fund(current()).shares).toBe(109.9);
    const once = structuredClone(current());
    await importInvestmentFileIntoStores(statement([formalRow]), { deferUpload: true });
    expect(fund(current())).toEqual(fund(once));
    await importInvestmentFileIntoStores(statement([[...formalRow.slice(0, 7), '', 2, 0.2, '测试账户', '待确认']]), { deferUpload: true });
    expect(fund(current()).shares).toBe(109.9);
    expect(fund(current()).pendingBuys).toBeUndefined();
    expect(current().investmentTransactions).toHaveLength(1);
  });

  it('完整账单中的旧交易不会改写矫正余额，后来的新买入正常计一次', async () => {
    useMonthlyStore.setState({ records: [correct(shot('2026-09-16', []))] });
    const oldRow = ['old', '2026-09-01 10:00:00', '2026-09-02', '买入', '标普测试A', code, 20, 10, 2, 0, '测试账户', '交易成功'];
    const fresh = ['fresh', '2026-09-17 10:00:00', '2026-09-18', '买入', '标普测试A', code, 20, 10, 2, 0, '测试账户', '交易成功'];
    await importInvestmentFileIntoStores(statement([oldRow, fresh]), { deferUpload: true });
    expect(fund(current()).shares).toBe(110);
    await importInvestmentFileIntoStores(statement([oldRow, fresh]), { deferUpload: true });
    expect(fund(current()).shares).toBe(110);
    expect(fund(current()).costPrice).toBe(1.5455);
  });

  it('待 T+1 的截图订单与待确认 Excel 合并为一笔，保留最早入账限制', async () => {
    useMonthlyStore.setState({ records: [correct(shot('2026-09-14'))] });
    await importInvestmentFileIntoStores(statement([[...formalRow.slice(0, 7), '', 2, 0.2, '测试账户', '待确认']]), { deferUpload: true });
    expect(fund(current()).pendingBuys).toHaveLength(1);
    expect(fund(current()).pendingBuys![0].notBefore).toBe('2026-09-15');
    expect(fund(current()).shares).toBe(100);
  });

  it('新的支付宝实录覆盖旧桥接后，旧订单正式确认不会再次改写余额', () => {
    const first = correct();
    const snapshot = shot('2026-09-17', []);
    snapshot.funds[0] = { ...snapshot.funds[0], shares: 120, totalAmount: 240, confirmedAmount: 240, holdingProfit: 60 };
    const second = correct(snapshot, first);
    const result = reconcileAutoFundBuy([second], actual()).records[0];
    expect(fund(result).shares).toBe(120);
    expect(fund(result).costPrice).toBe(1.5);
  });

  it('已正式导入的订单再次桥接仍可校对，完整账单不会移除这笔桥接再加一遍', async () => {
    const record = base(); record.investmentTransactions = [{ ...actual(), date: '2026-09-15' }];
    const corrected = correct(shot(), record);
    useMonthlyStore.setState({ records: [corrected] });
    await importInvestmentFileIntoStores(statement([formalRow]), { deferUpload: true });
    expect(fund(current()).shares).toBe(109.9);
    await importInvestmentFileIntoStores(statement([formalRow]), { deferUpload: true });
    expect(fund(current()).shares).toBe(109.9);
    expect(current().investmentTransactions).toHaveLength(1);
  });

  it('预览后交易变化会改变签名，实时行情刷新不会；不同月份不能应用', () => {
    const record = base(); const signature = yimuCorrectionSignature([record]);
    fund(record).lastPrice = 3;
    expect(yimuCorrectionSignature([record])).toBe(signature);
    fund(record).shares = 4;
    expect(yimuCorrectionSignature([record])).not.toBe(signature);
    expect(() => applyAlipayYimuCorrection(base('2026-10'), plan(), [code], now)).toThrow('月份');
    expect(() => applyAlipayYimuCorrection(base(), plan(), [code], Date.parse('2026-09-01'))).toThrow();
  });
});
