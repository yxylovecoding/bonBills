import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './ticktick-trips';
import { DAILY_PLAN_KEY, DAILY_PLAN_SETTINGS_KEY } from './_ticktickDailyPlan';
const { data, auth, failHistory, failWrite } = vi.hoisted(() => ({ data: new Map<string, any>(), auth: { ok: true }, failHistory: { value: false }, failWrite: { value: false } }));
vi.mock('./_auth.js', () => ({ authOk: async () => auth.ok }));
vi.mock('./_outlookSync.js', () => ({ syncOutlookCalendar: async () => ({ connected: true,
  availability: { startDate: '2020-01-01', endDate: '2030-01-01', events: [] } }) }));
vi.mock('./_lifeSwimming.js', () => ({ syncSwimmingSchedule: async () => undefined }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: async () => 'lock', releaseTickTickLock: async () => undefined }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return 'OK'; } } }));
vi.mock('./_ticktickTrips.js', async (original) => ({
  ...await original<typeof import('./_ticktickTrips')>(),
  decryptTickTickToken: () => 'test-token',
  TickTickOpenApiClient: class { async listCompletedTasks() { if (failHistory.value) throw new Error('history unavailable'); return []; } },
  readAllTickTickTasks: async () => [],
  readConnectedTickTickTemplate: async () => ({ rootTask: { id: 'root' }, tasks: [] }),
  reconcileTickTickTrips: async () => ({}), reconcileTickTickWishPreparations: async () => ({}),
  syncTickTickRoutines: async (options: any) => {
    await options.planDay([]);
    if (failWrite.value) throw new Error('write unavailable');
    return { updatedRoutineTasks: 0 };
  },
}));
async function request(method: string, body?: unknown) {
  const result = { status: 200, body: {} as Record<string, any> };
  const res = { setHeader: vi.fn(), status: (code: number) => { result.status = code; return res; }, json: (value: Record<string, unknown>) => { result.body = value; return res; } };
  await handler({ method, headers: {}, body, query: {} } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
beforeEach(() => { data.clear(); auth.ok = true; failHistory.value = false; failWrite.value = false; data.set('ticktick:connection:v1', { encryptedToken: {} }); });
afterEach(() => vi.restoreAllMocks());
describe('每日安排接口', () => {
  it('读取默认用时并校验修改范围，未认证不能更改', async () => {
    expect((await request('GET')).body.budgetMinutes).toBeNull();
    for (const value of [0, 9, 241, 30.5, '30']) expect((await request('PATCH', { budgetMinutes: value })).status).toBe(400);
    expect((await request('PATCH', { budgetMinutes: 60 })).body.budgetMinutes).toBe(60);
    expect(data.get(DAILY_PLAN_SETTINGS_KEY)).toEqual({ budgetMinutes: 60 });
    expect((await request('PATCH', { budgetMinutes: null, availabilityProfile: 'evening' })).status).toBe(200);
    expect(data.get(DAILY_PLAN_SETTINGS_KEY)).toEqual({ budgetMinutes: null, availabilityProfile: 'evening' });
    expect((await request('PATCH', { budgetMinutes: null, availabilityProfile: 'bad' })).status).toBe(400);
    auth.ok = false;
    expect((await request('PATCH', { budgetMinutes: 90 })).status).toBe(401);
    expect(data.get(DAILY_PLAN_SETTINGS_KEY)).toEqual({ budgetMinutes: null, availabilityProfile: 'evening' });
  });
  it('只有写入成功才发布新的每日安排，失败保留旧摘要', async () => {
    expect((await request('POST')).status).toBe(200);
    const old = data.get(DAILY_PLAN_KEY).summary;
    data.get(DAILY_PLAN_KEY).summary = { ...old, todayCount: 7 };
    failWrite.value = true;
    expect((await request('POST')).status).toBe(502);
    expect(data.get(DAILY_PLAN_KEY).summary.todayCount).toBe(7);
  });
  it('历史读取失败时不发布空计划、不推进历史时间', async () => {
    await request('POST');
    const before = structuredClone(data.get(DAILY_PLAN_KEY));
    failHistory.value = true;
    expect((await request('POST')).status).toBe(502);
    expect(data.get(DAILY_PLAN_KEY)).toEqual(before);
  });
});
