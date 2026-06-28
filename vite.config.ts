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

        server.middlewares.use('/api/market-chart', async (req, res) => {
          const requestUrl = new URL(req.url ?? '', 'http://localhost');
          const symbol = (requestUrl.searchParams.get('symbol') ?? 'DRAM').trim().toUpperCase();
          const range = requestUrl.searchParams.get('range') ?? '6mo';
          const interval = requestUrl.searchParams.get('interval') ?? '1d';
          if (!/^[A-Z0-9.^=_-]{1,24}$/i.test(symbol)) return sendJson(res, 400, { error: 'invalid symbol' });

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
