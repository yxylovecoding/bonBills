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

type EastmoneyTrendPoint = {
  x?: number;
  y?: number;
  equityReturn?: number;
};

type PriceBar = {
  date: string;
  close: number;
  adjClose: number;
  [key: string]: unknown;
};

const VALID_SYMBOL = /^[A-Z0-9.^=_-]{1,24}$/i;

export function lastBarPerMonth<T extends { date: string }>(bars: T[]): T[] {
  const byMonth = new Map<string, T>();
  for (const bar of [...bars].sort((left, right) => left.date.localeCompare(right.date))) {
    byMonth.set(bar.date.slice(0, 7), bar);
  }
  return [...byMonth.values()];
}

function parseEastmoneyTrend(script: string): EastmoneyTrendPoint[] {
  const match = script.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('fund NAV trend missing');
  return JSON.parse(match[1]) as EastmoneyTrendPoint[];
}

export function fundTotalReturnBars(trend: EastmoneyTrendPoint[]): PriceBar[] {
  let totalReturnIndex = 1;
  let previousNav: number | null = null;
  return trend.flatMap((item) => {
    const timestamp = Number(item.x);
    const nav = Number(item.y);
    if (!Number.isFinite(timestamp) || !Number.isFinite(nav) || nav <= 0) return [];
    const reportedReturn = Number(item.equityReturn);
    const periodReturn = Number.isFinite(reportedReturn)
      ? reportedReturn / 100
      : previousNav !== null ? nav / previousNav - 1 : 0;
    if (Number.isFinite(periodReturn) && periodReturn > -1) totalReturnIndex *= 1 + periodReturn;
    previousNav = nav;
    return [{
      date: new Date(timestamp).toISOString().slice(0, 10),
      close: totalReturnIndex,
      adjClose: totalReturnIndex,
    }];
  });
}

async function fetchEastmoneyTrend(symbol: string): Promise<EastmoneyTrendPoint[]> {
  const response = await fetch(`https://fund.eastmoney.com/pingzhongdata/${symbol}.js?v=${Date.now()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: `https://fund.eastmoney.com/${symbol}.html`,
      Accept: 'text/javascript,*/*',
    },
  });
  if (!response.ok) throw new Error(`fund trend ${response.status}`);
  return parseEastmoneyTrend(await response.text());
}

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
    if (range === 'max') {
      try {
        const trend = await fetchEastmoneyTrend(symbol);
        const valid = trend.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number(item.y) > 0);
        const latest = valid[valid.length - 1];
        if (!latest) throw new Error('fund NAV trend empty');
        const totalReturnBars = fundTotalReturnBars(valid);
        res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
        return res.status(200).json({
          symbol,
          currency: fundCurrency,
          regularMarketPrice: Number(latest.y),
          regularMarketTime: new Date(Number(latest.x)).toISOString(),
          bars: interval === '1mo' ? lastBarPerMonth(totalReturnBars) : totalReturnBars,
          source: 'Eastmoney Fund Total Return',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return res.status(502).json({ error: 'fund history fetch failed', message });
      }
    }
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
      if (!upstream.ok) throw new Error(`primary fund NAV ${upstream.status}`);
      const payload = await upstream.json() as EastmoneyNavResponse;
      const navs = payload.Data?.LSJZList ?? [];
      const latest = navs.find((item) => Number.isFinite(Number(item.DWJZ)) && Number(item.DWJZ) > 0 && item.FSRQ);
      if (payload.ErrCode !== 0 || !latest) throw new Error('primary fund NAV unavailable');
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
    } catch (primaryError) {
      try {
        const fallback = await fetch(`https://fund.eastmoney.com/pingzhongdata/${symbol}.js?v=${Date.now()}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://fund.eastmoney.com/${symbol}.html`, Accept: 'text/javascript,*/*' },
        });
        if (!fallback.ok) throw new Error(`fallback ${fallback.status}`);
        const script = await fallback.text();
        const trend = parseEastmoneyTrend(script);
        const valid = trend.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number(item.y) > 0);
        const latest = valid[valid.length - 1];
        if (!latest) throw new Error('fallback NAV empty');
        const bars = valid.slice(-10).map((item) => ({
          date: new Date(Number(item.x)).toISOString().slice(0, 10),
          close: Number(item.y),
          adjClose: Number(item.y),
        }));
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
        return res.status(200).json({
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
        return res.status(502).json({ error: 'fund nav fetch failed', message: `${primaryMessage}; ${fallbackMessage}` });
      }
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
      bars: interval === '1mo' ? lastBarPerMonth(bars) : bars,
      source: 'Yahoo Finance',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return res.status(502).json({ error: 'market chart fetch failed', message });
  }
}
