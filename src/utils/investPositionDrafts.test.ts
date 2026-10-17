import { describe, expect, it } from 'vitest';
import type { InvestPositionItem, InvestPositionItems } from '../models/types';
import { INVEST_POSITION_KEYS, summarizeInvestPositionItems } from './investPositionItems';
import { canSplitInvestPositionAccount, investPositionDraftGroupsFromItems, investPositionItemsFromDraftGroups, moveInvestPositionDraft, splitInvestPositionDraft, type PositionSplitInput } from './investPositionDrafts';

const splitItem: InvestPositionItem = {
  id: 'split-bond', name: '美元债测试基金', symbol: '003386', quoteSource: 'eastmoney-fund',
  quoteCurrency: 'USD', historicalProfitCurrency: 'USD', status: 'closed',
  historicalProfitCny: -12.34, profitInputMode: 'historical', marketValueCny: 0, holdingProfitCny: 0,
  lastFxRateToCny: 7,
};
const reload = (items: InvestPositionItems) => investPositionItemsFromDraftGroups(investPositionDraftGroupsFromItems(JSON.parse(JSON.stringify(items))));

describe('支付宝 past 汇总拆分', () => {
  const account: InvestPositionItem = {
    id: 'alipay-past', name: '支付宝past', symbol: 'LEGACY-ACCOUNT', status: 'closed',
    historicalProfitCny: -95.67, historicalProfitCurrency: 'CNY', profitInputMode: 'historical',
  };
  const input: PositionSplitInput = {
    sourceGroupKey: 'account', sourceId: account.id, name: '测试基金', symbol: '000001',
    quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY', splitMarketValueCny: 0,
    splitTotalProfitOriginal: -12.34, holdingProfitAtSplitCny: 0, profitCurrency: 'CNY', profitFxRateToCny: 1,
  };

  it.each(['支付宝past', '支付宝 PAST', '🔵支付宝 past'])('带旧代码的 %s 仍可拆分', (name) => {
    expect(canSplitInvestPositionAccount({ ...account, name })).toBe(true);
  });

  it('普通股票基金不因为处于 past 或名称包含支付宝就成为汇总账户', () => {
    expect(canSplitInvestPositionAccount(splitItem)).toBe(false);
    expect(canSplitInvestPositionAccount({ name: '支付宝past测试基金', symbol: '000001' })).toBe(false);
    expect(canSplitInvestPositionAccount({ name: '自定义汇总账户', symbol: '' })).toBe(true);
  });

  it('分出负收益后保留账户及剩余收益，刷新后合计不变', () => {
    const drafts = investPositionDraftGroupsFromItems({ account: [account] });
    const split = splitInvestPositionDraft(drafts, input, 'child');
    const saved = reload(investPositionItemsFromDraftGroups(split));
    expect(saved.account).toEqual([
      expect.objectContaining({ ...account, historicalProfitCny: -83.33 }),
      expect.objectContaining({ id: 'child', name: '测试基金', status: 'closed', historicalProfitCny: -12.34 }),
    ]);
    expect(summarizeInvestPositionItems(saved).totalProfitCny).toBe(-95.67);
    expect(drafts.account[0].historicalProfitCny).toBe('-95.67');
  });

  it('分出美元收益后保留换算汇率，继续移到 now 也不改变收益合计', () => {
    const drafts = investPositionDraftGroupsFromItems({ account: [account] });
    const split = splitInvestPositionDraft(drafts, { ...input, quoteCurrency: 'USD', profitCurrency: 'USD',
      splitTotalProfitOriginal: -10, profitFxRateToCny: 7 }, 'child');
    const saved = reload(investPositionItemsFromDraftGroups(split));
    expect(saved.account?.[0].historicalProfitCny).toBe(-25.67);
    expect(saved.account?.[1]).toMatchObject({ historicalProfitCny: -10, lastFxRateToCny: 7, historicalProfitCurrency: 'USD' });
    expect(summarizeInvestPositionItems(saved).totalProfitCny).toBe(-95.67);
    const moved = moveInvestPositionDraft(investPositionDraftGroupsFromItems(saved), 'account', 'child', 'usBond', 'active');
    expect(summarizeInvestPositionItems(reload(investPositionItemsFromDraftGroups(moved))).totalProfitCny).toBe(-95.67);
  });

  it('有持仓金额的汇总账户仍可拆分，超过余额时不修改', () => {
    const drafts = investPositionDraftGroupsFromItems({ aggregate: [{ ...account, symbol: '', status: 'paused',
      marketValueCny: 1000, historicalProfitCny: 50, holdingProfitCny: 10 }] });
    const splitInput = { ...input, sourceGroupKey: 'aggregate' as const, splitMarketValueCny: 300,
      splitTotalProfitOriginal: 15, holdingProfitAtSplitCny: 20, shares: 200, costPrice: 1.4 };
    const split = splitInvestPositionDraft(drafts, splitInput, 'child');
    const saved = reload(investPositionItemsFromDraftGroups(split));
    expect(saved.aggregate?.[1]).toMatchObject({ marketValueCny: 300, historicalProfitCny: -5, shares: 200, costPrice: 1.4 });
    expect(summarizeInvestPositionItems(saved)).toMatchObject({ totalMarketValueCny: 1000, totalProfitCny: 60 });
    expect(splitInvestPositionDraft(drafts, { ...splitInput, splitMarketValueCny: 1001 }, 'child')).toBe(drafts);
  });
});

describe('拆分条目移动', () => {
  it.each(INVEST_POSITION_KEYS)('历史账户中的条目可直接移至 %s / now，保存后仍保留原收益与币种', (category) => {
    const parent: InvestPositionItem = { id: 'parent', name: '支付宝', symbol: '', status: 'closed', historicalProfitCny: 250.48 };
    const items = { account: [parent, splitItem] };
    const drafts = investPositionDraftGroupsFromItems(items);
    const moved = moveInvestPositionDraft(drafts, 'account', splitItem.id, category, 'active');
    const saved = reload(investPositionItemsFromDraftGroups(moved));

    expect(saved.account).toEqual([expect.objectContaining(parent)]);
    expect(saved[category]).toEqual([expect.objectContaining({ ...splitItem, status: 'active' })]);
    expect(summarizeInvestPositionItems(saved).totalProfitCny).toBe(summarizeInvestPositionItems(items).totalProfitCny);
    expect(drafts.account).toHaveLength(2);
  });

  it('只修改分类时仍留在 past，累计亏损不变', () => {
    const drafts = investPositionDraftGroupsFromItems({ account: [splitItem] });
    const moved = moveInvestPositionDraft(drafts, 'account', splitItem.id, 'usBond');
    expect(reload(investPositionItemsFromDraftGroups(moved)).usBond?.[0]).toMatchObject({
      status: 'paused', historicalProfitCny: -12.34, quoteCurrency: 'USD',
    });
  });

  it('待归类账户移至 now 后保留份额、成本、市值及历史收益', () => {
    const item: InvestPositionItem = { ...splitItem, status: 'paused', shares: 100.1234, costPrice: 1.0345,
      marketValueCny: 770.95, holdingProfitCny: 45.91, historicalProfitCny: 12.34 };
    const drafts = investPositionDraftGroupsFromItems({ aggregate: [item] });
    const moved = moveInvestPositionDraft(drafts, 'aggregate', item.id, 'usBond', 'active');
    const saved = reload(investPositionItemsFromDraftGroups(moved));
    expect(saved.aggregate).toBeUndefined();
    expect(saved.usBond?.[0]).toMatchObject({ ...item, status: 'active' });
    expect(summarizeInvestPositionItems(saved).totalProfitCny).toBe(summarizeInvestPositionItems({ aggregate: [item] }).totalProfitCny);
    expect(summarizeInvestPositionItems(saved).totalMarketValueCny).toBe(770.95);
  });

  it('历史账户已有的份额和成本不会在移动时清零', () => {
    const drafts = investPositionDraftGroupsFromItems({ account: [{ ...splitItem, shares: 25.1234, costPrice: 1.2345 }] });
    const moved = moveInvestPositionDraft(drafts, 'account', splitItem.id, 'usBond', 'active');
    expect(reload(investPositionItemsFromDraftGroups(moved)).usBond?.[0]).toMatchObject({
      shares: 25.1234, costPrice: 1.2345, historicalProfitCny: -12.34,
    });
  });

  it('同一分类可往返 now / past，保持顺序且不重复条目', () => {
    const items = { usBond: [{ ...splitItem, status: 'active' as const }, { ...splitItem, id: 'other', status: 'active' as const }] };
    let drafts = investPositionDraftGroupsFromItems(items);
    drafts = moveInvestPositionDraft(drafts, 'usBond', splitItem.id, 'usBond', 'paused');
    expect(reload(investPositionItemsFromDraftGroups(drafts)).usBond?.map((item) => [item.id, item.status])).toEqual([
      [splitItem.id, 'paused'], ['other', 'active'],
    ]);
    drafts = moveInvestPositionDraft(drafts, 'usBond', splitItem.id, 'usBond', 'active');
    expect(reload(investPositionItemsFromDraftGroups(drafts)).usBond?.[0]).toMatchObject({ ...splitItem, status: 'active' });
  });

  it('跨分类时保留待确认买入并同步目标分类', () => {
    const pending = { id: 'pending', matchKey: 'key', baseMatchKey: 'base', operationAt: '2026-10-16T10:00:00',
      name: splitItem.name, symbol: splitItem.symbol, currency: 'USD', groupKey: 'a' as const, amount: 100 };
    const drafts = investPositionDraftGroupsFromItems({ a: [{ ...splitItem, status: 'paused', pendingBuys: [pending] }] });
    const moved = moveInvestPositionDraft(drafts, 'a', splitItem.id, 'usBond', 'active');
    expect(reload(investPositionItemsFromDraftGroups(moved)).usBond?.[0].pendingBuys).toEqual([{ ...pending, groupKey: 'usBond' }]);
    expect(drafts.a[0].pendingBuys).toEqual([pending]);
  });

  it('无代码的历史条目移到美股时继续以人民币计收益', () => {
    const item = { ...splitItem, symbol: '', quoteCurrency: undefined, historicalProfitCurrency: 'CNY', historicalProfitCny: -95.67 };
    const drafts = investPositionDraftGroupsFromItems({ account: [item] });
    const moved = moveInvestPositionDraft(drafts, 'account', splitItem.id, 'us', 'active');
    const saved = reload(investPositionItemsFromDraftGroups(moved));
    expect(saved.us?.[0].quoteCurrency).toBe('CNY');
    expect(summarizeInvestPositionItems(saved).totalProfitCny).toBe(-95.67);
  });
});
