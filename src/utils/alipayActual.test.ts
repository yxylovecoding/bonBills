import { describe, expect, it } from 'vitest';
import { alipayActualCost, parseAlipayActual, summarizeAlipayActual } from './alipayActual';
import type { AlipayActualOrder, AlipayActualSnapshot } from '../models/types';

const order: AlipayActualOrder = { id: 'buy-1', code: '123456', operationAt: '2026-10-08T10:30:00', side: 'buy', quantity: 20, unit: 'CNY', status: 'pending' };
const sample = (): AlipayActualSnapshot => ({
  date: '2026-10-10', funds: [{ code: '123456', name: '示例基金', totalAmount: 120, holdingProfit: -3, amountKind: 'total' }], orders: [order],
});
const parse = (value: unknown) => parseAlipayActual(JSON.stringify(value));

describe('支付宝实录', () => {
  it('记录实际确认数据和预计日期，不将预期确认当作实际确认', () => {
    const input = sample();
    input.orders = [
      { ...order, status: 'confirmed', confirmationDate: '2026-10-09', confirmedShares: 8.5, nav: 2.3529, fee: 0 },
      { ...order, id: 'pending', navDate: '2026-10-08', expectedConfirmationDate: '2026-10-12' },
    ];
    const result = parse(input);
    expect(result.orders).toEqual(input.orders);
    expect(summarizeAlipayActual(result).pendingBuy).toBe(20);
    expect(result.funds[0].shares).toBeUndefined();
    expect(() => parse({ ...input, orders: [{ ...order, confirmationDate: '2026-10-12' }] })).toThrow('确认日期');
  });
  it('只按唯一编号去除截图重复，保留编号不同的相同金额订单', () => {
    const input = sample(); input.orders = [order, { ...order }, { ...order, id: 'buy-2' }];
    const result = parse(input);
    expect(result.orders).toHaveLength(2);
    expect(summarizeAlipayActual(result).pendingBuy).toBe(40);
    expect(parse(result)).toEqual(result);
  });
  it('相同编号内容冲突时拒绝整份导入', () => {
    const input = sample(); input.orders.push({ ...order, quantity: 30 });
    expect(() => parse(input)).toThrow('内容冲突');
  });
  it('在途买入和卖出分别统计，撤销、已确认、未知状态和份额不当作在途金额', () => {
    const input = sample();
    input.orders.push(
      { ...order, id: 'sell', side: 'sell', quantity: 35.12 },
      { ...order, id: 'cancel', side: 'sell', unit: 'shares', quantity: 40, status: 'cancelled' },
      { ...order, id: 'done', status: 'confirmed' },
      { ...order, id: 'unknown', status: 'unknown' },
      { ...order, id: 'shares', side: 'sell', unit: 'shares', quantity: 40 },
    );
    expect(summarizeAlipayActual(parse(input))).toEqual({ totalAmount: 120, holdingProfit: -3, pendingBuy: 20, pendingSell: 35.12, unknownCount: 1 });
    expect(parse(input).orders.find((row) => row.id === 'cancel')?.unit).toBe('shares');
  });
  it('含在途的总金额不反推份额和成本，明确持有金额才反推成本', () => {
    const input = sample();
    const result = parse(input);
    expect(result.funds[0].shares).toBeUndefined();
    expect(alipayActualCost(result.funds[0])).toBeNull();
    input.funds[0] = { ...input.funds[0], amountKind: 'confirmed', shares: 42.5 };
    expect(alipayActualCost(parse(input).funds[0])).toBe(123);
    expect(parse(input).funds[0].shares).toBe(42.5);
  });
  it.each(['2026-02-30', '2026-10-10T00:00:00', 'invalid'])('拒绝无效实录日期 %s', (date) => {
    expect(() => parse({ ...sample(), date })).toThrow('日期');
  });
  it.each(['2026-10-11T10:30:00', '2026-02-30T10:30:00', '2026-10-08T25:30:00'])('拒绝不完整、无效或晚于实录日的交易时间 %s', (operationAt) => {
    expect(() => parse({ ...sample(), orders: [{ ...order, operationAt }] })).toThrow('时间');
  });
  it('拒绝重复基金、丢失关联、负金额和字符串金额', () => {
    const input = sample();
    expect(() => parse({ ...input, funds: [...input.funds, ...input.funds] })).toThrow('重复');
    expect(() => parse({ ...input, orders: [{ ...order, code: '654321' }] })).toThrow('对应基金');
    expect(() => parse({ ...input, orders: [{ ...order, quantity: -1 }] })).toThrow('数量');
    expect(() => parse({ ...input, funds: [{ ...input.funds[0], totalAmount: '120' }] })).toThrow('金额');
  });
  it('导入实录不会修改输入或生成原始账本字段', () => {
    const input = sample(); const original = structuredClone(input);
    const result = parse({ ...input, investPositionItems: { gold: [] }, fundConfirmationOverrides: { overwrite: true } });
    expect(input).toEqual(original);
    expect(Object.keys(result).sort()).toEqual(['date', 'funds', 'orders']);
  });
});
