import type { InvestKey, InvestPositionGroupKey, InvestPositionItem, InvestPositionItems, InvestQuoteSource } from '../models/types';
import { canonicalInvestmentName } from './investmentInstrument';
import { INVEST_POSITION_GROUP_KEYS, calculateInvestPositionMetric, isInvestPositionSummaryItem, normalizeFundPositionCurrencies } from './investPositionItems';

export type InvestPositionDraft = Omit<InvestPositionItem, 'shares' | 'costPrice' | 'historicalProfitCny' | 'marketValueCny' | 'holdingProfitCny' | 'lastPrice'> & {
  shares: string;
  costPrice: string;
  historicalProfitCny: string;
  marketValueCny: string;
  holdingProfitCny: string;
  lastPrice: string;
};
export type InvestPositionDraftGroups = Record<InvestPositionGroupKey, InvestPositionDraft[]>;

export function defaultInvestQuoteCurrency(groupKey: InvestPositionGroupKey) {
  return groupKey === 'us' || groupKey === 'usBond' ? 'USD' : undefined;
}

function emptyInvestPositionDraftGroups(): InvestPositionDraftGroups {
  return INVEST_POSITION_GROUP_KEYS.reduce<InvestPositionDraftGroups>((groups, key) => {
    groups[key] = [];
    return groups;
  }, {} as InvestPositionDraftGroups);
}

export function investPositionDraftGroupsFromItems(items: InvestPositionItems): InvestPositionDraftGroups {
  items = normalizeFundPositionCurrencies(items);
  const groups = emptyInvestPositionDraftGroups();
  for (const key of INVEST_POSITION_GROUP_KEYS) {
    groups[key] = (items[key] ?? []).map((item) => {
      const metric = calculateInvestPositionMetric(item);
      return {
        ...item,
        status: key === 'account'
          ? 'closed'
          : key === 'aggregate' || item.status === 'closed'
            ? 'paused'
            : item.status,
        shares: item.shares !== undefined
          ? String(item.shares)
          : item.status === 'closed' && key !== 'account'
            ? '0'
            : '',
        costPrice: item.costPrice !== undefined ? String(item.costPrice) : '',
        historicalProfitCny: String(roundCny(metric.historicalProfitCny / metric.profitFxRateToCny)),
        historicalProfitCurrency: isInvestPositionSummaryItem(item)
          ? 'CNY'
          : item.historicalProfitCurrency || item.quoteCurrency || defaultInvestQuoteCurrency(key) || 'CNY',
        profitInputMode: 'historical' as const,
        marketValueCny: item.marketValueCny !== undefined ? String(item.marketValueCny) : '',
        holdingProfitCny: item.holdingProfitCny !== undefined ? String(item.holdingProfitCny) : '',
        lastPrice: item.lastPrice !== undefined ? String(item.lastPrice) : '',
      };
    });
  }
  return groups;
}

function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const roundCny = (value: number) => Math.round(value * 100) / 100;

export function investPositionItemsFromDraftGroups(groups: InvestPositionDraftGroups): InvestPositionItems {
  const items: InvestPositionItems = {};
  for (const key of INVEST_POSITION_GROUP_KEYS) {
    if (groups[key].length === 0) continue;
    items[key] = groups[key].map((draft) => ({
      ...draft,
      symbol: draft.symbol.trim().toUpperCase(),
      shares: numberOrUndefined(draft.shares),
      costPrice: numberOrUndefined(draft.costPrice),
      historicalProfitCny: numberOrUndefined(draft.historicalProfitCny) ?? 0,
      historicalProfitCurrency: isInvestPositionSummaryItem(draft)
        ? 'CNY'
        : draft.historicalProfitCurrency || draft.quoteCurrency || defaultInvestQuoteCurrency(key) || 'CNY',
      profitInputMode: 'historical',
      marketValueCny: numberOrUndefined(draft.marketValueCny),
      holdingProfitCny: numberOrUndefined(draft.holdingProfitCny),
      lastPrice: numberOrUndefined(draft.lastPrice),
      status: key === 'account' ? 'closed' : key === 'aggregate' || draft.status === 'closed' ? 'paused' : draft.status,
    }));
  }
  return items;
}

export function moveInvestPositionDraft(
  groups: InvestPositionDraftGroups,
  sourceGroupKey: InvestPositionGroupKey,
  id: string,
  targetGroupKey: InvestKey,
  targetStatus?: 'active' | 'paused',
): InvestPositionDraftGroups {
  const item = groups[sourceGroupKey].find((position) => position.id === id);
  if (!item) return groups;
  const status = targetStatus ?? (item.status === 'closed' ? 'paused' : item.status);
  if (sourceGroupKey === targetGroupKey && item.status === status) return groups;
  const movedItem: InvestPositionDraft = {
    ...item,
    status,
    quoteCurrency: isInvestPositionSummaryItem(item)
      ? 'CNY'
      : item.quoteCurrency || item.lastCurrency || defaultInvestQuoteCurrency(sourceGroupKey) || item.historicalProfitCurrency || 'CNY',
    pendingBuys: item.pendingBuys?.map((pending) => ({ ...pending, groupKey: targetGroupKey })),
  };
  // Moving a split item must retain its entered shares, cost and profit.
  if (sourceGroupKey === targetGroupKey) {
    return { ...groups, [sourceGroupKey]: groups[sourceGroupKey].map((position) => position.id === id ? movedItem : position) };
  }
  return {
    ...groups,
    [sourceGroupKey]: groups[sourceGroupKey].filter((position) => position.id !== id),
    [targetGroupKey]: [...groups[targetGroupKey], movedItem],
  };
}

export type PositionSplitInput = {
  sourceGroupKey: InvestPositionGroupKey;
  sourceId: string;
  name: string;
  symbol: string;
  quoteSource?: InvestQuoteSource;
  quoteCurrency?: string;
  shares?: number;
  costPrice?: number;
  splitMarketValueCny: number;
  splitTotalProfitOriginal: number;
  holdingProfitAtSplitCny: number;
  profitCurrency: string;
  profitFxRateToCny: number;
};
export function canSplitInvestPositionAccount(item: Pick<InvestPositionItem, 'name' | 'symbol'>) {
  // This legacy aggregate may carry a code, but still represents an account.
  return isInvestPositionSummaryItem(item)
    || canonicalInvestmentName(item.name).replace(/\s+/g, '') === '支付宝past';
}

export function splitInvestPositionDraft(
  groups: InvestPositionDraftGroups,
  input: PositionSplitInput,
  targetId: string,
): InvestPositionDraftGroups {
  if (!input.name.trim() || !Number.isFinite(input.splitMarketValueCny) || input.splitMarketValueCny < 0
    || !Number.isFinite(input.splitTotalProfitOriginal) || !Number.isFinite(input.holdingProfitAtSplitCny)
    || !Number.isFinite(input.profitFxRateToCny) || input.profitFxRateToCny <= 0) return groups;
  if (input.splitMarketValueCny === 0 && input.splitTotalProfitOriginal === 0) return groups;
  const source = groups[input.sourceGroupKey].find((item) => item.id === input.sourceId);
  if (!source || !canSplitInvestPositionAccount(source)) return groups;
  const sourceMarketValue = source.status === 'closed' ? 0 : numberOrUndefined(source.marketValueCny) ?? 0;
  if (input.splitMarketValueCny > sourceMarketValue + 0.01) return groups;
  const sourceProfitCurrency = isInvestPositionSummaryItem(source)
    ? 'CNY'
    : (source.historicalProfitCurrency || defaultInvestQuoteCurrency(input.sourceGroupKey) || 'CNY').toUpperCase();
  const sourceProfitFxRateToCny = ['CNY', 'CNH'].includes(sourceProfitCurrency)
    ? 1
    : source.lastFxRateToCny || input.profitFxRateToCny;
  const splitHistoricalProfitOriginal = roundCny(
    input.splitTotalProfitOriginal - input.holdingProfitAtSplitCny / input.profitFxRateToCny,
  );
  const historicalProfitFromSource = roundCny(
    splitHistoricalProfitOriginal * input.profitFxRateToCny / sourceProfitFxRateToCny,
  );
  const target: InvestPositionDraft = {
    id: targetId,
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    quoteSource: input.quoteSource,
    quoteCurrency: input.quoteCurrency,
    status: source.status,
    shares: input.shares !== undefined ? String(input.shares) : '',
    costPrice: input.costPrice !== undefined ? String(input.costPrice) : '',
    historicalProfitCny: String(splitHistoricalProfitOriginal),
    historicalProfitCurrency: input.profitCurrency,
    profitInputMode: 'historical',
    marketValueCny: String(roundCny(input.splitMarketValueCny)),
    holdingProfitCny: String(roundCny(input.holdingProfitAtSplitCny)),
    lastPrice: '',
    lastFxRateToCny: input.profitFxRateToCny,
  };
  const sourceItems = groups[input.sourceGroupKey].map((item) => item.id === input.sourceId ? {
    ...item,
    marketValueCny: String(roundCny(sourceMarketValue - input.splitMarketValueCny)),
    holdingProfitCny: String(roundCny((numberOrUndefined(item.holdingProfitCny) ?? 0) - input.holdingProfitAtSplitCny)),
    historicalProfitCny: String(roundCny((numberOrUndefined(item.historicalProfitCny) ?? 0) - historicalProfitFromSource)),
  } : item);
  return {
    ...groups,
    [input.sourceGroupKey]: [...sourceItems, target],
  };
}
