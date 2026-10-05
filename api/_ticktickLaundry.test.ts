import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLaundryDay, isLaundryTask, laundryAnchor, laundryLocation, readLaundryForecast, syncLaundrySchedule,
  LAUNDRY_STATE_KEY, type LaundryForecast, type LaundryState, type LaundryWeather } from './_ticktickLaundry';
import type { ClothesDayContext } from '../src/clothes/types';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';
const { data, upstream } = vi.hoisted(() => ({ data: new Map<string, any>(), upstream: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => structuredClone(data.get(key) ?? null),
  hgetall: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } } }));
vi.mock('./_bonClothes.js', () => ({ CONTEXTS_KEY: 'contexts', upstream }));

const now = new Date('2026-10-05T16:00:00+08:00');
const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'wash', projectId: 'life', title: '洗衣服', status: 0,
  startDate: '2026-10-10T00:00:00Z', dueDate: '2026-10-10T00:00:00Z', timeZone: 'Asia/Shanghai',
  isAllDay: false, tags: ['居', '活'], priority: 5, repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=5', repeatFrom: '1', ...fields });
const history = [task({ id: 'history', status: 2, completedTime: '2026-10-05T03:56:45Z' })];
const state = (): LaundryState => ({ connectionId: 'connection', anchors: {} });
const sunny: LaundryWeather = { rain: 0, probability: 5, sunshine: 7 * 3600, code: 0 };
const wet: LaundryWeather = { rain: 3, probability: 80, sunshine: 3600, code: 61 };
const dates = Array.from({ length: 16 }, (_, i) => `2026-10-${String(i + 5).padStart(2, '0')}`);
const forecast = (weather = wet): LaundryForecast => ({ fetchedAt: now.toISOString(), days: Object.fromEntries(dates.map(date => [date, { ...weather }])) });
const options = (fields: Record<string, any> = {}) => ({ tasks: [task()], history,
  calendarState: { tagMap: Object.fromEntries(dates.map(date => [date, 'school'])) },
  availability: { startDate: '2026-10-05', endDate: '2026-11-01', events: [] }, today: '2026-10-05', now, ...fields });
const context = (date: string, name = '北京'): ClothesDayContext => ({ date, timezone: 'Asia/Shanghai', revision: '',
  location: { name, latitude: 40, longitude: 116.3, source: 'geo' }, scene: null, active: null, manualWeather: null });
function mockWeather(f = forecast()) {
  upstream.mockResolvedValue({ daily: { time: dates, precipitation_sum: dates.map(d => f.days[d].rain),
    precipitation_probability_max: dates.map(d => f.days[d].probability), sunshine_duration: dates.map(d => f.days[d].sunshine),
    weather_code: dates.map(d => f.days[d].code) } });
}
function client(original = task()) {
  let current = structuredClone(original);
  const api = { getTask: vi.fn(async () => structuredClone(current)), updateTask: vi.fn(async (_id, payload) => {
    current = { ...current, ...structuredClone(payload) }; return current;
  }) } as unknown as TickTickApi;
  return { api, current: () => current, change: (fields: Partial<TickTickTask>) => { current = { ...current, ...fields }; } };
}
beforeEach(() => { data.clear(); upstream.mockReset(); mockWeather(); data.set('contexts', { '2026-10-05': context('2026-10-05') }); });
afterEach(() => vi.restoreAllMocks());

describe('洗衣周期和地点', () => {
  it('完成后五天为目标，反复提前/推后不会移动窗口；新完成记录才开启下一周期', () => {
    const saved = state(), first = task();
    expect(laundryAnchor(first, [first], history, saved, now)?.target).toBe('2026-10-10');
    const early = task({ startDate: '2026-10-08T00:00:00Z', dueDate: '2026-10-08T00:00:00Z' });
    expect(laundryAnchor(early, [early], history, saved, now)?.target).toBe('2026-10-10');
    const next = task({ id: 'next', startDate: '2026-10-13T00:00:00Z', dueDate: '2026-10-13T00:00:00Z' });
    expect(laundryAnchor(next, [next], [...history, task({ id: 'early-done', status: 2, completedTime: '2026-10-08T01:00:00Z' })], saved,
      new Date('2026-10-08T12:00:00+08:00'))?.target).toBe('2026-10-13');
    const noHistory = state();
    expect(laundryAnchor(first, [first], [], noHistory, now)?.target).toBe('2026-10-10');
    expect(laundryAnchor(early, [early], [], noHistory, now)?.target).toBe('2026-10-10');
  });
  it('使用真实周期，拒绝有限/未知/无日期规则及同名历史歧义', () => {
    expect(laundryAnchor(task({ repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=7' }), [task()], history, state(), now)?.target).toBe('2026-10-12');
    for (const repeatFlag of ['', 'RRULE:FREQ=HOURLY', 'RRULE:FREQ=DAILY;COUNT=5'])
      expect(laundryAnchor(task({ repeatFlag }), [task()], history, state(), now)).toBeNull();
    expect(laundryAnchor(task({ startDate: undefined, dueDate: undefined }), [task()], history, state(), now)).toBeNull();
    const ambiguous = task({ dueDate: '2026-10-15T00:00:00Z' });
    expect(laundryAnchor(ambiguous, [ambiguous, task({ id: 'same-name' })], history, state(), now)?.target).toBe('2026-10-15');
    expect(isLaundryTask(task({ title: '买洗衣凝珠' }))).toBe(false);
    expect(isLaundryTask(task({ tags: ['不关我事'] }))).toBe(false);
  });
  it('居和实习沿用同场景位置，不能拿旅游目的地或过旧位置猜天气', () => {
    const calendar = { tagMap: { '2026-10-05': 'school', '2026-10-07': 'travel', '2026-10-10': 'intern', '2026-10-12': 'home' } };
    const contexts = [context('2026-10-05'), context('2026-10-07', '杭州')];
    expect(laundryLocation('2026-10-10', calendar, contexts)?.name).toBe('北京');
    expect(laundryLocation('2026-10-12', calendar, contexts)).toBeNull();
    expect(laundryLocation('2026-11-10', { tagMap: { ...calendar.tagMap, '2026-11-10': 'school' } }, contexts)).toBeNull();
    expect(laundryLocation('2026-10-12', calendar, [...contexts, context('2026-10-12', '家')])?.name).toBe('家');
  });
});

describe('天气与日程选日', () => {
  it('在前后两天内选连续晴天，前一天也晴时更优，绝不越界追晴天', () => {
    const f = forecast();
    for (const date of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-11', '2026-10-12', '2026-10-13']) f.days[date] = sunny;
    expect(chooseLaundryDay(task(), '2026-10-10', options(), () => f)).toBe('2026-10-08');
    expect(chooseLaundryDay(task(), '2026-10-10', options(), () => forecast(sunny))).toBe('2026-10-10');
  });
  it('寄居旅优先：有晴天但旅行不选；固定08点会议冲突也不选', () => {
    const f = forecast(), o = options();
    for (const date of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) f.days[date] = sunny;
    o.calendarState.tagMap['2026-10-11'] = 'travel'; o.calendarState.tagMap['2026-10-12'] = 'travel';
    o.availability.events.push({ start: '2026-10-10T07:00:00+08:00', end: '2026-10-10T09:00:00+08:00', title: '会议' });
    const selected = chooseLaundryDay(task(), '2026-10-10', o, () => f);
    expect(['2026-10-08', '2026-10-09']).toContain(selected);
  });
  it('重要事项负担/整天空闲不足排除，即使天气最佳', () => {
    const f = forecast(sunny), o = options();
    o.availability.events.push({ start: '2026-10-10T00:00:00+08:00', end: '2026-10-11T00:00:00+08:00', title: '全天外出' });
    expect(chooseLaundryDay(task(), '2026-10-10', o, () => f)).not.toBe('2026-10-10');
    const busy = task({ id: 'important', title: '重要事项 480分钟', isAllDay: true, repeatFlag: undefined });
    expect(chooseLaundryDay(task(), '2026-10-10', options({ tasks: [task(), busy, { ...busy, id: 'important-2' }] }), () => f)).not.toBe('2026-10-10');
  });
  it('只考虑剩余时间；过了08点不把定时待办排回今天；窗口过期不无限滚动', () => {
    expect(chooseLaundryDay(task(), '2026-10-05', options(), () => forecast(sunny))).toBe('2026-10-06');
    expect(chooseLaundryDay(task(), '2026-10-01', options(), () => forecast(sunny))).toBeNull();
  });
  it('天气缺失、过期或没有日程时保留原排期；阴雨不会被当晴天', () => {
    const f = forecast(); delete f.days['2026-10-09'];
    expect(chooseLaundryDay(task(), '2026-10-10', options(), () => f)).toBeNull();
    expect(chooseLaundryDay(task(), '2026-10-10', options(), () => ({ ...forecast(), fetchedAt: '2026-10-04T00:00:00Z' }))).toBeNull();
    expect(chooseLaundryDay(task(), '2026-10-10', options({ availability: undefined }), () => forecast())).toBeNull();
    const rainy = forecast(); rainy.days['2026-10-09'] = { ...wet, rain: 0.5, probability: 50 };
    rainy.days['2026-10-10'] = { ...wet, rain: 0.5, probability: 50 };
    expect(chooseLaundryDay(task(), '2026-10-10', options(), () => rainy)).toBe('2026-10-09');
  });
});

describe('洗衣同步与天气故障', () => {
  it('只改日期，回读保留时刻/重复/优先级/标签/清单；先存锚点，再次执行幂等', async () => {
    const original = task({ items: [{ id: 'pending', title: '晾衣', status: 0, startDate: '2026-10-10T02:00:00Z' },
      { id: 'done', title: '洗衣液', status: 1, startDate: '2026-10-01T00:00:00Z', completedTime: '2026-10-01T01:00:00Z' }] });
    const f = forecast(); for (const day of ['2026-10-07', '2026-10-08', '2026-10-09']) f.days[day] = sunny; mockWeather(f);
    const c = client(original);
    const result = await syncLaundrySchedule(c.api, { ...options({ tasks: [original] }), connectionId: 'connection' });
    expect(result.updated).toBe(1); expect(result.managedTaskIds.has('wash')).toBe(true);
    expect(c.current()).toMatchObject({ startDate: '2026-10-08T00:00:00Z', dueDate: '2026-10-08T00:00:00Z',
      repeatFlag: original.repeatFlag, repeatFrom: original.repeatFrom, priority: 5, tags: original.tags, status: 0,
      items: [{ startDate: '2026-10-08T02:00:00Z' }, original.items![1]] });
    expect(data.get(LAUNDRY_STATE_KEY).anchors.wash.target).toBe('2026-10-10');
    expect(c.api.updateTask).toHaveBeenCalledWith('wash', expect.not.objectContaining({ status: expect.anything() }));
    const again = await syncLaundrySchedule(c.api, { ...options({ tasks: [c.current()] }), connectionId: 'connection' });
    expect(again.updated).toBe(0); expect(upstream).toHaveBeenCalledOnce();
  });
  it('天气服务失败、无地点时仍保护洗衣日期，不影响其他任务；模板和完成任务不写', async () => {
    const c = client(); upstream.mockRejectedValue(new Error('weather unavailable'));
    expect((await syncLaundrySchedule(c.api, { ...options(), connectionId: 'connection' })).updated).toBe(0);
    expect(c.api.updateTask).not.toHaveBeenCalled(); expect(upstream).toHaveBeenCalledOnce();
    data.delete('contexts');
    expect((await syncLaundrySchedule(c.api, { ...options(), connectionId: 'connection' })).managedTaskIds.has('wash')).toBe(true);
    expect((await syncLaundrySchedule(c.api, { ...options(), connectionId: 'connection', excludedTaskIds: new Set(['wash']) })).managedTaskIds.size).toBe(0);
    expect((await syncLaundrySchedule(c.api, { ...options({ tasks: [task({ status: 2 })] }), connectionId: 'connection' })).updated).toBe(0);
  });
  it('用户在查天气期间完成/改期时不覆盖，也不误报已安排新日期', async () => {
    const c = client(); c.change({ status: 2, completedTime: now.toISOString() });
    const result = await syncLaundrySchedule(c.api, { ...options(), connectionId: 'connection' });
    expect(result.updated).toBe(0); expect(result.decisions[0].date).toBeUndefined();
    expect(c.api.updateTask).not.toHaveBeenCalled();
  });
  it('写入失败保留原周期；回读发现重复规则丢失则报错，不宣称同步成功', async () => {
    const f = forecast(); for (const day of ['2026-10-07', '2026-10-08', '2026-10-09']) f.days[day] = sunny; mockWeather(f);
    const c = client(); vi.mocked(c.api.updateTask).mockRejectedValueOnce(new Error('write failed'));
    await expect(syncLaundrySchedule(c.api, { ...options(), connectionId: 'connection' })).rejects.toThrow('write failed');
    expect(data.get(LAUNDRY_STATE_KEY).anchors.wash.target).toBe('2026-10-10');
    vi.mocked(c.api.updateTask).mockImplementationOnce(async () => {
      c.change({ startDate: '2026-10-08T00:00:00Z', dueDate: '2026-10-08T00:00:00Z', repeatFlag: undefined }); return c.current();
    });
    await expect(syncLaundrySchedule(c.api, { ...options(), connectionId: 'connection' })).rejects.toThrow('未正确保存');
  });
  it('不拿过期缓存改期，不把不完整返回的 null 当0毫米降水', async () => {
    const loc = context('2026-10-05').location!;
    await readLaundryForecast(loc, '2026-10-05', now);
    upstream.mockRejectedValueOnce(new Error('offline'));
    await expect(readLaundryForecast(loc, '2026-10-05', new Date(now.getTime() + 4 * 3600_000))).rejects.toThrow('offline');
    data.clear(); upstream.mockResolvedValue({ daily: { time: dates, precipitation_sum: dates.map(() => null) } });
    await expect(readLaundryForecast(loc, '2026-10-05', now)).rejects.toThrow('不完整');
  });
});
