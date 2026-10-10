import type { AlipayActualFund, AlipayActualOrder, AlipayActualSnapshot, InvestKey, InvestPositionItems } from '../models/types';
import { validConfirmationDate } from './alipayHoldings';
import { canonicalInvestmentSymbol } from './investmentInstrument';

type ActualGroupKey = InvestKey | 'japan' | 'unclassified';
const ACTUAL_SECTIONS: { label: string; groups: { key: ActualGroupKey; label: string }[] }[] = [
  { label: '股', groups: [{ key: 'us', label: '美股' }, { key: 'japan', label: '日股' }, { key: 'eu', label: '欧股' }, { key: 'a', label: 'A股' }, { key: 'asia', label: '其他亚股' }] },
  { label: '债', groups: [{ key: 'longBond', label: '长债' }, { key: 'usBond', label: '美债' }] },
  { label: '商', groups: [{ key: 'gold', label: '黄金' }] },
  { label: '待分类', groups: [{ key: 'unclassified', label: '待分类基金' }] },
];

/** Match account categories by exact fund code; ambiguous or missing matches stay visible. */
export function groupAlipayActual(snapshot: AlipayActualSnapshot, items: InvestPositionItems) {
  const categories = new Map<string, Set<InvestKey>>();
  for (const key of ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'] as const) {
    for (const item of items[key] ?? []) {
      const symbol = canonicalInvestmentSymbol(item.symbol);
      if (item.quoteSource === 'yahoo' || !/^\d{6}$/.test(symbol)) continue;
      const matches = categories.get(symbol) ?? new Set<InvestKey>();
      matches.add(key);
      categories.set(symbol, matches);
    }
  }
  const fundsByGroup = new Map<ActualGroupKey, AlipayActualFund[]>();
  for (const fund of snapshot.funds) {
    const matches = categories.get(fund.code);
    let key: ActualGroupKey = matches?.size === 1 ? [...matches][0] : 'unclassified';
    if (key === 'asia' && /日经|日本|日股|TOPIX/i.test(fund.name)) key = 'japan';
    fundsByGroup.set(key, [...(fundsByGroup.get(key) ?? []), fund]);
  }
  return ACTUAL_SECTIONS.map((section) => {
    const groups = section.groups.flatMap((group) => {
      const funds = fundsByGroup.get(group.key) ?? [];
      return funds.length ? [{ ...group, funds, totals: summarizeAlipayActual({ ...snapshot, funds, orders: [] }) }] : [];
    });
    return { label: section.label, groups, totals: summarizeAlipayActual({ ...snapshot, funds: groups.flatMap((group) => group.funds), orders: [] }) };
  }).filter((section) => section.groups.length > 0);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('实录格式不正确');
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string, signed = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12 || (!signed && value < 0)) throw new Error(`${label}不正确`);
  return value;
}

function code(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw new Error('基金代码必须为六位数字');
  return value;
}

/** Import observations only: never turn screenshot money into position shares or ledger entries. */
export function parseAlipayActual(text: string): AlipayActualSnapshot {
  if (text.length > 1_000_000) throw new Error('实录文件过大');
  const source = object(JSON.parse(text));
  if (typeof source.date !== 'string' || !validConfirmationDate(source.date)) throw new Error('实录日期不正确');
  const date = source.date;
  if (!Array.isArray(source.funds) || !source.funds.length || source.funds.length > 500 || !Array.isArray(source.orders) || source.orders.length > 5000) throw new Error('持仓或交易记录不正确');
  const funds = source.funds.map((raw): AlipayActualFund => {
    const fund = object(raw);
    if (typeof fund.name !== 'string' || !fund.name.trim() || fund.name.length > 100) throw new Error('基金名称不正确');
    if (fund.amountKind !== 'total' && fund.amountKind !== 'confirmed') throw new Error('金额类型不正确');
    return {
      code: code(fund.code), name: fund.name.trim(), amountKind: fund.amountKind,
      totalAmount: number(fund.totalAmount, '金额'), holdingProfit: number(fund.holdingProfit, '持有收益', true),
      ...(fund.shares === undefined ? {} : { shares: number(fund.shares, '份额') }),
    };
  });
  const codes = new Set(funds.map((fund) => fund.code));
  if (codes.size !== funds.length) throw new Error('同一基金重复，请先核对');
  const orders = source.orders.map((raw): AlipayActualOrder => {
    const order = object(raw);
    const symbol = code(order.code);
    if (!codes.has(symbol)) throw new Error('交易记录缺少对应基金');
    if (typeof order.id !== 'string' || !order.id.trim() || order.id.length > 200) throw new Error('交易记录缺少唯一编号');
    if (typeof order.operationAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(order.operationAt)
      || !validConfirmationDate(order.operationAt.slice(0, 10)) || order.operationAt.slice(0, 10) > date) throw new Error('交易时间不正确');
    if (order.side !== 'buy' && order.side !== 'sell') throw new Error('交易方向不正确');
    if (order.unit !== 'CNY' && order.unit !== 'shares') throw new Error('交易单位不正确');
    if (order.status !== 'pending' && order.status !== 'confirmed' && order.status !== 'cancelled' && order.status !== 'unknown') throw new Error('交易状态不正确');
    const details: Partial<AlipayActualOrder> = {};
    for (const field of ['navDate', 'confirmationDate', 'expectedConfirmationDate'] as const) {
      const value = order[field];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !validConfirmationDate(value) || value < order.operationAt.slice(0, 10)
        || (field !== 'expectedConfirmationDate' && value > date)) throw new Error('净值或确认日期不正确');
      details[field] = value;
    }
    for (const field of ['confirmedShares', 'nav', 'fee'] as const) {
      if (order[field] !== undefined) details[field] = number(order[field], '确认数据');
    }
    return { id: order.id.trim(), code: symbol, operationAt: order.operationAt, side: order.side,
      quantity: number(order.quantity, '交易数量'), unit: order.unit, status: order.status, ...details };
  });
  const unique = new Map<string, AlipayActualOrder>();
  for (const order of orders) {
    const prior = unique.get(order.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(order)) throw new Error('同一交易编号的内容冲突，请先核对');
    unique.set(order.id, order);
  }
  return { date, funds, orders: [...unique.values()] };
}

export function summarizeAlipayActual(snapshot: AlipayActualSnapshot) {
  const cents = (values: number[]) => values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;
  const pending = snapshot.orders.filter((order) => order.status === 'pending' && order.unit === 'CNY');
  return {
    totalAmount: cents(snapshot.funds.map((fund) => fund.totalAmount)),
    holdingProfit: cents(snapshot.funds.map((fund) => fund.holdingProfit)),
    pendingBuy: cents(pending.filter((order) => order.side === 'buy').map((order) => order.quantity)),
    pendingSell: cents(pending.filter((order) => order.side === 'sell').map((order) => order.quantity)),
    unknownCount: snapshot.orders.filter((order) => order.status === 'unknown').length,
  };
}

export function alipayActualCost(fund: AlipayActualFund): number | null {
  return fund.amountKind === 'confirmed' ? Math.round((fund.totalAmount - fund.holdingProfit) * 100) / 100 : null;
}

/** Screenshot fields win; a unique account position may supply explicitly estimated fields. */
export function alipayActualBasis(fund: AlipayActualFund, items: InvestPositionItems) {
  const matches = Object.values(items).flatMap((rows) => rows ?? []).filter((item) =>
    item.status !== 'closed' && item.quoteSource !== 'yahoo' && canonicalInvestmentSymbol(item.symbol) === fund.code);
  const item = matches.length === 1 ? matches[0] : undefined;
  const finite = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
  const actualShares = finite(fund.shares);
  const shares = actualShares ?? finite(item?.shares);
  const actualCost = alipayActualCost(fund);
  const currency = (item?.quoteCurrency || item?.lastCurrency || 'CNY').toUpperCase();
  const estimatedPrice = ['CNY', 'CNH'].includes(currency) ? finite(item?.costPrice) : null;
  const costPrice = actualCost !== null && actualShares !== null && actualShares > 0
    ? actualCost / actualShares : actualCost === null ? estimatedPrice : null;
  const costTotal = actualCost ?? (shares !== null && costPrice !== null ? Math.round(shares * costPrice * 100) / 100 : null);
  return { item, shares, costPrice, costTotal, sharesEstimated: actualShares === null && shares !== null, costEstimated: actualCost === null };
}
