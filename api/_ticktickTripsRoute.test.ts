import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { encryptTickTickToken } from './_ticktickTrips';
import handler from './ticktick-trips';

const { data, rootId } = vi.hoisted(() => ({ data: new Map<string, unknown>(), rootId: { value: 'new-root' } }));
vi.mock('./_auth.js', () => ({ authOk: async () => true }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return 'OK'; },
} }));
vi.mock('./_ticktickTrips.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./_ticktickTrips')>(),
  TickTickOpenApiClient: class {
    async listProjects() { return [{ id: 'life', name: '活' }]; }
    async getPreference() { return { timeZone: 'Asia/Shanghai' }; }
    async filterTasks() { return [{ id: rootId.value, projectId: 'life', title: '出门todo模板', tags: ['活'] }]; }
    async getProjectData() { return { tasks: await this.filterTasks() }; }
  },
}));

const connectionKey = 'ticktick:connection:v1';
const stateKey = 'ticktick:trip-sync:v1';
const secret = 'test-sync-secret';
const instance = (id: string) => ({ tripKey: id, startDate: '2026-10-01', endDate: '2026-10-02', dates: ['2026-10-01', '2026-10-02'], name: id,
  rootTaskId: `generated-${id}`, taskIdsByTemplateId: { 'old-root': `generated-${id}` }, itemIdsByTemplateTaskId: {},
  taskDateStates: { [`generated-${id}`]: { manual: true, lastSynced: { startDate: null, dueDate: null, isAllDay: true, timeZone: 'Asia/Shanghai' } } } });

async function connect(token = 'personal-token') {
  const result = { status: 200, body: {} as Record<string, unknown> };
  const res = { setHeader: vi.fn(), status: (status: number) => { result.status = status; return res; },
    json: (body: Record<string, unknown>) => { result.body = body; return res; } };
  await handler({ method: 'PUT', headers: {}, body: { token }, query: {} } as VercelRequest, res as unknown as VercelResponse);
  return result;
}

beforeEach(() => {
  data.clear(); rootId.value = 'new-root'; vi.stubEnv('SYNC_SECRET', secret);
  data.set(connectionKey, { projectId: 'play', templateRootId: 'old-root', encryptedToken: encryptTickTickToken('personal-token', secret), timeZone: 'Asia/Shanghai', connectedAt: '2026-09-01' });
  data.set(stateKey, { instances: { trip: instance('trip') }, wishInstances: { wish: { ...instance('wish'), projectId: 'wish-list' } }, lastSyncAt: '2026-09-24' });
});
afterEach(() => vi.unstubAllEnvs());

describe('TickTick 模板重新连接', () => {
  it('同一连接按新名字找到不同 ID 和清单后仍保留出行、心愿实例及原目标清单', async () => {
    const before = structuredClone(data.get(stateKey)) as { instances: { trip: ReturnType<typeof instance> }; wishInstances: unknown; lastSyncAt: string };
    expect((await connect()).status).toBe(200);
    expect(data.get(connectionKey)).toMatchObject({ projectId: 'life', templateRootId: 'new-root' });
    expect(data.get(stateKey)).toEqual({ ...before, instances: { trip: { ...before.instances.trip, projectId: 'play' } } });
  });

  it('模板只是移动，更新令牌也不会因清单变化清空已有实例', async () => {
    rootId.value = 'old-root';
    expect((await connect('rotated-token')).status).toBe(200);
    expect(data.get(stateKey)).toHaveProperty('instances.trip.rootTaskId', 'generated-trip');
    expect(data.get(stateKey)).toHaveProperty('instances.trip.projectId', 'play');
  });

  it('令牌及模板都不同的全新连接不沿用旧任务实例', async () => {
    expect((await connect('different-account-token')).status).toBe(200);
    expect(data.get(stateKey)).toEqual({ instances: {} });
  });

  it('旧服务端密钥已失效时仍允许用有效令牌重新连接', async () => {
    data.set(connectionKey, { projectId: 'play', templateRootId: 'old-root', encryptedToken: encryptTickTickToken('personal-token', 'old-key') });
    expect((await connect()).status).toBe(200);
    expect(data.get(connectionKey)).toMatchObject({ projectId: 'life', templateRootId: 'new-root' });
  });
});
