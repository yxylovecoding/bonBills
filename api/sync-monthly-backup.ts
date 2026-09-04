import { authOk } from './_auth.js';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getShanghaiDate,
  MANUAL_BACKUP_INDEX_KEY,
  MANUAL_BACKUP_PREFIX,
  mergeMonthlyBackupIndex,
  mergeManualBackupIndex,
  MONTHLY_BACKUP_INDEX_KEY,
  MONTHLY_BACKUP_PREFIX,
  type MonthlyBackupIndexEntry,
} from './_monthlyBackup.js';
import { SYNC_STORE_KEYS, type SyncPayload } from './_syncKeys.js';

function cronAuthOk(req: VercelRequest) {
  const secret = (process.env.CRON_SECRET || '').trim();
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

function parseSyncPayload(req: VercelRequest): SyncPayload | null {
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const data = Object.fromEntries(
      SYNC_STORE_KEYS.filter((storeKey) => storeKey in body).map((storeKey) => [storeKey, body[storeKey]]),
    ) as SyncPayload;
    return Object.keys(data).length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function saveBackup(
  data: SyncPayload,
  entry: MonthlyBackupIndexEntry,
  indexKey: string,
  mergeIndex: (existing: MonthlyBackupIndexEntry[], current: MonthlyBackupIndexEntry) => {
    retained: MonthlyBackupIndexEntry[];
    removed: MonthlyBackupIndexEntry[];
  },
) {
  const existingIndex = await kv.get<MonthlyBackupIndexEntry[]>(indexKey);
  const { retained, removed } = mergeIndex(
    Array.isArray(existingIndex) ? existingIndex : [],
    entry,
  );

  await kv.set(entry.key, { date: entry.date, createdAt: entry.createdAt, data });
  await kv.set(indexKey, retained);
  await Promise.all(removed.map((oldEntry) => kv.del(oldEntry.key)));
  return { retained: retained.length, removed: removed.length };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'POST') {
    if (!await authOk(req)) return res.status(401).json({ error: 'unauthorized' });
    const data = parseSyncPayload(req);
    if (!data) return res.status(400).json({ error: 'invalid body' });

    const date = getShanghaiDate();
    const createdAt = new Date().toISOString();
    const entry: MonthlyBackupIndexEntry = {
      date,
      createdAt,
      key: `${MANUAL_BACKUP_PREFIX}${createdAt}`,
    };
    const result = await saveBackup(data, entry, MANUAL_BACKUP_INDEX_KEY, mergeManualBackupIndex);

    return res.status(200).json({
      ok: true,
      date,
      createdAt,
      storedKeys: Object.keys(data).length,
      ...result,
    });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!cronAuthOk(req)) return res.status(401).json({ error: 'unauthorized' });

  const date = getShanghaiDate();
  const createdAt = new Date().toISOString();
  const key = `${MONTHLY_BACKUP_PREFIX}${date}`;
  const values = await Promise.all(SYNC_STORE_KEYS.map((storeKey) => kv.get(storeKey)));
  const data = Object.fromEntries(
    SYNC_STORE_KEYS.map((storeKey, index) => [storeKey, values[index]]),
  ) as SyncPayload;
  const entry: MonthlyBackupIndexEntry = { date, createdAt, key };
  const result = await saveBackup(data, entry, MONTHLY_BACKUP_INDEX_KEY, mergeMonthlyBackupIndex);

  return res.status(200).json({
    ok: true,
    date,
    storedKeys: SYNC_STORE_KEYS.length,
    ...result,
  });
}
