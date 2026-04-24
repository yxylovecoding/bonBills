import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_KEYS = [
  'bill-details',
  'monthly-records',
  'calendar-tags',
  'account-snapshot',
  'app-config',
  'user-prefs',
] as const;

type StoreKey = typeof STORE_KEYS[number];
type SyncPayload = Partial<Record<StoreKey, unknown>>;

function authOk(req: VercelRequest): boolean {
  const secret = (process.env.SYNC_SECRET || '').trim();
  if (!secret) return false;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  return match !== null && match[1].trim() === secret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authOk(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    const values = await Promise.all(STORE_KEYS.map((k) => kv.get(k)));
    const result: SyncPayload = {};
    let hasAny = false;
    STORE_KEYS.forEach((k, i) => {
      if (values[i] !== null && values[i] !== undefined) {
        result[k] = values[i];
        hasAny = true;
      }
    });
    if (!hasAny) {
      return res.status(204).end();
    }
    return res.status(200).json(result);
  }

  if (req.method === 'PUT') {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as SyncPayload;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'invalid body' });
    }
    await Promise.all(
      STORE_KEYS.filter((k) => k in body).map((k) => kv.set(k, body[k])),
    );
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
