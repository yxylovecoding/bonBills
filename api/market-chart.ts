import type { VercelRequest, VercelResponse } from '@vercel/node';

type YahooChartResponse = {
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

type EastmoneyNavResponse = {
  Data?: {
    LSJZList?: Array<{
      FSRQ?: string;
      DWJZ?: string;
    }>;
  };
  ErrCode?: number;
};

const VALID_SYMBOL = /^[A-Z0-9.^=_-]{1,24}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const symbol = String(req.query.symbol ?? 'DRAM').trim().toUpperCase();
  const source = String(req.query.source ?? 'yahoo');
  const range = String(req.query.range ?? '6mo');
  const interval = String(req.query.interval ?? '1d');

  if (!VALID_SYMBOL.test(symbol)) {
    return res.status(400).json({ error: 'invalid symbol' });
  }

  if (source === 'eastmoney-fund') {
    if (!/^\d{6}$/.test(symbol)) return res.status(400).json({ error: 'invalid fund code' });
    const fundCurrency = String(req.query.currency ?? 'CNY').trim().toUpperCase();
    if (!['CNY', 'USD', 'HKD'].includes(fundCurrency)) return res.status(400).json({ error: 'invalid currency' });
    const url = new URL('https://api.fund.eastmoney.com/f10/lsjz');
    url.searchParams.set('fundCode', symbol);
    url.searchParams.set('pageIndex', '1');
    url.searchParams.set('pageSize', '10');
    try {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: `https://fundf10.eastmoney.com/jjjz_${symbol}.html`,
          Accept: 'application/json',
        },
      });
      if (!upstream.ok) return res.status(502).json({ error: 'upstream error', status: upstream.status });
      const payload = await upstream.json() as EastmoneyNavResponse;
      const navs = payload.Data?.LSJZList ?? [];
      const latest = navs.find((item) => Number.isFinite(Number(item.DWJZ)) && Number(item.DWJZ) > 0 && item.FSRQ);
      if (payload.ErrCode !== 0 || !latest) return res.status(502).json({ error: 'invalid upstream payload' });
      const bars = navs.flatMap((item) => {
        const close = Number(item.DWJZ);
        if (!item.FSRQ || !Number.isFinite(close) || close <= 0) return [];
        return [{ date: item.FSRQ, close, adjClose: close }];
      }).reverse();
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
      return res.status(200).json({
        symbol,
        currency: fundCurrency,
        regularMarketPrice: Number(latest.DWJZ),
        regularMarketTime: `${latest.FSRQ}T00:00:00.000Z`,
        bars,
        source: 'Eastmoney Fund NAV',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return res.status(502).json({ error: 'fund nav fetch failed', message });
    }
  }

  if (source !== 'yahoo') return res.status(400).json({ error: 'invalid source' });

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', range);
  url.searchParams.set('interval', interval);
  url.searchParams.set('events', 'history');
  url.searchParams.set('includeAdjustedClose', 'true');

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'upstream error', status: upstream.status });
    }

    const data = (await upstream.json()) as YahooChartResponse;
    const result = data.chart?.result?.[0];
    if (!result || data.chart?.error) {
      return res.status(502).json({ error: 'invalid upstream payload', detail: data.chart?.error });
    }

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

    if (bars.length === 0) {
      return res.status(502).json({ error: 'empty upstream bars' });
    }

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({
      symbol: result.meta?.symbol ?? symbol,
      currency: result.meta?.currency ?? '',
      name: result.meta?.longName ?? result.meta?.shortName ?? symbol,
      regularMarketPrice: result.meta?.regularMarketPrice ?? null,
      regularMarketTime: result.meta?.regularMarketTime
        ? new Date(result.meta.regularMarketTime * 1000).toISOString()
        : null,
      bars,
      source: 'Yahoo Finance',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return res.status(502).json({ error: 'market chart fetch failed', message });
  }
}
