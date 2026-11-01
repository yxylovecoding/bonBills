import { describe, expect, it } from 'vitest';
import type { InvestPositionItem } from '../models/types';
import { alipayHoldingDraft, buildAlipayHoldingPatch } from './alipayManualCorrection';
import { investPositionDraftGroupsFromItems, investPositionItemsFromDraftGroups } from './investPositionDrafts';
import { calculateInvestPositionMetric } from './investPositionItems';

const item: InvestPositionItem = { id: 'fund', name: '测试基金A', symbol: '000001', quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY',
  status: 'active', shares: 100, costPrice: 1.5, lastPrice: 2, lastCurrency: 'CNY', lastFxRateToCny: 1,
  historicalProfitCny: 7, profitInputMode: 'historical', marketValueCny: 200, holdingProfitCny: 50 };
function apply(source: InvestPositionItem, draft = alipayHoldingDraft(source), market?: Parameters<typeof buildAlipayHoldingPatch>[2]) {
  const groups = investPositionDraftGroupsFromItems({ us: [source] });
  groups.us[0] = { ...groups.us[0], ...buildAlipayHoldingPatch(source, draft, market) };
  return investPositionItemsFromDraftGroups(groups).us![0];
}
describe('支付宝手动修正共享持仓', () => {
  it('金额收益写回完整持仓，保存后不会被份额成本重新算回旧值', () => {
    const next = apply(item, { ...alipayHoldingDraft(item), amount: '250.39', profit: '-12.43' });
    const metric = calculateInvestPositionMetric(next);
    expect(next.shares).toBeCloseTo(125.195, 8);
    expect(next.costPrice).toBeCloseTo(262.82 / 125.195, 8);
    expect(metric.marketValueCny).toBe(250.39);
    expect(metric.holdingProfitCny).toBe(-12.43);
    expect(metric.historicalProfitCny).toBe(7);
  });
  it('份额成本修正同步金额收益，同时保留在途链接和确认时间边界', () => {
    const source: InvestPositionItem = { ...item, pendingBuys: [{ id: 'pending', matchKey: 'pending', baseMatchKey: 'pending', operationAt: '2026-09-15T10:00:00', amount: 10, currency: 'CNY', name: item.name, symbol: item.symbol, groupKey: 'us' }],
      alipayCorrection: { date: '2026-09-15', deferredBuys: [{ operationAt: '2026-09-15T10:00:00', amount: 10 }],
        valuation: { shares: 100, costPrice: 1.5, price: 2, marketValueCny: 200.01, holdingProfitCny: 50.01 } } };
    const next = apply(source, { ...alipayHoldingDraft(source), mode: 'shares', shares: '150', costPrice: '1.75' });
    expect(calculateInvestPositionMetric(next)).toMatchObject({ marketValueCny: 300, holdingProfitCny: 37.5 });
    expect(next.pendingBuys).toEqual(source.pendingBuys);
    expect(next.alipayCorrection?.date).toBe(source.alipayCorrection?.date);
    expect(next.alipayCorrection?.deferredBuys).toEqual(source.alipayCorrection?.deferredBuys);
    expect(calculateInvestPositionMetric(next, { price: 2.1, currency: 'CNY', fxRateToCny: 1 })).toMatchObject({ marketValueCny: 315, holdingProfitCny: 52.5 });
  });
  it('只修改名称时保留原有份额、精度和截图金额锚点', () => {
    const source = { ...item, shares: 100.123456 };
    expect(buildAlipayHoldingPatch(source, { ...alipayHoldingDraft(source), name: ' 新名称 ' })).toEqual({ name: '新名称', status: 'active' });
  });
  it('外币金额按原币编辑并按汇率保存', () => {
    const source = { ...item, symbol: 'TEST', quoteSource: 'yahoo' as const, quoteCurrency: 'USD', lastCurrency: 'USD', lastFxRateToCny: 7 };
    const next = apply(source, { ...alipayHoldingDraft(source), amount: '300', profit: '50' });
    expect(calculateInvestPositionMetric(next)).toMatchObject({ marketValueCny: 2100, holdingProfitCny: 350 });
  });
  it('清零与缺失净值均有明确处理', () => {
    expect(calculateInvestPositionMetric(apply(item, { ...alipayHoldingDraft(item), amount: '0', profit: '0' }))).toMatchObject({ marketValueCny: 0, holdingProfitCny: 0 });
    const noPrice = { ...item, lastPrice: undefined };
    expect(() => apply(noPrice, { ...alipayHoldingDraft(noPrice), amount: '250' })).toThrow('补充净值');
    expect(calculateInvestPositionMetric(apply(noPrice, { ...alipayHoldingDraft(noPrice), amount: '250', price: '2' })).marketValueCny).toBe(250);
  });
  it('拒绝空白、非数、负金额以及收益超过持有金额', () => {
    for (const amount of ['', 'NaN', '-1', 'Infinity']) expect(() => apply(item, { ...alipayHoldingDraft(item), amount })).toThrow();
    expect(() => apply(item, { ...alipayHoldingDraft(item), profit: '201' })).toThrow('金额与收益不一致');
    expect(() => apply(item, { ...alipayHoldingDraft(item), mode: 'shares', shares: '-1' })).toThrow('份额');
  });
});
