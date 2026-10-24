import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { digest, exportRedis, importSnapshot, finalizeMigration, readTarget, validateSnapshot, type RecordData, type RedisCommand, type Snapshot } from './storage-migration.js';

let client: Client, records: RecordData[], source: RedisCommand;
beforeEach(() => {
  client = createClient({ url: 'file::memory:' });
  records = [
    { key: 'auth:owner', kind: 'string', value: '{"account":"legacy","secret":"synthetic-only"}', expiresAt: null },
    { key: 'account:other:items', kind: 'hash', value: [['second', '001'], ['first', '{"nested":[1,null]}']], expiresAt: null },
    { key: 'auth:session:fixture', kind: 'string', value: '"user"', expiresAt: Date.now() + 3600_000 },
    { key: 'make:usage', kind: 'zset', value: [['request-a', 1234], ['request-b', 1235]], expiresAt: Date.now() + 3600_000 },
  ];
  source = async args => {
    if (args[0] === 'SCAN') return ['0', [...records.map(row => row.key), records[0].key, 'expired']];
    const row = records.find(row => row.key === args[3]);
    return row ? [row.kind, row.expiresAt ?? -1, typeof row.value === 'string' ? row.value : row.value.flat().map(String)] : null;
  };
});
afterEach(() => client.close());

it('copies every namespace, exact wire bytes and absolute expiry, and resumes without duplicates', async () => {
  const snapshot = await exportRedis(source);
  expect(snapshot.records).toHaveLength(4);
  await importSnapshot(client, snapshot);
  await importSnapshot(client, snapshot);
  expect(digest(await readTarget(client))).toBe(snapshot.digest);
  expect((await client.execute("SELECT value FROM storage_meta WHERE name='verified_migration'")).rows).toEqual([]);
  await finalizeMigration(client, snapshot, source);
  expect((await client.execute("SELECT value FROM storage_meta WHERE name='verified_migration'")).rows[0].value).toBe(snapshot.digest);
  await expect(importSnapshot(client, snapshot)).rejects.toThrow('Refusing');
});
it('never interprets an unavailable or empty source as a successful export', async () => {
  await expect(exportRedis(async () => { throw Error('quota'); })).rejects.toThrow('quota');
  await expect(exportRedis(async () => ['0', []])).rejects.toThrow('validation');
  await expect(exportRedis(async args => args[0] === 'SCAN' ? ['0', ['x']] : ['list', -1, ['x']])).rejects.toThrow('validation');
});
it('refuses source drift, target corruption and edited snapshots before setting readiness', async () => {
  const snapshot = await exportRedis(source);
  const corrupt = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
  corrupt.records[0].value = 'changed';
  expect(() => validateSnapshot(corrupt)).toThrow('validation');
  await importSnapshot(client, snapshot);
  records[0].value = 'changed';
  await expect(finalizeMigration(client, snapshot, source)).rejects.toThrow('validation');
  records[0].value = snapshot.records.find(row => row.key === records[0].key)!.value;
  await client.execute("UPDATE storage_hash SET value='corrupted' WHERE field='first'");
  await expect(finalizeMigration(client, snapshot, source)).rejects.toThrow('validation');
  expect((await client.execute("SELECT value FROM storage_meta WHERE name='verified_migration'")).rows).toEqual([]);
});
it('refuses unrelated target content and duplicate snapshot keys', async () => {
  const snapshot = await exportRedis(source);
  await importSnapshot(client, snapshot);
  records.push({ key: 'new', kind: 'string', value: 'new', expiresAt: null });
  await expect(importSnapshot(client, await exportRedis(source))).rejects.toThrow('different migration');
  snapshot.records.push(snapshot.records[0]); snapshot.digest = digest(snapshot.records);
  expect(() => validateSnapshot(snapshot)).toThrow('validation');
});
