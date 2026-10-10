import { describe, expect, it } from 'vitest';
import { alipayActualBasis, alipayActualCost, groupAlipayActual, parseAlipayActual, summarizeAlipayActual } from './alipayActual';
import type { AlipayActualFund, AlipayActualOrder, AlipayActualSnapshot, InvestKey, InvestPositionItem, InvestPositionItems } from '../models/types';

const order: AlipayActualOrder = { id: 'buy-1', code: '123456', operationAt: '2026-10-08T10:30:00', side: 'buy', quantity: 20, unit: 'CNY', status: 'pending' };
const sample = (): AlipayActualSnapshot => ({
  date: '2026-10-10', funds: [{ code: '123456', name: '示例基金', totalAmount: 120, holdingProfit: -3, amountKind: 'total' }], orders: [order],
});

describe('支付宝实录分类', () => {
  const fund = (code: string, name = '示例基金', totalAmount = 100, holdingProfit = 10): AlipayActualFund => ({ code, name, totalAmount, holdingProfit, amountKind: 'total' });
  const position = (symbol: string): InvestPositionItem => ({ id: symbol, symbol, name: '账本简称', quoteSource: 'eastmoney-fund', status: 'active', historicalProfitCny: 0 });
  const snapshot = (funds: AlipayActualFund[]): AlipayActualSnapshot => ({ date: '2026-10-10', funds, orders: [] });

  it('按已有分类分为股债商及地区，汇总与每只基金一致且不改原数据', () => {
    const keys: InvestKey[] = ['us', 'asia', 'eu', 'a', 'asia', 'longBond', 'usBond', 'gold'];
    const funds = keys.map((_, i) => fund(`12345${i}`, i === 1 ? '示例日经225联接C' : '示例基金', (i + 1) * 100, (i + 1) * (i % 2 ? -10 : 10)));
    const items: InvestPositionItems = {};
    keys.forEach((key, i) => { items[key] = [...(items[key] ?? []), position(funds[i].code)]; });
    const input = snapshot(funds); const before = structuredClone({ input, items });
    const sections = groupAlipayActual(input, items);
    expect(sections.map((section) => section.label)).toEqual(['股', '债', '商']);
    expect(sections[0].groups.map((group) => group.label)).toEqual(['美股', '日股', '欧股', 'A股', '其他亚股']);
    expect(sections[1].groups.map((group) => group.label)).toEqual(['长债', '美债']);
    expect(sections[2].groups.map((group) => group.label)).toEqual(['黄金']);
    expect(sections.map((section) => [section.totals.totalAmount, section.totals.holdingProfit])).toEqual([[1500, 30], [1300, 10], [800, -80]]);
    expect(sections.flatMap((section) => section.groups.flatMap((group) => group.funds)).map((row) => row.code).sort()).toEqual(funds.map((row) => row.code));
    expect({ input, items }).toEqual(before);
  });
  it('按基金代码匹配简称和前缀，暂停持仓仍可归类，重复持仓不重复累计', () => {
    const input = snapshot([fund('123456')]);
    const sections = groupAlipayActual(input, { gold: [{ ...position('OF123456'), status: 'paused' }, position('123456')] });
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('商');
    expect(sections[0].totals.totalAmount).toBe(100);
    expect(sections[0].groups[0].funds).toHaveLength(1);
  });
  it('缺失、冲突或只有股票代码匹配时保留在待分类，不凭基金名称归类', () => {
    const input = snapshot([fund('123456', '黄金基金'), fund('123457'), fund('123458')]);
    const sections = groupAlipayActual(input, {
      us: [position('123457'), { ...position('123458'), quoteSource: 'yahoo' }],
      eu: [position('123457')],
    });
    expect(sections.map((section) => section.label)).toEqual(['待分类']);
    expect(sections[0].groups[0].funds).toHaveLength(3);
    expect(sections[0].totals).toMatchObject({ totalAmount: 300, holdingProfit: 30 });
  });
  it('保留零金额基金，按分汇总，隐藏没有实录的分类', () => {
    const input = snapshot([fund('123456', '基金甲', 0.1, 0.01), fund('123457', '基金乙', 0.2, -0.02), fund('123458', '基金丙', 0, 0)]);
    const sections = groupAlipayActual(input, { a: input.funds.map((row) => position(row.code)) });
    expect(sections).toHaveLength(1);
    expect(sections[0].groups).toHaveLength(1);
    expect(sections[0].totals).toMatchObject({ totalAmount: 0.3, holdingProfit: -0.01 });
    expect(sections[0].groups[0].funds).toHaveLength(3);
    expect(groupAlipayActual(snapshot([]), {})).toEqual([]);
  });
});
const parse = (value: unknown) => parseAlipayActual(JSON.stringify(value));

describe('实录金额与在途核对', () => {
  const fund: AlipayActualFund = { code: '123456', name: '示例基金', totalAmount: 123.2, holdingProfit: 5.2, amountKind: 'total', nav: 1.29, navDate: '2026-10-08', pendingOrdersComplete: true };
  const buys: AlipayActualOrder[] = [{ ...order, id: 'first', quantity: 10 }, { ...order, id: 'second', quantity: 10 }];
  it('扣除在途后推算份额及成本，不沿用偏高的账本基数', () => {
    const items: InvestPositionItems = { us: [{ id: 'old', symbol: fund.code, name: fund.name, status: 'active', quoteSource: 'eastmoney-fund', shares: 91.24, costPrice: 1.24, historicalProfitCny: 0 }] };
    const original = structuredClone({ fund, items, buys });
    const result = alipayActualBasis(fund, items, buys);
    expect(result).toMatchObject({ shares: 80, costTotal: 98, confirmedAmount: 103.2, pendingBuy: 20, bookMismatch: true, needsReview: false, sharesEstimated: true });
    expect(result.costPrice).toBeCloseTo(1.225, 8);
    expect({ fund, items, buys }).toEqual(original);
  });
  it('更换账本份额和最新净值不会改写旧实录的推算结果', () => {
    const items: InvestPositionItems = { us: [{ id: 'new', symbol: fund.code, name: fund.name, status: 'active', quoteSource: 'eastmoney-fund', shares: 1000, costPrice: 2, lastPrice: 3, quoteAt: '2026-10-12', historicalProfitCny: 0 }] };
    expect(alipayActualBasis(fund, items, buys)).toMatchObject({ shares: 80, costPrice: 1.225, costTotal: 98 });
  });
  it('相同订单只扣一次，撤销、已确认及其他基金的订单不扣除', () => {
    const orders: AlipayActualOrder[] = [...buys, { ...buys[0] }, { ...order, id: 'cancelled', status: 'cancelled' }, { ...order, id: 'confirmed', status: 'confirmed' }, { ...order, code: '654321' }];
    expect(alipayActualBasis(fund, {}, orders)).toMatchObject({ shares: 80, pendingBuy: 20 });
    expect(alipayActualBasis(fund, {}, [...buys, { ...buys[0], quantity: 20 }])).toMatchObject({ shares: null, costTotal: null, needsReview: true });
  });
  it('未核对全部订单、卖出未到账、未知状态或份额单位时不生成结论', () => {
    expect(alipayActualBasis({ ...fund, pendingOrdersComplete: false }, {}, buys)).toMatchObject({ shares: null, costTotal: null });
    for (const extra of [{ ...order, side: 'sell' as const }, { ...order, status: 'unknown' as const }, { ...order, unit: 'shares' as const }]) {
      expect(alipayActualBasis(fund, {}, [...buys, extra])).toMatchObject({ shares: null, costTotal: null, needsReview: true });
    }
  });
  it('缺少实录净值时只给出可核对的成本总额，不以最新净值填空', () => {
    expect(alipayActualBasis({ ...fund, nav: undefined, navDate: undefined }, {}, buys)).toMatchObject({ shares: null, costPrice: null, costTotal: 98, needsReview: true });
  });
  it('已确认金额不重复扣待确认订单；显式份额和成本价优先', () => {
    expect(alipayActualBasis({ ...fund, totalAmount: 103.2, amountKind: 'confirmed' }, {}, buys)).toMatchObject({ shares: 80, costTotal: 98 });
    expect(alipayActualBasis({ ...fund, shares: 79.9, costPrice: 1.3 }, {}, buys)).toMatchObject({ shares: 79.9, costPrice: 1.3, sharesEstimated: false, costPriceEstimated: false });
  });
  it('在途超过金额、成本为负或金额舍入不能唯一确定份额时保留待核对', () => {
    expect(alipayActualBasis({ ...fund, totalAmount: 10 }, {}, buys)).toMatchObject({ shares: null, costTotal: null });
    expect(alipayActualBasis({ ...fund, holdingProfit: 200 }, {}, buys)).toMatchObject({ costPrice: null, costTotal: null, needsReview: true });
    expect(alipayActualBasis({ ...fund, nav: 0.2 }, {}, buys)).toMatchObject({ shares: null, costPrice: null, needsReview: true });
  });
  it('导入保留净值日期及核对状态，拒绝不成对、未来或无效净值', () => {
    const input = { date: '2026-10-10', funds: [fund], orders: buys };
    expect(parse(input)).toEqual(input);
    for (const patch of [{ nav: 0 }, { nav: -1 }, { navDate: undefined }, { navDate: '2026-10-11' }, { navDate: '2026-02-30' }, { pendingOrdersComplete: 'true' }, { costPrice: -1 }]) {
      expect(() => parse({ ...input, funds: [{ ...fund, ...patch }] })).toThrow();
    }
  });
});

describe('支付宝基金份额与成本', () => {
  const position: InvestPositionItem = { id: 'fund', symbol: 'OF123456', name: '账本简称', status: 'active', quoteSource: 'eastmoney-fund', shares: 40, costPrice: 2, historicalProfitCny: 0 };
  it('实录份额和明确持有金额优先于账本，保留输入不写回', () => {
    const fund: AlipayActualFund = { ...sample().funds[0], amountKind: 'confirmed', shares: 42.5 };
    const items = { us: [position] }; const original = structuredClone({ fund, items });
    const result = alipayActualBasis(fund, items);
    expect(result).toMatchObject({ shares: 42.5, costTotal: 123, sharesEstimated: false, costPriceEstimated: true });
    expect(result.costPrice).toBeCloseTo(123 / 42.5, 8);
    expect({ fund, items }).toEqual(original);
  });
  it('在途未核对时不再用一木份额和成本填补支付宝实录', () => {
    expect(alipayActualBasis(sample().funds[0], { us: [position] })).toMatchObject({ shares: null, costPrice: null, costTotal: null, needsReview: true });
  });
  it('实录份额保留，但资料不足时不混入账本成本', () => {
    expect(alipayActualBasis({ ...sample().funds[0], shares: 42.5 }, { us: [position] })).toMatchObject({ shares: 42.5, costPrice: null, costTotal: null, sharesEstimated: false });
  });
  it('代码未匹配、重复匹配、已关闭和股票持仓均不补入基金字段', () => {
    const ambiguous = [
      {}, { us: [position], eu: [{ ...position, id: 'other' }] },
      { us: [{ ...position, status: 'closed' as const }] },
      { us: [{ ...position, quoteSource: 'yahoo' as const }] },
      { us: [{ ...position, symbol: '654321' }] },
    ];
    for (const items of ambiguous) expect(alipayActualBasis(sample().funds[0], items)).toMatchObject({ item: undefined, shares: null, costPrice: null, costTotal: null });
  });
  it('不借用外币账本份额和成本来补全实录', () => {
    expect(alipayActualBasis(sample().funds[0], { us: [{ ...position, quoteCurrency: 'USD' }] })).toMatchObject({ shares: null, costPrice: null, costTotal: null });
    expect(alipayActualBasis(sample().funds[0], { us: [{ ...position, lastCurrency: 'USD' }] })).toMatchObject({ shares: null, costPrice: null, costTotal: null });
  });
  it('保留实录零份额，未知份额不以订单确认量或账本份额反推真实成本价', () => {
    expect(alipayActualBasis({ ...sample().funds[0], amountKind: 'confirmed', totalAmount: 0, holdingProfit: 0, shares: 0 }, { us: [position] })).toMatchObject({ shares: 0, costPrice: null, costTotal: 0, sharesEstimated: false });
    expect(alipayActualBasis({ ...sample().funds[0], amountKind: 'confirmed' }, { us: [position] })).toMatchObject({ shares: null, costPrice: null, costTotal: 123, sharesEstimated: false });
  });
});

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
