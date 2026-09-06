import { describe, expect, it } from 'vitest';
import { fundTotalReturnBars, lastBarPerMonth } from './market-chart';

describe('市场历史序列', () => {
  it('基金使用官方每日回报拼接总收益，避免分红除权造成虚假亏损', () => {
    const bars = fundTotalReturnBars([
      { x: Date.UTC(2024, 0, 1), y: 1, equityReturn: 0 },
      { x: Date.UTC(2024, 0, 2), y: 1.01, equityReturn: 1 },
      { x: Date.UTC(2024, 0, 3), y: 0.91, equityReturn: 0 },
      { x: Date.UTC(2024, 0, 4), y: 0.9282, equityReturn: 2 },
    ]);
    expect(bars.map((bar) => bar.adjClose)).toEqual([1, 1.01, 1.01, 1.0302]);
  });

  it('月线只保留每月最后一个有效交易日', () => {
    expect(lastBarPerMonth([
      { date: '2024-02-29', value: 4 },
      { date: '2024-01-03', value: 1 },
      { date: '2024-01-31', value: 2 },
      { date: '2024-02-01', value: 3 },
    ])).toEqual([
      { date: '2024-01-31', value: 2 },
      { date: '2024-02-29', value: 4 },
    ]);
  });
});
