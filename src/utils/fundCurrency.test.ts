import { describe, expect, it } from 'vitest';
import type { InvestPositionItem, InvestPositionItems } from '../models/types';
import { normalizeMonthlyRecords } from '../stores/monthlyStore';
import { emptyMonthlyRecord } from './investmentRollover';
import { calculateInvestPositionMetric, calculateInvestPositionMonthlyProfit, normalizeFundPositionCurrencies, summarizeInvestPositionItems } from './investPositionItems';
import { investPositionDraftGroupsFromItems, investPositionItemsFromDraftGroups } from './investPositionDrafts';
import { inferInvestmentProfitFromBaseline } from './investTransactionProfit';

const mislabeled: InvestPositionItem = {
  id: 'icbc-bond-c', name: '工银全球美元债C', symbol: '003387', quoteSource: 'eastmoney-fund',
  status: 'paused', quoteCurrency: 'USD', historicalProfitCurrency: 'USD',
  historicalProfitCny: -36.84, profitInputMode: 'historical',
  lastPrice: 0.963, lastCurrency: 'USD', lastFxRateToCny: 7,
  marketValueCny: 0, holdingProfitCny: 0,
};

describe('人民币美元债旧数据修复', () => {
  it.each(['active', 'paused', 'closed'] as const)('刷新修复 %s 条目及分类收益，保留录入金额、净值和分类', (status) => {
    const original = { ...emptyMonthlyRecord('2026-10'), investmentCategoryRepairVersion: 2,
      investPositionItems: { usBond: [{ ...mislabeled, status }] } };
    const repaired = normalizeMonthlyRecords(JSON.parse(JSON.stringify([original])))[0];
    const item = repaired.investPositionItems!.usBond![0];
    expect(item).toMatchObject({
      id: mislabeled.id, symbol: '003387', status, quoteCurrency: 'CNY', historicalProfitCurrency: 'CNY',
      historicalProfitCny: -36.84, lastPrice: 0.963, lastCurrency: 'CNY', lastFxRateToCny: 1,
    });
    expect(calculateInvestPositionMetric(item)).toMatchObject({ totalProfitCny: -36.84, profitCurrency: 'CNY', profitFxRateToCny: 1 });
    expect(repaired.investBreakdownPastProfit?.usBond).toBe(-36.84);
    expect(normalizeMonthlyRecords([repaired])).toEqual([repaired]);
    expect(original.investPositionItems.usBond[0].quoteCurrency).toBe('USD');
  });

  it('有份额的旧缓存按人民币重新计算市值和持有收益', () => {
    const items = normalizeFundPositionCurrencies({ usBond: [{ ...mislabeled, shares: 100, costPrice: 1,
      marketValueCny: 674.1, holdingProfitCny: -25.9 }] });
    expect(items.usBond![0]).toMatchObject({ shares: 100, costPrice: 1, marketValueCny: 96.3, holdingProfitCny: -3.7 });
    expect(summarizeInvestPositionItems(items)).toMatchObject({ totalMarketValueCny: 96.3, totalProfitCny: -40.54 });
    const saved = investPositionItemsFromDraftGroups(investPositionDraftGroupsFromItems(items));
    expect(summarizeInvestPositionItems(saved).totalProfitCny).toBe(-40.54);
  });

  it('历史账户和待归类条目打开编辑时也修复，美元份额及股票不变', () => {
    const usd = { ...mislabeled, id: 'usd', symbol: '003386' };
    const stock = { ...mislabeled, id: 'stock', quoteSource: 'yahoo' as const };
    const items: InvestPositionItems = { account: [mislabeled], aggregate: [{ ...mislabeled, symbol: 'OF003385' }], usBond: [usd, stock] };
    const saved = investPositionItemsFromDraftGroups(investPositionDraftGroupsFromItems(items));
    expect(saved.account![0]).toMatchObject({ quoteCurrency: 'CNY', historicalProfitCny: -36.84 });
    expect(saved.aggregate![0]).toMatchObject({ quoteCurrency: 'CNY', historicalProfitCny: -36.84 });
    expect(saved.usBond!.map((item) => item.quoteCurrency)).toEqual(['USD', 'USD']);
    const unaffected = { usBond: [usd, stock] };
    expect(normalizeFundPositionCurrencies(unaffected)).toBe(unaffected);
  });

  it('当前月和历史月同时修复后，月收益不再乘美元汇率', () => {
    const holding = { ...mislabeled, shares: 100, costPrice: 1 };
    const records = normalizeMonthlyRecords([
      { ...emptyMonthlyRecord('2026-09'), investPositionItems: { usBond: [{ ...holding, historicalProfitCny: -30, lastFxRateToCny: 6.8 }] } },
      { ...emptyMonthlyRecord('2026-10'), investPositionItems: { usBond: [holding] } },
    ]);
    const monthly = calculateInvestPositionMonthlyProfit(records[0].investPositionItems!, records[1].investPositionItems!);
    expect(monthly.byItemId[mislabeled.id]).toEqual({ value: -6.84, currency: 'CNY' });
    expect(monthly.totalCny).toBe(-6.84);
  });

  it('旧收益基准中的币种也纠正，不会与修复后的持仓发生冲突', () => {
    const current = normalizeFundPositionCurrencies({ usBond: [mislabeled] });
    const result = inferInvestmentProfitFromBaseline({ date: '2026-10-01', yearMonth: '2026-10', createdAt: '2026-10-01',
      positionItems: { usBond: [mislabeled] } }, current, summarizeInvestPositionItems(current), [], '2026-10-19');
    expect(result.mismatchedItems).toEqual([]);
    expect(result.totalProfitCny).toBe(-36.84);
    expect(result.profitsByItemId[mislabeled.id]).toEqual({ value: -36.84, currency: 'CNY' });
  });
});
