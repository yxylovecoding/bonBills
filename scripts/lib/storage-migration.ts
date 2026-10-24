import { createHash } from 'node:crypto';
import type { Client, InStatement } from '@libsql/client';
import { initializeTursoSchema } from '../../api/_tursoSchema.js';

export type RecordData = { key: string; kind: 'string' | 'hash' | 'zset'; expiresAt: number | null;
  value: string | [string, string | number][] };
export type Snapshot = { version: 1; createdAt: number; records: RecordData[]; digest: string };
export type RedisCommand = (args: (string | number)[]) => Promise<unknown>;
function fail(): never { throw new Error('Storage migration validation failed'); }
const sort = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function canonical(records: RecordData[]) {
  return records.map(row => ({ key: row.key, kind: row.kind, expiresAt: row.expiresAt,
    value: typeof row.value === 'string' ? row.value : [...row.value].sort((a, b) => sort(a[0], b[0])),
  })).sort((a, b) => sort(a.key, b.key));
}
export const digest = (records: RecordData[]) => createHash('sha256').update(JSON.stringify(canonical(records))).digest('hex');
export function validateSnapshot(input: unknown): asserts input is Snapshot {
  const data = input as Snapshot;
  if (!data || data.version !== 1 || !Number.isFinite(data.createdAt) || !Array.isArray(data.records) || !data.records.length) fail();
  const seen = new Set<string>();
  for (const row of data.records) {
    if (!row || typeof row.key !== 'string' || seen.has(row.key) || !['string', 'hash', 'zset'].includes(row.kind)
      || row.expiresAt !== null && (!Number.isSafeInteger(row.expiresAt) || row.expiresAt < 0)) fail();
    seen.add(row.key);
    if (row.kind === 'string') { if (typeof row.value !== 'string') fail(); }
    else {
      if (!Array.isArray(row.value) || !row.value.length) fail();
      const members = new Set<string>();
      for (const pair of row.value) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || members.has(pair[0])
          || (row.kind === 'hash' ? typeof pair[1] !== 'string' : typeof pair[1] !== 'number' || !Number.isFinite(pair[1]))) fail();
        members.add(pair[0]);
      }
    }
  }
  if (data.digest !== digest(data.records)) fail();
}

// A script captures a key, its raw wire values and expiry together. Failure is
// fatal, never an empty result. Unsupported Redis structures fail closed.
export const EXPORT_KEY = `
local kind = redis.call('TYPE', KEYS[1]).ok
if kind == 'none' then return false end
local time = redis.call('TIME')
local ttl = redis.call('PTTL', KEYS[1])
local expires = ttl < 0 and -1 or tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000) + ttl
local value
if kind == 'string' then value = redis.call('GET', KEYS[1])
elseif kind == 'hash' then value = redis.call('HGETALL', KEYS[1])
elseif kind == 'zset' then value = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
else return redis.error_reply('Unsupported migration type') end
return {kind, expires, value}
`;
export async function exportRedis(command: RedisCommand): Promise<Snapshot> {
  const keys = new Set<string>();
  let cursor = '0';
  do {
    const page = await command(['SCAN', cursor, 'COUNT', 500]) as [string | number, string[]];
    if (!Array.isArray(page) || page.length !== 2 || !Array.isArray(page[1]) || !/^\d+$/.test(String(page[0]))) fail();
    cursor = String(page[0]);
    for (const key of page[1]) { if (typeof key !== 'string') fail(); keys.add(key); }
  } while (cursor !== '0');
  const records: RecordData[] = [];
  for (const key of [...keys].sort(sort)) {
    const row = await command(['EVAL', EXPORT_KEY, 1, key]) as [RecordData['kind'], number, string | string[]] | null;
    if (row === null) continue; // Expired since SCAN; Redis false is REST null.
    if (!Array.isArray(row) || row.length !== 3 || !Number.isSafeInteger(row[1]) || row[1] < -1) fail();
    let value: RecordData['value'];
    if (row[0] === 'string') {
      if (typeof row[2] !== 'string') fail();
      value = row[2];
    } else {
      if (!['hash', 'zset'].includes(row[0]) || !Array.isArray(row[2]) || row[2].length % 2) fail();
      const pairs: [string, string | number][] = [];
      for (let i = 0; i < row[2].length; i += 2) pairs.push([row[2][i], row[0] === 'zset' ? Number(row[2][i + 1]) : row[2][i + 1]]);
      value = pairs as RecordData['value'];
    }
    records.push({ key, kind: row[0], expiresAt: row[1] === -1 ? null : row[1], value });
  }
  const result: Snapshot = { version: 1, createdAt: Date.now(), records: canonical(records), digest: digest(records) };
  validateSnapshot(result);
  return result;
}

export function assertSameRecords(expected: RecordData[], actual: RecordData[], now = Date.now(), expiryTolerance = 0) {
  const live = (records: RecordData[]) => canonical(records.filter(row => row.expiresAt === null || row.expiresAt > now));
  const left = live(expected), right = live(actual);
  if (left.length !== right.length) fail();
  for (let i = 0; i < left.length; i++) {
    const a = left[i], b = right[i];
    if (a.key !== b.key || a.kind !== b.kind || JSON.stringify(a.value) !== JSON.stringify(b.value)
      || (a.expiresAt === null || b.expiresAt === null ? a.expiresAt !== b.expiresAt : Math.abs(a.expiresAt - b.expiresAt) > expiryTolerance)) fail();
  }
}
export async function readTarget(client: Client): Promise<RecordData[]> {
  const keys = await client.execute('SELECT key,kind,value,expires_at FROM storage_keys ORDER BY key');
  const records: RecordData[] = [];
  for (const row of keys.rows) {
    const key = String(row.key), kind = row.kind as RecordData['kind'];
    let value: RecordData['value'] = String(row.value);
    if (kind !== 'string') {
      const members = await client.execute({ sql: kind === 'hash' ? 'SELECT field,value FROM storage_hash WHERE key=?'
        : 'SELECT member,score FROM storage_zset WHERE key=?', args: [key] });
      value = members.rows.map(item => kind === 'hash' ? [String(item.field), String(item.value)] : [String(item.member), Number(item.score)]) as RecordData['value'];
    }
    records.push({ key, kind, value, expiresAt: row.expires_at === null ? null : Number(row.expires_at) });
  }
  return records;
}
export async function importSnapshot(client: Client, snapshot: Snapshot) {
  validateSnapshot(snapshot);
  await initializeTursoSchema(client);
  const existing = await client.execute("SELECT name,value FROM storage_meta WHERE name IN ('importing_migration','verified_migration')");
  if (existing.rows.some(row => row.name === 'verified_migration')) throw new Error('Refusing to overwrite verified/live storage');
  const staged = existing.rows.find(row => row.name === 'importing_migration');
  if (staged && staged.value !== snapshot.digest) throw new Error('A different migration is already staged');
  if (!staged) {
    const count = await client.execute('SELECT COUNT(*) AS count FROM storage_keys');
    if (Number(count.rows[0].count)) throw new Error('Target must be empty');
    await client.execute({ sql: "INSERT INTO storage_meta(name,value) VALUES ('importing_migration',?)", args: [snapshot.digest] });
  }
  for (const row of snapshot.records) {
    const statements: InStatement[] = [
      { sql: 'DELETE FROM storage_hash WHERE key=?', args: [row.key] },
      { sql: 'DELETE FROM storage_zset WHERE key=?', args: [row.key] },
      { sql: 'INSERT INTO storage_keys(key,kind,value,expires_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET kind=excluded.kind,value=excluded.value,expires_at=excluded.expires_at',
        args: [row.key, row.kind, row.kind === 'string' ? row.value as string : null, row.expiresAt] },
    ];
    if (row.kind !== 'string') {
      const pairs = row.value as [string, string | number][];
      for (let offset = 0; offset < pairs.length; offset += 100) {
        const chunk = pairs.slice(offset, offset + 100);
        statements.push({ sql: `INSERT INTO ${row.kind === 'hash' ? 'storage_hash(key,field,value)' : 'storage_zset(key,member,score)'} VALUES ${chunk.map(() => '(?,?,?)').join(',')}`,
          args: chunk.flatMap(([member, value]) => [row.key, member, value]) });
      }
    }
    await client.batch(statements, 'write');
  }
  assertSameRecords(snapshot.records, await readTarget(client));
}
export async function finalizeMigration(client: Client, snapshot: Snapshot, source: RedisCommand) {
  validateSnapshot(snapshot);
  const staged = await client.execute("SELECT value FROM storage_meta WHERE name='importing_migration'");
  if (staged.rows[0]?.value !== snapshot.digest) throw new Error('Snapshot is not staged in this database');
  // Caller must keep source writes frozen until production points to Turso.
  const fresh = await exportRedis(source);
  assertSameRecords(snapshot.records, fresh.records, Date.now(), 5);
  assertSameRecords(snapshot.records, await readTarget(client));
  await client.execute({ sql: "INSERT INTO storage_meta(name,value) VALUES ('verified_migration',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", args: [snapshot.digest] });
}
