import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './market-search';

afterEach(() => vi.unstubAllGlobals());

describe('基金份额币种', () => {
  it('区分美元债标的与份额计价币种，保留真正的美元和港币份额', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => ({
      ok: true,
      json: async () => url.hostname.includes('yahoo')
        ? { quotes: [{ symbol: 'TLT', longname: 'Treasury Bond ETF', quoteType: 'ETF', currency: 'USD' }] }
        : { Datas: [
          { CODE: '003385', NAME: '工银全球美元债A' },
          { CODE: '003386', NAME: '工银全球美元债A' },
          { CODE: '003387', NAME: '工银全球美元债C' },
          { CODE: '900001', NAME: '测试美元债C' },
          { CODE: '900002', NAME: '测试美元债A（美元现汇）' },
          { CODE: '900003', NAME: '测试美元债A（人民币）' },
          { CODE: '900004', NAME: '测试基金（美元现钞）' },
          { CODE: '900005', NAME: '测试基金（港币）' },
        ] },
    })));
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    await handler({ method: 'GET', query: { q: '美元债' } } as VercelRequest, response as unknown as VercelResponse);
    expect(response.status).toHaveBeenCalledWith(200);
    const results = response.json.mock.calls[0][0].results as { symbol: string; currency: string }[];
    expect(Object.fromEntries(results.map((result) => [result.symbol, result.currency]))).toEqual({
      '003385': 'CNY', '003386': 'USD', '003387': 'CNY', TLT: 'USD',
      '900001': 'CNY', '900002': 'USD', '900003': 'CNY', '900004': 'USD', '900005': 'HKD',
    });
  });
});
