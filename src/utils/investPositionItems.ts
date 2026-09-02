import type {
  InvestHoldings,
  InvestKey,
  InvestPositionGroupKey,
  InvestPositionItem,
  InvestPositionItems,
  MonthlyRecord,
} from '../models/types';

export const INVEST_POSITION_KEYS: InvestKey[] = ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'];
export const INVEST_POSITION_GROUP_KEYS: InvestPositionGroupKey[] = [...INVEST_POSITION_KEYS, 'account', 'aggregate'];

export interface InvestMarketSnapshot {
  price: number;
  currency: string;
  fxRateToCny: number;
  live?: boolean;
  quoteAt?: string;
}

export interface InvestPositionMetric {
  marketValueCny: number;
  holdingProfitCny: number;
  historicalProfitCny: number;
  totalProfitCny: number;
  profitCurrency: string;
  profitFxRateToCny: number;
  live: boolean;
  price?: number;
  currency?: string;
  fxRateToCny?: number;
  quoteAt?: string;
}

export interface InvestPositionSummary {
  marketValueByCategory: InvestHoldings;
  holdingProfitByCategory: InvestHoldings;
  historicalProfitByCategory: InvestHoldings;
  accountHistoricalProfitCny: number;
  aggregateMarketValueCny: number;
  aggregateProfitCny: number;
  totalMarketValueCny: number;
  totalProfitCny: number;
  metricsById: Record<string, InvestPositionMetric>;
}

export interface InvestPositionMonthlyProfit {
  totalCny: number | null;
  byCategory: Partial<Record<InvestKey, number | null>>;
  byItemId: Record<string, { value: number; currency: string } | null>;
}

const emptyHoldings = (): InvestHoldings => ({
  us: 0,
  eu: 0,
  asia: 0,
  a: 0,
  longBond: 0,
  usBond: 0,
  gold: 0,
});

const finiteOrZero = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const roundShares = (value: number) => Math.round(value * 10000) / 10000;

export function investPositionQuoteKey(item: Pick<InvestPositionItem, 'symbol' | 'quoteSource'>) {
  return `${item.quoteSource ?? 'yahoo'}:${item.symbol.trim().toUpperCase()}`;
}

export function isInvestPositionSummaryItem(item: Pick<InvestPositionItem, 'symbol'>) {
  return item.symbol.trim().length === 0;
}

function investPositionComparisonKey(item: Pick<InvestPositionItem, 'name' | 'symbol' | 'quoteSource'>) {
  return isInvestPositionSummaryItem(item)
    ? `summary:${item.name.trim().toLowerCase()}`
    : `instrument:${investPositionQuoteKey(item)}`;
}

export function calculateInvestPositionMetric(
  item: InvestPositionItem,
  market?: InvestMarketSnapshot,
): InvestPositionMetric {
  const profitCurrency = isInvestPositionSummaryItem(item)
    ? 'CNY'
    : (item.historicalProfitCurrency || item.quoteCurrency || market?.currency || item.lastCurrency || 'CNY').toUpperCase();
  const profitFxRateToCny = ['CNY', 'CNH'].includes(profitCurrency)
    ? 1
    : (market?.fxRateToCny ?? finiteOrZero(item.lastFxRateToCny)) || 1;
  const storedProfitCny = roundMoney(finiteOrZero(item.historicalProfitCny) * profitFxRateToCny);
  if (item.status === 'closed') {
    return {
      marketValueCny: 0,
      holdingProfitCny: 0,
      historicalProfitCny: storedProfitCny,
      totalProfitCny: storedProfitCny,
      profitCurrency,
      profitFxRateToCny,
      live: false,
    };
  }

  const shares = Math.max(finiteOrZero(item.shares), 0);
  const hasExplicitShares = item.shares !== undefined;
  const costPrice = Math.max(finiteOrZero(item.costPrice), 0);
  const hasLiveMarket = Boolean(
    market
    && Number.isFinite(market.price)
    && market.price > 0
    && Number.isFinite(market.fxRateToCny)
    && market.fxRateToCny > 0,
  );
  const canCalculatePosition = hasLiveMarket && shares > 0;
  const marketValueCny = hasExplicitShares && shares === 0
    ? 0
    : canCalculatePosition
    ? roundMoney(shares * market!.price * market!.fxRateToCny)
    : roundMoney(Math.max(finiteOrZero(item.marketValueCny), 0));
  const holdingProfitCny = hasExplicitShares && shares === 0
    ? 0
    : canCalculatePosition && costPrice > 0
    ? roundMoney((market!.price - costPrice) * shares * market!.fxRateToCny)
    : roundMoney(finiteOrZero(item.holdingProfitCny));
  // 旧数据保存的是累计收益；首次读取时减去当时的持有收益，还原成历史收益。
  const historicalProfitCny = item.profitInputMode === 'historical'
    ? storedProfitCny
    : roundMoney(storedProfitCny - finiteOrZero(item.holdingProfitCny));
  const totalProfitCny = roundMoney(historicalProfitCny + holdingProfitCny);

  return {
    marketValueCny,
    holdingProfitCny,
    historicalProfitCny,
    totalProfitCny,
    profitCurrency,
    profitFxRateToCny,
    live: hasLiveMarket && market?.live !== false,
    price: hasLiveMarket ? market!.price : item.lastPrice,
    currency: hasLiveMarket ? market!.currency : item.lastCurrency,
    fxRateToCny: hasLiveMarket ? market!.fxRateToCny : item.lastFxRateToCny,
    quoteAt: hasLiveMarket ? market!.quoteAt : item.quoteAt,
  };
}

export function summarizeInvestPositionItems(
  items: InvestPositionItems,
  marketsBySymbol: Record<string, InvestMarketSnapshot | undefined> = {},
): InvestPositionSummary {
  const marketValueByCategory = emptyHoldings();
  const holdingProfitByCategory = emptyHoldings();
  const historicalProfitByCategory = emptyHoldings();
  const metricsById: Record<string, InvestPositionMetric> = {};

  for (const key of INVEST_POSITION_KEYS) {
    for (const item of items[key] ?? []) {
      const normalizedSymbol = item.symbol.trim().toUpperCase();
      const market = item.symbol
        ? marketsBySymbol[investPositionQuoteKey(item)] ?? marketsBySymbol[normalizedSymbol]
        : undefined;
      const metric = calculateInvestPositionMetric(item, market);
      metricsById[item.id] = metric;
      marketValueByCategory[key] += metric.marketValueCny;
      holdingProfitByCategory[key] += metric.holdingProfitCny;
      historicalProfitByCategory[key] += metric.historicalProfitCny;
    }
    marketValueByCategory[key] = roundMoney(marketValueByCategory[key]);
    holdingProfitByCategory[key] = roundMoney(holdingProfitByCategory[key]);
    historicalProfitByCategory[key] = roundMoney(historicalProfitByCategory[key]);
  }
  let accountHistoricalProfitCny = 0;
  for (const item of items.account ?? []) {
    const metric = calculateInvestPositionMetric({ ...item, status: 'closed' });
    metricsById[item.id] = metric;
    accountHistoricalProfitCny += metric.historicalProfitCny;
  }
  accountHistoricalProfitCny = roundMoney(accountHistoricalProfitCny);

  let aggregateMarketValueCny = 0;
  let aggregateProfitCny = 0;
  for (const item of items.aggregate ?? []) {
    const metric = calculateInvestPositionMetric({ ...item, status: 'paused' });
    metricsById[item.id] = metric;
    aggregateMarketValueCny += metric.marketValueCny;
    aggregateProfitCny += metric.totalProfitCny;
  }
  aggregateMarketValueCny = roundMoney(aggregateMarketValueCny);
  aggregateProfitCny = roundMoney(aggregateProfitCny);

  return {
    marketValueByCategory,
    holdingProfitByCategory,
    historicalProfitByCategory,
    accountHistoricalProfitCny,
    aggregateMarketValueCny,
    aggregateProfitCny,
    totalMarketValueCny: roundMoney(INVEST_POSITION_KEYS.reduce((sum, key) => sum + marketValueByCategory[key], 0) + aggregateMarketValueCny),
    totalProfitCny: roundMoney(INVEST_POSITION_KEYS.reduce(
      (sum, key) => sum + holdingProfitByCategory[key] + historicalProfitByCategory[key],
      0,
    ) + accountHistoricalProfitCny + aggregateProfitCny),
    metricsById,
  };
}

export function syncInvestPositionItems(
  record: MonthlyRecord,
  items: InvestPositionItems,
): MonthlyRecord {
  const summary = summarizeInvestPositionItems(items);
  return {
    ...record,
    investPositionItems: items,
    investBreakdown: summary.marketValueByCategory,
    investBreakdownProfit: summary.holdingProfitByCategory,
    investBreakdownPastProfit: summary.historicalProfitByCategory,
    investTotal: summary.totalMarketValueCny,
  };
}

export function syncInvestPositionCategoryAmounts(
  record: MonthlyRecord,
  amounts: Partial<InvestHoldings>,
): MonthlyRecord {
  const fallbackBreakdown = { ...(record.investBreakdown ?? {}) };
  if (record.investPositionItems === undefined) {
    for (const key of INVEST_POSITION_KEYS) {
      const amount = amounts[key];
      if (amount !== undefined && Number.isFinite(amount)) fallbackBreakdown[key] = roundMoney(Math.max(amount, 0));
    }
    return {
      ...record,
      investBreakdown: fallbackBreakdown,
      investTotal: roundMoney(INVEST_POSITION_KEYS.reduce((sum, key) => sum + finiteOrZero(fallbackBreakdown[key]), 0)),
    };
  }

  const nextItems: InvestPositionItems = Object.fromEntries(
    Object.entries(record.investPositionItems).map(([key, items]) => [
      key,
      items?.map((item) => ({ ...item })),
    ]),
  );

  for (const key of INVEST_POSITION_KEYS) {
    const requestedAmount = amounts[key];
    if (requestedAmount === undefined || !Number.isFinite(requestedAmount)) continue;
    const targetAmount = roundMoney(Math.max(requestedAmount, 0));
    const currentSummary = summarizeInvestPositionItems(nextItems);
    const currentAmount = currentSummary.marketValueByCategory[key];
    const delta = roundMoney(targetAmount - currentAmount);
    if (Math.abs(delta) < 0.01) continue;

    const group = [...(nextItems[key] ?? [])];
    if (delta > 0) {
      const adjustmentId = `reconcile-adjustment:${record.yearMonth}:${key}`;
      const adjustmentIndex = group.findIndex((item) => item.id === adjustmentId);
      const adjustment = adjustmentIndex >= 0 ? group[adjustmentIndex] : undefined;
      const nextAdjustment: InvestPositionItem = {
        ...(adjustment ?? {}),
        id: adjustmentId,
        name: '对账加仓',
        symbol: '',
        status: 'active',
        historicalProfitCny: adjustment?.historicalProfitCny ?? 0,
        historicalProfitCurrency: 'CNY',
        profitInputMode: 'historical',
        marketValueCny: roundMoney(finiteOrZero(adjustment?.marketValueCny) + delta),
        holdingProfitCny: finiteOrZero(adjustment?.holdingProfitCny),
      };
      if (adjustmentIndex >= 0) group[adjustmentIndex] = nextAdjustment;
      else group.push(nextAdjustment);
    } else if (currentAmount > 0) {
      const keepRatio = Math.max(0, Math.min(targetAmount / currentAmount, 1));
      for (let index = 0; index < group.length; index += 1) {
        const item = group[index];
        if (item.status === 'closed') continue;
        const metric = calculateInvestPositionMetric(item);
        const realizedHoldingProfitCny = metric.holdingProfitCny * (1 - keepRatio);
        const nextShares = item.shares === undefined ? undefined : roundShares(Math.max(item.shares, 0) * keepRatio);
        group[index] = {
          ...item,
          status: nextShares === 0 ? 'paused' : item.status,
          shares: nextShares,
          marketValueCny: roundMoney(metric.marketValueCny * keepRatio),
          holdingProfitCny: roundMoney(metric.holdingProfitCny * keepRatio),
          historicalProfitCny: roundMoney(
            (metric.historicalProfitCny + realizedHoldingProfitCny) / metric.profitFxRateToCny,
          ),
          historicalProfitCurrency: metric.profitCurrency,
          profitInputMode: 'historical',
        };
      }
    }
    nextItems[key] = group;
  }

  return syncInvestPositionItems(record, nextItems);
}

export function calculateInvestPositionMonthlyProfit(
  currentItems: InvestPositionItems,
  previousItems: InvestPositionItems | undefined,
  currentMarkets: Record<string, InvestMarketSnapshot | undefined> = {},
  previousMarkets: Record<string, InvestMarketSnapshot | undefined> = {},
): InvestPositionMonthlyProfit {
  const byCategory: InvestPositionMonthlyProfit['byCategory'] = {};
  const byItemId: InvestPositionMonthlyProfit['byItemId'] = {};
  const currentSummary = summarizeInvestPositionItems(currentItems, currentMarkets);
  const previousSummary = previousItems
    ? summarizeInvestPositionItems(previousItems, previousMarkets)
    : null;
  let totalCny = 0;
  let hasComparableCategory = false;

  for (const groupKey of INVEST_POSITION_KEYS) {
    const previousGroup = previousItems?.[groupKey] ?? [];
    const previousById = new Map(previousGroup.map((item) => [item.id, item]));
    const previousByStableKey = new Map<string, InvestPositionItem>();
    for (const item of previousGroup) {
      previousByStableKey.set(investPositionComparisonKey(item), item);
    }

    for (const item of currentItems[groupKey] ?? []) {
      if (item.shares !== undefined && finiteOrZero(item.shares) === 0) {
        byItemId[item.id] = null;
        continue;
      }
      const comparisonKey = investPositionComparisonKey(item);
      const previousItemById = previousById.get(item.id);
      const previousItemWithSameId = previousItemById && (
        isInvestPositionSummaryItem(item) && isInvestPositionSummaryItem(previousItemById)
        || investPositionComparisonKey(previousItemById) === comparisonKey
      )
        ? previousItemById
        : undefined;
      const previousItem = previousItemWithSameId ?? previousByStableKey.get(comparisonKey);
      const currentMetric = currentSummary.metricsById[item.id];
      const previousMetric = previousItem ? previousSummary?.metricsById[previousItem.id] : undefined;
      if (
        !currentMetric
        || !previousMetric
        || previousMetric.profitCurrency !== currentMetric.profitCurrency
      ) {
        byItemId[item.id] = null;
        continue;
      }

      const currentOriginal = currentMetric.totalProfitCny / currentMetric.profitFxRateToCny;
      const previousOriginal = previousMetric.totalProfitCny / previousMetric.profitFxRateToCny;
      const value = roundMoney(currentOriginal - previousOriginal);
      byItemId[item.id] = { value, currency: currentMetric.profitCurrency };
    }

    const hasCategoryData = (currentItems[groupKey]?.length ?? 0) > 0
      || (previousItems?.[groupKey]?.length ?? 0) > 0;
    if (previousSummary && hasCategoryData) {
      // 品类本月收益按整个类目的累计收益差计算，包含 now 与 past。
      const currentCategoryProfit = currentSummary.holdingProfitByCategory[groupKey]
        + currentSummary.historicalProfitByCategory[groupKey];
      const previousCategoryProfit = previousSummary.holdingProfitByCategory[groupKey]
        + previousSummary.historicalProfitByCategory[groupKey];
      const categoryCny = roundMoney(currentCategoryProfit - previousCategoryProfit);
      byCategory[groupKey] = categoryCny;
      totalCny += categoryCny;
      hasComparableCategory = true;
    } else {
      byCategory[groupKey] = null;
    }
  }

  return {
    totalCny: hasComparableCategory ? roundMoney(totalCny) : null,
    byCategory,
    byItemId,
  };
}

export function migrateLegacyInvestPositionItems(
  record: MonthlyRecord | undefined,
  labels: Record<InvestKey, string>,
): InvestPositionItems {
  if (record?.investPositionItems !== undefined) {
    return record.investPositionItems;
  }

  const items: InvestPositionItems = {};
  let categorizedProfit = 0;
  for (const key of INVEST_POSITION_KEYS) {
    const marketValueCny = finiteOrZero(record?.investBreakdown?.[key]);
    const holdingProfitCny = finiteOrZero(record?.investBreakdownProfit?.[key]);
    const historicalProfitCny = finiteOrZero(record?.investBreakdownPastProfit?.[key]);
    const categoryItems: InvestPositionItem[] = [];
    if (marketValueCny !== 0 || holdingProfitCny !== 0) {
      categoryItems.push({
        id: `legacy-${record?.yearMonth ?? 'month'}-${key}-holding`,
        name: `原${labels[key]}汇总`,
        symbol: '',
        status: 'active',
        historicalProfitCny: 0,
        historicalProfitCurrency: 'CNY',
        profitInputMode: 'historical',
        marketValueCny,
        holdingProfitCny,
      });
    }
    if (historicalProfitCny !== 0) {
      categoryItems.push({
        id: `legacy-${record?.yearMonth ?? 'month'}-${key}-closed`,
        name: `原${labels[key]}历史`,
        symbol: '',
        status: 'closed',
        historicalProfitCny,
        historicalProfitCurrency: 'CNY',
        profitInputMode: 'historical',
      });
    }
    if (categoryItems.length > 0) items[key] = categoryItems;
    categorizedProfit += holdingProfitCny + historicalProfitCny;
  }

  const uncategorizedProfit = roundMoney(finiteOrZero(record?.accumulatedProfit) - categorizedProfit);
  if (uncategorizedProfit !== 0) {
    items.account = [{
      id: `legacy-${record?.yearMonth ?? 'month'}-account`,
      name: '原未分类收益',
      symbol: '',
      status: 'closed',
      historicalProfitCny: uncategorizedProfit,
      historicalProfitCurrency: 'CNY',
      profitInputMode: 'historical',
    }];
  }
  return items;
}
