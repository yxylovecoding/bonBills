import { describe, expect, it } from 'vitest';
import type { InvestPositionItems, InvestmentTransactionRecord, PendingInvestmentBuy } from '../models/types';
import { confirmationOrderKey, estimateConfirmationDate, fundConfirmationKey, holdingsAsOf, projectAlipayHoldings, resolveFundConfirmationRule, type AlipayProjectionOptions } from './alipayHoldings';
import { applyInvestmentTransaction, captureInvestmentPositionBefore, createInvestmentRolloverRecord, emptyMonthlyRecord } from './investmentRollover';
import { summarizeInvestPositionItems, syncInvestPositionItems } from './investPositionItems';
import { bookPendingFundBuy, reconcileAutoFundBuy } from './autoFundBuys';

const fundKey = fundConfirmationKey('017641');
const holidays = { 2026: {}, 2027: {} };
const options = (patch: Partial<AlipayProjectionOptions> = {}): AlipayProjectionOptions => ({
  asOf: '2026-09-15', records: [], holidays, metadata: { [fundKey]: { name: '标普500', type: 'QDII-指数' } }, ...patch,
});
const base = (): InvestPositionItems => ({ us: [{
  id: 'fund', name: '标普500', symbol: '017641', quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY',
  status: 'active', shares: 100, costPrice: 10, historicalProfitCny: 20, profitInputMode: 'historical',
  lastPrice: 12, lastCurrency: 'CNY', lastFxRateToCny: 1,
}] });
const buy = (patch: Partial<InvestmentTransactionRecord> = {}): InvestmentTransactionRecord => ({
  id: 'buy-1', orderId: 'order-1', date: '2026-09-15', operationAt: '2026-09-14T10:00:00',
  side: 'buy', symbol: '017641', quoteSource: 'eastmoney-fund', name: '标普500', groupKey: 'us',
  shares: 20, price: 11, fee: 0, amount: 220, currency: 'CNY', ...patch,
});
function booked(transactions = [buy()], yearMonth = '2026-09') {
  const items = base();
  const ledger = transactions.map((transaction) => {
    const captured = captureInvestmentPositionBefore(items, transaction);
    applyInvestmentTransaction(items, captured);
    return captured;
  });
  return { ...syncInvestPositionItems(emptyMonthlyRecord(yearMonth), items), investmentTransactions: ledger };
}

describe('支付宝确认日期', () => {
  it('周一买入分别在周二和周三确认，15点截单使用北京时间', () => {
    expect(estimateConfirmationDate('2026-09-14T14:59:59', 1, holidays)).toBe('2026-09-15');
    expect(estimateConfirmationDate('2026-09-14T14:59:59', 2, holidays)).toBe('2026-09-16');
    expect(estimateConfirmationDate('2026-09-14T07:00:00Z', 2, holidays)).toBe('2026-09-17');
    expect(estimateConfirmationDate('2026-09-18T15:00:00', 2, holidays)).toBe('2026-09-23');
  });
  it('跳过国庆假期，调休周六不增加确认日', () => {
    const calendar = { 2026: Object.fromEntries(Array.from({ length: 7 }, (_, i) => {
      const date = `2026-10-0${i + 1}`; return [date, { date, isOffDay: true }];
    }).concat([['2026-10-10', { date: '2026-10-10', isOffDay: false }]])) };
    expect(estimateConfirmationDate('2026-09-30T10:00:00', 2, calendar)).toBe('2026-10-09');
    expect(estimateConfirmationDate('2026-10-09T10:00:00', 2, calendar)).toBe('2026-10-13');
  });
  it('支持跨年，缺少下一年日历时保持未知', () => {
    expect(estimateConfirmationDate('2026-12-31T10:00:00', 2, { ...holidays, 2027: { '2027-01-01': { date: '2027-01-01', isOffDay: true } } })).toBe('2027-01-05');
    expect(estimateConfirmationDate('2026-12-31T10:00:00', 2, { 2026: {} })).toBeUndefined();
  });
  it('优先采用已知成交净值日期，缺时间和类型时不猜测', () => {
    expect(estimateConfirmationDate('2026-09-14', 2, holidays, '2026-09-15')).toBe('2026-09-17');
    expect(estimateConfirmationDate('2026-09-14', 2, holidays)).toBeUndefined();
    expect(estimateConfirmationDate('2026-09-14T10:00:00', undefined, holidays)).toBeUndefined();
    expect(estimateConfirmationDate('2026-09-14T10:00:00', 2, {})).toBeUndefined();
  });
  it('只识别明确基金类型，单只基金规则可覆盖自动识别', () => {
    expect(resolveFundConfirmationRule({ name: '标普500(QDII)', type: '基金' })).toBe(2);
    expect(resolveFundConfirmationRule({ name: '国内指数', type: '股票指数' })).toBeUndefined();
    expect(resolveFundConfirmationRule({ name: '沪深300', type: '指数型-股票' })).toBe(1);
    expect(resolveFundConfirmationRule({ name: '养老', type: '混合型-FOF' })).toBeUndefined();
    expect(resolveFundConfirmationRule(undefined)).toBeUndefined();
    expect(resolveFundConfirmationRule(undefined, 2)).toBe(2);
  });
  it('历史月份固定月末，当前月份按今天', () => {
    expect(holdingsAsOf('2026-08', '2026-09-15')).toBe('2026-08-31');
    expect(holdingsAsOf('2026-09', '2026-09-15')).toBe('2026-09-15');
  });
});

describe('支付宝持仓投影', () => {
  it('未确认买入同步移除份额和成本，原成交净值及账本不变', () => {
    const record = booked();
    const before = structuredClone(record);
    const result = projectAlipayHoldings(record.investPositionItems!, options({ records: [record] }));
    expect(result.items.us![0]).toMatchObject({ shares: 100, costPrice: 10 });
    expect(summarizeInvestPositionItems(result.items)).toMatchObject({ totalMarketValueCny: 1200, totalProfitCny: 220 });
    expect(result.orders[0]).toMatchObject({ confirmationDate: '2026-09-16', status: 'pending', amount: 220, shares: 20, price: 11 });
    expect(result.reviewItemIds.size).toBe(0);
    expect(record).toEqual(before);
    const confirmed = projectAlipayHoldings(record.investPositionItems!, options({ records: [record], asOf: '2026-09-16' }));
    expect(confirmed.items).toEqual(record.investPositionItems);
    expect(confirmed.orders[0].status).toBe('confirmed');
  });
  it('手动保持待确认、指定日期及恢复自动均只改变投影', () => {
    const record = booked();
    const key = confirmationOrderKey(buy());
    const run = (overrides: AlipayProjectionOptions['overrides'], asOf = '2026-09-17') => projectAlipayHoldings(record.investPositionItems!, options({ records: [record], overrides, asOf }));
    expect(run({ [key]: { status: 'pending' } }).items.us![0].shares).toBe(100);
    expect(run({ [key]: { status: 'confirmed', date: '2026-09-15' } }, '2026-09-15').items.us![0].shares).toBe(120);
    expect(run({ [key]: null }).items.us![0].shares).toBe(120);
    expect(run({ [key]: { status: 'confirmed', date: '2026-02-31' } }).reviewItemIds.has('fund')).toBe(true);
  });
  it('跨月确认保留前月待确认，后月到期计入且前后月收益同口径', () => {
    const august = booked([buy({ date: '2026-08-31', operationAt: '2026-08-31T10:00:00' })], '2026-08');
    const september = createInvestmentRolloverRecord(august, '2026-09');
    const records = [august, september];
    const previous = projectAlipayHoldings(august.investPositionItems!, options({ records, asOf: '2026-08-31' }));
    const before = projectAlipayHoldings(september.investPositionItems!, options({ records, asOf: '2026-09-01' }));
    const after = projectAlipayHoldings(september.investPositionItems!, options({ records, asOf: '2026-09-02' }));
    expect(previous.items.us![0].shares).toBe(100);
    expect(before.items.us![0].shares).toBe(100);
    expect(after.items.us![0].shares).toBe(120);
    expect(summarizeInvestPositionItems(after.items).totalProfitCny - summarizeInvestPositionItems(previous.items).totalProfitCny).toBeCloseTo(20, 1);
  });
  it('后续卖出使用可见份额的成本并修正已实现收益差额', () => {
    const record = booked([buy({ shares: 100, price: 20, amount: 2000 }), buy({ id: 'sell', orderId: 'sell', side: 'sell', shares: 50, price: 30, amount: 1500 })]);
    const result = projectAlipayHoldings(record.investPositionItems!, options({ records: [record] }));
    expect(result.items.us![0]).toMatchObject({ shares: 50, costPrice: 10, historicalProfitCny: 270 });
    expect(summarizeInvestPositionItems(result.items).totalProfitCny).toBe(370);
  });
  it('卖出超过可见份额或持仓被手动更改时保留原值并标记', () => {
    const record = booked([buy(), buy({ id: 'sell', side: 'sell', shares: 110 })]);
    const result = projectAlipayHoldings(record.investPositionItems!, options({ records: [record] }));
    expect(result.items).toEqual(record.investPositionItems);
    expect(result.reviewItemIds.has('fund')).toBe(true);
    const edited = booked(); edited.investPositionItems!.us![0].shares = 125;
    const mismatch = projectAlipayHoldings(edited.investPositionItems!, options({ records: [edited] }));
    expect(mismatch.items).toEqual(edited.investPositionItems);
    expect(mismatch.reviewItemIds.has('fund')).toBe(true);
  });
  it('重复交易ID不重复扣除，无法区分的订单不合并', () => {
    const record = booked();
    record.investmentTransactions.push(record.investmentTransactions[0]);
    expect(projectAlipayHoldings(record.investPositionItems!, options({ records: [record] })).items.us![0].shares).toBe(100);
    const ambiguous = booked([buy({ orderId: undefined, pendingBaseMatchKey: 'same' }), buy({ id: 'second', orderId: undefined, pendingBaseMatchKey: 'same' })]);
    const result = projectAlipayHoldings(ambiguous.investPositionItems!, options({ records: [ambiguous] }));
    expect(result.items).toEqual(ambiguous.investPositionItems);
    expect(result.orders).toHaveLength(2);
    expect(result.orders.every((order) => order.ambiguous)).toBe(true);
  });
  it('旧快照缺少交易依据或基金类型时不虚构持仓', () => {
    const items = base();
    const old = projectAlipayHoldings(items, options());
    expect(old.items).toEqual(items);
    expect(old.reviewItemIds.has('fund')).toBe(true);
    const record = booked(); record.investmentTransactions[0].positionBefore = undefined;
    const unanchored = projectAlipayHoldings(record.investPositionItems!, options({ records: [record] }));
    expect(unanchored.items).toEqual(record.investPositionItems);
    expect(unanchored.reviewItemIds.has('fund')).toBe(true);
    expect(projectAlipayHoldings(record.investPositionItems!, options({ records: [record], metadata: {} })).orders[0].status).toBe('review');
  });
  it('多个流水号共用旧身份时不把校正或未入账行分配给多个订单', () => {
    const first = buy({ pendingBaseMatchKey: 'same-operation' });
    const second = buy({ id: 'buy-2', orderId: 'order-2', pendingBaseMatchKey: 'same-operation' });
    const record = booked([first, second]);
    const overrides = { [confirmationOrderKey(first, true)]: { status: 'pending' as const } };
    const result = projectAlipayHoldings(record.investPositionItems!, options({ records: [record], overrides }));
    expect(result.items).toEqual(record.investPositionItems);
    expect(result.orders.every((order) => order.ambiguous)).toBe(true);
    record.investPositionItems!.us![0].pendingBuys = [{ id: 'pending', matchKey: 'match', baseMatchKey: 'same-operation', operationAt: first.operationAt!, symbol: first.symbol, name: first.name, groupKey: 'us', currency: 'CNY', amount: 220 }];
    const pending = projectAlipayHoldings(record.investPositionItems!, options({ records: [record] }));
    expect(pending.items).toEqual(record.investPositionItems);
    expect(pending.orders.every((order) => order.ambiguous)).toBe(true);
  });
  it('股票和场内ETF不调整', () => {
    const items = base(); items.us![0].quoteSource = 'yahoo';
    const result = projectAlipayHoldings(items, options({ records: [booked()] }));
    expect(result.items).toEqual(items); expect(result.orders).toEqual([]); expect(result.reviewItemIds.size).toBe(0);
  });
  it('自动预估转正式后保留订单校正，不重复计入待确认', () => {
    const pending: PendingInvestmentBuy = { id: 'pending', orderId: 'order-1', matchKey: 'match', baseMatchKey: 'base', operationAt: '2026-09-14T10:00:00', symbol: '017641', name: '标普500', groupKey: 'us', currency: 'CNY', amount: 220 };
    const items = base(); items.us![0].pendingBuys = [pending];
    const original = syncInvestPositionItems(emptyMonthlyRecord('2026-09'), items);
    const estimated = bookPendingFundBuy(original, pending.id, { shares: 20, price: 11, navDate: '2026-09-14', beforeFee: true });
    const overrides = { [confirmationOrderKey(pending)]: { status: 'pending' as const } };
    const result = projectAlipayHoldings(estimated.investPositionItems!, options({ records: [estimated], overrides }));
    expect(result.items.us![0].shares).toBe(100); expect(result.orders).toHaveLength(1);
    const formal = reconcileAutoFundBuy([estimated], buy({ shares: 19.9, fee: 1.1 })).records[0];
    const corrected = projectAlipayHoldings(formal.investPositionItems!, options({ records: [formal], asOf: '2026-09-17', overrides }));
    expect(corrected.orders).toHaveLength(1);
    expect(corrected.orders[0].status).toBe('pending');
    expect(corrected.items.us![0].shares).toBe(100);
  });
  it('未入账订单在确认且净值可用后仅计入视图，暂停申购不延后已受理订单确认', () => {
    const items = base(); items.us![0].pendingBuys = [{ id: 'pending', orderId: 'order-1', matchKey: 'match', baseMatchKey: 'base', operationAt: '2026-09-14T10:00:00', symbol: '017641', name: '标普500', groupKey: 'us', currency: 'CNY', amount: 220 }];
    const navs = { '017641:2026-09': [{ date: '2026-09-14', close: 11, purchaseStatus: '开放申购' }, { date: '2026-09-15', close: 12, purchaseStatus: '暂停申购' }] };
    const waiting = projectAlipayHoldings(items, options({ navs }));
    expect(waiting.items.us![0].shares).toBe(100);
    const confirmed = projectAlipayHoldings(items, options({ navs, asOf: '2026-09-16' }));
    expect(confirmed.items.us![0].shares).toBe(120);
    expect(confirmed.orders[0]).toMatchObject({ price: 11, confirmationDate: '2026-09-16', status: 'confirmed' });
    expect(items.us![0].shares).toBe(100);
    expect(projectAlipayHoldings(items, options({ asOf: '2026-09-16' })).orders[0].status).toBe('pending');
  });
  it('正式账单补充流水号仍沿用旧校正，恢复自动可清除旧匹配校正', () => {
    const initial = buy({ orderId: undefined, pendingBaseMatchKey: 'stable-operation' });
    const formal = buy({ orderId: 'new-bank-id', pendingBaseMatchKey: 'stable-operation', amount: 221 });
    const record = booked([formal]);
    const oldKey = confirmationOrderKey(initial);
    const newKey = confirmationOrderKey(formal);
    const overrides = { [oldKey]: { status: 'pending' as const } };
    const result = projectAlipayHoldings(record.investPositionItems!, options({ records: [record], asOf: '2026-09-20', overrides }));
    expect(result.items.us![0].shares).toBe(100);
    expect(result.orders[0].override).toEqual({ status: 'pending' });
    const reset = projectAlipayHoldings(record.investPositionItems!, options({ records: [record], asOf: '2026-09-20', overrides: { ...overrides, [newKey]: null } }));
    expect(reset.items.us![0].shares).toBe(120);
  });
  it('未入账买入后已有卖出时保留成本，等待正式台账校正', () => {
    const record = booked([buy({ id: 'sell', orderId: 'sell', side: 'sell', operationAt: '2026-09-15T10:00:00', shares: 50, price: 30 })]);
    record.investPositionItems!.us![0].pendingBuys = [{ id: 'pending', matchKey: 'match', baseMatchKey: 'base', operationAt: '2026-09-14T10:00:00', symbol: '017641', name: '标普500', groupKey: 'us', currency: 'CNY', amount: 220 }];
    const result = projectAlipayHoldings(record.investPositionItems!, options({ records: [record], asOf: '2026-09-16', navs: { '017641:2026-09': [{ date: '2026-09-14', close: 11, purchaseStatus: '开放申购' }] } }));
    expect(result.items).toEqual(record.investPositionItems);
    expect(result.orders[0].status).toBe('review');
    expect(result.reviewItemIds.has('fund')).toBe(true);
  });
  it('早期缺时间的记录保留原值，新买入有明确基准仍可剔除', () => {
    const record = booked([buy({ id: 'old', orderId: 'old', date: '2026-09-01', operationAt: '2026-09-01' }), buy()]);
    const result = projectAlipayHoldings(record.investPositionItems!, options({ records: [record] }));
    expect(result.items.us![0].shares).toBe(120);
    expect(result.reviewItemIds.has('fund')).toBe(true);
    expect(result.orders.map((order) => order.status)).toEqual(['review', 'pending']);
  });
});
