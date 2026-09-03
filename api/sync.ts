import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MONTHLY_BACKUP_INDEX_KEY, type MonthlyBackupIndexEntry } from './_monthlyBackup.js';
import { restoreMonthlyInvestmentState } from './_restoreMonthlyInvestment.js';
import { SYNC_STORE_KEYS, type SyncPayload } from './_syncKeys.js';

const AUGUST_INVESTMENT_RECOVERY_MARKER = 'sync-recovery:2026-08-investment:2026-09-03-v1';

interface MonthlyBackup {
  data?: SyncPayload;
}

function authOk(req: VercelRequest): boolean {
  const secret = (process.env.SYNC_SECRET || '').trim();
  if (!secret) return false;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  return match !== null && match[1].trim() === secret;
}

async function restoreAugustInvestmentFromLatestBackup(currentState: unknown) {
  const completed = await kv.get(AUGUST_INVESTMENT_RECOVERY_MARKER);
  if (completed) return currentState;

  const index = await kv.get<MonthlyBackupIndexEntry[]>(MONTHLY_BACKUP_INDEX_KEY);
  const entries = Array.isArray(index)
    ? [...index].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : [];
  for (const entry of entries) {
    const backup = await kv.get<MonthlyBackup>(entry.key);
    const restored = restoreMonthlyInvestmentState(
      currentState,
      backup?.data?.['monthly-records'],
      '2026-08',
    );
    if (!restored.restored) continue;
    const restoredAt = new Date().toISOString();
    await kv.set(`${AUGUST_INVESTMENT_RECOVERY_MARKER}:before`, {
      createdAt: restoredAt,
      data: currentState,
    });
    await kv.set('monthly-records', restored.state);
    await kv.set(AUGUST_INVESTMENT_RECOVERY_MARKER, {
      restoredAt,
      source: entry.key,
    });
    return restored.state;
  }
  return currentState;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authOk(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    const values = await Promise.all(SYNC_STORE_KEYS.map((k) => kv.get(k)));
    const result: SyncPayload = {};
    let hasAny = false;
    SYNC_STORE_KEYS.forEach((k, i) => {
      if (values[i] !== null && values[i] !== undefined) {
        result[k] = values[i];
        hasAny = true;
      }
    });
    if (result['monthly-records']) {
      result['monthly-records'] = await restoreAugustInvestmentFromLatestBackup(result['monthly-records']);
    }
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
      SYNC_STORE_KEYS.filter((k) => k in body).map((k) => kv.set(k, body[k])),
    );
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
