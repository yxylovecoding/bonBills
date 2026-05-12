import type { VercelRequest, VercelResponse } from '@vercel/node';

const UPSTREAM_URL = 'https://api.frankfurter.dev/v2/rate/USD/CNY';

type FrankfurterRateResponse = {
  amount?: number;
  base?: string;
  quote?: string;
  date?: string;
  rate?: number;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const upstream = await fetch(UPSTREAM_URL);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'upstream error', status: upstream.status });
    }

    const data = (await upstream.json()) as FrankfurterRateResponse;
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(502).json({ error: 'invalid upstream payload' });
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      rate,
      date: data.date ?? '',
      source: 'Frankfurter',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return res.status(502).json({ error: 'usd rate fetch failed', message });
  }
}
