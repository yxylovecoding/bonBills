import type { VercelRequest, VercelResponse } from '@vercel/node';

function authOk(req: VercelRequest) {
  const secret = (process.env.SYNC_SECRET || '').trim();
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return Boolean(secret && match && match[1].trim() === secret);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const baseUrl = (process.env.BONCV_API_BASE_URL || '').replace(/\/$/, '');
  const apiKey = (process.env.BONCV_API_KEY || '').trim();
  if (!baseUrl || !apiKey) return res.status(503).json({ error: 'BonCV connection is not configured' });

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (typeof req.headers['if-none-match'] === 'string') headers['If-None-Match'] = req.headers['if-none-match'];
  try {
    const upstream = await fetch(`${baseUrl}/api/v1/fire-profile`, { headers, signal: AbortSignal.timeout(10_000) });
    const etag = upstream.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');
    if (upstream.status === 304) return res.status(304).end();
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(body);
  } catch {
    return res.status(502).json({ error: 'BonCV is temporarily unavailable' });
  }
}
