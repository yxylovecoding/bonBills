import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CYCLE } from '../src/utils/bonLife';
import { EXERCISE_STATE_KEY, exerciseTarget, isExerciseTask, syncExerciseSchedule } from './_ticktickExercise';
import { syncTickTickRoutines, type TickTickApi, type TickTickTask } from './_ticktickTrips';

const { data } = vi.hoisted(() => ({ data: new Map<string, any>() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown) => data.set(key, structuredClone(value)),
} }));
vi.mock('./_lifeSwimming.js', () => ({ readSwimmingCycle: async () => ({ cycle: DEFAULT_CYCLE, periods: [] }) }));

const workout = (extra: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'full-body', projectId: 'life',
  title: '全身力训-运动💪🏻是生活的第一个锚点🪝', status: 0, priority: 5, tags: ['动', '当天'],
  startDate: '2026-10-04T01:00:00.000+0000', dueDate: '2026-10-04T01:00:00.000+0000',
  isAllDay: false, timeZone: 'Asia/Shanghai', repeatFlag: 'RRULE:FREQ=WEEKLY;WKST=MO;INTERVAL=1;BYDAY=SU', repeatFrom: '2', ...extra });
const now = (time: string) => new Date(`${time}+08:00`);
const options = (time: string) => ({ now: now(time), calendarState: {} });

function fakeApi(...tasks: TickTickTask[]) {
  const stored = new Map(tasks.map(task => [task.id, structuredClone(task)]));
  const api = {
    listProjects: async () => [{ id: 'life', name: '活' }],
    filterTasks: async () => [...stored.values()],
    getProjectData: async () => ({ tasks: [...stored.values()] }),
    listCompletedTasks: vi.fn(async () => []),
    getTask: vi.fn(async (_projectId: string, id: string) => structuredClone(stored.get(id)!)),
    updateTask: vi.fn(async (id: string, payload: Record<string, unknown>) => {
      const saved = { ...stored.get(id)!, ...payload } as TickTickTask;
      stored.set(id, structuredClone(saved)); return saved;
    }),
  };
  return { api: api as unknown as TickTickApi, stored, update: api.updateTask, read: api.getTask };
}
beforeEach(() => data.clear());

describe('夜间运动收尾', () => {
  it('22 点前保留当天训练，22 点后跳到原定星期，不堆到明天', () => {
    expect(exerciseTarget(workout(), options('2026-10-04T21:59:59'))).toBeNull();
    expect(exerciseTarget(workout(), options('2026-10-04T22:00:00'))).toBe('2026-10-11');
    expect(exerciseTarget(workout(), options('2026-10-05T05:00:00'))).toBe('2026-10-11');
    expect(exerciseTarget(workout(), options('2026-10-05T00:05:00'))).toBe('2026-10-11');
  });
  it('早上不跳过当天或未来训练；全天任务按上海日期解释', () => {
    const task = workout({ startDate: '2026-10-04T16:00:00.000+0000', dueDate: '2026-10-04T16:00:00.000+0000',
      isAllDay: true, repeatFlag: 'RRULE:FREQ=WEEKLY;BYDAY=MO' });
    expect(exerciseTarget(task, options('2026-10-05T05:00:00'))).toBeNull();
    expect(exerciseTarget(task, options('2026-10-04T23:00:00'))).toBeNull();
    expect(exerciseTarget(task, options('2026-10-05T22:00:00'))).toBe('2026-10-12');
  });
  it('没有 BYDAY 的每周训练仍保持当前星期；过期多周只保留下一次', () => {
    const task = workout({ repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=1' });
    expect(exerciseTarget(task, options('2026-10-26T05:00:00'))).toBe('2026-11-01');
  });
  it('排除准备、器材、赛事咨询、已完成和无日期的父任务', () => {
    for (const title of ['下班准备游泳', '健身第二天的东西', '网球发球机', '公开水域比赛 🍠游泳咨询mio']) {
      expect(isExerciseTask(workout({ title }))).toBe(false);
    }
    for (const extra of [{ status: 2 }, { completedTime: '2026-10-04T10:00:00Z' }, { tags: ['不关我事'] },
      { title: '运动💪🏻是生活的第一个锚点🪝', startDate: undefined, dueDate: undefined }]) {
      expect(exerciseTarget(workout(extra), options('2026-10-04T22:00:00'))).toBeNull();
    }
  });
  it('未知或有限重复规则不被错误改成无限重复', () => {
    for (const repeatFlag of ['EVERY WEEK', 'RRULE:FREQ=DAILY;COUNT=2', 'RRULE:FREQ=DAILY;UNTIL=20261010']) {
      expect(exerciseTarget(workout({ repeatFlag }), options('2026-10-04T22:00:00'))).toBeNull();
    }
  });
  it('下一次仍须符合场景；游泳在原间隔上避开经期', () => {
    const task = workout({ title: '游泳-运动💪🏻是生活的第一个锚点🪝', tags: ['居', '洗头'], repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2' });
    const calendarState = { tagMap: { '2026-10-06': 'travel', '2026-10-08': 'school', '2026-10-10': 'intern' } };
    const config = { ...options('2026-10-04T22:00:00'), calendarState, cycle: DEFAULT_CYCLE, periods: [] };
    expect(exerciseTarget(task, config)).toBe('2026-10-08');
    expect(exerciseTarget(task, { ...config, periods: ['2026-10-08'], cycle: { ...DEFAULT_CYCLE, periodLength: 1 },
      calendarState: { tagMap: { '2026-10-06': 'travel', '2026-10-08': 'school', '2026-10-16': 'school' } } })).toBe('2026-10-16');
    expect(exerciseTarget(task, { ...config, calendarState: {} })).toBeNull();
  });
  it('写入前复查完成情况，不改刚做完的运动', async () => {
    const fake = fakeApi(workout());
    fake.read.mockResolvedValueOnce(workout({ status: 2 }));
    const result = await syncExerciseSchedule(fake.api, { connectionId: 'account', ...options('2026-10-04T22:00:00') });
    expect(result.updated).toBe(0); expect(fake.update).not.toHaveBeenCalled();
  });
  it('保留时间、优先级、标签、重复方式和已完成清单项；重试不再跳一次', async () => {
    const task = workout({ reminders: ['TRIGGER:-PT30M'], parentId: 'training', content: 'details',
      items: [{ id: 'open', title: 'warmup', status: 0, startDate: '2026-10-04T00:45:00.000+0000' },
        { id: 'done', title: 'prepare', status: 1, completedTime: '2026-10-03T23:00:00Z', startDate: '2026-10-03T16:00:00.000+0000' }] });
    const fake = fakeApi(task);
    const config = { connectionId: 'account', ...options('2026-10-04T22:00:00') };
    expect((await syncExerciseSchedule(fake.api, config)).updated).toBe(1);
    expect(fake.stored.get(task.id)).toEqual({ ...task, startDate: '2026-10-11T01:00:00.000+0000', dueDate: '2026-10-11T01:00:00.000+0000',
      items: [{ ...task.items![0], startDate: '2026-10-11T00:45:00.000+0000' }, task.items![1]] });
    expect(fake.update.mock.calls[0][1]).not.toHaveProperty('status');
    expect(fake.update.mock.calls[0][1]).not.toHaveProperty('completedTime');
    expect((await syncExerciseSchedule(fake.api, config)).updated).toBe(0);
    expect(fake.update).toHaveBeenCalledOnce();
  });
  it('模板及生成的出行/心愿训练排除在收尾范围外', async () => {
    const fake = fakeApi(workout({ parentId: 'stage' }), workout({ id: 'stage', parentId: 'template' }),
      workout({ id: 'generated', parentId: 'wish' }));
    data.set('ticktick:trip-sync:v1', { instances: {}, wishInstances: { wish: { rootTaskId: 'wish', taskIdsByTemplateId: {} } } });
    expect((await syncExerciseSchedule(fake.api, { connectionId: 'account', templateRootId: 'template', ...options('2026-10-04T22:00:00') })).updated).toBe(0);
    expect(fake.update).not.toHaveBeenCalled();
  });
  it('后续场景或洗头跟随不能把跳过的游泳拉回原日', async () => {
    const swim = workout({ title: '游泳-运动💪🏻是生活的第一个锚点🪝', tags: ['居', '洗头'], repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2' });
    const wash = workout({ id: 'wash', title: '洗头', tags: [], repeatFlag: '' });
    const fake = fakeApi(swim, wash);
    const calendarState = { tagMap: { '2026-10-04': 'school', '2026-10-05': 'school', '2026-10-06': 'school' } };
    const result = await syncExerciseSchedule(fake.api, { connectionId: 'account', now: now('2026-10-04T22:00:00'), calendarState });
    expect(result.updated).toBe(1);
    await syncTickTickRoutines({ api: fake.api, today: '2026-10-05', calendarState, minimumTaskDates: result.minimumDates });
    expect(fake.stored.get(swim.id)?.dueDate).toBe('2026-10-06T01:00:00.000+0000');
    expect(fake.update).toHaveBeenCalledOnce();
    expect((await syncExerciseSchedule(fake.api, { connectionId: 'account', now: now('2026-10-05T05:00:00'), calendarState })).minimumDates.get(swim.id)).toBe('2026-10-06');
  });
  it('失败后记录目标供重试保护，换账号不沿用目标', async () => {
    const fake = fakeApi(workout());
    fake.update.mockRejectedValueOnce(new Error('write failed'));
    const config = { connectionId: 'account', ...options('2026-10-04T22:00:00') };
    await expect(syncExerciseSchedule(fake.api, config)).rejects.toThrow('write failed');
    expect(data.get(EXERCISE_STATE_KEY).deferrals['full-body'].notBefore).toBe('2026-10-11');
    expect((await syncExerciseSchedule(fake.api, config)).updated).toBe(1);
    expect((await syncExerciseSchedule(fake.api, { ...config, connectionId: 'other-account' })).minimumDates.size).toBe(0);
  });
});
