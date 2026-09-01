import type { VercelRequest, VercelResponse } from '@vercel/node';

type MarketSearchResult = {
  symbol: string;
  name: string;
  type: string;
  market: string;
  currency: string;
  source: 'yahoo' | 'eastmoney-fund';
};

type YahooSearchResponse = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    typeDisp?: string;
    exchange?: string;
    exchDisp?: string;
    currency?: string;
  }>;
};

type EastmoneySearchResponse = {
  Datas?: Array<{
    CODE?: string;
    NAME?: string;
    CATEGORYDESC?: string;
    FundBaseInfo?: { FTYPE?: string } | null;
  }>;
};

const SUPPORTED_YAHOO_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);

async function searchYahoo(query: string): Promise<MarketSearchResult[]> {
  const url = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  url.searchParams.set('q', query);
  url.searchParams.set('quotesCount', '8');
  url.searchParams.set('newsCount', '0');
  url.searchParams.set('enableFuzzyQuery', 'true');
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Yahoo ${response.status}`);
  const payload = await response.json() as YahooSearchResponse;
  return (payload.quotes ?? []).flatMap((quote) => {
    const symbol = quote.symbol?.trim().toUpperCase();
    const name = (quote.longname ?? quote.shortname)?.trim();
    const quoteType = quote.quoteType?.toUpperCase() ?? '';
    if (!symbol || !name || !SUPPORTED_YAHOO_TYPES.has(quoteType)) return [];
    return [{
      symbol,
      name,
      type: quote.typeDisp ?? quoteType,
      market: quote.exchDisp ?? quote.exchange ?? '',
      currency: quote.currency ?? '',
      source: 'yahoo' as const,
    }];
  });
}

async function searchEastmoneyFunds(query: string): Promise<MarketSearchResult[]> {
  const url = new URL('https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx');
  url.searchParams.set('m', '1');
  url.searchParams.set('key', query);
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  const payload = await response.json() as EastmoneySearchResponse;
  return (payload.Datas ?? []).flatMap((fund) => {
    const symbol = fund.CODE?.trim();
    const name = fund.NAME?.trim();
    if (!symbol || !name || !/^\d{6}$/.test(symbol)) return [];
    const currency = /美元|美钞|美汇/.test(name) ? 'USD' : /港币/.test(name) ? 'HKD' : 'CNY';
    return [{
      symbol,
      name,
      type: fund.FundBaseInfo?.FTYPE ?? fund.CATEGORYDESC ?? '基金',
      market: '中国公募基金',
      currency,
      source: 'eastmoney-fund' as const,
    }];
  });
}

function rankResult(result: MarketSearchResult, query: string) {
  const normalized = query.trim().toUpperCase();
  const symbol = result.symbol.toUpperCase();
  const name = result.name.toUpperCase();
  if (symbol === normalized) return 0;
  if (name === normalized) return 1;
  if (symbol.startsWith(normalized)) return 2;
  if (name.startsWith(normalized)) return 3;
  return 4;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const query = String(req.query.q ?? '').trim();
  if (!query || query.length > 80) return res.status(400).json({ error: 'invalid query' });

  const searches = await Promise.allSettled([searchYahoo(query), searchEastmoneyFunds(query)]);
  if (searches.every((result) => result.status === 'rejected')) {
    return res.status(502).json({ error: 'market search failed' });
  }
  const seen = new Set<string>();
  const merged = searches.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((result) => {
      const key = `${result.source}:${result.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const normalizedQuery = query.toUpperCase();
  const hasExactSymbol = merged.some((result) => result.symbol.toUpperCase() === normalizedQuery);
  const results = (hasExactSymbol
    ? merged.filter((result) => result.symbol.toUpperCase().startsWith(normalizedQuery))
    : merged)
    .sort((a, b) => rankResult(a, query) - rankResult(b, query) || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 10);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');
  return res.status(200).json({ results });
}
