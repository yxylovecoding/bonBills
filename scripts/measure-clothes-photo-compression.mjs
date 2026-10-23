// Offline only: exercise the actual Lua scripts against an isolated local Redis.
// REDIS_SERVER=/path/redis-server REDIS_CLI=/path/redis-cli node scripts/measure-clothes-photo-compression.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const source = readFileSync(new URL('../api/_clothesPhotoStorage.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('../api/_clothesReads.ts', import.meta.url), 'utf8');
const script = (name) => source.match(new RegExp(`export const ${name} = \x60([\\s\\S]*?)\x60;`))[1];
const dir = mkdtempSync(join(tmpdir(), 'bcp-'));
const socket = join(dir, 'redis.sock');
const server = spawn(process.env.REDIS_SERVER || 'redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
let startupLog = '';
server.stdout.on('data', (data) => { startupLog += data; });
server.stderr.on('data', (data) => { startupLog += data; });
let startupError;
server.on('error', (error) => { startupError = error; });
function command(args, input) {
  const result = spawnSync(process.env.REDIS_CLI || 'redis-cli', ['-s', socket, '--json', ...(input === undefined ? [] : ['-x']), ...args], { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
const token = (photo) => `photo-v2-${createHash('sha1').update(photo).digest('hex')}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    try { ready = command(['PING']) === 'PONG'; } catch { /* wait for socket */ }
    if (ready) break;
    await setTimeout(20);
  }
  assert.ok(ready, `Redis failed to start: ${startupLog}`);
  const prefix = 'account:fixture-a:bonclothes:photo:v1:';
  const items = 'account:fixture-a:bonclothes:items:v1', wear = 'account:fixture-a:bonclothes:wear:v1';
  const old = 'data:image/jpeg;base64,' + Buffer.alloc(100 * 1024, 7).toString('base64');
  const compact = 'data:image/webp;base64,' + Buffer.alloc(20 * 1024, 8).toString('base64');
  const storedItem = JSON.stringify({ id: 'item', photoId: 'photo-a', revision: 'unchanged' });
  const storedWear = JSON.stringify({ items: [{ photoId: 'photo-a' }, { photoId: 'photo-history' }, { photoId: 'photo-a' }] });
  command(['HSET', items, 'item'], storedItem);
  command(['HSET', items, 'discarded'], JSON.stringify({ status: '已丢弃', photoId: 'photo-b' }));
  command(['HSET', items, 'small'], JSON.stringify({ photoId: 'photo-small' }));
  command(['HSET', items, 'deleted'], JSON.stringify({ deleted: true }));
  command(['HSET', wear, 'history'], storedWear);
  for (const id of ['photo-a', 'photo-history']) command(['SET', prefix + id], old);
  command(['SET', prefix + 'photo-b'], JSON.stringify(old));
  command(['SET', prefix + 'photo-small'], compact);
  command(['SET', 'account:fixture-b:bonclothes:photo:v1:photo-a'], old);
  const list = () => command(['EVAL', script('READ_PHOTO_SIZES'), '3', items, wear, prefix, '54648']);
  assert.deepEqual(list().map(([id]) => id).sort(), ['photo-a', 'photo-b', 'photo-history']);
  const compress = (id, validator, photo) => command(['EVAL', script('COMPRESS_PHOTO'), '1', prefix + id, validator], photo);
  assert.deepEqual(compress('photo-a', token('stale'), compact), [-2, 0]);
  assert.equal(command(['GET', prefix + 'photo-a']), old);
  let saved = 0;
  for (const id of ['photo-a', 'photo-b', 'photo-history']) {
    const before = command(['STRLEN', prefix + id]);
    command(['PEXPIRE', prefix + id, '60000']);
    assert.deepEqual(compress(id, token(old), compact), [1, before - compact.length]);
    assert.ok(command(['PTTL', prefix + id]) > 0);
    assert.deepEqual(compress(id, token(old), compact), [0, 0]);
    assert.deepEqual(compress(id, token(compact), old), [0, 0]);
    saved += before - compact.length;
  }
  assert.deepEqual(list(), []);
  assert.deepEqual(compress('missing', token(old), compact), [-1, 0]);
  assert.equal(command(['GET', 'account:fixture-b:bonclothes:photo:v1:photo-a']), old);
  assert.equal(command(['HGET', items, 'item']), storedItem);
  assert.equal(command(['HGET', wear, 'history']), storedWear);
  const reference = JSON.stringify({ storage: 'r2', key: 'clothes/fixture/photo', mime: 'image/webp', bytes: 20 * 1024, validator: token(compact) });
  const migrate = (id, validator) => command(['EVAL', script('MIGRATE_PHOTO'), '1', prefix + id, validator], reference);
  assert.deepEqual(migrate('photo-a', token('stale')), [-2, 0]);
  assert.equal(command(['GET', prefix + 'photo-a']), compact);
  const beforeMigration = command(['STRLEN', prefix + 'photo-a']);
  assert.deepEqual(migrate('photo-a', token(compact)), [1, beforeMigration - reference.length]);
  assert.ok(command(['PTTL', prefix + 'photo-a']) > 0);
  assert.deepEqual(migrate('photo-a', token(compact)), [0, 0]);
  assert.deepEqual(compress('photo-a', token(compact), old), [-3, 0]);
  assert.deepEqual(command(['EVAL', script('READ_PHOTO'), '1', prefix + 'photo-a', '[]']), [token(compact), reference]);
  assert.deepEqual(command(['EVAL', script('READ_PHOTO'), '1', prefix + 'photo-a', JSON.stringify([`"${token(compact)}"`])]), [token(compact), '']);
  const remaining = command(['EVAL', script('READ_PHOTO_SIZES'), '3', items, wear, prefix, '0']);
  assert.deepEqual(remaining.map(([id]) => id).sort(), ['photo-b', 'photo-history', 'photo-small']);
  command(['SET', prefix + 'photo-b'], JSON.stringify(compact));
  assert.equal(migrate('photo-b', token(compact))[0], 1);
  assert.deepEqual(migrate('missing', token(compact)), [-1, 0]);
  assert.equal(command(['HGET', items, 'item']), storedItem);
  assert.equal(command(['HGET', wear, 'history']), storedWear);
  console.log(JSON.stringify({ photos: 3, savedStorageBytes: saved, passed: ['reference discovery', 'deduplication', 'discarded and historical photos', 'legacy JSON storage', 'version conflicts', 'smaller-only writes', 'idempotent retries', 'expiry preservation', 'account isolation', 'unchanged item and history metadata', 'atomic R2 migration', 'R2 conditional cache', 'migrated photo exclusion'] }, null, 2));
} finally {
  if (server.exitCode === null && !startupError) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  rmSync(dir, { recursive: true, force: true });
}
