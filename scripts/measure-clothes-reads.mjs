// Offline integration/regression measurement. Uses only an isolated temporary
// Redis with synthetic fixtures; never reads connection env vars or live data.
// REDIS_SERVER=/path/redis-server REDIS_CLI=/path/redis-cli node scripts/measure-clothes-reads.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const source = readFileSync(new URL('../api/_clothesReads.ts', import.meta.url), 'utf8');
const script = (name) => source.match(new RegExp(`export const ${name} = \x60([\\s\\S]*?)\x60;`))[1];
const photoScript = script('READ_PHOTO'), wearScript = script('READ_WEAR_PAGE');
const dir = mkdtempSync(join(tmpdir(), 'bonbills-redis-'));
const socket = join(dir, 'redis.sock');
const server = spawn(process.env.REDIS_SERVER || 'redis-server', ['--port', '0', '--unixsocket', socket,
  '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: 'ignore' });
let startupError;
server.on('error', (error) => { startupError = error; });
function command(args, input) {
  const result = spawnSync(process.env.REDIS_CLI || 'redis-cli', ['-s', socket, '--json', ...(input === undefined ? [] : ['-x']), ...args],
    { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    try { ready = command(['PING']) === 'PONG'; } catch { /* socket not ready */ }
    if (ready) break;
    await setTimeout(20);
  }
  assert.ok(ready, 'Local Redis must be available');
  const photo = 'data:image/jpeg;base64,' + Buffer.alloc(200 * 1024, 7).toString('base64');
  const key = 'account:fixture-a:bonclothes:photo:v1:fixture';
  command(['SET', key], photo);
  const first = command(['EVAL', photoScript, '1', key, '[]']);
  assert.equal(first[1], photo);
  const hit = command(['EVAL', photoScript, '1', key, JSON.stringify([`"${first[0]}"`])]);
  assert.deepEqual(hit, [first[0], '']);
  assert.ok(bytes(hit) < 100);
  assert.deepEqual(command(['EVAL', photoScript, '1', 'account:fixture-b:bonclothes:photo:v1:fixture', JSON.stringify([`"${first[0]}"`])]), ['', '']);
  assert.deepEqual(command(['EVAL', photoScript, '1', key, '["*"]']), hit);
  assert.equal(command(['EVAL', photoScript, '1', key, '["old-sha256-etag"]'])[1], photo);
  command(['SET', key], JSON.stringify(photo));
  assert.deepEqual(command(['EVAL', photoScript, '1', key, JSON.stringify([`"${first[0]}"`])]), hit);
  command(['SET', key], photo + 'changed');
  assert.equal(command(['EVAL', photoScript, '1', key, JSON.stringify([`"${first[0]}"`])])[1], photo + 'changed');
  command(['DEL', key]);
  assert.deepEqual(command(['EVAL', photoScript, '1', key, JSON.stringify([`"${first[0]}"`])]), ['', '']);

  const wearKey = 'account:fixture-a:bonclothes:wear:v1';
  const fixtures = {};
  for (let i = 0; i < 365; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    // Old date fields + newer manual UUID fields, multiple records on one date.
    for (let j = 0; j < (i === 364 ? 35 : 1); j++) {
      const field = j ? `manual-${i}-${j}` : date;
      fixtures[field] = { date, confirmedAt: `${date}T12:00:00Z`, ...(i % 11 === 0 ? { kind: 'styled' } : {}),
        items: [{ name: 'synthetic', photoId: 'immutable-fixture', notes: 'x'.repeat(2048) }] };
      command(['HSET', wearKey, field], JSON.stringify(fixtures[field]));
    }
  }
  const all = Object.values(fixtures);
  const normalize = (records) => records.map((r) => JSON.stringify(r)).sort();
  const read = (date, mode) => command(['EVAL', wearScript, '1', wearKey, date, mode]).map(JSON.parse);
  for (const date of ['2025-12-31', '2025-07-01', '2024-12-31']) {
    const worn = all.filter((r) => r.kind !== 'styled' && r.date <= date);
    const dates = [...new Set(worn.map((r) => r.date))].sort().reverse().slice(0, 30);
    assert.deepEqual(normalize(read(date, 'history')), normalize(worn.filter((r) => dates.includes(r.date))));
    assert.deepEqual(normalize(read(date, 'day')), normalize(all.filter((r) => r.date === date)));
  }
  assert.deepEqual(command(['EVAL', wearScript, '1', 'account:fixture-b:bonclothes:wear:v1', '2025-12-31', 'history']), []);
  // Redis REST returns JSON-serialized results. Count those result bytes only,
  // not HTTP headers, billing overhead, incoming script text or production usage.
  const oldHistory = command(['HGETALL', wearKey]);
  const page = command(['EVAL', wearScript, '1', wearKey, '2025-12-31', 'history']);
  const day = command(['EVAL', wearScript, '1', wearKey, '2025-12-31', 'day']);
  const report = {
    metric: 'UTF-8 bytes of JSON-serialized Redis result; synthetic offline fixtures only',
    photo: { binaryBytes: 200 * 1024, oldGet: bytes(photo), conditionalHit: bytes(hit), coldRead: bytes(first), outerCommandsBefore: 1, outerCommandsAfter: 1 },
    history: { totalRecords: all.length, returnedRecords: page.length, oldHgetall: bytes(oldHistory), page: bytes(page), day: bytes(day) },
  };
  assert.ok(bytes(page) < bytes(oldHistory));
  console.log(JSON.stringify(report, null, 2));
  console.log('PASS: Lua execution, legacy storage, changed/deleted photos, account keys, whole-date pagination, empty pages, styled records and day fallback');
} finally {
  if (server.exitCode === null && !startupError) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  rmSync(dir, { recursive: true, force: true });
}
