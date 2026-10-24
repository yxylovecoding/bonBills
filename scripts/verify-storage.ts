// Offline differential test: real Redis Lua versus real SQLite transactions.
// Only synthetic data, an isolated Unix socket and an in-memory database.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import ts from 'typescript';
import { createClient } from '@libsql/client';
import { initializeTursoSchema } from '../api/_tursoSchema.js';
import { createTursoKv } from '../api/_tursoKv.js';
import { decodeStorage, encodeStorage } from '../api/_storageCodec.js';
import { storageOperation, type StorageOperation } from '../api/_storageScriptIds.js';
import { exportRedis, readTarget } from './lib/storage-migration.js';

const scripts = new Map<StorageOperation, string[]>();
const apiDir = new URL('../api/', import.meta.url);
for (const name of readdirSync(apiDir).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
  const source = ts.createSourceFile(name, readFileSync(new URL(name, apiDir), 'utf8'), ts.ScriptTarget.Latest);
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) && node.text.includes('redis.call(')) {
      const operation = storageOperation(node.text);
      scripts.set(operation, [...(scripts.get(operation) ?? []), node.text]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const dir = mkdtempSync(join(tmpdir(), 'bonbills-parity-')), socket = join(dir, 'redis.sock');
const server = spawn(process.env.REDIS_SERVER || 'redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: 'ignore' });
let startupError: Error | undefined;
server.on('error', error => { startupError = error; });
const client = createClient({ url: 'file::memory:' }), kv = createTursoKv(client);
const checked = new Set<StorageOperation>();
let assertions = 0;
function redis(args: (string | number)[]) {
  const result = spawnSync(process.env.REDIS_CLI || 'redis-cli', ['-s', socket, '--json', ...args.map(String)], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
async function set(key: string, value: unknown, ttl?: number) {
  redis(['SET', key, encodeStorage(value), ...(ttl ? ['EX', ttl] : [])]);
  await kv.set(key, value, ttl ? { ex: ttl } : {});
}
async function hash(key: string, fields: Record<string, unknown>) {
  redis(['HSET', key, ...Object.entries(fields).flatMap(([field, value]) => [field, encodeStorage(value)])]);
  await kv.hset(key, fields);
}
async function evaluate(operation: StorageOperation, keys: string[], args: unknown[]) {
  let actual: unknown;
  for (const script of scripts.get(operation) ?? []) {
    const expected = decodeStorage(redis(['EVAL', script, keys.length, ...keys, ...args.map(encodeStorage)]));
    actual = await kv.eval(script, keys, args);
    const ordered = (value: unknown) => ['wear-page', 'photo-sizes'].includes(operation)
      ? [...value as unknown[]].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value;
    assert.deepEqual(ordered(actual), ordered(expected), operation);
    checked.add(operation); assertions++;
  }
  return actual;
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    try { ready = redis(['PING']) === 'PONG'; } catch { /* startup */ }
    if (ready) break;
    await setTimeout(20);
  }
  assert.ok(ready, 'Local Redis must start');
  await initializeTursoSchema(client);
  await set('lock', 'owner', 180);
  await evaluate('release-lock', ['lock'], ['other']);
  await evaluate('renew-outlook-lock', ['lock'], ['other']);
  await evaluate('renew-outlook-lock', ['lock'], ['owner']);
  await evaluate('release-lock', ['lock'], ['owner']);
  await set('email', { attempt: 'a' });
  await evaluate('release-email', ['email'], ['other']);
  await evaluate('release-email', ['email'], ['a']);
  await set('cas', { old: true });
  await evaluate('compare-set', ['cas'], ['wrong', 'new']);
  await evaluate('compare-set', ['cas'], [JSON.stringify({ old: true }), JSON.stringify({ new: true })]);
  await set('connection', { id: 'c', encryptedToken: { data: 'token' } });
  await evaluate('save-periods', ['connection', 'periods'], ['other', 10, '{"requestedAt":10}', 0]);
  await evaluate('save-periods', ['connection', 'periods'], ['c', 10, '{"requestedAt":10}', 0]);
  await evaluate('save-periods', ['connection', 'periods'], ['c', 20, '{"requestedAt":20}', 0]);
  await evaluate('save-periods', ['connection', 'periods'], ['c', 20, '{"requestedAt":20}', 10]);
  await evaluate('save-outlook-done', ['connection', 'outlook-done'], ['c', '20', '{"requestedAt":20}']);
  await evaluate('save-outlook-done', ['connection', 'outlook-done'], ['c', '10', '{"requestedAt":10}']);
  await evaluate('save-training', ['connection', 'training'], ['token', '{"requestedAt":20}', '20']);
  await evaluate('save-training', ['connection', 'training'], ['token', '{"requestedAt":10}', '10']);
  await evaluate('save-done', ['connection', 'done', 'synced', 'names'], ['token', '[{"id":"d","title":"fixture"}]', '2026-10-24', '{"project":"示例"}']);
  await evaluate('save-done', ['connection', 'done', 'synced', 'names'], ['other', '[{"id":"d2"}]', '2026-10-25', '{}']);
  await evaluate('save-done', ['connection', 'done', 'synced', 'names'], ['token', '[]', '2026-10-23', '{}']);
  const quotaNow = Date.now();
  for (let i = 0; i <= 200; i++) await evaluate('reserve-make', ['quota'], [quotaNow, `request-${i}`]);
  await evaluate('reserve-make', ['quota'], [quotaNow + 2_764_800_000, 'next-window']);
  await hash('items', { item: { revision: 'i1', status: '可穿' } });
  const clothes = (id: string, revision: string, check: string, photo = '', data = '') => evaluate('save-clothes', ['wear', id, 'items', photo],
    ['record', revision, 'v1', '{"revision":"v1","date":"2026-10-24","items":[{"photoId":"p1"}]}', data, check, id]);
  await clothes('missing-item', '', '[{"id":"absent","revision":"i1"}]');
  await clothes('stale-item', '', '[{"id":"item","revision":"wrong"}]');
  await clothes('missing-photo', '', '[]', 'absent');
  await clothes('saved', '', '[{"id":"item","revision":"i1"}]', 'photo:p1', 'data:image/png;base64,abcdefghijklmnop');
  await clothes('saved', '', '[]');
  await clothes('conflict', '', '[]');
  await evaluate('save-clothes', ['wear', 'saved', 'items', ''], ['record', '', 'v2', '{}', '', '[]', 'different-signature']);
  await hash('life', { day: { revision: 'v0', text: '', skin: { dry: true }, eyes: null, body: { weight: 50 } } });
  const life = (base: string, revision: string, makeup: string) => evaluate('save-life-entry', ['life', 'symptoms'],
    ['day', base, revision, JSON.stringify({ revision, text: '新内容', makeup: { revision: makeup, face: true, eyes: false } }), 'daily', 'shared']);
  await life('v0', 'v1', ''); await life('v0', 'v1', ''); await life('v1', 'v2', ''); await life('v1', 'v2', 'v1');
  await evaluate('save-life-entry', ['settings'], ['cycle', '', 'v1', '{"revision":"v1","days":28}', 'cycle']);
  const [etag] = await evaluate('read-photo', ['photo:p1'], ['[]']) as string[];
  await evaluate('read-photo', ['photo:p1'], [JSON.stringify([`"${etag}"`])]);
  await evaluate('compress-photo', ['photo:p1'], ['wrong', 'short']);
  await evaluate('compress-photo', ['photo:p1'], [etag, 'short']);
  const [newTag] = await evaluate('read-photo', ['photo:p1'], ['[]']) as string[];
  await evaluate('migrate-photo', ['photo:p1'], [newTag, JSON.stringify({ validator: newTag, key: 'r2/p1' })]);
  await evaluate('migrate-photo', ['photo:p1'], [newTag, '{}']);
  await evaluate('compress-photo', ['photo:p1'], [newTag, 'a']);
  await evaluate('read-photo', ['photo:p1'], ['["*"]']);
  await set('photo:legacy', JSON.stringify('data:image/png;base64,abc'));
  await evaluate('read-photo', ['photo:legacy'], ['[]']);
  await evaluate('read-photo', ['missing'], ['[]']);
  await hash('items', { legacy: { photoId: 'legacy' }, invalid: { photoId: 'under_score' } });
  await set('photo:under_score', 'data:image/png;base64,abc');
  await evaluate('photo-sizes', ['items', 'wear', 'photo:'], ['0']);
  const history = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [String(i), {
    date: new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10), ...(i % 9 === 0 ? { kind: 'styled' } : {}), items: [],
  }]));
  await hash('wear', history);
  await evaluate('wear-page', ['wear'], ['2026-10-24', 'history']);
  await evaluate('wear-page', ['wear'], ['2026-10-24', 'day']);
  await evaluate('wear-page', ['wear'], ['2025-10-24', 'history']);
  // Compare all side effects semantically, including TTLs and sorted sets.
  const expected = await exportRedis(async args => redis(args)), actual = await readTarget(client);
  const normalized = (rows: typeof actual) => rows.map(row => ({ ...row, expiresAt: undefined,
    value: typeof row.value === 'string' ? decodeStorage(row.value) : row.value.map(([key, value]) => [key, decodeStorage(value)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  })).sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(normalized(actual), normalized(expected.records));
  for (const row of expected.records) {
    const target = actual.find(item => item.key === row.key)!;
    assert.ok(row.expiresAt === null ? target.expiresAt === null : target.expiresAt !== null && Math.abs(row.expiresAt - target.expiresAt) < 2000, 'TTL must be preserved');
  }
  assert.equal(checked.size, scripts.size);
  console.log(`PASS: ${assertions} Redis/Turso comparisons across all ${checked.size} transaction operations, including side effects and TTLs`);
} finally {
  client.close();
  if (server.exitCode === null && !startupError) {
    server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve));
  }
  rmSync(dir, { recursive: true, force: true });
}
