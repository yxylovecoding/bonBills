import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getShanghaiDate,
  mergeMonthlyBackupIndex,
  MONTHLY_BACKUP_INDEX_KEY,
  MONTHLY_BACKUP_PREFIX,
  type MonthlyBackupIndexEntry,
} from './_monthlyBackup';
import { SYNC_STORE_KEYS, type SyncPayload } from './_syncKeys';

function authOk(req: VercelRequest) {
  const secret = (process.env.CRON_SECRET || '').trim();
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });

  const date = getShanghaiDate();
  const createdAt = new Date().toISOString();
  const key = `${MONTHLY_BACKUP_PREFIX}${date}`;
  const values = await Promise.all(SYNC_STORE_KEYS.map((storeKey) => kv.get(storeKey)));
  const data = Object.fromEntries(
    SYNC_STORE_KEYS.map((storeKey, index) => [storeKey, values[index]]),
  ) as SyncPayload;
  const entry: MonthlyBackupIndexEntry = { date, createdAt, key };
  const existingIndex = await kv.get<MonthlyBackupIndexEntry[]>(MONTHLY_BACKUP_INDEX_KEY);
  const { retained, removed } = mergeMonthlyBackupIndex(
    Array.isArray(existingIndex) ? existingIndex : [],
    entry,
  );

  await kv.set(key, { date, createdAt, data });
  await kv.set(MONTHLY_BACKUP_INDEX_KEY, retained);
  await Promise.all(removed.map((oldEntry) => kv.del(oldEntry.key)));

  return res.status(200).json({
    ok: true,
    date,
    storedKeys: SYNC_STORE_KEYS.length,
    retained: retained.length,
    removed: removed.length,
  });
}
