import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { initializeTursoSchema } from './_tursoSchema.js';
import { createTursoKv } from './_tursoKv.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), redisGet: vi.fn(), redisSet: vi.fn() }));
vi.mock('@libsql/client/web', () => ({ createClient: mocks.create }));
vi.mock('@vercel/kv', () => ({ kv: { get: mocks.redisGet, set: mocks.redisSet } }));
let client: Client;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  client = createClient({ url: 'file::memory:' }); await initializeTursoSchema(client);
  mocks.create.mockReturnValue(client);
  vi.stubEnv('STORAGE_BACKEND', ''); vi.stubEnv('STORAGE_MAINTENANCE', '');
  vi.stubEnv('TURSO_DATABASE_URL', 'libsql://synthetic.example');
  vi.stubEnv('TURSO_AUTH_TOKEN', 'synthetic-token'); vi.stubEnv('TURSO_MIGRATION_ID', 'fixture');
});
afterEach(() => { client.close(); vi.unstubAllEnvs(); });
it('keeps the source active until explicit cutover', async () => {
  mocks.redisGet.mockResolvedValue('source');
  const { kv } = await import('./_storage.js');
  expect(await kv.get('record')).toBe('source'); expect(mocks.create).not.toHaveBeenCalled();
});
it('rejects an unverified target without falling back or writing to the source', async () => {
  vi.stubEnv('STORAGE_BACKEND', 'turso');
  const { kv } = await import('./_storage.js');
  await expect(kv.set('record', 'new')).rejects.toThrow('not been verified');
  expect(mocks.redisSet).not.toHaveBeenCalled(); expect(mocks.redisGet).not.toHaveBeenCalled();
});
it('uses only the verified target after cutover', async () => {
  await client.execute("INSERT INTO storage_meta VALUES ('verified_migration','fixture')");
  await createTursoKv(client).set('record', 'target');
  vi.stubEnv('STORAGE_BACKEND', 'turso');
  const { kv } = await import('./_storage.js');
  expect(await kv.get('record')).toBe('target');
  expect(mocks.redisGet).not.toHaveBeenCalled();
});
it('fails closed on missing configuration, target errors and maintenance', async () => {
  vi.stubEnv('STORAGE_BACKEND', 'turso'); vi.stubEnv('TURSO_AUTH_TOKEN', '');
  const { kv } = await import('./_storage.js');
  await expect(kv.get('record')).rejects.toThrow('not configured');
  vi.stubEnv('TURSO_AUTH_TOKEN', 'fixture'); mocks.create.mockImplementation(() => { throw Error('Target offline'); });
  await expect(kv.get('record')).rejects.toThrow('Target offline');
  vi.stubEnv('STORAGE_MAINTENANCE', '1'); vi.stubEnv('STORAGE_BACKEND', 'upstash');
  await expect(kv.set('record', 1)).rejects.toThrow('migration in progress');
  expect(mocks.redisGet).not.toHaveBeenCalled(); expect(mocks.redisSet).not.toHaveBeenCalled();
});
