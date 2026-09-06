import { describe, expect, it } from 'vitest';
import type { InvestAllocTargets } from '../models/types';
import type { MarketChartResponse } from './dramDecision';
import {
  calculatePortfolioBacktest,
  portfolioBacktestRequestUrl,
  type PortfolioBacktestSeriesId,
} from './portfolioBacktest';

function chart(values: Array<[string, number]>): MarketChartResponse {
  return {
    symbol: 'TEST', currency: 'CNY', name: 'TEST', regularMarketPrice: null,
    regularMarketTime: null, source: 'test',
    bars: values.map(([date, value]) => ({
      date, open: value, high: value, low: value, close: value, adjClose: value,
    })),
  };
}

function months(startYear: number, startMonth: number, count: number, monthlyRate: number) {
  let value = 100;
  return Array.from({ length: count }, (_, index): [string, number] => {
    const absoluteMonth = startYear * 12 + startMonth - 1 + index;
    if (index > 0) value *= 1 + monthlyRate;
    return [`${Math.floor(absoluteMonth / 12)}-${String(absoluteMonth % 12 + 1).padStart(2, '0')}-28`, value];
  });
}

describe('目标比例最长回测', () => {
  it('按共同最长月份、人民币汇率及目标比例计算年化与回撤', () => {
    const charts: Partial<Record<PortfolioBacktestSeriesId, MarketChartResponse>> = {
      'us-spy': chart(months(2020, 1, 26, 0.01)),
      'eu-vgk': chart(months(2020, 1, 26, -0.005)),
      'usd-cny': chart(months(2020, 1, 26, 0)),
    };
    const targets = { us: 0.5, eu: 0.5 } as InvestAllocTargets;
    const result = calculatePortfolioBacktest(charts, targets, '2022-02');
    expect(result).toMatchObject({ startMonth: '2020-01', endMonth: '2022-01', monthCount: 24 });
    expect(result?.annualizedReturn).toBeCloseTo((1.0025 ** 12) - 1, 10);
    expect(result?.maxDrawdown).toBe(0);
  });

  it('优先使用指定基金，并用较早代理补足成立前历史', () => {
    const charts: Partial<Record<PortfolioBacktestSeriesId, MarketChartResponse>> = {
      'eu-006282': chart(months(2021, 1, 14, 0.02)),
      'eu-vgk': chart(months(2020, 1, 26, 0.01)),
      'usd-cny': chart(months(2020, 1, 26, 0)),
    };
    const result = calculatePortfolioBacktest(charts, { eu: 1 } as InvestAllocTargets, '2022-02');
    expect(result?.startMonth).toBe('2020-01');
    expect(result?.monthCount).toBe(24);
    expect(result?.annualizedReturn).toBeGreaterThan(0.16);
  });

  it('生成基金最大历史请求', () => {
    expect(portfolioBacktestRequestUrl({
      id: 'eu-006282', symbol: '006282', source: 'eastmoney-fund', currency: 'CNY',
    })).toBe('/api/market-chart?symbol=006282&range=max&interval=1mo&source=eastmoney-fund&currency=CNY');
    expect(portfolioBacktestRequestUrl({ id: 'asia-nikkei', symbol: '^N225' }))
      .toBe('/api/market-chart?symbol=%5EN225&range=20y&interval=1mo');
  });
});
