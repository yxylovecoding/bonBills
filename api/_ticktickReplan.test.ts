import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TickTickTask } from './_ticktickTrips';
import { replanRemainingToday } from './_ticktickReplan';
import { DAILY_PLAN_KEY, DAILY_PLAN_SETTINGS_KEY } from './_ticktickDailyPlan';

const mocks = vi.hoisted(() => ({ data: new Map<string, any>(), tasks: [] as TickTickTask[], history: [] as TickTickTask[],
  getTask: vi.fn(), update: vi.fn(), historyRead: vi.fn(), snapshot: vi.fn(), set: vi.fn(),
  acquire: vi.fn(), release: vi.fn(), broadSync: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => structuredClone(mocks.data.get(key) ?? null),
  set: mocks.set } }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: mocks.acquire, releaseTickTickLock: mocks.release }));
vi.mock('./_outlookSync.js', () => ({ OUTLOOK_CONNECTION_KEY: 'outlook:calendar-connection:v1', syncOutlookCalendar: mocks.broadSync }));
vi.mock('./_outlookCalendar.js', () => ({ decryptOutlookConnection: () => ({ policy: 'outlook' }), readOutlookSnapshot: mocks.snapshot }));
vi.mock('./_ticktickTrips.js', async original => ({ ...await original<typeof import('./_ticktickTrips')>(),
  decryptTickTickToken: () => 'test-token',
  readAllTickTickTasks: async () => structuredClone(mocks.tasks),
  readConnectedTickTickTemplate: async () => ({ rootTask: { id: 'template' }, tasks: [] }),
  TickTickOpenApiClient: class {
    getTask = mocks.getTask;
    updateTask = mocks.update;
    listCompletedTasks = mocks.historyRead;
  },
  syncTickTickRoutines: mocks.broadSync, reconcileTickTickTrips: mocks.broadSync,
  reconcileTickTickWishPreparations: mocks.broadSync,
}));
const day = '2026-10-05';
const task = (id: string, extra: Partial<TickTickTask> = {}): TickTickTask => ({ id, projectId: 'life', title: id,
  status: 0, isAllDay: true, dueDate: `${day}T00:00:00+0800`, content: '(15m)', ...extra });
const connectionId = createHash('sha256').update('test-token').digest('hex');
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(`${day}T21:30:00+08:00`));
  vi.clearAllMocks(); mocks.data.clear(); mocks.tasks = []; mocks.history = [];
  mocks.acquire.mockResolvedValue('lock'); mocks.release.mockResolvedValue(undefined);
  mocks.data.set('ticktick:connection:v1', { encryptedToken: {}, templateRootId: 'template', projectId: 'life' });
  mocks.data.set(DAILY_PLAN_SETTINGS_KEY, { budgetMinutes: 240 });
  mocks.getTask.mockImplementation(async (_project, id) => structuredClone(mocks.tasks.find(t => t.id === id)));
  mocks.update.mockImplementation(async (id, payload) => {
    const current = mocks.tasks.find(t => t.id === id)!;
    Object.assign(current, payload); return structuredClone(current);
  });
  mocks.set.mockImplementation(async (key, value) => { mocks.data.set(key, structuredClone(value)); return 'OK'; });
  mocks.historyRead.mockImplementation(async () => structuredClone(mocks.history));
  mocks.snapshot.mockResolvedValue({ startDate: day, endDate: '2026-11-05', tags: {},
    availability: { startDate: day, endDate: '2026-11-05', events: [] } });
});
afterEach(() => vi.useRealTimers());

describe('只重排剩余今日事', () => {
  it('按执行时刻剩余 15 分钟及完成间隔挑选，只顺延较新完成的任务', async () => {
    mocks.tasks = [task('older'), task('newer')];
    mocks.history = [task('older', { status: 2, completedTime: '2026-09-20T12:00:00+08:00' }),
      task('newer', { status: 2, completedTime: '2026-09-28T12:00:00+08:00' })];
    const result = await replanRemainingToday();
    expect(result).toMatchObject({ busy: false, updated: 1, dailyPlan: { todayCount: 1, plannedMinutes: 15, availableMinutes: 15 } });
    expect(mocks.update).toHaveBeenCalledWith('newer', expect.objectContaining({ dueDate: '2026-10-06T00:00:00+0800' }));
    expect(mocks.data.get(DAILY_PLAN_KEY).briefing.selected.map((t: TickTickTask) => t.id)).toEqual(['older']);
    expect(mocks.broadSync).not.toHaveBeenCalled();
    expect(mocks.set.mock.calls.every(([key]) => key === DAILY_PLAN_KEY)).toBe(true);
  });
  it('只移动今天/逾期的普通未完成任务，保留明日、重要、定时、routine、训练、洗衣和模板/旅行任务', async () => {
    vi.setSystemTime(new Date(`${day}T23:00:00+08:00`));
    mocks.tasks = [task('ordinary'), task('overdue', { dueDate: '2026-10-04T00:00:00+0800' }),
      task('tomorrow', { dueDate: '2026-10-06T00:00:00+0800', repeatFlag: 'RRULE:FREQ=DAILY' }),
      task('undated', { dueDate: undefined }), task('important', { priority: 5 }), task('timed', { isAllDay: false }),
      task('routine', { tags: ['routine'] }), task('irrelevant', { tags: ['不关我事'] }),
      task('hair', { title: '洗头' }), task('hair-child', { tags: ['洗头'] }),
      task('wash', { title: '洗衣服' }), task('exercise', { title: '游泳' }),
      task('done', { status: 2 }), task('completed', { completedTime: `${day}T12:00:00+08:00` }),
      task('template-child', { parentId: 'template' }), task('trip'), task('trip-child', { parentId: 'trip' })];
    mocks.data.set('ticktick:trip-sync:v1', { instances: { x: { rootTaskId: 'trip', taskIdsByTemplateId: {} } } });
    const before = structuredClone(mocks.tasks);
    await replanRemainingToday();
    expect(mocks.update.mock.calls.map(([id]) => id).sort()).toEqual(['ordinary', 'overdue']);
    expect(mocks.tasks.slice(2)).toEqual(before.slice(2));
    expect(mocks.broadSync).not.toHaveBeenCalled();
  });
  it('读取最新 Outlook 空档，不写日历；今天重要的事也占用剩余容量', async () => {
    vi.setSystemTime(new Date(`${day}T20:00:00+08:00`));
    mocks.data.set('outlook:calendar-connection:v1', { encrypted: 'encrypted' });
    mocks.snapshot.mockResolvedValueOnce({ startDate: day, endDate: '2026-11-05', tags: {},
      availability: { startDate: day, endDate: '2026-11-05', events: [{ title: '其他日程', start: `${day}T21:00:00+08:00`, end: `${day}T22:00:00+08:00` }] } });
    mocks.tasks = [task('ordinary'), task('important', { priority: 5, content: '(1h)' })];
    const result = await replanRemainingToday();
    expect(result).toMatchObject({ dailyPlan: { todayCount: 0, plannedMinutes: 0, availableMinutes: 0, importantCount: 1 } });
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.broadSync).not.toHaveBeenCalled();
    expect(mocks.set.mock.calls.every(([key]) => key === DAILY_PLAN_KEY)).toBe(true);
  });
  it('保留描述、标签、重复规则和子项，只修改任务日期', async () => {
    mocks.tasks = [task('large', { content: '（1h1m）', tags: ['居'], repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=7',
      repeatFrom: 1, items: [{ id: 'item', title: 'child', status: 0, startDate: `${day}T00:00:00+0800` }] })];
    mocks.data.set('calendar-tags', { tagMap: { [day]: 'school', '2026-10-06': 'school' } });
    const before = structuredClone(mocks.tasks[0]);
    await replanRemainingToday();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.tasks[0]).toEqual({ ...before, dueDate: '2026-10-06T00:00:00+0800' });
  });
  it.each(['completed', 'edited'])('写入前发现任务已 %s 时中止，不覆盖新状态', async kind => {
    mocks.tasks = [task('large', { content: '(1h)' })];
    mocks.getTask.mockResolvedValueOnce({ ...mocks.tasks[0], ...(kind === 'completed' ? { status: 2 } : { content: 'new description' }) });
    await expect(replanRemainingToday()).rejects.toThrow('待办已变化');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.data.has(DAILY_PLAN_KEY)).toBe(false);
    expect(mocks.release).toHaveBeenCalledWith('lock');
  });
  it('写入失败不发布成功摘要，保留周期锚点便于重试', async () => {
    mocks.tasks = [task('large', { content: '(1h)' })];
    const summary = { date: day, todayCount: 8 };
    mocks.data.set(DAILY_PLAN_KEY, { connectionId, history: [], deadlines: {}, summary });
    mocks.update.mockRejectedValueOnce(new Error('upstream unavailable'));
    await expect(replanRemainingToday()).rejects.toThrow('upstream unavailable');
    expect(mocks.data.get(DAILY_PLAN_KEY).summary).toEqual(summary);
    expect(mocks.data.get(DAILY_PLAN_KEY).deadlines.large.date).toBe(day);
    expect(mocks.release).toHaveBeenCalledWith('lock');
  });
  it('顺延喷雾避开明天已经安排的另一种喷雾，同时保留明日任务', async () => {
    vi.setSystemTime(new Date(`${day}T23:00:00+08:00`));
    mocks.tasks = [task('fragrance', { title: '香香喷雾' }),
      task('mite', { title: '除螨喷雾', dueDate: '2026-10-06T00:00:00+0800' })];
    const result = await replanRemainingToday();
    expect(result).toMatchObject({ updated: 1, dailyPlan: { todayCount: 0 } });
    expect(mocks.update).toHaveBeenCalledWith('fragrance', expect.objectContaining({ dueDate: '2026-10-07T00:00:00+0800' }));
    expect(mocks.tasks[1].dueDate).toBe('2026-10-06T00:00:00+0800');
  });
  it('繁忙和完成历史读取失败均不开始写入', async () => {
    mocks.acquire.mockResolvedValueOnce(null);
    expect(await replanRemainingToday()).toEqual({ busy: true });
    expect(mocks.historyRead).not.toHaveBeenCalled();
    mocks.tasks = [task('large', { content: '(1h)' })];
    mocks.historyRead.mockRejectedValueOnce(new Error('history unavailable'));
    await expect(replanRemainingToday()).rejects.toThrow('history unavailable');
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
  });
});
