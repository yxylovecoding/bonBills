import { describe, expect, it } from 'vitest';
import { alipayFundChoices, matchAlipayFund, parseAlipayScreenshot, combineAlipayScreenshotDrafts, materializeAlipayScreenshots, type AlipayFundDraft, type AlipayOrderDraft, type AlipayScreenshotDraft } from './alipayScreenshotImport';
import type { AlipayOcrImage } from './alipayScreenshotOcr';

const date = '2026-10-10';
const choices = [
  { code: '123456', name: '摩根示例欧洲股票(QDII)A', aliases: ['摩根示例欧洲股票(QDII)A'] },
  { code: '123457', name: '摩根示例欧洲股票(QDII)C', aliases: ['摩根示例欧洲股票(QDII)C'] },
  { code: '123458', name: '博时示例黄金联接C', aliases: ['博时示例黄金联接C'] },
];
const fund = (patch: Partial<AlipayFundDraft> = {}): AlipayFundDraft => ({ id: 'fund', source: 'a.png', code: '123456', name: choices[0].name, selected: true, notes: [], totalAmount: 110, holdingProfit: -10, amountKind: 'total', ...patch });
const order = (patch: Partial<AlipayOrderDraft> = {}): AlipayOrderDraft => ({ id: 'order', source: 'b.png', code: '123456', name: choices[0].name, selected: true, notes: [], operationAt: '2026-10-08T10:00:00', side: 'buy', quantity: 20, unit: 'CNY', status: 'pending', ...patch });
const draft = (funds = [fund()], orders: AlipayOrderDraft[] = []): AlipayScreenshotDraft => ({ funds, orders, notes: [] });
// Synthetic OCR geometry only: no personal screenshots or account data in the repository.
const screen = (rows: [number, [string, number, number][]][], text?: string): AlipayOcrImage => ({ name: 'synthetic.png', width: 1000, height: 2000,
  text: text ?? rows.map(([, cells]) => cells.map(([text]) => text).join(' ')).join('\n'),
  words: rows.flatMap(([y, cells]) => cells.map(([text, x0, x1]) => ({ text, confidence: 95, bbox: { x0, x1, y0: y, y1: y + 20 } }))),
});

describe('支付宝基金匹配与截图布局', () => {
  it('同名不同份额不猜测，明确代码或完整类别可以匹配', () => {
    expect(matchAlipayFund('摩根示例欧洲股票...', choices)).toBe('');
    expect(matchAlipayFund('摩根 示例欧洲股票 (QDII) C', choices)).toBe('123457');
    expect(matchAlipayFund('无法识别名称', choices, '987654')).toBe('987654');
    expect(matchAlipayFund('未知股票基金', choices)).toBe('');
  });
  it('汇总账号已有别名，排除同代码股票且不修改原始持仓', () => {
    const items = { eu: [{ id: 'x', symbol: 'OF123456', name: '简称', quoteSource: 'eastmoney-fund' as const, status: 'active' as const, historicalProfitCny: 0 }], us: [{ id: 'y', symbol: '654321', name: '股票', quoteSource: 'yahoo' as const, status: 'active' as const, historicalProfitCny: 0 }] };
    const before = structuredClone(items);
    const snapshot = materializeAlipayScreenshots(draft(), date, choices);
    expect(alipayFundChoices(items, { [date]: snapshot })).toEqual([{ ...choices[0], aliases: ['简称', choices[0].name] }]);
    expect(items).toEqual(before);
  });
  it('持有页取主行的金额与持有收益，忽略下一行昨日收益及收益率', () => {
    const result = parseAlipayScreenshot(screen([
      [10, [['我的持有', 30, 160]]],
      [100, [[choices[0].name, 30, 410], ['110.00', 600, 730], ['-10.00', 820, 930]]],
      [135, [['+3.00', 630, 730], ['-8.33%', 820, 930]]],
    ]), choices, date);
    expect(result.funds[0]).toMatchObject({ code: '123456', totalAmount: 110, holdingProfit: -10, amountKind: 'total' });
  });
  it('主行金额被遮住时不拿昨日收益或收益率补位', () => {
    const result = parseAlipayScreenshot(screen([
      [100, [[choices[0].name, 30, 410], ['反馈与投诉', 600, 930]]],
      [135, [['+3.00', 630, 730], ['-8.33%', 820, 930]]],
    ]), choices, date);
    expect(result.funds[0]).toMatchObject({ totalAmount: undefined, holdingProfit: undefined });
  });
  it('黄金页读取三列份额金额收益，忽略不足七天份额', () => {
    const result = parseAlipayScreenshot(screen([
      [10, [['黄金基金持仓', 40, 300]]],
      [100, [[choices[2].name, 50, 500]]],
      [150, [['持有份额', 50, 220], ['金额/昨日收益', 450, 700], ['持有收益/率', 800, 990]]],
      [200, [['50.00', 50, 220], ['100.00', 550, 700], ['-5.00', 830, 960]]],
      [240, [['+1.00', 550, 700], ['-4.76%', 830, 960]]],
      [300, [['持仓不足7日的份额:10.00份', 40, 700]]],
    ]), choices, date);
    expect(result.funds[0]).toMatchObject({ code: '123458', shares: 50, totalAmount: 100, holdingProfit: -5, amountKind: 'confirmed' });
  });
  it('资产详情分别读取持有和待确认金额及净值，跨年净值采用上一年', () => {
    const result = parseAlipayScreenshot(screen([
      [10, [['资产详情', 40, 300]]], [70, [[choices[0].name, 30, 650]]], [110, [['123456', 30, 180]]],
      [160, [['金额(元)', 420, 580]]], [220, [['110.00', 410, 590]]],
      [300, [['昨日收益(元)', 70, 270], ['持有收益(元)', 400, 600], ['持有收益率', 740, 960]]],
      [350, [['-1.00', 100, 240], ['-10.00', 420, 580], ['-10.00%', 760, 920]]],
      [430, [['持有金额', 40, 200], ['90.00', 230, 350], ['待确认金额', 530, 720], ['20.00', 760, 900]]],
      [480, [['持仓成本价', 40, 220], ['2.0000', 240, 380], ['持有份额', 530, 720], ['50.00', 760, 900]]],
      [530, [['基金净值', 530, 720], ['1.8000(12-31)', 760, 995]]],
    ]), choices, '2027-01-02');
    expect(result.funds[0]).toMatchObject({ code: '123456', totalAmount: 110, holdingProfit: -10, confirmedAmount: 90, pendingBuyAmount: 20, shares: 50, costPrice: 2, nav: 1.8, navDate: '2026-12-31' });
  });
  it('交易详情保留订单号与确认数据，预计确认日期跨年向后推', () => {
    const result = parseAlipayScreenshot(screen([
      [10, [['记录详情 份额待确认', 40, 600]]], [70, [['买入产品', 40, 200], [choices[0].name, 350, 980]]],
      [120, [['买入金额', 40, 200], ['20.00元', 780, 980]]],
      [200, [['买入时间', 40, 200], ['2026-12-31 10:00:00', 400, 980]]],
      [270, [['买入价格按照12月31日净值计算', 40, 800]]],
      [320, [['01-04 星期一 确认份额', 40, 800]]],
      [390, [['订单号 202612310000000000001', 40, 800]]],
    ]), choices, '2027-01-02');
    expect(result.orders[0]).toMatchObject({ code: '123456', quantity: 20, operationAt: '2026-12-31T10:00:00', orderId: '202612310000000000001', status: 'pending', navDate: '2026-12-31', expectedConfirmationDate: '2027-01-04' });
  });
  it('交易记录保留未知状态、卖出份额与被截掉时间的尾行', () => {
    const result = parseAlipayScreenshot(screen([
      [10, [['交易记录', 40, 300]]], [50, [['明细', 40, 100]]],
      [100, [['买入', 40, 100], [choices[0].name, 170, 690], ['20.00元', 790, 950]]],
      [170, [['2026-10-08 10:00:00', 170, 630]]],
      [220, [['卖出', 40, 100], [choices[0].name, 170, 690], ['30.00份', 790, 950]]],
      [250, [['已撤销', 790, 950]]], [290, [['2026-10-08 11:00:00', 170, 630]]],
      [350, [['定投', 40, 100], [choices[0].name, 170, 690], ['10.00元', 790, 950]]],
    ]), choices, date);
    expect(result.orders).toHaveLength(3);
    expect(result.orders[0].status).toBe('unknown');
    expect(result.orders[1]).toMatchObject({ side: 'sell', unit: 'shares', quantity: 30, status: 'cancelled' });
    expect(result.orders[2].operationAt).toBe('');
  });
  it('订单成功状态不被底部另一笔赎回确认中的提示覆盖', () => {
    const result = parseAlipayScreenshot(screen([
      [10, [['记录详情 买入成功', 40, 600]]], [50, [['买入信息', 40, 200]]],
      [100, [['买入产品', 40, 200], [choices[0].name, 350, 980]]],
      [150, [['买入金额', 40, 200], ['20.00元', 780, 980]]],
      [200, [['买入时间', 40, 200], ['2026-10-08 10:00:00', 400, 980]]],
      [300, [['确认份额', 40, 200], ['10.00份', 780, 980]]],
      [400, [['确认净值', 40, 200], ['2.0000', 780, 980]]],
      [500, [['你有1笔赎回确认中', 40, 800]]],
    ]), choices, date);
    expect(result.orders[0]).toMatchObject({ status: 'confirmed', quantity: 20, confirmedShares: 10, nav: 2 });
  });
  it('无法识别的图片保留提示，不生成空的准确持仓', () => {
    expect(parseAlipayScreenshot(screen([[10, [['广告', 40, 300]]]]), choices, date)).toMatchObject({ funds: [], orders: [] });
    expect(parseAlipayScreenshot(screen([]), choices, date).notes).toHaveLength(1);
  });
});

describe('截图合并和实录生成', () => {
  it('长截图重复行默认只选一笔，重复导入不会增加订单', () => {
    const merged = combineAlipayScreenshotDrafts([draft([fund()], [order(), order({ id: 'duplicate' })])]);
    expect(merged.orders.map((row) => row.selected)).toEqual([true, false]);
    const first = materializeAlipayScreenshots(merged, date, choices);
    expect(first.orders).toHaveLength(1);
    expect(materializeAlipayScreenshots(merged, date, choices, first)).toEqual(first);
  });
  it('用户明确勾选同一时间金额的两笔真实交易后保留两笔，重传仍是两笔', () => {
    const input = draft([fund()], [order(), order({ id: 'second' })]);
    const first = materializeAlipayScreenshots(input, date, choices);
    expect(first.orders).toHaveLength(2);
    expect(materializeAlipayScreenshots(input, date, choices, first)).toEqual(first);
  });
  it('订单详情补全列表状态和编号，真实编号接替旧推算编号', () => {
    const first = materializeAlipayScreenshots(draft([fund()], [order()]), date, choices);
    const detail = order({ id: 'detail', orderId: '202610080000000000001', status: 'confirmed', confirmationDate: '2026-10-09', confirmedShares: 10, nav: 2, fee: 0 });
    const merged = combineAlipayScreenshotDrafts([draft([fund()], [order(), detail])]);
    expect(merged.orders[0]).toMatchObject({ orderId: detail.orderId, status: 'confirmed', confirmedShares: 10, fee: 0 });
    const next = materializeAlipayScreenshots(merged, date, choices, first);
    expect(next.orders).toHaveLength(1);
    expect(next.orders[0]).toMatchObject({ id: detail.orderId, status: 'confirmed', confirmationDate: '2026-10-09' });
  });
  it('不同真实订单号不会因相同时间和金额被合并', () => {
    const merged = combineAlipayScreenshotDrafts([draft([fund()], [order({ orderId: '202610080000000000001' }), order({ id: 'second', orderId: '202610080000000000002' })])]);
    expect(merged.orders.every((row) => row.selected)).toBe(true);
    expect(materializeAlipayScreenshots(merged, date, choices).orders).toHaveLength(2);
  });
  it('列表同时匹配两笔详情时先取消选择模糊列表行，保留真实订单', () => {
    const merged = combineAlipayScreenshotDrafts([draft([fund()], [order(), order({ id: 'detail1', orderId: '202610080000000000001' }), order({ id: 'detail2', orderId: '202610080000000000002' })])]);
    expect(merged.orders.map((row) => row.selected)).toEqual([false, true, true]);
    expect(materializeAlipayScreenshots(merged, date, choices).orders).toHaveLength(2);
  });
  it('同一真实订单的不同内容不静默覆盖', () => {
    const merged = combineAlipayScreenshotDrafts([draft([fund()], [order({ orderId: '202610080000000000001' }), order({ id: 'conflict', orderId: '202610080000000000001', quantity: 40 })])]);
    expect(() => materializeAlipayScreenshots(merged, date, choices)).toThrow('冲突');
  });
  it('同一基金列表和详情一致时补充字段，冲突时阻止保存', () => {
    const original = draft([fund(), fund({ id: 'detail', shares: 50, costPrice: 2, confirmedAmount: 90, pendingBuyAmount: 20 })]);
    const before = structuredClone(original);
    const next = materializeAlipayScreenshots(original, date, choices);
    expect(next.funds).toHaveLength(1);
    expect(next.funds[0]).toMatchObject({ shares: 50, confirmedAmount: 90, pendingBuyAmount: 20 });
    expect(original).toEqual(before);
    expect(() => materializeAlipayScreenshots(draft([fund(), fund({ id: 'conflict', totalAmount: 999 })]), date, choices)).toThrow('冲突');
  });
  it('新截图不继承旧份额和净值，且不把其他日期的待确认交易带过来', () => {
    const old = materializeAlipayScreenshots(draft([fund({ shares: 30, nav: 3, navDate: '2026-10-08' })], [order()]), date, choices);
    const next = materializeAlipayScreenshots(draft([fund({ totalAmount: 130 })]), date, choices, old);
    expect(next.funds[0].shares).toBeUndefined(); expect(next.funds[0].nav).toBeUndefined();
    expect(next.orders).toHaveLength(1);
    expect(materializeAlipayScreenshots(draft(), '2026-10-11', choices, old).orders).toEqual([]);
    expect(old.funds[0].shares).toBe(30);
  });
  it.each([
    draft([fund({ code: '' })]), draft([fund({ holdingProfit: undefined })]),
    draft([fund()], [order({ operationAt: '' })]), draft([fund()], [order({ quantity: undefined })]),
    draft([fund()], [order({ status: 'unknown' })]), draft([fund()], [order({ code: '654321' })]),
    draft([fund()], [order({ operationAt: '2026-10-12T10:00:00' })]),
    draft([fund({ selected: false })]),
  ])('缺失或无效数据不生成已校对实录 %#', (input) => {
    expect(() => materializeAlipayScreenshots(input, date, choices)).toThrow();
  });
  it('撤销卖出更新原订单，移除之前的确认数据', () => {
    const input = draft([fund()], [order({ side: 'sell', status: 'confirmed', confirmationDate: '2026-10-09', confirmedShares: 10 })]);
    const old = materializeAlipayScreenshots(input, date, choices);
    const next = materializeAlipayScreenshots(draft([], [order({ side: 'sell', status: 'cancelled' })]), date, choices, old);
    expect(next.orders).toHaveLength(1);
    expect(next.orders[0].status).toBe('cancelled'); expect(next.orders[0].confirmationDate).toBeUndefined();
  });
});
