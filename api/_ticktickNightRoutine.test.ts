import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hairWashHidden, nightRoutineHidden, readingHidden, syncHairWashVisibility, syncNightRoutineVisibility,
  syncReadingVisibility, syncTimedTaskVisibility, timedTaskHidden, sleepTagStateKey } from './_ticktickNightRoutine';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';

const { data } = vi.hoisted(() => ({ data: new Map<string, unknown>() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return 'OK'; }),
} }));

const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'night', projectId: 'inbox-real', title: '夜间routine ',
  status: 0, isAllDay: false, startDate: '2026-10-04T14:00:00.000+0000', dueDate: '2026-10-04T14:00:00.000+0000',
  timeZone: 'Asia/Shanghai', repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1', repeatFrom: '1',
  tags: ['居', '活'], priority: 5, ...fields });
const at = (value: string) => new Date(`2026-10-04T${value}+08:00`);

beforeEach(() => data.clear());

describe('阅读按晚间窗口切换 routine', () => {
  const reading = task({ title: '而阅读📖是另一个🪝', content: '(15m)', priority: 3, tags: ['玩'] });
  it.each([['00:00:00', false], ['04:59:59', false], ['05:00:00', true], ['19:59:59', true],
    ['20:00:00', false], ['23:59:59', false]])('%s 的标签状态', (time, hidden) => {
    expect(readingHidden(reading, at(time))).toBe(hidden);
    expect(readingHidden({ ...reading, isAllDay: true, timeZone: 'America/New_York' }, at(time))).toBe(hidden);
  });
  it('只匹配这条阅读，不修改日语阅读、其他阅读或已完成任务', () => {
    expect(readingHidden({ ...reading, title: ' 阅读 ' }, at('19:00:00'))).toBe(true);
    for (const fields of [{ title: '日语阅读' }, { title: '阅读笔记' }, { status: 2 }]) {
      expect(readingHidden({ ...reading, ...fields }, at('19:00:00'))).toBeNull();
    }
  });
  it('晚间移除，跨午夜保留，早晨加回；不改变估时、其他标签、优先级或重复规则', async () => {
    const { api, current } = client(reading);
    // 到了 05:00，进入隐藏期，添加标签并占有。
    expect(await syncReadingVisibility(api, { now: new Date('2026-10-05T05:00:00+08:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 1, hidden: 1 });
    expect(current().tags).toEqual(['玩', 'bon-hidden']);
    // 到了 20:00，退出隐藏期，移除标签。
    expect(await syncReadingVisibility(api, { now: at('20:00:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 1, visible: 1 });
    expect(current().tags).toEqual(['玩']);
    // 跨午夜保留 (保持 visible)
    expect(await syncReadingVisibility(api, { now: new Date('2026-10-06T00:00:00+08:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 0, visible: 1 });
  });
});

function client(source = task()) {
  let current = structuredClone(source);
  const api = {
    filterTasks: vi.fn(async () => [] as TickTickTask[]),
    getProjectData: vi.fn(async () => ({ tasks: [structuredClone(current)] })),
    getTask: vi.fn(async () => structuredClone(current)),
    updateTask: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
      current = { ...current, ...payload } as TickTickTask;
      return structuredClone(current);
    }),
  };
  return { api: api as unknown as TickTickApi & typeof api, current: () => current };
}

describe('夜间 routine 开始时间显隐', () => {
  it.each([['05:00:00', true], ['20:00:00', true], ['21:59:59', true], ['22:00:00', false], ['23:59:59', false]])(
    '%s 按上海时区判断开始时间', (time, hidden) => expect(nightRoutineHidden(task(), at(time))).toBe(hidden),
  );
  it('读取用户修改后的开始时间，不硬编码 22 点，也不误用结束时间', () => {
    const changed = task({ startDate: '2026-10-04T20:30:00+08:00', dueDate: '2026-10-04T23:00:00+08:00' });
    expect(nightRoutineHidden(changed, at('20:29:59'))).toBe(true);
    expect(nightRoutineHidden(changed, at('20:30:00'))).toBe(false);
  });
  it('跨日后未完成任务重新隐藏，下一次重复也在开始前隐藏', () => {
    expect(nightRoutineHidden(task(), new Date('2026-10-05T00:00:00+08:00'))).toBe(true);
    expect(nightRoutineHidden(task(), new Date('2026-10-05T22:00:00+08:00'))).toBe(false);
    const future = task({ startDate: '2026-10-05T22:00:00+08:00' });
    expect(nightRoutineHidden(future, at('23:00:00'))).toBe(true);
    expect(nightRoutineHidden(future, new Date('2026-10-05T21:59:00+08:00'))).toBe(true);
  });
  it('不同地区按任务时区，未设时区沿用连接时区', () => {
    const abroad = task({ timeZone: 'America/New_York', startDate: '2026-10-04T22:00:00-04:00' });
    expect(nightRoutineHidden(abroad, new Date('2026-10-05T09:59:00+08:00'))).toBe(true);
    expect(nightRoutineHidden(abroad, new Date('2026-10-05T10:00:00+08:00'))).toBe(false);
    expect(nightRoutineHidden(task({ timeZone: undefined }), at('22:00:00'))).toBe(false);
  });
  it('已完成、全天、无开始时间或错误时区都不猜测；不匹配其他 routine', () => {
    for (const fields of [{ status: 2 }, { isAllDay: true }, { startDate: undefined }, { startDate: 'bad' },
      { timeZone: 'invalid/zone' }, { title: '早间routine' }, { title: '夜间routine副本' }]) {
      expect(nightRoutineHidden(task(fields), at('22:00:00'))).toBeNull();
    }
    expect(nightRoutineHidden(task({ title: '夜间 ROUTINE ' }), at('22:00:00'))).toBe(false);
  });
});

describe('夜间 routine 标签同步', () => {
  it('高优先级是重要之事的必要条件，开始前也准备好但继续用标签隐藏', async () => {
    const { api, current } = client(task({ priority: 0 }));
    expect(await syncNightRoutineVisibility(api, { now: at('20:00:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 1, hidden: 1 });
    expect(current().priority).toBe(5);
    expect(current().tags).toEqual(['居', '活', 'bon-hidden']);
  });
  it('读取真实收集箱，切换标签但保留优先级、场景、提醒、重复及 checklist；重复执行不重复写', async () => {
    const original = task({ content: 'existing content', reminders: ['TRIGGER:PT0S'], items: [{ id: 'item', title: 'item', status: 1 }] });
    const { api, current } = client(original);
    // 隐藏
    await syncNightRoutineVisibility(api, { now: at('20:00:00'), projectId: 'inbox-real' });
    // 显示
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 1, visible: 1 });
    expect(current()).toEqual({ ...original, tags: ['居', '活'] });
  });
  it('列表之后被改时间或完成的任务以回读值为准，完整同步复用已有列表', async () => {
    const { api } = client(task({ startDate: '2026-10-04T23:00:00+08:00' }));
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), tasks: [task({ startDate: '2026-10-04T23:00:00+08:00' })], projectId: 'inbox-real' })).toMatchObject({ hidden: 1, updated: 1 });
    api.getTask.mockResolvedValue(task({ status: 2 }));
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), tasks: [task()], projectId: 'inbox-real' })).toMatchObject({ matched: 0, skipped: 1 });
  });
  it('没有匹配任务不修改其他任务，读失败或标签未保存就报错', async () => {
    const { api } = client(task({ title: '其他任务' }));
    expect(await syncNightRoutineVisibility(api, { projectId: 'inbox-real' })).toMatchObject({ matched: 0, updated: 0 });
    api.getTask.mockResolvedValue(task());
    await expect(syncNightRoutineVisibility(api, { tasks: [task()], now: at('20:00:00'), projectId: 'inbox-real' })).rejects.toThrow('未保存');
  });

  it('用户原有 routine 到点不移除，且 journal 不会记录它', async () => {
    const original = task({ tags: ['routine', '居'] }); // 用户手动加的
    const { api, current } = client(original);
    // 到点显示 (22:00)
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), projectId: 'inbox-real' })).toMatchObject({ visible: 1, updated: 0 });
    expect(current().tags).toContain('routine');
    expect(current().tags).not.toContain('bon-hidden');
    expect(data.get(sleepTagStateKey('inbox-real'))).toBeFalsy();
  });

  it('旧 journal 对应任务没有 bon-hidden 时只清理记录，用户 routine 永远保留', async () => {
    const original = task({ tags: ['routine', '居'] });
    const { api, current } = client(original);
    const journalKey = sleepTagStateKey('inbox-real');
    data.set(journalKey, { [original.id]: { projectId: original.projectId, phase: 'added', addedOn: '2026-10-04' } });
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), projectId: 'inbox-real' }))
      .toMatchObject({ visible: 1, updated: 0 });
    expect(current().tags).toEqual(['routine', '居']);
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(data.get(journalKey)).toEqual({});
  });

  it('旧 journal 绝不删除用户 routine；存在 bon-hidden 时只移除系统标签', async () => {
    const original = task({ tags: ['routine', 'bon-hidden', '居'] });
    const { api, current } = client(original);
    // 预设 Journal 中已标记归系统所有
    data.set(sleepTagStateKey('inbox-real'), { [original.id]: { projectId: 'inbox-real', phase: 'added', addedOn: '2026-10-04' } });

    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), projectId: 'inbox-real' })).toMatchObject({ visible: 1, updated: 1 });
    expect(current().tags).not.toContain('bon-hidden');
    expect(current().tags).toContain('routine');
    expect(data.get(sleepTagStateKey('inbox-real'))).toEqual({});
  });

  it('中断 phase 恢复：adding 状态下重试应继续标记为 added，restoring 下重试应完成移除', async () => {
    const { api, current } = client(task({ tags: ['居'] }));
    const journalKey = sleepTagStateKey('inbox-real');

    // 场景 A: 隐藏过程中断 (phase: adding)
    data.set(journalKey, { 'night': { projectId: 'inbox-real', phase: 'adding', addedOn: '2026-10-04' } });
    await syncNightRoutineVisibility(api, { now: at('20:00:00'), projectId: 'inbox-real' });
    expect(current().tags).toContain('bon-hidden');
    expect((data.get(journalKey) as any)['night'].phase).toBe('added');

    // 场景 B: 显示过程中断 (phase: restoring)
    data.set(journalKey, { 'night': { projectId: 'inbox-real', phase: 'restoring', addedOn: '2026-10-04' } });
    await syncNightRoutineVisibility(api, { now: at('22:00:00'), projectId: 'inbox-real' });
    expect(current().tags).not.toContain('bon-hidden');
    expect(data.get(journalKey)).toEqual({});
  });
});

describe('所有定时任务按开始时间显隐', () => {
  const timed = task({ id: 'timed', title: '普通定时任务', tags: ['居'], priority: 3,
    startDate: '2026-10-04T20:30:00+08:00', dueDate: '2026-10-04T21:00:00+08:00' });
  it('开始前隐藏，到点显示；未来日期仍隐藏', () => {
    expect(timedTaskHidden(timed, at('20:29:59'))).toBe(true);
    expect(timedTaskHidden(timed, at('20:30:00'))).toBe(false);
    expect(timedTaskHidden({ ...timed, startDate: '2026-10-05T08:00:00+08:00' }, at('23:00:00'))).toBe(true);
  });
  it('全天、无具体时间、已完成和错误时间不处理，缺少开始时间时使用截止时间', () => {
    expect(timedTaskHidden({ ...timed, startDate: undefined, dueDate: '2026-10-04T20:30:00+08:00' }, at('20:29:59'))).toBe(true);
    for (const fields of [{ isAllDay: true }, { startDate: undefined, dueDate: undefined }, { status: 2 },
      { startDate: 'bad', dueDate: undefined }]) expect(timedTaskHidden({ ...timed, ...fields }, at('20:00:00'))).toBeNull();
  });
  it('同步所有定时任务，保留原字段且重复执行不重复写', async () => {
    const { api, current } = client(timed);
    expect(await syncTimedTaskVisibility(api, { now: at('20:00:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 1, hidden: 1 });
    expect(current().tags).toEqual(['居', 'bon-hidden']);
    expect(await syncTimedTaskVisibility(api, { now: at('20:30:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 1, visible: 1 });
    expect(current()).toEqual(timed);
  });
  it('应当保留原有的 routine 标签，即使任务已到显示时间', async () => {
    const original = { ...timed, tags: ['routine', '居'] };
    const { api, current } = client(original);
    expect(timedTaskHidden(original, at('20:30:00'))).toBe(false);
    await syncTimedTaskVisibility(api, { now: at('20:30:00'), projectId: 'inbox-real' });
    expect(current().tags).toContain('routine');
    expect(current().tags).not.toContain('bon-hidden');
  });
});

describe('洗头 20 点显隐', () => {
  const wash = (fields: Partial<TickTickTask> = {}) => task({ id: 'wash', title: ' 洗头 ', priority: 3,
    isAllDay: true, startDate: undefined, dueDate: undefined, tags: ['居'], ...fields });
  it.each([['00:00:00', true], ['05:00:00', true], ['19:59:59', true], ['20:00:00', false], ['23:59:59', false]])(
    '%s 按北京时间决定标签，不依赖任务时间或全天设置', (time, hidden) => {
      expect(hairWashHidden(wash(), at(time))).toBe(hidden);
      expect(hairWashHidden(wash({ timeZone: 'America/New_York' }), at(time))).toBe(hidden);
    },
  );
  it('只修改洗头任务，不影响带洗头标签的游泳和准备，也不修改已完成任务', async () => {
    for (const fields of [{ title: '下班准备游泳', tags: ['洗头'] }, { title: '买洗头用品' }, { status: 2 }]) {
      expect(hairWashHidden(wash(fields), at('20:00:00'))).toBeNull();
    }
    const { api } = client(wash({ title: '下班准备游泳', tags: ['洗头'] }));
    expect(await syncHairWashVisibility(api, { now: at('20:00:00'), projectId: 'inbox-real' })).toMatchObject({ matched: 0, updated: 0 });
  });
  it('20 点去掉标签，次日凌晨重新加上；保留洗头时间、优先级、重复和清单', async () => {
    const original = wash({ tags: ['居', '活'], repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2', repeatFrom: '0',
      startDate: '2026-10-04T13:30:00.000+0000', dueDate: '2026-10-04T13:30:00.000+0000', isAllDay: false,
      reminders: ['TRIGGER:PT0S'], items: [{ id: 'item', title: 'done', status: 1 }], parentId: 'parent' });
    const { api, current } = client(original);
    // 凌晨加上
    await syncHairWashVisibility(api, { now: at('05:00:00'), projectId: 'inbox-real' });
    expect(current().tags).toContain('bon-hidden');
    // 20 点移除
    expect(await syncHairWashVisibility(api, { now: at('20:00:00'), projectId: 'inbox-real' })).toMatchObject({ updated: 1, visible: 1 });
    expect(current().tags).toEqual(['居', '活']);
  });
});
