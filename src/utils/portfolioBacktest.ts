import type { InvestAllocTargets, InvestKey } from '../models/types';
import type { MarketChartResponse } from './dramDecision';

export type PortfolioBacktestSeriesId =
  | 'us-spy'
  | 'eu-006282'
  | 'eu-vgk'
  | 'asia-nikkei'
  | 'a-low-vol'
  | 'a-dividend-proxy'
  | 'long-bond-013594'
  | 'long-bond-10y-proxy'
  | 'long-bond-5y-proxy'
  | 'us-bond-tlt'
  | 'gold-gld'
  | 'usd-cny'
  | 'jpy-cny';

export interface PortfolioBacktestSeriesDefinition {
  id: PortfolioBacktestSeriesId;
  symbol: string;
  source?: 'eastmoney-fund';
  currency?: 'CNY';
  fxId?: 'usd-cny' | 'jpy-cny';
}

type AssetSeriesDefinition = PortfolioBacktestSeriesDefinition & { assetKey: InvestKey };

// 优先使用用户指定的基金/资产；成立前按顺序续接同类指数基金。
export const PORTFOLIO_BACKTEST_ASSET_SERIES: readonly AssetSeriesDefinition[] = [
  { id: 'us-spy', assetKey: 'us', symbol: 'SPY', fxId: 'usd-cny' },
  { id: 'eu-006282', assetKey: 'eu', symbol: '006282', source: 'eastmoney-fund', currency: 'CNY' },
  { id: 'eu-vgk', assetKey: 'eu', symbol: 'VGK', fxId: 'usd-cny' },
  { id: 'asia-nikkei', assetKey: 'asia', symbol: '^N225', fxId: 'jpy-cny' },
  { id: 'a-low-vol', assetKey: 'a', symbol: '515100.SS' },
  { id: 'a-dividend-proxy', assetKey: 'a', symbol: '510880.SS' },
  { id: 'long-bond-013594', assetKey: 'longBond', symbol: '013594', source: 'eastmoney-fund', currency: 'CNY' },
  { id: 'long-bond-10y-proxy', assetKey: 'longBond', symbol: '511260.SS' },
  { id: 'long-bond-5y-proxy', assetKey: 'longBond', symbol: '511010.SS' },
  { id: 'us-bond-tlt', assetKey: 'usBond', symbol: 'TLT', fxId: 'usd-cny' },
  { id: 'gold-gld', assetKey: 'gold', symbol: 'GLD', fxId: 'usd-cny' },
] as const;

export const PORTFOLIO_BACKTEST_FX_SERIES: readonly PortfolioBacktestSeriesDefinition[] = [
  { id: 'usd-cny', symbol: 'CNY=X' },
  { id: 'jpy-cny', symbol: 'JPYCNY=X' },
] as const;

export const PORTFOLIO_BACKTEST_REQUESTS = [
  ...PORTFOLIO_BACKTEST_ASSET_SERIES,
  ...PORTFOLIO_BACKTEST_FX_SERIES,
] as const;

export const PORTFOLIO_BACKTEST_SOURCE_TITLE =
  '标普 SPY；欧洲 006282 / VGK；日经225；红利低波100 / 上证红利；美债 TLT；国债 013594 / 10年国债ETF / 5年国债ETF；黄金 GLD。外币按人民币汇率折算，按月再平衡。';

export interface PortfolioBacktestResult {
  startMonth: string;
  endMonth: string;
  monthCount: number;
  years: number;
  annualizedReturn: number;
  totalReturn: number;
  maxDrawdown: number;
}

export function portfolioBacktestRequestUrl(definition: PortfolioBacktestSeriesDefinition): string {
  const params = new URLSearchParams({
    symbol: definition.symbol,
    range: 'max',
    interval: '1mo',
  });
  if (definition.source) params.set('source', definition.source);
  if (definition.currency) params.set('currency', definition.currency);
  return `/api/market-chart?${params.toString()}`;
}

function monthKey(date: string): string | null {
  const match = date.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function monthNumber(month: string): number {
  const [year, value] = month.split('-').map(Number);
  return year * 12 + value - 1;
}

function previousMonth(month: string): string {
  const index = monthNumber(month) - 1;
  const year = Math.floor(index / 12);
  return `${year}-${String(index % 12 + 1).padStart(2, '0')}`;
}

function chartMonthlyLevels(chart: MarketChartResponse | undefined): Map<string, number> {
  const levels = new Map<string, number>();
  for (const bar of chart?.bars ?? []) {
    const month = monthKey(bar.date);
    const value = Number(bar.adjClose ?? bar.close);
    if (month && Number.isFinite(value) && value > 0) levels.set(month, value);
  }
  return levels;
}

function convertLevelsToCny(
  levels: Map<string, number>,
  fxLevels: Map<string, number> | undefined,
): Map<string, number> {
  if (!fxLevels) return levels;
  const converted = new Map<string, number>();
  const fxEntries = [...fxLevels.entries()].sort(([left], [right]) => left.localeCompare(right));
  let fxIndex = 0;
  let latestFx: number | null = null;
  for (const [month, level] of [...levels.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    while (fxIndex < fxEntries.length && fxEntries[fxIndex][0] <= month) {
      latestFx = fxEntries[fxIndex][1];
      fxIndex += 1;
    }
    if (latestFx !== null) converted.set(month, level * latestFx);
  }
  return converted;
}

function monthlyReturns(levels: Map<string, number>): Map<string, number> {
  const result = new Map<string, number>();
  const entries = [...levels.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (let index = 1; index < entries.length; index += 1) {
    const [previousKey, previousValue] = entries[index - 1];
    const [currentKey, currentValue] = entries[index];
    if (monthNumber(currentKey) - monthNumber(previousKey) !== 1) continue;
    const value = currentValue / previousValue - 1;
    if (Number.isFinite(value) && value > -1) result.set(currentKey, value);
  }
  return result;
}

function longestConsecutiveMonths(months: string[]): string[] {
  let longest: string[] = [];
  let current: string[] = [];
  for (const month of months) {
    if (current.length === 0 || monthNumber(month) - monthNumber(current[current.length - 1]) === 1) {
      current.push(month);
    } else {
      current = [month];
    }
    if (current.length >= longest.length) longest = [...current];
  }
  return longest;
}

export function calculatePortfolioBacktest(
  charts: Partial<Record<PortfolioBacktestSeriesId, MarketChartResponse>>,
  targets: InvestAllocTargets,
  excludedMonth?: string,
): PortfolioBacktestResult | null {
  const activeAssets = (Object.entries(targets) as Array<[InvestKey, number]>)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0);
  const totalWeight = activeAssets.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) return null;

  const fxLevels = new Map<PortfolioBacktestSeriesId, Map<string, number>>(
    PORTFOLIO_BACKTEST_FX_SERIES.map((definition) => [definition.id, chartMonthlyLevels(charts[definition.id])]),
  );
  const returnsByAsset = new Map<InvestKey, Map<string, number>>();
  for (const [assetKey] of activeAssets) {
    const stitched = new Map<string, number>();
    for (const definition of PORTFOLIO_BACKTEST_ASSET_SERIES.filter((source) => source.assetKey === assetKey)) {
      const levels = chartMonthlyLevels(charts[definition.id]);
      const cnyLevels = convertLevelsToCny(levels, definition.fxId ? fxLevels.get(definition.fxId) : undefined);
      for (const [month, value] of monthlyReturns(cnyLevels)) {
        if (!stitched.has(month)) stitched.set(month, value);
      }
    }
    if (stitched.size === 0) return null;
    returnsByAsset.set(assetKey, stitched);
  }

  const firstAssetMonths = [...returnsByAsset.get(activeAssets[0][0])!.keys()];
  const commonMonths = firstAssetMonths
    .filter((month) => month !== excludedMonth && activeAssets.every(([key]) => returnsByAsset.get(key)!.has(month)))
    .sort();
  const months = longestConsecutiveMonths(commonMonths);
  if (months.length < 12) return null;

  let wealth = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const month of months) {
    const portfolioReturn = activeAssets.reduce((sum, [key, weight]) => (
      sum + returnsByAsset.get(key)!.get(month)! * weight / totalWeight
    ), 0);
    wealth *= 1 + portfolioReturn;
    peak = Math.max(peak, wealth);
    maxDrawdown = Math.min(maxDrawdown, wealth / peak - 1);
  }
  const annualizedReturn = Math.pow(wealth, 12 / months.length) - 1;
  if (!Number.isFinite(annualizedReturn)) return null;
  return {
    startMonth: previousMonth(months[0]),
    endMonth: months[months.length - 1],
    monthCount: months.length,
    years: months.length / 12,
    annualizedReturn,
    totalReturn: wealth - 1,
    maxDrawdown,
  };
}
