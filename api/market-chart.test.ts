import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { fundNavMonthRange, fundTotalReturnBars, lastBarPerMonth } from './market-chart';

afterEach(() => vi.unstubAllGlobals());

async function requestNav(query: Record<string, string>) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: 'GET', query: { symbol: '017641', source: 'eastmoney-fund', ...query } } as VercelRequest, response as unknown as VercelResponse);
  return response;
}

describe('申购月份的历史净值', () => {
  it('范围包含次月，跨年和闰年仍正确', () => {
    expect(fundNavMonthRange('2026-09')).toEqual({ startDate: '2026-09-01', endDate: '2026-10-31' });
    expect(fundNavMonthRange('2026-12')).toEqual({ startDate: '2026-12-01', endDate: '2027-01-31' });
    expect(fundNavMonthRange('2024-01')).toEqual({ startDate: '2024-01-01', endDate: '2024-02-29' });
  });

  it('无效月份直接拒绝，不访问上游', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestNav({ navMonth: '2026-13' });
    expect(response.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('按月份查全量原始单位净值，保留暂停申购状态供顺延判断', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ErrCode: 0, Data: { LSJZList: [
      { FSRQ: '2026-09-18', DWJZ: '1.6952', LJJZ: '2.1111', SGZT: '限制大额申购' },
      { FSRQ: '2026-09-17', DWJZ: '1.6939', SGZT: '暂停申购' },
      { FSRQ: '2026-09-16', DWJZ: '--', SGZT: '开放申购' },
      { FSRQ: '2026-08-31', DWJZ: '1.68', SGZT: '开放申购' },
    ] } }) });
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestNav({ navMonth: '2026-09' });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('startDate')).toBe('2026-09-01');
    expect(url.searchParams.get('endDate')).toBe('2026-10-31');
    expect(url.searchParams.get('pageSize')).toBe('100');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ bars: [
      { date: '2026-09-17', close: 1.6939, purchaseStatus: '暂停申购' },
      { date: '2026-09-18', close: 1.6952, purchaseStatus: '限制大额申购' },
    ] }));
  });

  it('净值未出返回空数据，接口错误不回退到最新估值', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ErrCode: 0, Data: { LSJZList: [] } }) })
      .mockResolvedValueOnce({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);
    const empty = await requestNav({ navMonth: '2026-09' });
    expect(empty.status).toHaveBeenCalledWith(200);
    expect(empty.json).toHaveBeenCalledWith(expect.objectContaining({ bars: [] }));
    const failed = await requestNav({ navMonth: '2026-09' });
    expect(failed.status).toHaveBeenCalledWith(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

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
