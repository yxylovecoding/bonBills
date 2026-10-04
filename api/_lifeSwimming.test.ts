import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CYCLE } from '../src/utils/bonLife';
import { LIFE_SETTINGS_KEY } from './_bonLife';
import { encryptTickTickToken, TICKTICK_CONNECTION_KEY, type TickTickApi, type TickTickTask } from './_ticktickTrips';
import { postponeSwimmingTasks, swimmingTarget, swimmingSyncWarning, syncSwimmingSchedule } from './_lifeSwimming';

const { data } = vi.hoisted(() => ({ data: new Map<string, any>() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => data.get(key) ?? null,
  hgetall: async (key: string) => data.get(key) ?? null,
  set: async (key: string, value: unknown, options?: { nx?: boolean }) => {
    if (options?.nx && data.has(key)) return null;
    data.set(key, value); return 'OK';
  },
  eval: async (_script: string, [key]: string[], [id]: string[]) => { if (data.get(key) === id) data.delete(key); return 1; },
} }));

const today = '2026-10-04';
const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-07' };
const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'swim', projectId: 'inbox-real', title: '下班准备游泳',
  startDate: '2026-10-06T16:00:00.000+0000', dueDate: '2026-10-06T16:00:00.000+0000', timeZone: 'Asia/Shanghai', status: 0,
  ...fields });
function apiFor(initial: TickTickTask[]) {
  const state = new Map(initial.map((value) => [value.id, structuredClone(value)]));
  const api = {
    getTask: vi.fn(async (_project: string, id: string) => structuredClone(state.get(id))),
    updateTask: vi.fn(async (id: string, payload: Partial<TickTickTask>) => {
      const updated = { ...state.get(id)!, ...structuredClone(payload) }; state.set(id, updated); return updated;
    }),
  };
  return { api: api as unknown as TickTickApi, state, write: api.updateTask, read: api.getTask };
}

beforeEach(() => { data.clear(); vi.stubEnv('SYNC_SECRET', 'secret'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('经期游泳顺延', () => {
  it('所有标题含游泳的待办都生效，不依赖训练锚点或清单', () => {
    for (const title of ['下班准备游泳', '游泳-运动💪🏻是生活的第一个锚点🪝', '买游泳用品']) {
      expect(swimmingTarget(task({ title }), today, cycle, [])).toBe('2026-10-14');
    }
    for (const value of [task({ title: '跑步', content: '游泳' }), task({ status: 2 }), task({ completedTime: '2026-10-07' }),
      task({ startDate: undefined, dueDate: undefined }), task({ startDate: '2026-10-14', dueDate: '2026-10-14' })]) {
      expect(swimmingTarget(value, today, cycle, [])).toBeNull();
    }
    expect(swimmingTarget(task(), today, DEFAULT_CYCLE, [])).toBeNull();
  });
  it('实际经期记录和长经期优先，月末与闰年顺延正确', () => {
    expect(swimmingTarget(task(), today, { ...cycle, periodLength: 10 }, [])).toBe('2026-10-17');
    expect(swimmingTarget(task(), today, DEFAULT_CYCLE, ['2026-10-07', '2026-10-08'])).toBe('2026-10-14');
    expect(swimmingTarget(task({ startDate: '2026-12-31', dueDate: '2026-12-31' }), today,
      { ...cycle, lastPeriodStart: '2026-12-29' }, [])).toBe('2027-01-05');
    expect(swimmingTarget(task({ startDate: '2024-02-29', dueDate: '2024-02-29' }), '2024-02-27',
      { ...cycle, lastPeriodStart: '2024-02-28' }, [])).toBe('2024-03-06');
  });
  it('跨日待办任何一天碰到经期都整体顺延，逾期待办按今天处理', () => {
    expect(swimmingTarget(task({ startDate: '2026-10-06', dueDate: '2026-10-08' }), today, cycle, [])).toBe('2026-10-14');
    const old = task({ startDate: '2026-09-01', dueDate: '2026-09-01' });
    expect(swimmingTarget(old, '2026-10-09', cycle, [])).toBe('2026-10-14');
    expect(swimmingTarget(old, '2026-10-15', cycle, [])).toBeNull();
  });
  it('保留时间、时区、时长、提醒、标签、备注、层级与重复规则，并回读验证', async () => {
    const original = task({ startDate: '2026-10-07T18:30:00+0800', dueDate: '2026-10-07T20:00:00+0800', isAllDay: false,
      repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2', reminders: ['TRIGGER:-PT30M'], tags: ['玩', '居'], priority: 3,
      content: '泳镜、泳帽', desc: '原备注', parentId: 'parent', kind: 'CHECKLIST', sortOrder: 123,
      items: [{ id: 'pending', title: '准备', status: 0, startDate: '2026-10-06T20:00:00+0800' },
        { id: 'done', title: '已购', status: 1, startDate: '2026-10-01T20:00:00+0800' }] });
    const { api, state, write } = apiFor([original]);
    expect(await postponeSwimmingTasks(api, [original], today, cycle, [])).toBe(1);
    const saved = state.get('swim')!;
    expect(saved).toEqual({ ...original, startDate: '2026-10-14T18:30:00+0800', dueDate: '2026-10-14T20:00:00+0800',
      items: [{ ...original.items![0], startDate: '2026-10-13T20:00:00+0800' }, original.items![1]] });
    // Both stale discovery data and a fresh second run are idempotent.
    expect(await postponeSwimmingTasks(api, [original], today, cycle, [])).toBe(0);
    expect(await postponeSwimmingTasks(api, [saved], today, cycle, [])).toBe(0);
    expect(write).toHaveBeenCalledOnce();
  });
  it('UTC 表示的全天日期按任务时区顺延，单独截止日期也可处理', async () => {
    for (const original of [task({ isAllDay: true }), task({ startDate: undefined })]) {
      const { api, state } = apiFor([original]);
      await postponeSwimmingTasks(api, [original], today, cycle, []);
      expect(state.get('swim')!.dueDate).toBe('2026-10-13T16:00:00.000+0000');
    }
  });
  it('写入前重新检查，尊重用户刚完成、改标题或改日期的任务', async () => {
    for (const latest of [task({ status: 2 }), task({ title: '已改跑步' }), task({ startDate: '2026-10-20', dueDate: '2026-10-20' })]) {
      const { api, write } = apiFor([latest]);
      expect(await postponeSwimmingTasks(api, [task()], today, cycle, [])).toBe(0);
      expect(write).not.toHaveBeenCalled();
    }
  });
  it('实际日期或重复规则未保存时报告失败，不假报成功', async () => {
    const original = task({ repeatFlag: 'FREQ=DAILY;INTERVAL=2' });
    const { api, read } = apiFor([original]);
    read.mockResolvedValue(structuredClone(original));
    await expect(postponeSwimmingTasks(api, [original], today, cycle, [])).rejects.toThrow('未确认');
    read.mockResolvedValueOnce(original).mockResolvedValueOnce(task({ startDate: '2026-10-13T16:00:00.000+0000', dueDate: '2026-10-13T16:00:00.000+0000' }));
    await expect(postponeSwimmingTasks(api, [original], today, cycle, [])).rejects.toThrow('未确认');
  });
  it('后台扫描收集箱与全部清单，只写实际冲突项，出错释放同一把同步锁', async () => {
    const year = new Date().getFullYear();
    const date = `${year}-12-28`;
    const original = task({ startDate: date, dueDate: date });
    let saved = original;
    data.set(TICKTICK_CONNECTION_KEY, { encryptedToken: encryptTickTickToken('private-token', 'secret') });
    data.set(LIFE_SETTINGS_KEY, { cycle: { ...cycle, lastPeriodStart: date } });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/project')) return new Response('[]');
      if (url.endsWith('/filter')) return new Response('[]');
      if (url.endsWith('/inbox/data')) return new Response(JSON.stringify({ tasks: [saved] }));
      if (url.endsWith('/project/inbox-real/task/swim')) return new Response(JSON.stringify(saved));
      if (url.endsWith('/task/swim') && init?.method === 'POST') { saved = { ...saved, ...JSON.parse(String(init.body)) }; return new Response(JSON.stringify(saved)); }
      throw new Error('unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await syncSwimmingSchedule()).toEqual({ updated: 1 });
    expect(saved.dueDate).toBe(`${year + 1}-01-04`);
    expect(data.has('ticktick:trip-sync:lock')).toBe(false);
    expect(await syncSwimmingSchedule()).toEqual({ updated: 0 });
    fetchMock.mockRejectedValue(new Error('private-token'));
    await expect(syncSwimmingSchedule()).rejects.toThrow('TickTick 游泳待办顺延失败');
    expect(await swimmingSyncWarning()).not.toContain('private-token');
    expect(data.has('ticktick:trip-sync:lock')).toBe(false);
  });
  it('断开连接或其他同步持锁时不写任务，不释放别人的锁', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await syncSwimmingSchedule()).toEqual({ updated: 0 });
    data.set(TICKTICK_CONNECTION_KEY, { encryptedToken: encryptTickTickToken('private-token', 'secret') });
    data.set('ticktick:trip-sync:lock', 'other-sync');
    await expect(syncSwimmingSchedule()).rejects.toThrow('正在同步');
    expect(fetch).not.toHaveBeenCalled();
    expect(data.get('ticktick:trip-sync:lock')).toBe('other-sync');
  });
});
