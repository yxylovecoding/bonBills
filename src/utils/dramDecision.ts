import type { DramDecisionConfig } from '../models/types';

export interface MarketBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume?: number | null;
}

export interface MarketChartResponse {
  symbol: string;
  currency: string;
  name: string;
  regularMarketPrice: number | null;
  regularMarketTime: string | null;
  source: string;
  bars: MarketBar[];
}

export type DramDecisionKind = 'clear' | 'trim' | 'pause' | 'buy' | 'hold' | 'wait';

export interface DramDecisionResult {
  kind: DramDecisionKind;
  headline: string;
  detail: string;
  latestDate: string;
  latestPrice: number;
  costProfitRate: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  drawdownFromPeak: number;
  peakPrice: number;
  peakDate: string;
  weight: number | null;
  dramValueCny: number | null;
  usStockValueCny: number;
  sellShares: number;
  sellCny: number;
  buyCapacityCny: number;
  clearReasons: string[];
  priceState: {
    aboveMa5: boolean | null;
    aboveMa20: boolean | null;
    twoWeeksBelowMa20: boolean;
    twoWeeksBelowMa60: boolean;
  };
}

export const DEFAULT_DRAM_DECISION: DramDecisionConfig = {
  symbol: 'DRAM',
  shares: 2.8255,
  costPrice: 70.77,
  targetWeight: 0.2,
  hardLimit: 0.25,
  minBuyWeight: 0.1,
  drawdownClear: 0.3,
};

export const normalizeDramDecisionConfig = (
  config?: Partial<DramDecisionConfig>,
): DramDecisionConfig => ({
  ...DEFAULT_DRAM_DECISION,
  ...(config ?? {}),
  symbol: (config?.symbol?.trim() || DEFAULT_DRAM_DECISION.symbol).toUpperCase(),
});

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const roundShares = (value: number) => Math.round(value * 10000) / 10000;

const movingAverage = (values: number[], days: number) => {
  const out: Array<number | null> = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= days) sum -= values[i - days];
    if (i >= days - 1) out[i] = sum / days;
  }
  return out;
};

const weekStartKey = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
};

const lastWeeklyIndexes = (bars: Array<{ date: string }>) => {
  const indexes: number[] = [];
  let currentKey = '';
  for (let i = 0; i < bars.length; i += 1) {
    const key = weekStartKey(bars[i].date);
    if (key !== currentKey) {
      currentKey = key;
      indexes.push(i);
    } else {
      indexes[indexes.length - 1] = i;
    }
  }
  return indexes;
};

const lastTwoWeeksBelow = (
  weeklyIndexes: number[],
  closes: number[],
  ma: Array<number | null>,
) => {
  const lastTwo = weeklyIndexes.slice(-2);
  return lastTwo.length === 2 && lastTwo.every((idx) => ma[idx] !== null && closes[idx] <= ma[idx]!);
};

export function buildDramDecision({
  chart,
  config,
  usdRate,
  usStockValueCny,
}: {
  chart: MarketChartResponse;
  config: DramDecisionConfig;
  usdRate: number | null;
  usStockValueCny: number;
}): DramDecisionResult | null {
  const bars = chart.bars
    .map((bar) => ({ date: bar.date, close: Number(bar.adjClose ?? bar.close) }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length === 0) return null;

  const closes = bars.map((bar) => bar.close);
  const ma5 = movingAverage(closes, 5);
  const ma10 = movingAverage(closes, 10);
  const ma20 = movingAverage(closes, 20);
  const ma60 = movingAverage(closes, 60);
  const lastIndex = bars.length - 1;
  const latest = bars[lastIndex];
  const latestMa5 = ma5[lastIndex];
  const latestMa20 = ma20[lastIndex];
  const latestMa60 = ma60[lastIndex];
  const weeklyIndexes = lastWeeklyIndexes(bars);
  const twoWeeksBelowMa20 = lastTwoWeeksBelow(weeklyIndexes, closes, ma20);
  const twoWeeksBelowMa60 = lastTwoWeeksBelow(weeklyIndexes, closes, ma60);

  let peakPrice = closes[0];
  let peakDate = bars[0].date;
  for (const bar of bars) {
    if (bar.close > peakPrice) {
      peakPrice = bar.close;
      peakDate = bar.date;
    }
  }

  const drawdownFromPeak = latest.close / peakPrice - 1;
  const clearReasons: string[] = [];
  if (twoWeeksBelowMa20) clearReasons.push('连续两周低于 MA20');
  if (-drawdownFromPeak >= config.drawdownClear) clearReasons.push(`高点回撤达到 ${Math.round(config.drawdownClear * 100)}%`);
  if (twoWeeksBelowMa60) clearReasons.push('连续两周低于 MA60');

  const priceCny = usdRate !== null ? latest.close * usdRate : null;
  const dramValueCny = priceCny !== null ? roundMoney(priceCny * config.shares) : null;
  const weight = dramValueCny !== null && usStockValueCny > 0 ? dramValueCny / usStockValueCny : null;
  const costProfitRate = config.costPrice > 0 ? latest.close / config.costPrice - 1 : null;

  const targetCny = usStockValueCny * config.targetWeight;
  const hardLimitCny = usStockValueCny * config.hardLimit;
  const sellToTargetCny = dramValueCny !== null && priceCny !== null
    ? roundMoney(Math.max(dramValueCny - targetCny, 0))
    : 0;
  const sellToTargetShares = priceCny !== null && priceCny > 0
    ? roundShares(Math.min(config.shares, sellToTargetCny / priceCny))
    : 0;
  const buyCapacityCny = dramValueCny !== null
    ? roundMoney(Math.max(targetCny - dramValueCny, 0))
    : 0;

  const aboveMa5 = latestMa5 === null ? null : latest.close > latestMa5;
  const aboveMa20 = latestMa20 === null ? null : latest.close > latestMa20;

  if (clearReasons.length > 0) {
    return {
      kind: 'clear',
      headline: '清仓 DRAM',
      detail: `触发${clearReasons.join('、')}，卖出全部 ${config.shares.toFixed(4)} 股，资金转 SPY 或现金。`,
      latestDate: latest.date,
      latestPrice: latest.close,
      costProfitRate,
      ma5: latestMa5,
      ma10: ma10[lastIndex],
      ma20: latestMa20,
      ma60: latestMa60,
      drawdownFromPeak,
      peakPrice,
      peakDate,
      weight,
      dramValueCny,
      usStockValueCny,
      sellShares: config.shares,
      sellCny: dramValueCny ?? 0,
      buyCapacityCny: 0,
      clearReasons,
      priceState: { aboveMa5, aboveMa20, twoWeeksBelowMa20, twoWeeksBelowMa60 },
    };
  }

  if (weight === null || dramValueCny === null || priceCny === null) {
    return {
      kind: 'wait',
      headline: '先补数据',
      detail: '需要美元汇率和美股总额，才能计算 DRAM 在美股里的比例。',
      latestDate: latest.date,
      latestPrice: latest.close,
      costProfitRate,
      ma5: latestMa5,
      ma10: ma10[lastIndex],
      ma20: latestMa20,
      ma60: latestMa60,
      drawdownFromPeak,
      peakPrice,
      peakDate,
      weight,
      dramValueCny,
      usStockValueCny,
      sellShares: 0,
      sellCny: 0,
      buyCapacityCny: 0,
      clearReasons,
      priceState: { aboveMa5, aboveMa20, twoWeeksBelowMa20, twoWeeksBelowMa60 },
    };
  }

  if (dramValueCny >= hardLimitCny) {
    return {
      kind: 'trim',
      headline: '减到 20%',
      detail: `DRAM 已超过美股 ${Math.round(config.hardLimit * 100)}% 硬上限，卖出约 ${sellToTargetShares.toFixed(4)} 股，降回 ${Math.round(config.targetWeight * 100)}%。`,
      latestDate: latest.date,
      latestPrice: latest.close,
      costProfitRate,
      ma5: latestMa5,
      ma10: ma10[lastIndex],
      ma20: latestMa20,
      ma60: latestMa60,
      drawdownFromPeak,
      peakPrice,
      peakDate,
      weight,
      dramValueCny,
      usStockValueCny,
      sellShares: sellToTargetShares,
      sellCny: sellToTargetCny,
      buyCapacityCny: 0,
      clearReasons,
      priceState: { aboveMa5, aboveMa20, twoWeeksBelowMa20, twoWeeksBelowMa60 },
    };
  }

  if (aboveMa5 === false) {
    const overTarget = dramValueCny > targetCny;
    return {
      kind: overTarget ? 'trim' : 'pause',
      headline: overTarget ? '停买并减仓' : '暂停买入',
      detail: overTarget
        ? `已跌破 MA5，卖出约 ${sellToTargetShares.toFixed(4)} 股，把 DRAM 压回 ${Math.round(config.targetWeight * 100)}%；核心仓不清。`
        : '已跌破 MA5，只暂停买入；未触发 MA20/回撤清仓条件，核心仓继续留着。',
      latestDate: latest.date,
      latestPrice: latest.close,
      costProfitRate,
      ma5: latestMa5,
      ma10: ma10[lastIndex],
      ma20: latestMa20,
      ma60: latestMa60,
      drawdownFromPeak,
      peakPrice,
      peakDate,
      weight,
      dramValueCny,
      usStockValueCny,
      sellShares: overTarget ? sellToTargetShares : 0,
      sellCny: overTarget ? sellToTargetCny : 0,
      buyCapacityCny: 0,
      clearReasons,
      priceState: { aboveMa5, aboveMa20, twoWeeksBelowMa20, twoWeeksBelowMa60 },
    };
  }

  if (weight < config.targetWeight) {
    return {
      kind: 'buy',
      headline: weight < config.minBuyWeight ? '可补 DRAM' : '小额可买',
      detail: `趋势在 MA5 上方，DRAM 低于 ${Math.round(config.targetWeight * 100)}% 上限；本次美股新增资金最多给 DRAM 约 ¥${Math.round(buyCapacityCny)}，其余给 SPY。`,
      latestDate: latest.date,
      latestPrice: latest.close,
      costProfitRate,
      ma5: latestMa5,
      ma10: ma10[lastIndex],
      ma20: latestMa20,
      ma60: latestMa60,
      drawdownFromPeak,
      peakPrice,
      peakDate,
      weight,
      dramValueCny,
      usStockValueCny,
      sellShares: 0,
      sellCny: 0,
      buyCapacityCny,
      clearReasons,
      priceState: { aboveMa5, aboveMa20, twoWeeksBelowMa20, twoWeeksBelowMa60 },
    };
  }

  return {
    kind: 'hold',
    headline: '持有不加',
    detail: `趋势仍在 MA5 上方，但 DRAM 已接近或超过 ${Math.round(config.targetWeight * 100)}% 目标；新增美股资金优先投 SPY。`,
    latestDate: latest.date,
    latestPrice: latest.close,
    costProfitRate,
    ma5: latestMa5,
    ma10: ma10[lastIndex],
    ma20: latestMa20,
    ma60: latestMa60,
    drawdownFromPeak,
    peakPrice,
    peakDate,
    weight,
    dramValueCny,
    usStockValueCny,
    sellShares: 0,
    sellCny: 0,
    buyCapacityCny: 0,
    clearReasons,
    priceState: { aboveMa5, aboveMa20, twoWeeksBelowMa20, twoWeeksBelowMa60 },
  };
}
