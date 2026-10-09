import type { MonthlyRecord } from '../models/types';
import type { MarketChartResponse } from './dramDecision';
import {
  PORTFOLIO_BACKTEST_ASSET_SERIES,
  PORTFOLIO_BACKTEST_FX_SERIES,
  portfolioBacktestRequestUrl,
  type PortfolioBacktestSeriesDefinition,
  type PortfolioBacktestSeriesId,
} from './portfolioBacktest';

// 复用项目里「bill-资产配置比例-回测」的数据源：仅需 SPY + usd-cny 汇率。
export const SP500_COMPARISON_REQUESTS: readonly PortfolioBacktestSeriesDefinition[] = [
  ...PORTFOLIO_BACKTEST_ASSET_SERIES.filter((d) => d.id === 'us-spy'),
  ...PORTFOLIO_BACKTEST_FX_SERIES.filter((d) => d.id === 'usd-cny'),
];

export { portfolioBacktestRequestUrl };

export interface Sp500ComparisonResult {
  // 同期等额定投 SPY 的收益（人民币）；null 表示数据不足
  monthSp500Profit: number | null;
  yearSp500Profit: number | null;
}

function monthKey(date: string): string | null {
  const m = date.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
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

function prevYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 构造每个月的 SPY 人民币等效价格：外币价格 × 当月（向前填充）美元兑人民币汇率。
function buildCnyPrice(
  spyLevels: Map<string, number>,
  fxLevels: Map<string, number>,
): Map<string, number> {
  const sortedFx = [...fxLevels.entries()].sort(([a], [b]) => a.localeCompare(b));
  const result = new Map<string, number>();
  for (const [month, px] of spyLevels) {
    let fx: number | null = null;
    for (const [fm, fv] of sortedFx) {
      if (fm <= month) fx = fv; else break;
    }
    if (fx !== null) result.set(month, px * fx);
  }
  return result;
}

/**
 * 计算同期每月定投标普500（SPY）的收益。
 * - 每月投入金额 = 当月理财总额变化 - 当月实际收益（与「本月/今年」收益数据同源）。
 * - 起点：
 *     「本月」= 本月第 1 天（以上月末 SPY 收盘价成交）；
 *     「今年」= 今年 1 月 1 日（1 月买入以去年 12 月末价成交，以此类推）。
 */
export function calculateSp500Comparison(
  charts: Partial<Record<PortfolioBacktestSeriesId, MarketChartResponse>>,
  records: readonly MonthlyRecord[],
  currentYearMonth: string,
): Sp500ComparisonResult {
  const empty: Sp500ComparisonResult = { monthSp500Profit: null, yearSp500Profit: null };
  const spyLevels = chartMonthlyLevels(charts['us-spy']);
  const fxLevels = chartMonthlyLevels(charts['usd-cny']);
  if (spyLevels.size === 0 || fxLevels.size === 0) return empty;

  const cnyPrice = buildCnyPrice(spyLevels, fxLevels);
  const recordByMonth = new Map(records.map((record) => [record.yearMonth, record]));

  // 每月净投入金额（与现有「本月/今年」收益同源：Δ investTotal - Δ accumulatedProfit）
  function monthlyBuy(ym: string): number | null {
    const current = recordByMonth.get(ym);
    const previous = recordByMonth.get(prevYearMonth(ym));
    if (!current || !previous) return null;
    return (current.investTotal - previous.investTotal)
      - (current.accumulatedProfit - previous.accumulatedProfit);
  }

  // 计算在给定区间内，每月定投 SPY 的收益：
  // 第 i 个月的买入价 = 该月月初 ≈ 上个月末 SPY 收盘价；期末价 = 当前月的 SPY 收盘价。
  function profitForBuys(months: string[]): number | null {
    const priceEnd = cnyPrice.get(currentYearMonth);
    if (!priceEnd) return null;
    let totalShares = 0;
    let totalBuy = 0;
    for (const ym of months) {
      const buy = monthlyBuy(ym);
      if (buy === null) return null;
      const priceBuy = cnyPrice.get(prevYearMonth(ym));
      if (!priceBuy || priceBuy <= 0) return null;
      totalShares += buy / priceBuy;
      totalBuy += buy;
    }
    return totalShares * priceEnd - totalBuy;
  }

  // 本月：只考虑当月这一笔
  const monthSp500Profit = profitForBuys([currentYearMonth]);

  // 今年：1 月至当前月
  const [curYear, curMonth] = currentYearMonth.split('-').map(Number);
  const ytdMonths: string[] = [];
  for (let m = 1; m <= curMonth; m += 1) {
    ytdMonths.push(`${curYear}-${String(m).padStart(2, '0')}`);
  }
  const yearSp500Profit = profitForBuys(ytdMonths);

  return { monthSp500Profit, yearSp500Profit };
}
