import type {
  InvestmentProfitBaseline,
  InvestPositionItem,
  InvestPositionItems,
  InvestmentTransactionRecord,
} from '../models/types';
import type { InvestPositionSummary } from './investPositionItems';
import {
  INVEST_POSITION_KEYS,
  isInvestPositionSummaryItem,
  summarizeInvestPositionItems,
} from './investPositionItems';

export interface InferredInvestmentProfit {
  totalProfitCny: number | null;
  transactionCount: number;
  mismatchedItems: string[];
}

export interface BaselineInferredInvestmentProfit extends InferredInvestmentProfit {
  profitsByItemId: Record<string, { value: number; currency: string }>;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

function instrumentKey(item: Pick<InvestPositionItem, 'symbol' | 'name'>, groupKey: string) {
  const symbol = item.symbol.trim().toUpperCase();
  return symbol
    ? `${groupKey}:symbol:${symbol}`
    : `${groupKey}:name:${item.name.trim().toLowerCase()}`;
}

function currenciesMatch(left: string, right: string) {
  if (left === right) return true;
  return ['CNY', 'CNH'].includes(left) && ['CNY', 'CNH'].includes(right);
}

function quoteCurrency(item: InvestPositionItem, metric: InvestPositionSummary['metricsById'][string]) {
  return (metric?.currency || item.quoteCurrency || item.lastCurrency || metric?.profitCurrency || 'CNY').toUpperCase();
}

function quoteFxRate(
  item: InvestPositionItem,
  metric: InvestPositionSummary['metricsById'][string],
  currency: string,
  fallbackFxRates: Record<string, number>,
) {
  if (['CNY', 'CNH'].includes(currency)) return 1;
  return metric?.fxRateToCny
    || item.lastFxRateToCny
    || fallbackFxRates[currency]
    || (metric?.profitCurrency === currency ? metric.profitFxRateToCny : 0);
}

export function inferInvestmentProfitFromBaseline(
  baseline: InvestmentProfitBaseline,
  currentItems: InvestPositionItems,
  currentSummary: InvestPositionSummary,
  transactions: InvestmentTransactionRecord[],
  throughDate: string,
  fallbackFxRates: Record<string, number> = {},
): BaselineInferredInvestmentProfit {
  const baselineSummary = summarizeInvestPositionItems(baseline.positionItems);
  const states = new Map<string, {
    name: string;
    shares: number;
    cash: number;
    currency: string;
  }>();
  const mismatchedItems: string[] = [];

  for (const groupKey of INVEST_POSITION_KEYS) {
    for (const item of baseline.positionItems[groupKey] ?? []) {
      const metric = baselineSummary.metricsById[item.id];
      const currency = quoteCurrency(item, metric);
      const fxRateToCny = quoteFxRate(item, metric, currency, fallbackFxRates);
      const shares = Math.max(Number(item.shares) || 0, 0);
      if (!(fxRateToCny > 0) || (shares > 0.0002 && !(metric?.marketValueCny > 0))) {
        mismatchedItems.push(item.name || item.symbol || '基准持仓');
        continue;
      }
      states.set(instrumentKey(item, groupKey), {
        name: item.name || item.symbol,
        shares,
        cash: (metric?.totalProfitCny ?? 0) / fxRateToCny - (metric?.marketValueCny ?? 0) / fxRateToCny,
        currency,
      });
    }
  }

  const uniqueTransactions = new Map(
    transactions
      .filter((transaction) => transaction.date > baseline.date && transaction.date <= throughDate)
      .map((transaction) => [transaction.id, transaction]),
  );
  for (const transaction of uniqueTransactions.values()) {
    const key = instrumentKey(transaction, transaction.groupKey);
    const transactionCurrency = transaction.currency.toUpperCase();
    const state = states.get(key) ?? {
      name: transaction.name || transaction.symbol,
      shares: 0,
      cash: 0,
      currency: transactionCurrency,
    };
    if (!currenciesMatch(state.currency, transactionCurrency)) {
      mismatchedItems.push(state.name || key);
      continue;
    }
    const gross = transaction.shares * transaction.price;
    state.shares += transaction.side === 'buy' ? transaction.shares : -transaction.shares;
    state.cash += transaction.side === 'buy' ? -(gross + transaction.fee) : gross - transaction.fee;
    states.set(key, state);
  }

  const currentByKey = new Map<string, InvestPositionItem>();
  for (const groupKey of INVEST_POSITION_KEYS) {
    for (const item of currentItems[groupKey] ?? []) {
      currentByKey.set(instrumentKey(item, groupKey), item);
    }
  }

  const profitsByItemId: BaselineInferredInvestmentProfit['profitsByItemId'] = {};
  let totalProfitCny = 0;
  for (const [key, state] of states) {
    const item = currentByKey.get(key);
    if (!item) {
      mismatchedItems.push(state.name || key);
      continue;
    }
    const metric = currentSummary.metricsById[item.id];
    const actualShares = Math.max(Number(item.shares) || 0, 0);
    if (Math.abs(state.shares - actualShares) > 0.0002) {
      mismatchedItems.push(state.name || key);
      continue;
    }
    const currency = quoteCurrency(item, metric);
    if (!currenciesMatch(currency, state.currency)) {
      mismatchedItems.push(state.name || key);
      continue;
    }
    const fxRateToCny = quoteFxRate(item, metric, currency, fallbackFxRates);
    if (!(fxRateToCny > 0) || (actualShares > 0.0002 && !(metric?.marketValueCny > 0))) {
      mismatchedItems.push(state.name || key);
      continue;
    }
    const totalProfitInQuoteCurrency = state.cash + (metric?.marketValueCny ?? 0) / fxRateToCny;
    const totalProfitCnyForItem = totalProfitInQuoteCurrency * fxRateToCny;
    const profitCurrency = isInvestPositionSummaryItem(item)
      ? 'CNY'
      : (item.historicalProfitCurrency || currency).toUpperCase();
    const profitFxRateToCny = ['CNY', 'CNH'].includes(profitCurrency)
      ? 1
      : metric?.profitFxRateToCny || fallbackFxRates[profitCurrency] || fxRateToCny;
    profitsByItemId[item.id] = {
      value: roundMoney(totalProfitCnyForItem / profitFxRateToCny),
      currency: profitCurrency,
    };
    totalProfitCny += totalProfitCnyForItem;
  }

  for (const [key, item] of currentByKey) {
    const metric = currentSummary.metricsById[item.id];
    const hasRecordedValue = (Number(item.shares) || 0) > 0.0002
      || Math.abs(metric?.marketValueCny ?? 0) > 0.005
      || Math.abs(metric?.totalProfitCny ?? 0) > 0.005;
    if (hasRecordedValue && !states.has(key)) mismatchedItems.push(item.name || item.symbol || key);
  }

  for (const groupKey of ['account', 'aggregate'] as const) {
    for (const item of currentItems[groupKey] ?? []) {
      totalProfitCny += currentSummary.metricsById[item.id]?.totalProfitCny ?? 0;
    }
  }

  const uniqueMismatches = [...new Set(mismatchedItems)];
  return {
    totalProfitCny: uniqueMismatches.length === 0 ? roundMoney(totalProfitCny) : null,
    transactionCount: uniqueTransactions.size,
    mismatchedItems: uniqueMismatches,
    profitsByItemId,
  };
}

export function inferInvestmentProfitFromTransactions(
  items: InvestPositionItems,
  summary: InvestPositionSummary,
  transactions: InvestmentTransactionRecord[],
  throughDate: string,
  fallbackFxRates: Record<string, number> = {},
): InferredInvestmentProfit {
  const uniqueTransactions = new Map(
    transactions
      .filter((transaction) => transaction.date <= throughDate)
      .map((transaction) => [transaction.id, transaction]),
  );
  if (uniqueTransactions.size === 0) {
    return { totalProfitCny: null, transactionCount: 0, mismatchedItems: [] };
  }

  const positionsByKey = new Map<string, InvestPositionItem>();
  const fxByCurrency = new Map<string, number>([
    ['CNY', 1],
    ['CNH', 1],
    ...Object.entries(fallbackFxRates)
      .filter(([, rate]) => Number.isFinite(rate) && rate > 0)
      .map(([currency, rate]) => [currency.toUpperCase(), rate] as [string, number]),
  ]);
  for (const groupKey of INVEST_POSITION_KEYS) {
    for (const item of items[groupKey] ?? []) {
      positionsByKey.set(instrumentKey(item, groupKey), item);
      const metric = summary.metricsById[item.id];
      const currency = (metric?.currency || metric?.profitCurrency)?.toUpperCase();
      const fxRateToCny = metric?.fxRateToCny ?? metric?.profitFxRateToCny;
      if (currency && fxRateToCny && fxRateToCny > 0) {
        fxByCurrency.set(currency, fxRateToCny);
      }
    }
  }

  const flows = new Map<string, {
    name: string;
    shares: number;
    cash: number;
    currency: string;
  }>();
  for (const transaction of uniqueTransactions.values()) {
    const key = instrumentKey(transaction, transaction.groupKey);
    const current = flows.get(key) ?? {
      name: transaction.name || transaction.symbol,
      shares: 0,
      cash: 0,
      currency: transaction.currency.toUpperCase(),
    };
    const gross = transaction.shares * transaction.price;
    current.shares += transaction.side === 'buy' ? transaction.shares : -transaction.shares;
    current.cash += transaction.side === 'buy'
      ? -(gross + transaction.fee)
      : gross - transaction.fee;
    flows.set(key, current);
  }

  const mismatchedItems: string[] = [];
  let totalProfitCny = 0;
  for (const [key, flow] of flows) {
    const item = positionsByKey.get(key);
    const actualShares = Math.max(Number(item?.shares) || 0, 0);
    if (Math.abs(flow.shares - actualShares) > 0.0002) {
      mismatchedItems.push(flow.name || key);
      continue;
    }
    const metric = item ? summary.metricsById[item.id] : undefined;
    const metricCurrency = metric?.currency?.toUpperCase();
    if (metricCurrency && metricCurrency !== flow.currency && !(['CNY', 'CNH'].includes(metricCurrency) && ['CNY', 'CNH'].includes(flow.currency))) {
      mismatchedItems.push(flow.name || key);
      continue;
    }
    const fxRateToCny = metric?.fxRateToCny ?? fxByCurrency.get(flow.currency);
    if (!fxRateToCny || fxRateToCny <= 0) {
      mismatchedItems.push(flow.name || key);
      continue;
    }
    const marketValueOriginal = actualShares > 0
      ? (metric?.marketValueCny ?? 0) / (metric?.fxRateToCny || fxRateToCny)
      : 0;
    if (actualShares > 0 && (!metric || !(metric.marketValueCny > 0))) {
      mismatchedItems.push(flow.name || key);
      continue;
    }
    totalProfitCny += (flow.cash + marketValueOriginal) * fxRateToCny;
  }

  for (const [key, item] of positionsByKey) {
    const metric = summary.metricsById[item.id];
    const hasRecordedValue = (Number(item.shares) || 0) > 0.0002
      || Math.abs(metric?.marketValueCny ?? 0) > 0.005
      || Math.abs(metric?.totalProfitCny ?? 0) > 0.005;
    if (hasRecordedValue && !flows.has(key)) {
      mismatchedItems.push(item.name || item.symbol || key);
    }
  }
  return {
    totalProfitCny: mismatchedItems.length === 0 ? roundMoney(totalProfitCny) : null,
    transactionCount: uniqueTransactions.size,
    mismatchedItems: [...new Set(mismatchedItems)],
  };
}
