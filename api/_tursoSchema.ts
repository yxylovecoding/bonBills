import type { Client } from '@libsql/client';

export const STORAGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS storage_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS storage_keys (
    key TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('string','hash','zset')),
    value TEXT, expires_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS storage_expiry ON storage_keys(expires_at) WHERE expires_at IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS storage_hash (
    key TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(key, field)
  )`,
  `CREATE TABLE IF NOT EXISTS storage_zset (
    key TEXT NOT NULL, member TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY(key, member)
  )`,
  `CREATE INDEX IF NOT EXISTS storage_zset_score ON storage_zset(key, score)`,
];

export async function initializeTursoSchema(client: Client) {
  await client.batch(STORAGE_SCHEMA, 'write');
}
