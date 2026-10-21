import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planTickTickDay } from './_ticktickDailyPlan';
import { routineTaskDate, syncTickTickAlwaysToday, syncTickTickRoutines, type TickTickApi, type TickTickTask } from './_ticktickTrips';

const day = '2026-10-21';
const makeTask = (id: string, extra: Partial<TickTickTask> = {}): TickTickTask => ({
  id, projectId: 'life', title: id, status: 0, isAllDay: true, timeZone: 'Asia/Shanghai',
  tags: ['always-today'], dueDate: '2026-10-20T00:00:00+0800', ...extra,
});
function fixture(tasks: TickTickTask[]) {
  const saved = new Map(tasks.map(task => [task.id, structuredClone(task)]));
  const getTask = vi.fn(async (_project: string, id: string) => structuredClone(saved.get(id)!));
  const updateTask = vi.fn(async (id: string, payload: Record<string, unknown>) => {
    saved.set(id, { ...saved.get(id)!, ...structuredClone(payload) });
    return saved.get(id)!;
  });
  const api = { getTask, updateTask,
    listProjects: async () => [{ id: 'life', name: '生活' }],
    getProjectData: async () => ({ tasks: structuredClone([...saved.values()]) }),
    filterTasks: async () => structuredClone([...saved.values()]),
    listCompletedTasks: async () => [],
  } as unknown as TickTickApi;
  return { api, saved, getTask, updateTask };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${day}T00:00:01+08:00`)); });
afterEach(() => vi.useRealTimers());

describe('always-today 截止日期', () => {
  it('北京时间跨天滚动，重复同步不重复写；不按 UTC 日期判断今天', async () => {
    const f = fixture([makeTask('today')]);
    expect(await syncTickTickAlwaysToday(f.api)).toEqual({ matched: 1, updated: 1 });
    expect(routineTaskDate(f.saved.get('today')!)).toBe(day);
    expect(await syncTickTickAlwaysToday(f.api)).toEqual({ matched: 1, updated: 0 });
    vi.setSystemTime(new Date('2026-10-21T16:00:01Z'));
    expect(await syncTickTickAlwaysToday(f.api)).toEqual({ matched: 1, updated: 1 });
    expect(routineTaskDate(f.saved.get('today')!)).toBe('2026-10-22');
    expect(f.updateTask).toHaveBeenCalledTimes(2);
  });

  it('未来、无日期、仅开始日期和高优先级隐藏任务都补今天的截止日期', async () => {
    const tasks = [makeTask('future', { dueDate: '2027-01-01T00:00:00+0800' }),
      makeTask('undated', { dueDate: undefined, isAllDay: undefined }),
      makeTask('start-only', { dueDate: undefined, startDate: `${day}T09:00:00+0800`, isAllDay: false }),
      makeTask('important', { priority: 5, tags: ['routine', 'bon-hidden', '旅', 'always-today'] })];
    const f = fixture(tasks);
    expect(await syncTickTickAlwaysToday(f.api)).toEqual({ matched: 4, updated: 4 });
    for (const task of f.saved.values()) { expect(task.dueDate).toBeTruthy(); expect(routineTaskDate(task)).toBe(day); }
    expect(f.saved.get('undated')?.isAllDay).toBe(true);
    expect(f.saved.get('start-only')?.dueDate).toBe(`${day}T09:00:00+0800`);
    expect(f.saved.get('important')?.tags).toEqual(tasks[3].tags);
  });

  it('保留时刻、跨日起止间隔、循环、提醒与其他字段，兼容 UTC 返回日期', async () => {
    const task = makeTask('timed', { startDate: '2026-10-18T15:00:00Z', dueDate: '2026-10-19T01:00:00Z',
      isAllDay: false, content: '(30m)', desc: '备注', priority: 5, parentId: 'parent', sortOrder: 17,
      repeatFlag: 'RRULE:FREQ=WEEKLY', repeatFrom: 1, reminders: ['TRIGGER:PT0S'],
      tags: [' ALWAYS-TODAY ', 'routine', '居'], items: [
        { id: 'open', title: '未完成', status: 0, startDate: '2026-10-18T16:00:00Z' },
        { id: 'done', title: '已完成', status: 1, startDate: '2026-10-18T16:00:00Z' },
        { id: 'undated', title: '无日期', status: 0 },
      ] });
    const f = fixture([task]);
    await syncTickTickAlwaysToday(f.api);
    expect(f.saved.get(task.id)).toEqual({ ...task, startDate: '2026-10-20T15:00:00Z', dueDate: '2026-10-21T01:00:00Z',
      items: [{ ...task.items![0], startDate: '2026-10-20T16:00:00Z' }, ...task.items!.slice(1)] });
  });

  it('已完成、不带标签和刚移除标签的任务均不修改，不向子任务继承标签', async () => {
    const tasks = [makeTask('done', { status: 2 }), makeTask('completed', { completedTime: '2026-10-20T01:00:00Z' }),
      makeTask('other', { tags: ['always-today-other'] }), makeTask('child', { tags: [], parentId: 'done' }), makeTask('removed')];
    const f = fixture(tasks);
    f.saved.get('removed')!.tags = ['routine'];
    await syncTickTickAlwaysToday(f.api, { tasks });
    expect(f.updateTask).not.toHaveBeenCalled();
  });

  it('写后日期未保存或标签丢失时报告失败', async () => {
    const f = fixture([makeTask('failed')]);
    f.updateTask.mockImplementationOnce(async id => f.saved.get(id)!);
    await expect(syncTickTickAlwaysToday(f.api)).rejects.toThrow('日期');
    f.updateTask.mockImplementationOnce(async (id, payload) => {
      f.saved.set(id, { ...f.saved.get(id)!, ...payload, tags: [] });
      return f.saved.get(id)!;
    });
    await expect(syncTickTickAlwaysToday(f.api)).rejects.toThrow('更新结果未确认');
  });

  it('完整同步中优先于场景、洗头日期跟随、重复周期与普通轮换，且占用今日预算', async () => {
    const f = fixture([makeTask('fixed', { tags: ['always-today', '旅', '洗头', 'at-least'], content: '(30m)',
      repeatFlag: 'RRULE:FREQ=WEEKLY', dueDate: '2026-11-05T00:00:00+0800' }),
    makeTask('wash', { title: '洗头', tags: [], dueDate: '2026-10-25T00:00:00+0800' }),
    makeTask('ordinary', { tags: [], content: '(30m)', dueDate: `${day}T00:00:00+0800` })]);
    vi.setSystemTime(new Date(`${day}T21:30:00+08:00`));
    let fixedMinutes = 0;
    await syncTickTickRoutines({ api: f.api, today: day, calendarState: { tagMap: { [day]: 'school', '2026-10-25': 'travel' } },
      planDay: async tasks => {
        const state = { connectionId: 'test', history: [], deadlines: {} };
        const plan = planTickTickDay({ tasks, today: day, calendarState: {}, state, budgetMinutes: 30 });
        fixedMinutes = plan.summary.plannedMinutes;
        return plan.dates;
      } });
    expect(routineTaskDate(f.saved.get('fixed')!)).toBe(day);
    expect(routineTaskDate(f.saved.get('ordinary')!)).toBe('2026-10-22');
    expect(fixedMinutes).toBe(30);
  });
});
