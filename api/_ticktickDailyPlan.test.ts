import { describe, expect, it, vi } from 'vitest';
import { cycleEnd, estimateTaskMinutes, planTickTickDay, refreshDailyHistory, type DailyPlanState } from './_ticktickDailyPlan';
import { TickTickOpenApiClient, syncTickTickRoutines, type TickTickApi, type TickTickTask } from './_ticktickTrips';
const today = '2026-10-04';
const task = (id: string, fields: Partial<TickTickTask> = {}): TickTickTask => ({ id, projectId: 'inbox-real', title: id,
  status: 0, isAllDay: true, startDate: `${today}T00:00:00+0800`, dueDate: `${today}T00:00:00+0800`, ...fields });
const done = (source: TickTickTask, day: string, id = source.id): TickTickTask => ({ ...source, id, status: 2, completedTime: `${day}T09:00:00+0800` });
const state = (history: TickTickTask[] = []): DailyPlanState => ({ connectionId: 'same', history, deadlines: {} });
const run = (tasks: TickTickTask[], other: Partial<Parameters<typeof planTickTickDay>[0]> = {}) => planTickTickDay({
  tasks, state: state(), today, now: new Date(`${today}T05:00:00+08:00`), calendarState: {}, budgetMinutes: 60, ...other,
});
const apply = (tasks: TickTickTask[], dates: Map<string, string>) => tasks.map((t) => dates.has(t.id)
  ? { ...t, startDate: `${dates.get(t.id)}T00:00:00+0800`, dueDate: `${dates.get(t.id)}T00:00:00+0800` } : t);

describe('每日待办动态安排', () => {
  it('记录入选原因和估时，未选中项不冒充今日事', () => {
    const s = state();
    const p = run([task('a', { title: '学习 25分钟' }), task('b', { title: '学习 25分钟' })], { state: s, budgetMinutes: 25 });
    const chosen = s.briefing!.selected;
    expect(chosen).toHaveLength(1);
    expect(chosen[0].minutes).toBe(25);
    expect(chosen[0].reasons.join('')).toContain('可放入剩余空档');
    expect(p.dates.get(chosen[0].id)).toBe(today);
    expect(s.briefing!.date).toBe(today);
  });
  it('同周期按实际最近完成排序，识别重复任务新 ID，并给重要事项留量', () => {
    const newer = task('mite', { title: '除螨喷雾', repeatFlag: 'RRULE:FREQ=WEEKLY' });
    const older = task('fragrance', { title: '香香喷雾', repeatFlag: 'RRULE:FREQ=WEEKLY' });
    const p = run([newer, older, task('important', { priority: 5, title: '重要事项 45分钟' })], { budgetMinutes: 50,
      state: state([done(newer, '2026-09-27', 'old-id1'), done(older, '2026-09-20', 'old-id2')]) });
    expect(p.dates.get(older.id)).toBe(today);
    expect(p.dates.get(newer.id)).toBe('2026-10-05');
    expect(p.dates.has('important')).toBe(false);
    expect(p.summary).toMatchObject({ todayCount: 1, plannedMinutes: 5, importantCount: 1 });
  });
  it('寄居旅始终优先，多标签取最近可用日，明天不匹配就顺延', () => {
    const p = run([task('home', { tags: ['寄'] }), task('school', { tags: ['居'] }), task('both', { tags: ['寄', '居'] }), task('travel', { tags: ['旅'] })], {
      budgetMinutes: 10, calendarState: { tagMap: { [today]: 'school', '2026-10-05': 'travel', '2026-10-06': 'home', '2026-10-07': 'intern' } },
    });
    expect(p.dates.get('home')).toBe('2026-10-06');
    expect(p.dates.get('school')).toBe('2026-10-07');
    expect(p.dates.get('both')).toBe('2026-10-06');
    expect(p.dates.get('travel')).toBe('2026-10-05');
  });
  it('未来场景任务不能因很久没完成而被提前拉回今日', () => {
    const p = run([task('school', { tags: ['居'], dueDate: '2026-10-07T00:00:00+0800', repeatFlag: 'RRULE:FREQ=WEEKLY' })], {
      calendarState: { tagMap: { [today]: 'home', '2026-10-07': 'school' } },
    });
    expect(p.dates.size).toBe(0);
  });
  it('无下一适用场景时保留今日日期并如实计入负担', () => {
    const p = run([task('last-day', { tags: ['旅'], title: '任务 60分钟' })], {
      budgetMinutes: 10, calendarState: { tagMap: { [today]: 'travel' } },
    });
    expect(p.dates.get('last-day')).toBe(today);
    expect(p.summary.plannedMinutes).toBe(60);
  });
  it('排除标签按自身判断，普通子任务独立轮换，模板后代不动', () => {
    const p = run([task('folder', { tags: ['routine'] }), task('child', { parentId: 'folder' }),
      task('template'), task('stage', { parentId: 'template' }), task('leaf', { parentId: 'stage' }),
      task('ignored', { tags: ['不关我事'] }), task('timed', { isAllDay: false }),
      task('wash', { title: '洗头' }), task('follow', { tags: ['洗头'] }),
      task('unknown', { repeatFlag: 'LUNAR:FREQ=YEARLY' })], { excludedTaskIds: new Set(['template']), budgetMinutes: 240 });
    expect([...p.dates.keys()]).toEqual(['child']);
  });
  it('重要事项越多、实际已完成越多，今日数量减少', () => {
    const pool = Array.from({ length: 8 }, (_, i) => task(String(i)));
    const quiet = run(pool).summary;
    const busy = run([...pool, task('important', { priority: 5 })]).summary;
    const completed = run(pool, { state: state([done(task('finished'), today)]) }).summary;
    expect(busy.todayCount).toBeLessThan(quiet.todayCount);
    expect(completed.todayCount).toBeLessThan(quiet.todayCount);
    expect(busy.plannedMinutes).toBeLessThanOrEqual(busy.availableMinutes);
  });
  it('周期越紧迫每天安排越多，仍不突破每日用时', () => {
    const pool = Array.from({ length: 10 }, (_, i) => task(String(i), { repeatFlag: 'RRULE:FREQ=WEEKLY' }));
    const near = run(pool, { state: state(pool.map((t) => done(t, '2026-09-27'))) });
    const far = run(pool, { state: state(pool.map((t) => done(t, '2026-10-03'))) });
    expect(near.summary.todayCount).toBeGreaterThan(far.summary.todayCount);
    expect(near.summary.plannedMinutes).toBeLessThanOrEqual(60);
  });
  it('当天不因完成任务无限补入，也不会把刚完成的重复任务拉回', () => {
    const t = task('repeat', { repeatFlag: 'RRULE:FREQ=DAILY' });
    const p = run([t, task('other')], { budgetMinutes: 30, state: state([done(t, today), done(task('another'), today)]) });
    expect(p.summary.todayCount).toBe(0);
    expect(p.dates.get(t.id)).toBe('2026-10-05');
  });
  it('同日重复规划稳定，延期不会重置原周期截止日', () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task(String(i)));
    const s = state();
    const first = run(tasks, { state: s });
    const second = run(apply(tasks, first.dates), { state: s });
    expect(second).toEqual(first);
    expect(s.deadlines['6'].date).toBe(today);
    run(apply(tasks, first.dates), { state: s, today: '2026-10-05' });
    expect(s.deadlines['6'].date).toBe(today);
  });
  it('同名不同清单或父任务不会混用完成历史，同系列取最新记录', () => {
    const t = task('a', { title: '喷雾', parentId: 'parent', repeatFlag: 'RRULE:FREQ=WEEKLY' });
    const other = task('b', { title: '喷雾', projectId: 'other', repeatFlag: 'RRULE:FREQ=WEEKLY' });
    const s = state([done({ ...t, parentId: 'wrong' }, today, 'unrelated'), done(t, '2026-09-20', 'old'), done(t, '2026-09-27', 'new')]);
    const p = run([t, other], { state: s });
    expect(s.deadlines.a.date).toBe(today);
    expect(p.dates.get(t.id)).toBe(today);
  });
  it('未来的一次性约定保留原日期，无日期积压可以被挑入', () => {
    const p = run([task('future', { dueDate: '2026-10-05T00:00:00+0800' }), task('undated', { startDate: undefined, dueDate: undefined })]);
    expect(p.dates.has('future')).toBe(false);
    expect(p.dates.get('undated')).toBe(today);
  });
  it('周期计算覆盖自然月和每周指定日，用时优先取显式信息', () => {
    expect(cycleEnd(task('x', { repeatFlag: 'RRULE:FREQ=WEEKLY' }), '2026-09-27')).toBe(today);
    expect(cycleEnd(task('x', { repeatFlag: 'RRULE:FREQ=MONTHLY' }), '2026-09-04')).toBe(today);
    expect(cycleEnd(task('x', { repeatFlag: 'LUNAR:FREQ=YEARLY' }), today)).toBeNull();
    expect(estimateTaskMinutes(task('x', { title: '学习 25分钟' }))).toBe(25);
    expect(estimateTaskMinutes(task('x', { title: '看剧📺15m', priority: 5 }))).toBe(15);
    expect(estimateTaskMinutes(task('x', { title: '签到', priority: 5 }))).toBe(5);
    expect(estimateTaskMinutes(task('x', { priority: 5 }))).toBe(15);
    expect(estimateTaskMinutes(task('x', { title: '洗衣服' }))).toBe(50);
    expect(estimateTaskMinutes(task('x', { title: '洗衣服', content: '（1h1m）' }))).toBe(61);
  });
  it('完成记录读取失败时不推进检查点，成功后保留过去已知最后完成', async () => {
    const s = state([done(task('old'), '2020-01-01')]);
    const api = { listCompletedTasks: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as TickTickApi;
    await expect(refreshDailyHistory(api, [task('recent')], s, new Date('2026-10-04T10:00:00Z'))).rejects.toThrow('offline');
    expect(s.historyThrough).toBeUndefined();
    vi.mocked(api.listCompletedTasks).mockResolvedValue([done(task('recent'), today)]);
    await refreshDailyHistory(api, [task('recent')], s, new Date('2026-10-04T10:00:00Z'));
    expect(s.history.map((t) => t.id)).toContain('old');
    expect(s.historyThrough).toBe('2026-10-04T10:00:00.000Z');
  });
  it('与场景排期整合后只写最终日期，二次同步不往返改期', async () => {
    const original = task('scene', { tags: ['居'], title: '任务 15分钟', dueDate: '2026-10-05T00:00:00+0800', startDate: '2026-10-05T00:00:00+0800' });
    const api = { listProjects: async () => [], filterTasks: async () => [original], getProjectData: async () => ({ tasks: [original] }),
      listCompletedTasks: async () => [], updateTask: vi.fn(), getTask: async () => original } as unknown as TickTickApi;
    const s = state();
    for (let i = 0; i < 2; i++) await syncTickTickRoutines({ api, today, calendarState: { tagMap: { [today]: 'school', '2026-10-05': 'school' } },
      planDay: async (tasks) => run(tasks, { state: s, budgetMinutes: 10, calendarState: { tagMap: { [today]: 'school', '2026-10-05': 'school' } } }).dates });
    expect(api.updateTask).not.toHaveBeenCalled();
  });
});

describe('TickTick 明确限流', () => {
  it('等待后重试明确的查询限流，普通错误不重放', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('{"errorCode":"exceed_query_limit"}', { status: 500 }))
        .mockResolvedValueOnce(new Response('[]'));
      const api = new TickTickOpenApiClient('token', 'https://ticktick.test', fetcher);
      const pending = api.listProjects();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      fetcher.mockResolvedValueOnce(new Response('internal error', { status: 500 }));
      await expect(api.listProjects()).rejects.toThrow('TickTick 500');
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});
