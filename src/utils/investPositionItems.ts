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

export function investPositionQuoteKey(item: Pick<InvestPositionItem, 'symbol' | 'quoteSource'>) {
  return `${item.quoteSource ?? 'yahoo'}:${item.symbol.trim().toUpperCase()}`;
}

export function calculateInvestPositionMetric(
  item: InvestPositionItem,
  market?: InvestMarketSnapshot,
): InvestPositionMetric {
  const profitCurrency = (item.historicalProfitCurrency || item.quoteCurrency || market?.currency || item.lastCurrency || 'CNY').toUpperCase();
  const profitFxRateToCny = ['CNY', 'CNH'].includes(profitCurrency)
    ? 1
    : (market?.fxRateToCny ?? finiteOrZero(item.lastFxRateToCny)) || 1;
  // 兼容既有数据字段名：historicalProfitCny 实际保存的是用户手填的累计收益。
  const cumulativeProfitCny = roundMoney(finiteOrZero(item.historicalProfitCny) * profitFxRateToCny);
  if (item.status === 'closed') {
    return {
      marketValueCny: 0,
      holdingProfitCny: 0,
      historicalProfitCny: cumulativeProfitCny,
      totalProfitCny: cumulativeProfitCny,
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
  const historicalProfitCny = roundMoney(cumulativeProfitCny - holdingProfitCny);

  return {
    marketValueCny,
    holdingProfitCny,
    historicalProfitCny,
    totalProfitCny: cumulativeProfitCny,
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
        historicalProfitCny: holdingProfitCny,
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
    }];
  }
  return items;
}
