import type { VercelRequest, VercelResponse } from '@vercel/node';

const UPSTREAM_BASE_URL = 'https://api.jiejiariapi.com/v1/holidays';

function parseYear(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  if (year < 2000 || year > 2100) return null;
  return year;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const year = parseYear(req.query.year);
  if (year === null) {
    return res.status(400).json({ error: 'invalid year' });
  }

  try {
    const headers: Record<string, string> = {};
    const apiKey = (process.env.JIEJIARI_API_KEY || '').trim();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const upstream = await fetch(`${UPSTREAM_BASE_URL}/${year}`, { headers });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'upstream error', status: upstream.status });
    }

    const data = await upstream.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(502).json({ error: 'invalid upstream payload' });
    }

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return res.status(502).json({ error: 'holiday fetch failed', message });
  }
}
