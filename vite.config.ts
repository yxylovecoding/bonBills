import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sendJson = (res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body: string) => void }, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const yahooChartUrl = (symbol: string, range: string, interval: string) => {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', range);
  url.searchParams.set('interval', interval);
  url.searchParams.set('events', 'history');
  url.searchParams.set('includeAdjustedClose', 'true');
  return url;
};

type LocalMarketSearchResult = {
  symbol: string;
  name: string;
  type: string;
  market: string;
  currency: string;
  source: 'yahoo' | 'eastmoney-fund';
};

const rankMarketSearchResult = (result: LocalMarketSearchResult, query: string) => {
  const normalized = query.trim().toUpperCase();
  const symbol = result.symbol.toUpperCase();
  const name = result.name.toUpperCase();
  if (symbol === normalized) return 0;
  if (name === normalized) return 1;
  if (symbol.startsWith(normalized)) return 2;
  if (name.startsWith(normalized)) return 3;
  return 4;
};

const searchYahooMarket = async (query: string): Promise<LocalMarketSearchResult[]> => {
  const url = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  url.searchParams.set('q', query);
  url.searchParams.set('quotesCount', '8');
  url.searchParams.set('newsCount', '0');
  url.searchParams.set('enableFuzzyQuery', 'true');
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Yahoo ${response.status}`);
  const payload = await response.json() as { quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string; typeDisp?: string; exchange?: string; exchDisp?: string; currency?: string }> };
  const supportedTypes = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);
  return (payload.quotes ?? []).flatMap((quote) => {
    const symbol = quote.symbol?.trim().toUpperCase();
    const name = (quote.longname ?? quote.shortname)?.trim();
    const quoteType = quote.quoteType?.toUpperCase() ?? '';
    if (!symbol || !name || !supportedTypes.has(quoteType)) return [];
    return [{ symbol, name, type: quote.typeDisp ?? quoteType, market: quote.exchDisp ?? quote.exchange ?? '', currency: quote.currency ?? '', source: 'yahoo' as const }];
  });
};

const searchEastmoneyFunds = async (query: string): Promise<LocalMarketSearchResult[]> => {
  const url = new URL('https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx');
  url.searchParams.set('m', '1');
  url.searchParams.set('key', query);
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  const payload = await response.json() as { Datas?: Array<{ CODE?: string; NAME?: string; CATEGORYDESC?: string; FundBaseInfo?: { FTYPE?: string } | null }> };
  return (payload.Datas ?? []).flatMap((fund) => {
    const symbol = fund.CODE?.trim();
    const name = fund.NAME?.trim();
    if (!symbol || !name || !/^\d{6}$/.test(symbol)) return [];
    const currency = /美元|美钞|美汇/.test(name) ? 'USD' : /港币/.test(name) ? 'HKD' : 'CNY';
    return [{ symbol, name, type: fund.FundBaseInfo?.FTYPE ?? fund.CATEGORYDESC ?? '基金', market: '中国公募基金', currency, source: 'eastmoney-fund' as const }];
  });
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-api',
      configureServer(server) {
        server.middlewares.use('/api/usd-rate', async (_req, res) => {
          try {
            const upstream = await fetch('https://api.frankfurter.dev/v2/rate/USD/CNY');
            if (!upstream.ok) return sendJson(res, 502, { error: 'upstream error', status: upstream.status });
            const data = await upstream.json() as { date?: string; rate?: number };
            const rate = Number(data.rate);
            if (!Number.isFinite(rate) || rate <= 0) return sendJson(res, 502, { error: 'invalid upstream payload' });
            return sendJson(res, 200, { rate, date: data.date ?? '', source: 'Frankfurter' });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            return sendJson(res, 502, { error: 'usd rate fetch failed', message });
          }
        });

        server.middlewares.use('/api/market-search', async (req, res) => {
          const requestUrl = new URL(req.url ?? '', 'http://localhost');
          const query = (requestUrl.searchParams.get('q') ?? '').trim();
          if (!query || query.length > 80) return sendJson(res, 400, { error: 'invalid query' });
          const searches = await Promise.allSettled([searchYahooMarket(query), searchEastmoneyFunds(query)]);
          if (searches.every((result) => result.status === 'rejected')) return sendJson(res, 502, { error: 'market search failed' });
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
            .sort((a, b) => rankMarketSearchResult(a, query) - rankMarketSearchResult(b, query) || a.name.localeCompare(b.name, 'zh-CN'))
            .slice(0, 10);
          return sendJson(res, 200, { results });
        });

        server.middlewares.use('/api/market-chart', async (req, res) => {
          const requestUrl = new URL(req.url ?? '', 'http://localhost');
          const symbol = (requestUrl.searchParams.get('symbol') ?? 'DRAM').trim().toUpperCase();
          const source = requestUrl.searchParams.get('source') ?? 'yahoo';
          const range = requestUrl.searchParams.get('range') ?? '6mo';
          const interval = requestUrl.searchParams.get('interval') ?? '1d';
          if (!/^[A-Z0-9.^=_-]{1,24}$/i.test(symbol)) return sendJson(res, 400, { error: 'invalid symbol' });

          if (source === 'eastmoney-fund') {
            if (!/^\d{6}$/.test(symbol)) return sendJson(res, 400, { error: 'invalid fund code' });
            const fundCurrency = (requestUrl.searchParams.get('currency') ?? 'CNY').trim().toUpperCase();
            if (!['CNY', 'USD', 'HKD'].includes(fundCurrency)) return sendJson(res, 400, { error: 'invalid currency' });
            const url = new URL('https://api.fund.eastmoney.com/f10/lsjz');
            url.searchParams.set('fundCode', symbol);
            url.searchParams.set('pageIndex', '1');
            url.searchParams.set('pageSize', '10');
            try {
              const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://fundf10.eastmoney.com/jjjz_${symbol}.html`, Accept: 'application/json' } });
              if (!upstream.ok) throw new Error(`primary fund NAV ${upstream.status}`);
              const payload = await upstream.json() as { Data?: { LSJZList?: Array<{ FSRQ?: string; DWJZ?: string }> }; ErrCode?: number };
              const navs = payload.Data?.LSJZList ?? [];
              const latest = navs.find((item) => Number.isFinite(Number(item.DWJZ)) && Number(item.DWJZ) > 0 && item.FSRQ);
              if (payload.ErrCode !== 0 || !latest) throw new Error('primary fund NAV unavailable');
              const bars = navs.flatMap((item) => {
                const close = Number(item.DWJZ);
                if (!item.FSRQ || !Number.isFinite(close) || close <= 0) return [];
                return [{ date: item.FSRQ, close, adjClose: close }];
              }).reverse();
              return sendJson(res, 200, {
                symbol,
                currency: fundCurrency,
                regularMarketPrice: Number(latest.DWJZ),
                regularMarketTime: `${latest.FSRQ}T00:00:00.000Z`,
                bars,
                source: 'Eastmoney Fund NAV',
              });
            } catch (primaryError) {
              try {
                const fallback = await fetch(`https://fund.eastmoney.com/pingzhongdata/${symbol}.js?v=${Date.now()}`, {
                  headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://fund.eastmoney.com/${symbol}.html`, Accept: 'text/javascript,*/*' },
                });
                if (!fallback.ok) throw new Error(`fallback ${fallback.status}`);
                const script = await fallback.text();
                const match = script.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
                if (!match) throw new Error('fallback NAV missing');
                const trend = JSON.parse(match[1]) as Array<{ x?: number; y?: number }>;
                const valid = trend.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number(item.y) > 0);
                const latest = valid[valid.length - 1];
                if (!latest) throw new Error('fallback NAV empty');
                const bars = valid.slice(-10).map((item) => ({ date: new Date(Number(item.x)).toISOString().slice(0, 10), close: Number(item.y), adjClose: Number(item.y) }));
                return sendJson(res, 200, {
                  symbol,
                  currency: fundCurrency,
                  regularMarketPrice: Number(latest.y),
                  regularMarketTime: new Date(Number(latest.x)).toISOString(),
                  bars,
                  source: 'Eastmoney Fund Trend',
                });
              } catch (fallbackError) {
                const primaryMessage = primaryError instanceof Error ? primaryError.message : 'unknown error';
                const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'unknown error';
                return sendJson(res, 502, { error: 'fund nav fetch failed', message: `${primaryMessage}; ${fallbackMessage}` });
              }
            }
          }

          if (source !== 'yahoo') return sendJson(res, 400, { error: 'invalid source' });

          try {
            const upstream = await fetch(yahooChartUrl(symbol, range, interval), {
              headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            });
            if (!upstream.ok) return sendJson(res, 502, { error: 'upstream error', status: upstream.status });
            const data = await upstream.json() as {
              chart?: {
                result?: Array<{
                  meta?: {
                    symbol?: string;
                    currency?: string;
                    regularMarketPrice?: number;
                    regularMarketTime?: number;
                    longName?: string;
                    shortName?: string;
                  };
                  timestamp?: number[];
                  indicators?: {
                    quote?: Array<{
                      open?: Array<number | null>;
                      high?: Array<number | null>;
                      low?: Array<number | null>;
                      close?: Array<number | null>;
                      volume?: Array<number | null>;
                    }>;
                    adjclose?: Array<{ adjclose?: Array<number | null> }>;
                  };
                }>;
                error?: { code?: string; description?: string };
              };
            };
            const result = data.chart?.result?.[0];
            if (!result || data.chart?.error) return sendJson(res, 502, { error: 'invalid upstream payload', detail: data.chart?.error });
            const timestamps = result.timestamp ?? [];
            const quote = result.indicators?.quote?.[0] ?? {};
            const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
            const bars = timestamps.map((timestamp, i) => ({
              date: new Date(timestamp * 1000).toISOString().slice(0, 10),
              open: quote.open?.[i] ?? null,
              high: quote.high?.[i] ?? null,
              low: quote.low?.[i] ?? null,
              close: quote.close?.[i] ?? null,
              adjClose: adjClose[i] ?? quote.close?.[i] ?? null,
              volume: quote.volume?.[i] ?? null,
            })).filter((bar) => bar.open !== null && bar.close !== null && bar.adjClose !== null);
            if (bars.length === 0) return sendJson(res, 502, { error: 'empty upstream bars' });
            return sendJson(res, 200, {
              symbol: result.meta?.symbol ?? symbol,
              currency: result.meta?.currency ?? '',
              name: result.meta?.longName ?? result.meta?.shortName ?? symbol,
              regularMarketPrice: result.meta?.regularMarketPrice ?? null,
              regularMarketTime: result.meta?.regularMarketTime ? new Date(result.meta.regularMarketTime * 1000).toISOString() : null,
              bars,
              source: 'Yahoo Finance',
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            return sendJson(res, 502, { error: 'market chart fetch failed', message });
          }
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
  },
});
