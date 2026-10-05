import { describe, expect, it, vi } from 'vitest';
import { separateTickTickSprays, sprayKind, syncTickTickRoutines, type TickTickApi, type TickTickTask } from './_ticktickTrips';
import { planTickTickDay, type DailyPlanState } from './_ticktickDailyPlan';
const today = '2026-10-05', now = new Date(`${today}T12:00:00+08:00`);
const task = (id: string, fields: Partial<TickTickTask> = {}): TickTickTask => ({ id, projectId: 'inbox-real',
  title: id === 'mite' ? '除螨喷雾' : '香香喷雾', priority: 1, tags: ['居'], status: 0, isAllDay: true,
  startDate: `${today}T00:00:00+0800`, dueDate: `${today}T00:00:00+0800`, repeatFlag: 'RRULE:FREQ=WEEKLY', repeatFrom: '1', ...fields });
const completed = (task: TickTickTask, day: string) => ({ ...task, id: `old-${task.id}`, status: 2, completedTime: `${day}T09:00:00+0800` });
const calendarState = { tagMap: { [today]: 'school', '2026-10-06': 'school', '2026-10-07': 'school', '2026-10-08': 'school' } };
const history = [completed(task('mite'), '2026-09-14'), completed(task('fragrance'), '2026-09-16')];
const separate = (tasks: TickTickTask[], other: Partial<Parameters<typeof separateTickTickSprays>[0]> = {}) => {
  const options = { tasks, dates: new Map<string, string>(), history, calendarState, today, now, ...other };
  const resolved = separateTickTickSprays(options); return { dates: options.dates, resolved };
};
const apply = (tasks: TickTickTask[], dates: ReadonlyMap<string, string>) => tasks.map(task => dates.has(task.id)
  ? { ...task, startDate: `${dates.get(task.id)}T00:00:00+0800`, dueDate: `${dates.get(task.id)}T00:00:00+0800` } : task);

describe('喷雾错日约束', () => {
  it('两个都能放进预算也只留较久未做的一种，简报和用时与最终日期一致', () => {
    const tasks = [task('mite'), task('fragrance', { content: '(1m)' })];
    const state: DailyPlanState = { connectionId: 'same', history, deadlines: {} };
    const options = { tasks, state, calendarState, today, now, budgetMinutes: 60 };
    const first = planTickTickDay(options);
    expect(first.dates.get('mite')).toBe(today); expect(first.dates.get('fragrance')).toBe('2026-10-06');
    expect(first.summary).toMatchObject({ todayCount: 1, plannedMinutes: 5, deferredCount: 1 });
    expect(state.briefing?.selected.map(task => task.id)).toEqual(['mite']);
    expect(planTickTickDay({ ...options, tasks: apply(tasks, first.dates) })).toEqual(first);
  });
  it('今天都放不下时，也不把两种一起堆到明天；重要/定时任务同样错开', () => {
    const tasks = [task('mite'), task('fragrance')];
    const state: DailyPlanState = { connectionId: 'same', history, deadlines: {} };
    const result = planTickTickDay({ tasks, state, calendarState, today, now: new Date(`${today}T23:00:00+0800`), budgetMinutes: 10 });
    expect(result.dates.get('mite')).toBe('2026-10-06'); expect(result.dates.get('fragrance')).toBe('2026-10-07');
    const important = separate(tasks.map(task => ({ ...task, priority: 5, isAllDay: false })));
    expect(important.dates.get('fragrance')).toBe('2026-10-06');
  });
  it('错开一种喷雾后，腾出的预算还能安排其他任务，不虚占用时', () => {
    const tasks = [task('mite'), task('fragrance'), task('other', { title: '浇水', tags: [], repeatFlag: undefined })];
    const state: DailyPlanState = { connectionId: 'same', history, deadlines: {} };
    const plan = planTickTickDay({ tasks, state, calendarState, today, now, budgetMinutes: 10 });
    expect(plan.dates.get('mite')).toBe(today);
    expect(plan.dates.get('fragrance')).toBe('2026-10-06');
    expect(plan.dates.get('other')).toBe(today);
    expect(plan.summary.plannedMinutes).toBe(10);
  });
  it('今天已经做过一种，即使新重复任务生成了，也不再安排另一种', () => {
    const tasks = [task('fragrance')];
    expect(separate(tasks, { history: [...history, completed(task('mite'), today)] }).dates.get('fragrance')).toBe('2026-10-06');
    // The user message copied into a completed to-do is data, not a spray occurrence.
    expect(separate(tasks, { history: [completed(task('message', { title: '香香喷雾和除螨喷雾不能在同一天' }), today)] }).dates.size).toBe(0);
  });
  it('未来原定日期冲突也解决；先满足场景，再找没有另一种喷雾的日期', () => {
    const tasks = apply([task('mite'), task('fragrance')], new Map([['mite', '2026-10-06'], ['fragrance', '2026-10-06']]));
    expect(separate(tasks, { calendarState: { tagMap: { '2026-10-06': 'school', '2026-10-07': 'travel', '2026-10-08': 'school' } } }).dates.get('fragrance')).toBe('2026-10-08');
    expect(() => separate(tasks, { calendarState: { tagMap: { '2026-10-06': 'school' } } })).toThrow('后续适用场景');
  });
  it('逾期但仍待办视作今日候选，已有完成记录按北京时间判断', () => {
    expect(separate([task('fragrance', { dueDate: '2026-10-03T00:00:00+0800' })], {
      history: [completed(task('mite'), '2026-10-04'), { ...completed(task('mite'), today), completedTime: '2026-10-04T16:05:00Z' }],
    }).dates.get('fragrance')).toBe('2026-10-06');
  });
  it('只匹配这两个操作，忽略装备/说明、已完成项、不关我事与模板后代', () => {
    expect(sprayKind(task('a', { title: '香香喷雾（1m）' }))).toBe('fragrance');
    for (const title of ['购买除螨喷雾', '香香喷雾和除螨喷雾', '除螨喷雾说明']) expect(sprayKind(task('a', { title }))).toBeNull();
    expect(separate([task('mite'), task('fragrance', { status: 2 })]).dates.size).toBe(0);
    expect(separate([task('mite'), task('fragrance', { tags: ['不关我事'] })]).dates.size).toBe(0);
    expect(separate([task('mite'), task('fragrance', { parentId: 'stage' }), task('stage', { title: '模板阶段', parentId: 'root' })], {
      excludedTaskIds: new Set(['root']) }).dates.size).toBe(0);
  });
  it('不混用同名不同清单的最近完成时间，时长标注改变不丢系列匹配', () => {
    const tasks = [task('mite'), task('fragrance', { title: '香香喷雾（1m）' })];
    const unrelated = completed(task('mite', { projectId: 'elsewhere' }), today);
    expect(separate(tasks, { history: [...history, unrelated] }).dates.get('fragrance')).toBe('2026-10-06');
  });
  it('场景/每日同步只写最终错开的日期，保留重复和时间字段，第二次同步不再写', async () => {
    const originals = apply([task('mite'), task('fragrance')], new Map([['mite', '2026-10-06'], ['fragrance', '2026-10-06']]));
    const stored = new Map(originals.map(task => [task.id, task]));
    const api = { listProjects: async () => [], filterTasks: async () => [...stored.values()],
      getProjectData: async () => ({ tasks: [...stored.values()] }), listCompletedTasks: async () => [],
      updateTask: vi.fn(async (id, payload) => { const next = { ...stored.get(id)!, ...payload }; stored.set(id, next); return next; }),
      getTask: async (_projectId, id) => stored.get(id)! } as unknown as TickTickApi;
    for (let i = 0; i < 2; i++) await syncTickTickRoutines({ api, calendarState, today, completedTasks: history });
    expect(api.updateTask).toHaveBeenCalledTimes(1);
    expect(stored.get('fragrance')).toMatchObject({ dueDate: '2026-10-07T00:00:00+0800', repeatFlag: 'RRULE:FREQ=WEEKLY', repeatFrom: '1' });
    expect(stored.get('mite')).toEqual(originals[0]);
  });
  it('显式跟随洗头日期的喷雾先跟随，再错日，不被后面的跟随步骤改回同日', async () => {
    const stored = new Map([task('mite', { tags: ['居', '洗头'] }), task('fragrance', { tags: ['居', '洗头'] }),
      task('hair', { title: '洗头', tags: [], startDate: '2026-10-06T00:00:00+0800', dueDate: '2026-10-06T00:00:00+0800' })].map(task => [task.id, task]));
    const api = { listProjects: async () => [], filterTasks: async () => [...stored.values()],
      getProjectData: async () => ({ tasks: [...stored.values()] }), listCompletedTasks: async () => [],
      updateTask: vi.fn(async (id, payload) => { const next = { ...stored.get(id)!, ...payload }; stored.set(id, next); return next; }),
      getTask: async (_projectId, id) => stored.get(id)! } as unknown as TickTickApi;
    await syncTickTickRoutines({ api, calendarState, today, completedTasks: history });
    expect(stored.get('mite')?.dueDate).toBe('2026-10-06T00:00:00+0800');
    expect(stored.get('fragrance')?.dueDate).toBe('2026-10-07T00:00:00+0800');
    expect(api.updateTask).toHaveBeenCalledTimes(2);
    await syncTickTickRoutines({ api, calendarState, today, completedTasks: history });
    expect(api.updateTask).toHaveBeenCalledTimes(2);
  });
});
