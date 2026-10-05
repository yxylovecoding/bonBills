import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inSleepFilterScope, sleepTagStateKey, sleepWindow, syncSleepRoutineTags } from './_ticktickSleepTags';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';

const { data } = vi.hoisted(() => ({ data: new Map<string, unknown>() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return 'OK'; }),
} }));
const at = (time: string) => new Date(`2026-10-05T${time}+08:00`);
const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'task', projectId: 'life', title: '待办', status: 0,
  tags: ['活'], priority: 1, dueDate: '2026-10-04T16:00:00.000+0000', isAllDay: true, timeZone: 'Asia/Shanghai',
  repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2', repeatFrom: '2', ...fields });
const config = (time: string) => ({ projectId: 'connected-project', now: at(time) });
const key = sleepTagStateKey('connected-project');

function client(...source: TickTickTask[]) {
  const tasks = new Map(source.map(task => [task.id, structuredClone(task)]));
  const api = {
    listProjects: async () => [{ id: 'life' }, { id: 'moved' }],
    filterTasks: async () => [...tasks.values()].filter(task => (task.status ?? 0) === 0),
    getProjectData: async () => ({ tasks: [...tasks.values()].filter(task => (task.status ?? 0) === 0) }),
    getTask: vi.fn(async (_projectId: string, id: string) => {
      if (!tasks.has(id)) throw new Error('TickTick 404');
      return structuredClone(tasks.get(id)!);
    }),
    updateTask: vi.fn(async (id: string, payload: Record<string, unknown>) => {
      tasks.set(id, { ...tasks.get(id)!, ...structuredClone(payload) } as TickTickTask);
      return structuredClone(tasks.get(id)!);
    }),
  };
  return { api: api as unknown as TickTickApi, tasks, read: api.getTask, write: api.updateTask };
}
beforeEach(() => data.clear());

describe('四个智能清单范围和凌晨窗口', () => {
  it.each([['00:00:00', true], ['04:59:59', true], ['05:00:00', false], ['23:59:59', false]])('%s 的北京时间边界', (time, hidden) => {
    expect(sleepWindow(at(time))).toEqual({ day: '2026-10-05', hidden });
  });
  it('精确区分重要事项的当天标签、21天窗口，以及普通事项的30天窗口', () => {
    const today = '2026-10-05';
    const check = (fields: Partial<TickTickTask>) => inSleepFilterScope(task(fields), today);
    expect(check({ priority: 5, tags: ['不关我事'], dueDate: '2026-10-04T12:00:00+0800' })).toBe(true);
    expect(check({ priority: 5, tags: ['当天'], dueDate: '2026-10-06T12:00:00+0800' })).toBe(false);
    expect(check({ priority: 5, dueDate: '2026-10-26T12:00:00+0800' })).toBe(true);
    expect(check({ priority: 5, dueDate: '2026-10-27T12:00:00+0800' })).toBe(false);
    expect(check({ priority: 5, dueDate: undefined })).toBe(true);
    expect(check({ priority: 5, tags: ['当天'], dueDate: undefined })).toBe(false);
    expect(check({ dueDate: '2026-11-04T12:00:00+0800' })).toBe(true);
    expect(check({ dueDate: '2026-11-05T12:00:00+0800' })).toBe(false);
    expect(check({ dueDate: undefined })).toBe(true);
    expect(check({ dueDate: '2026-10-01T12:00:00+0800' })).toBe(true);
    expect(check({ tags: ['不关我事'] })).toBe(false);
    expect(check({ tags: [' Routine '] })).toBe(false);
    expect(check({ status: 2 })).toBe(false);
  });
});

describe('临时 routine 标签所有权', () => {
  it('凌晨隐藏未来洗头任务，05 点不揭开旧记录中的洗头，也不影响原生 routine', async () => {
    const wash = task({ id: 'wash', title: '洗头', dueDate: '2027-01-01T00:00:00+0800' });
    const c = client(wash);
    await syncSleepRoutineTags(c.api, config('00:00:00'));
    expect(c.tasks.get('wash')).toEqual({ ...wash, tags: ['活', 'routine'] });
    expect(data.get(key)).toBeUndefined();
    // A prior version may already have journaled this task as a temporary tag.
    data.set(key, { wash: { projectId: 'life', addedOn: '2026-10-05', phase: 'added' } });
    expect(await syncSleepRoutineTags(c.api, config('05:00:00'))).toMatchObject({ updated: 0, complete: true });
    expect(c.tasks.get('wash')?.tags).toContain('routine');
    expect(data.get(key)).toEqual({});
    expect(c.write).toHaveBeenCalledOnce();
  });
  it('只记录本次添加的标签，五点恢复时保留所有原生 routine', async () => {
    const original = task({ content: 'content', reminders: ['TRIGGER:PT0S'], parentId: 'parent',
      items: [{ id: 'done', title: 'done', status: 1, completedTime: '2026-10-04T10:00:00Z' }] });
    const permanent = task({ id: 'original-routine', tags: [' Routine ', '居'] });
    const outside = task({ id: 'future', dueDate: '2027-01-01T12:00:00+0800' });
    const c = client(original, permanent, outside);
    expect(await syncSleepRoutineTags(c.api, config('00:00:00'))).toMatchObject({ updated: 1, complete: true });
    expect(data.get(key)).toEqual({ task: { projectId: 'life', addedOn: '2026-10-05', phase: 'added' } });
    expect(c.tasks.get('task')).toEqual({ ...original, tags: ['活', 'routine'] });
    c.tasks.get('task')!.tags!.push('新标签');
    expect(await syncSleepRoutineTags(c.api, config('05:00:00'))).toMatchObject({ updated: 1, complete: true });
    expect(c.tasks.get('task')).toEqual({ ...original, tags: ['活', '新标签'] });
    expect(c.tasks.get(permanent.id)).toEqual(permanent);
    expect(c.tasks.get(outside.id)).toEqual(outside);
    expect(data.get(key)).toEqual({});
    for (const [, payload] of c.write.mock.calls) expect(payload).not.toHaveProperty('status');
  });
  it('逐批执行可恢复，重复午夜或早晨执行不重复修改', async () => {
    const c = client(task(), task({ id: 'second' }));
    expect(await syncSleepRoutineTags(c.api, { ...config('00:00:00'), maxTasks: 1 })).toMatchObject({ updated: 1, remaining: 1, complete: false });
    expect(await syncSleepRoutineTags(c.api, { ...config('00:00:00'), maxTasks: 1 })).toMatchObject({ updated: 1, complete: true });
    expect(await syncSleepRoutineTags(c.api, config('01:00:00'))).toMatchObject({ updated: 0, complete: true });
    expect(await syncSleepRoutineTags(c.api, { ...config('05:00:00'), maxTasks: 1 })).toMatchObject({ updated: 1, remaining: 1 });
    expect(await syncSleepRoutineTags(c.api, config('05:00:00'))).toMatchObject({ updated: 1, complete: true });
    expect(await syncSleepRoutineTags(c.api, config('12:00:00'))).toMatchObject({ updated: 0, complete: true });
    expect(c.write).toHaveBeenCalledTimes(4);
  });
  it('写入成功但响应失败仍可恢复，不把临时标签误当原生标签', async () => {
    const c = client(task());
    c.write.mockImplementationOnce(async (id, payload) => {
      expect(data.get(key)).toHaveProperty('task.phase', 'adding');
      c.tasks.set(id, { ...c.tasks.get(id)!, ...payload } as TickTickTask);
      throw new Error('response lost');
    });
    await expect(syncSleepRoutineTags(c.api, config('00:00:00'))).rejects.toThrow('response lost');
    expect(await syncSleepRoutineTags(c.api, config('01:00:00'))).toMatchObject({ updated: 0 });
    await syncSleepRoutineTags(c.api, config('05:00:00'));
    expect(c.tasks.get('task')?.tags).toEqual(['活']);
    expect(data.get(key)).toEqual({});
  });
  it('五点删除失败保留记录重试；网络故障不会当成任务已删除', async () => {
    const c = client(task());
    await syncSleepRoutineTags(c.api, config('00:00:00'));
    c.write.mockRejectedValueOnce(new Error('offline'));
    await expect(syncSleepRoutineTags(c.api, config('05:00:00'))).rejects.toThrow('offline');
    expect(data.get(key)).toHaveProperty('task.phase', 'restoring');
    c.read.mockRejectedValueOnce(new Error('TickTick 503'));
    await expect(syncSleepRoutineTags(c.api, config('12:00:00'))).rejects.toThrow('503');
    expect(data.get(key)).toHaveProperty('task');
    await syncSleepRoutineTags(c.api, config('12:00:00'));
    expect(c.tasks.get('task')?.tags).toEqual(['活']);
  });
  it('五点依记录恢复，任务改期移出过滤器或夜里完成后也能恢复', async () => {
    const c = client(task(), task({ id: 'done' }));
    await syncSleepRoutineTags(c.api, config('00:00:00'));
    Object.assign(c.tasks.get('task')!, { projectId: 'moved', dueDate: '2027-01-01T00:00:00+0800' });
    Object.assign(c.tasks.get('done')!, { status: 2, completedTime: '2026-10-05T03:00:00+0800' });
    await syncSleepRoutineTags(c.api, config('05:00:00'));
    expect(c.tasks.get('task')).toMatchObject({ projectId: 'moved', dueDate: '2027-01-01T00:00:00+0800', tags: ['活'] });
    expect(c.tasks.get('done')).toMatchObject({ status: 2, completedTime: '2026-10-05T03:00:00+0800', tags: ['活'] });
  });
  it('五点恢复时让夜间 routine 继续隐藏；新规则不再移除日常父任务的原生标签', async () => {
    const night = task({ id: 'night', title: '夜间routine ', priority: 5, isAllDay: false,
      startDate: '2026-10-04T22:00:00+0800', dueDate: '2026-10-04T22:00:00+0800' });
    const originalDaily = task({ id: 'daily', title: '🐦日常任务 ', tags: ['routine'] });
    const c = client(night, originalDaily);
    await syncSleepRoutineTags(c.api, config('00:00:00'));
    await syncSleepRoutineTags(c.api, config('05:00:00'));
    expect(c.tasks.get('night')?.tags).toContain('routine');
    expect(c.tasks.get('daily')?.tags).toEqual(['routine']);
    expect(data.get(key)).toEqual({});
  });
  it('复读时已带有 routine 的任务不取得所有权；只恢复自己的记录', async () => {
    const c = client(task());
    c.read.mockResolvedValueOnce(task({ tags: ['routine'] }));
    await syncSleepRoutineTags(c.api, config('00:00:00'));
    expect(data.has(key)).toBe(false); expect(c.write).not.toHaveBeenCalled();
    expect(await syncSleepRoutineTags(c.api, config('05:00:00'))).toMatchObject({ updated: 0 });
  });
  it('恢复入口在凌晨不提前揭开任务，缺少记录或已删除任务不会误写其他任务', async () => {
    const c = client(task());
    await syncSleepRoutineTags(c.api, { ...config('01:00:00'), restoreOnly: true });
    expect(c.write).not.toHaveBeenCalled();
    await syncSleepRoutineTags(c.api, config('01:00:00'));
    c.tasks.delete('task');
    expect(await syncSleepRoutineTags(c.api, config('05:00:00'))).toMatchObject({ updated: 0, complete: true });
    expect(data.get(key)).toEqual({});
  });
});
