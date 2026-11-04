import { beforeEach, expect, it, vi } from 'vitest';
import { runTickTickTemplateSync } from './_ticktickTemplateRun';

const m = vi.hoisted(() => ({ data: new Map<string, unknown>(), lock: vi.fn(), release: vi.fn(), history: vi.fn(), sync: vi.fn(),
  removed: [] as string[], write: vi.fn(), tasks: [{ id: 'a', projectId: 'p', title: '搬家-京广-11.5', status: 0 }] }));
vi.mock('./_accountKv.js', () => ({ kv: {
  get: async (key: string) => structuredClone(m.data.get(key)),
  set: async (key: string, value: unknown) => { m.data.set(key, structuredClone(value)); },
} }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: m.lock, releaseTickTickLock: m.release }));
vi.mock('./_ticktickDailyPlan.js', () => ({ DAILY_PLAN_KEY: 'daily', refreshDailyHistory: m.history }));
vi.mock('./_ticktickTemplateSync.js', () => ({ syncTickTickTemplates: m.sync }));
vi.mock('./_schedulingRules.js', () => ({ readSchedulingRules: async () => ({ removed: m.removed }) }));
vi.mock('./_ticktickTrips.js', () => ({ decryptTickTickToken: () => 'token', readAllTickTickTasks: async () => structuredClone(m.tasks),
  TickTickOpenApiClient: class {
    async getTask(_project: string, id: string) { return structuredClone(m.tasks.find(task => task.id === id)); }
    async updateTask(id: string, payload: any) { m.write(id); Object.assign(m.tasks.find(task => task.id === id)!, payload); }
  },
}));

beforeEach(() => {
  vi.clearAllMocks(); m.data.clear(); m.removed = []; m.tasks[0].title = '搬家-京广-11.5';
  m.data.set('ticktick:connection:v1', { encryptedToken: 'encrypted', templateRootId: 'template' });
  m.lock.mockResolvedValue('lock'); m.release.mockResolvedValue(undefined); m.history.mockResolvedValue(undefined);
  m.sync.mockImplementation(async (api, _root, _connection, options) => {
    expect(m.history).toHaveBeenCalledOnce(); expect(options.requireCompletionHistory).toBe(true);
    if (options.mode === 'content') {
      await api.updateTask('a', { title: '搬家-京广-11.6' });
      expect(m.write).not.toHaveBeenCalled();
      options.deferState(async () => { m.data.set('verified', true); });
    }
    return { instanceSync: [{ created: 0, completed: 1, removed: 0 }] };
  });
});

it('writes only after successful history and both template passes, then publishes verified result', async () => {
  expect(await runTickTickTemplateSync()).toMatchObject({ busy: false, updated: 1, instances: [{ created: 0, completed: 1 }] });
  expect(m.sync).toHaveBeenCalledTimes(2); expect(m.write).toHaveBeenCalledOnce();
  expect(m.data.get('verified')).toBe(true); expect(m.release).toHaveBeenCalledWith('lock');
});
it('stops before planning or writing when history cannot be read, releasing the lock', async () => {
  m.history.mockRejectedValueOnce(new Error('history unavailable'));
  await expect(runTickTickTemplateSync()).rejects.toThrow('history unavailable');
  expect(m.sync).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
});
it('does not overlap a running replan or release its lock', async () => {
  m.lock.mockResolvedValueOnce(null);
  expect(await runTickTickTemplateSync()).toEqual({ busy: true });
  expect(m.history).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
});
it('respects a disabled template rule', async () => {
  m.removed = ['template-content'];
  expect(await runTickTickTemplateSync()).toMatchObject({ skipped: 'disabled' });
  expect(m.history).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
});
it('a failed date pass does not publish a partially planned content change', async () => {
  m.sync.mockImplementationOnce(async api => {
    await api.updateTask('a', { title: 'changed' }); return { instanceSync: [] };
  }).mockRejectedValueOnce(new Error('dates unavailable'));
  await expect(runTickTickTemplateSync()).rejects.toThrow('dates unavailable');
  expect(m.write).not.toHaveBeenCalled(); expect(m.data.has('verified')).toBe(false);
});
