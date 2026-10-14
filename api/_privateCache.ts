import type { VercelRequest, VercelResponse } from '@vercel/node';

// Call only for successful, authenticated reads. Errors, mutations and cron
// endpoints retain their no-store policy. Never put personal data in a CDN.
export function privateCache(res: VercelResponse, seconds = 30, immutable = false) {
  res.setHeader('Cache-Control', `private, max-age=${seconds}, ${immutable ? 'immutable' : 'must-revalidate'}`);
  res.setHeader('Vary', 'Cookie, Authorization, X-BonBills-Account, X-BonBills-Cache');
}

export function privateJson(req: VercelRequest, res: VercelResponse, value: unknown, seconds = 30) {
  if (req.method === 'GET') privateCache(res, seconds);
  return res.status(200).json(value);
}
