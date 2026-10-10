import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function setup(bars: { date: string; close: number; purchaseStatus?: string }[], month = '2026-09') {
  vi.resetModules();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    symbol: '123456', startDate: `${month}-01`, bars: bars.map((bar) => ({ purchaseStatus: '开放申购', ...bar })),
  }) });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, fetchNav: (await import('./alipayActualNav')).fetchAlipayActualNav };
}

describe('支付宝实录自动净值', () => {
  it('按实录日期选择最近净值，忽略未来净值，不把暂停申购当成净值失效', async () => {
    const { fetchNav, fetchMock } = await setup([
      { date: '2026-10-12', close: 1.6 }, { date: '2026-10-09', close: 1.25, purchaseStatus: '暂停申购' },
      { date: '2026-10-08', close: 1.2 }, { date: '2026-09-31', close: 99 },
    ]);
    expect(await fetchNav('123456', '2026-10-10')).toEqual({ code: '123456', date: '2026-10-09', nav: 1.25 });
    // The API receives only a public fund code and month, not personal balances or orders.
    expect(fetchMock.mock.calls[0][0]).toBe('/api/market-chart?source=eastmoney-fund&symbol=123456&navMonth=2026-09');
  });
  it('节假日和月初沿用上月已公布净值，同代码请求复用且各实录独立截止', async () => {
    const { fetchNav, fetchMock } = await setup([{ date: '2026-09-30', close: 1.2 }, { date: '2026-10-09', close: 1.25 }]);
    const [earlier, later] = await Promise.all([fetchNav('123456', '2026-10-01'), fetchNav('123456', '2026-10-10')]);
    expect(earlier).toMatchObject({ date: '2026-09-30', nav: 1.2 });
    expect(later).toMatchObject({ date: '2026-10-09', nav: 1.25 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('跨年查询包含上一年十二月', async () => {
    const { fetchNav, fetchMock } = await setup([{ date: '2025-12-31', close: 1.1 }], '2025-12');
    expect(await fetchNav('123456', '2026-01-01')).toMatchObject({ date: '2025-12-31', nav: 1.1 });
    expect(fetchMock.mock.calls[0][0]).toContain('navMonth=2025-12');
  });
  it('没有有效净值时返回缺失，不能用零值或未来数据冒充', async () => {
    const { fetchNav } = await setup([{ date: '2026-10-12', close: 1.6 }, { date: '2026-10-09', close: 0 }, { date: '2026-10-08', close: NaN }]);
    expect(await fetchNav('123456', '2026-10-10')).toBeUndefined();
  });
  it('错误代码的响应不会串入另一只基金', async () => {
    const { fetchNav } = await setup([{ date: '2026-10-09', close: 1.2 }]);
    await expect(fetchNav('654321', '2026-10-10')).rejects.toThrow('invalid NAV history');
  });
  it('查询失败不缓存假净值，退避之后可以恢复', async () => {
    vi.useFakeTimers();
    const { fetchNav, fetchMock } = await setup([{ date: '2026-10-09', close: 1.2 }]);
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(fetchNav('123456', '2026-10-10')).rejects.toThrow();
    await expect(fetchNav('123456', '2026-10-10')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect(await fetchNav('123456', '2026-10-10')).toMatchObject({ nav: 1.2 });
  });
  it('无效代码或日期不发送请求', async () => {
    const { fetchNav, fetchMock } = await setup([]);
    expect(await fetchNav('ABCDEF', '2026-10-10')).toBeUndefined();
    expect(await fetchNav('123456', '2026-02-30')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
