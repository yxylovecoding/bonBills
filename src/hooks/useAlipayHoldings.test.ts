import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('确认规则基金资料查询', () => {
  it('只采用准确匹配代码和基金来源的资料，同代码请求复用', async () => {
    vi.resetModules();
    const { fetchConfirmationFundMetadata } = await import('./useAlipayHoldings');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [
      { symbol: '017642', source: 'eastmoney-fund', name: '相近基金', type: 'QDII' },
      { symbol: '017641', source: 'yahoo', name: '其他证券', type: 'ETF' },
      { symbol: '017641', source: 'eastmoney-fund', name: '正确基金', type: 'QDII-指数' },
    ] }) });
    vi.stubGlobal('fetch', fetchMock);
    const first = fetchConfirmationFundMetadata('017641');
    expect(fetchConfirmationFundMetadata('017641')).toBe(first);
    expect(await first).toEqual({ name: '正确基金', type: 'QDII-指数' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/market-search?q=017641');
  });
  it('查询失败不会伪造普通基金，退避后可恢复', async () => {
    vi.resetModules(); vi.useFakeTimers();
    const { fetchConfirmationFundMetadata } = await import('./useAlipayHoldings');
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => ({ results: [{ symbol: '017641', source: 'eastmoney-fund', name: '基金', type: 'QDII' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchConfirmationFundMetadata('017641')).toBeUndefined();
    expect(await fetchConfirmationFundMetadata('017641')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect(await fetchConfirmationFundMetadata('017641')).toMatchObject({ type: 'QDII' });
  });
});
