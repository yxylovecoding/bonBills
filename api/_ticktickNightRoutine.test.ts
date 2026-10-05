import { describe, expect, it, vi } from 'vitest';
import { hairWashHidden, nightRoutineHidden, readingHidden, syncHairWashVisibility, syncNightRoutineVisibility,
  syncReadingVisibility } from './_ticktickNightRoutine';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';

const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'night', projectId: 'inbox-real', title: '夜间routine ',
  status: 0, isAllDay: false, startDate: '2026-10-04T14:00:00.000+0000', dueDate: '2026-10-04T14:00:00.000+0000',
  timeZone: 'Asia/Shanghai', repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1', repeatFrom: '1',
  tags: ['routine', '居', '活'], priority: 5, ...fields });
const at = (value: string) => new Date(`2026-10-04T${value}+08:00`);

describe('阅读按晚间窗口切换 routine', () => {
  const reading = task({ title: '而阅读📖是另一个🪝', content: '(15m)', priority: 3 });
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
    expect(await syncReadingVisibility(api, { now: at('20:00:00') })).toMatchObject({ updated: 1, visible: 1 });
    expect(current()).toEqual({ ...reading, tags: ['居', '活'] });
    expect(await syncReadingVisibility(api, { now: new Date('2026-10-05T00:00:00+08:00') })).toMatchObject({ updated: 0, visible: 1 });
    expect(await syncReadingVisibility(api, { now: new Date('2026-10-05T05:00:00+08:00') })).toMatchObject({ updated: 1, hidden: 1 });
    expect(current()).toEqual({ ...reading, tags: ['居', '活', 'routine'] });
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
    expect(await syncNightRoutineVisibility(api, { now: at('20:00:00') })).toMatchObject({ updated: 1, hidden: 1 });
    expect(current().priority).toBe(5);
    expect(current().tags).toEqual(['居', '活', 'routine']);
  });
  it('读取真实收集箱，切换标签但保留优先级、场景、提醒、重复及 checklist；重复执行不重复写', async () => {
    const original = task({ content: 'existing content', reminders: ['TRIGGER:PT0S'], items: [{ id: 'item', title: 'item', status: 1 }] });
    const { api, current } = client(original);
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00') })).toMatchObject({ updated: 1, visible: 1 });
    expect(current()).toEqual({ ...original, tags: ['居', '活'] });
    expect(api.updateTask.mock.calls[0][1]).not.toHaveProperty('status');
    expect(await syncNightRoutineVisibility(api, { now: at('23:00:00') })).toMatchObject({ updated: 0, visible: 1 });
    expect(api.updateTask).toHaveBeenCalledTimes(1);
    expect(await syncNightRoutineVisibility(api, { now: new Date('2026-10-05T05:00:00+08:00') })).toMatchObject({ updated: 1, hidden: 1 });
    expect(current()).toEqual({ ...original, tags: ['居', '活', 'routine'] });
  });
  it('列表之后被改时间或完成的任务以回读值为准，完整同步复用已有列表', async () => {
    const { api } = client(task({ startDate: '2026-10-04T23:00:00+08:00' }));
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), tasks: [task()] })).toMatchObject({ hidden: 1, updated: 0 });
    expect(api.filterTasks).not.toHaveBeenCalled();
    expect(api.getProjectData).not.toHaveBeenCalled();
    api.getTask.mockResolvedValue(task({ status: 2 }));
    expect(await syncNightRoutineVisibility(api, { now: at('22:00:00'), tasks: [task()] })).toMatchObject({ matched: 0, skipped: 1 });
    expect(api.updateTask).not.toHaveBeenCalled();
  });
  it('没有匹配任务不修改其他任务，读失败或标签未保存就报错', async () => {
    const { api } = client(task({ title: '其他任务' }));
    expect(await syncNightRoutineVisibility(api)).toMatchObject({ matched: 0, updated: 0 });
    expect(api.updateTask).not.toHaveBeenCalled();
    api.getProjectData.mockRejectedValueOnce(new Error('offline'));
    await expect(syncNightRoutineVisibility(api)).rejects.toThrow('offline');
    api.getTask.mockResolvedValue(task());
    await expect(syncNightRoutineVisibility(api, { tasks: [task()], now: at('22:00:00') })).rejects.toThrow('未保存');
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
    expect(await syncHairWashVisibility(api, { now: at('20:00:00') })).toMatchObject({ matched: 0, updated: 0 });
    expect(api.updateTask).not.toHaveBeenCalled();
  });
  it('20 点去掉标签，次日凌晨重新加上；保留洗头时间、优先级、重复和清单', async () => {
    const original = wash({ tags: ['routine', '居', '活'], repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2', repeatFrom: '0',
      startDate: '2026-10-04T13:30:00.000+0000', dueDate: '2026-10-04T13:30:00.000+0000', isAllDay: false,
      reminders: ['TRIGGER:PT0S'], items: [{ id: 'item', title: 'done', status: 1 }], parentId: 'parent' });
    const { api, current } = client(original);
    expect(await syncHairWashVisibility(api, { now: at('20:00:00') })).toMatchObject({ updated: 1, visible: 1 });
    expect(current()).toEqual({ ...original, tags: ['居', '活'] });
    expect(await syncHairWashVisibility(api, { now: at('20:00:01') })).toMatchObject({ updated: 0 });
    expect(await syncHairWashVisibility(api, { now: new Date('2026-10-05T00:00:00+0800') })).toMatchObject({ updated: 1, hidden: 1 });
    expect(current()).toEqual({ ...original, tags: ['居', '活', 'routine'] });
    for (const [, payload] of api.updateTask.mock.calls) expect(payload).not.toHaveProperty('status');
  });
});
