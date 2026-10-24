import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { initializeTursoSchema } from './_tursoSchema.js';
import { createTursoKv } from './_tursoKv.js';
import { STORAGE_SCRIPT_IDS, storageOperation } from './_storageScriptIds.js';
import { SAVE_CLOTHES } from './_bonClothes.js';
import { SAVE_LIFE_ENTRY } from './_bonLife.js';
import { READ_PHOTO, READ_WEAR_PAGE } from './_clothesReads.js';
import { READ_PHOTO_SIZES, MIGRATE_PHOTO } from './_clothesPhotoStorage.js';

let client: Client, kv: ReturnType<typeof createTursoKv>, now: number;
beforeEach(async () => {
  client = createClient({ url: 'file::memory:' });
  await initializeTursoSchema(client);
  now = Date.now(); kv = createTursoKv(client, () => now);
});
afterEach(() => client.close());

describe('Turso storage contract', () => {
  it('preserves wire values, hash fields, account namespaces and missing values', async () => {
    const fixtures = { text: 'abc', number: 42, null: null, jsonString: '"quoted"', zeroPrefix: '001', large: '9007199254740993', object: { a: [1, null] } };
    await kv.mset(fixtures);
    expect(await kv.mget(...Object.keys(fixtures), 'missing')).toEqual(['abc', 42, null, 'quoted', '001', '9007199254740993', { a: [1, null] }, null]);
    await kv.hset('account:a:items', { one: { revision: 'v1' }, two: 'raw' });
    expect(await kv.hgetall('account:b:items')).toBeNull();
    expect(await kv.hset('account:a:items', { one: { revision: 'v2' }, three: 3 })).toBe(1);
    expect(await kv.hgetall('account:a:items')).toEqual({ one: { revision: 'v2' }, two: 'raw', three: 3 });
    expect(await kv.hdel('account:a:items', 'one', 'two', 'three')).toBe(3);
    expect(await kv.hgetall('account:a:items')).toBeNull();
    expect(await kv.del('absent', 'text', 'text')).toBe(1);
  });
  it('honors NX, session expiry, rate-limit TTL and replacing types', async () => {
    expect(await kv.set('session', { user: 'a' }, { nx: true, ex: 10 })).toBe('OK');
    expect(await kv.set('session', { user: 'b' }, { nx: true })).toBeNull();
    now += 10_001;
    expect(await kv.get('session')).toBeNull();
    expect(await kv.set('session', { user: 'b' }, { nx: true })).toBe('OK');
    await kv.set('attempts', 0, { ex: 10 });
    expect(await Promise.all(Array.from({ length: 20 }, () => kv.incr('attempts')))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    now += 10_001;
    expect(await kv.get('attempts')).toBeNull();
    await kv.hset('replace', { field: 1 });
    await kv.set('replace', 'text');
    await expect(kv.hgetall('replace')).rejects.toThrow('type mismatch');
    expect((await client.execute("SELECT * FROM storage_hash WHERE key='replace'")).rows).toEqual([]);
  });
  it('serializes competing revisions, preserves receipts, and rolls back rejected writes', async () => {
    const save = (revision: string, receipt: string, expected = '') => kv.eval(SAVE_CLOTHES,
      ['items', receipt, 'items', ''], ['id', expected, revision, JSON.stringify({ revision }), '', '[]', revision]);
    const outcomes = await Promise.all([save('v1', 'request1'), save('v2', 'request2')]);
    expect(outcomes.map(row => (row as number[])[0])).toEqual([1, 0]);
    expect(await save('v1', 'request1')).toEqual([1, { revision: 'v1' }]);
    expect(await save('v2', 'request1')).toEqual([-3, '']);
    await kv.hset('broken-receipt', { field: 1 });
    await expect(save('v3', 'broken-receipt', 'v1')).rejects.toThrow('type mismatch');
    expect(await kv.hget('items', 'id')).toEqual({ revision: 'v1' });
    await kv.set('bad-counter', 'no');
    await expect(kv.incr('bad-counter')).rejects.toThrow('integer');
    expect(await kv.get('bad-counter')).toBe('no');
  });
  it('merges shared makeup, preserves omitted fields and checks revisions atomically', async () => {
    await kv.hset('life', { day: { revision: 'v0', text: 'old', body: { weight: 50 } } });
    const save = (base: string, revision: string, makeupBase: string) => kv.eval(SAVE_LIFE_ENTRY, ['life', 'symptoms'],
      ['day', base, revision, JSON.stringify({ revision, text: 'new', makeup: { revision: makeupBase, face: true, eyes: false } }), 'daily', 'shared']);
    expect(await save('v0', 'v1', '')).toEqual([1, { revision: 'v1', text: 'new', body: { weight: 50 }, makeup: { revision: 'v1', face: true, eyes: false } }]);
    expect(await kv.hget('symptoms', 'day')).toEqual({ revision: 'v1', text: 'new', body: { weight: 50 } });
    expect((await save('v1', 'v2', '') as number[])[0]).toBe(0);
    expect((await save('v0', 'v1', '') as number[])[0]).toBe(1);
  });
  it('filters history in SQL and preserves conditional photo reads and migration TTL', async () => {
    const records = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), { date: `2026-01-${String(i + 1).padStart(2, '0')}`, items: [{ photoId: 'photo-1' }] }]));
    await kv.hset('wear', records);
    expect((await kv.eval<string[], unknown[]>(READ_WEAR_PAGE, ['wear'], ['2026-12-31', 'history'])).length).toBe(30);
    expect(await kv.eval(READ_WEAR_PAGE, ['wear'], ['2025-01-01', 'history'])).toEqual([]);
    await kv.hset('items', { one: { photoId: 'photo-1' }, invalid: { photoId: 'photo_bad' } });
    await kv.set('photo:photo-1', 'data:image/png;base64,abc', { ex: 10 });
    await kv.set('photo:photo_bad', 'data:image/png;base64,abc');
    const [etag, photo] = await kv.eval<string[], string[]>(READ_PHOTO, ['photo:photo-1'], ['[]']);
    expect(photo).toBe('data:image/png;base64,abc');
    expect(await kv.eval(READ_PHOTO, ['photo:photo-1'], [JSON.stringify([`"${etag}"`])])).toEqual([etag, '']);
    expect(await kv.eval(READ_PHOTO_SIZES, ['items', 'wear', 'photo:'], ['0'])).toEqual([['photo-1', 25]]);
    const reference = JSON.stringify({ validator: etag, key: 'r2/photo-1' });
    expect((await kv.eval<string[], number[]>(MIGRATE_PHOTO, ['photo:photo-1'], [etag, reference]))[0]).toBe(1);
    expect(await kv.eval(READ_PHOTO, ['photo:photo-1'], ['["*"]'])).toEqual([etag, '']);
    now += 10_001;
    expect(await kv.get('photo:photo-1')).toBeNull();
  });
  it('has an exact reviewed port for every existing Lua script and rejects unknown scripts', () => {
    const found = new Set<string>();
    for (const name of readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const file = ts.createSourceFile(name, readFileSync(new URL(name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteralLike(node) && node.text.includes('redis.call(')) {
          expect(() => storageOperation(node.text)).not.toThrow(); found.add(node.text.trim());
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(found.size).toBe(Object.keys(STORAGE_SCRIPT_IDS).length);
    expect(() => kv.eval('return 1', [], [])).toThrow('Unsupported');
  });
});
