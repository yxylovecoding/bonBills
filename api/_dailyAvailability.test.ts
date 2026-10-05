import { describe, expect, it } from 'vitest';
import { dayAvailability, freeSlots, occupySlots, slotMinutes } from './_dailyAvailability';
import { estimateTaskMinutes, planTickTickDay, type DailyPlanState } from './_ticktickDailyPlan';
import type { TickTickTask } from './_ticktickTrips';
import type { OutlookAvailability } from '../src/utils/outlookCalendar';

const today = '2026-10-04';
const at = (hour: number, day = today) => `${day}T${String(hour).padStart(2, '0')}:00:00+08:00`;
const task = (id: string, fields: Partial<TickTickTask> = {}): TickTickTask => ({ id, projectId: 'inbox', title: id,
  status: 0, isAllDay: true, startDate: at(0), dueDate: at(0), ...fields });
const event = (start: number, end: number, title = '课程', day = today) => ({ title, start: at(start, day), end: at(end, day) });
const calendar = (events: OutlookAvailability['events'] = []): OutlookAvailability => ({ startDate: today, endDate: '2026-11-04', events });
const free = (overrides: Partial<Parameters<typeof dayAvailability>[0]> = {}) => dayAvailability({ calendar: calendar(), day: today, today,
  now: new Date(at(9)), tasks: [], fixed: [], completed: [], estimate: estimateTaskMinutes, ...overrides });
const state = (history: TickTickTask[] = []): DailyPlanState => ({ connectionId: 'same', deadlines: {}, history });
const plan = (tasks: TickTickTask[], overrides: Partial<Parameters<typeof planTickTickDay>[0]> = {}) => planTickTickDay({
  tasks, calendarState: {}, today, now: new Date(at(9)), state: state(), availability: calendar(), ...overrides });

describe('Outlook 实际空档', () => {
  it('明细区分距午夜、排期时段与日程占用，重叠和进行中的日程只扣一次', () => {
    const result = free({ now: new Date(`${today}T20:30:00+08:00`),
      calendar: calendar([event(20, 21, '阅读'), event(20, 21, '阅读')]),
      tasks: [task('reading', { title: '阅读', priority: 5, content: '(1h)' })] });
    expect(result.breakdown).toMatchObject({ clockRemainingMinutes: 210, windowMinutes: 90,
      occupiedMinutes: 30, freeMinutes: 60, importantAdditionalMinutes: 0,
      afterReservationsMinutes: 60, bufferMinutes: 30, allocationRatio: 0.5 });
    expect(result.breakdown.importantReservations).toHaveLength(1);
    expect(result.breakdown.importantReservations[0].additionalMinutes).toBe(0);
    expect(result.remainingMinutes).toBe(30);
  });
  it('重要及固定任务另行预留的明细与实际剩余额度一致，已错过的日程仍需预留', () => {
    const important = task('important', { title: '准备材料', priority: 5, content: '(30m)' });
    const fixed = task('fixed', { content: '(10m)' });
    const result = free({ now: new Date(at(20)), calendar: calendar([event(10, 11, important.title)]),
      tasks: [important, fixed], fixed: [fixed] });
    expect(result.breakdown).toMatchObject({ clockRemainingMinutes: 240, windowMinutes: 120,
      freeMinutes: 120, importantAdditionalMinutes: 30, fixedAdditionalMinutes: 10,
      afterReservationsMinutes: 80, bufferMinutes: 40 });
    expect(result.remainingMinutes).toBe(40);
  });
  it('重叠日程合并，午晚饭不重复扣，保留休息后动态超过旧 30 分钟上限', () => {
    expect(free().totalMinutes).toBe(330);
    // 09–12 and 13–14 are occupied. Lunch 12–13 was already excluded.
    expect(free({ calendar: calendar([event(9, 13), event(10, 14), event(9, 13)]) }).totalMinutes).toBe(210);
    expect(free({ scene: 'intern' }).totalMinutes).toBe(90);
    expect(free({ scene: 'travel' }).totalMinutes).toBe(90);
    expect(free({ profile: 'evening' }).totalMinutes).toBe(90);
  });
  it('Outlook 与 TickTick 的同名唯一事项只计一次，歧义不猜配', () => {
    const important = task('reading', { title: '阅读', priority: 5 });
    const timed = task('training', { title: '训练', priority: 5, isAllDay: false, startDate: at(10), dueDate: at(11) });
    const cal = calendar([event(9, 10, '阅读'), event(10, 11, '训练')]);
    expect(free({ calendar: cal, tasks: [important, timed] }).totalMinutes).toBe(free({ calendar: cal }).totalMinutes);
    expect(free({ calendar: cal, tasks: [important, { ...important, id: 'another' }] }).totalMinutes).toBe(255);
  });
  it('当天已过去的时间不能再安排，晚上仍未完成的重要事项优先占用', () => {
    expect(free({ now: new Date(at(21)) }).remainingMinutes).toBe(30);
    expect(free({ now: new Date(at(21)), tasks: [task('important', { priority: 5, title: '重要事项 45分钟' })] }).remainingMinutes).toBe(7);
    expect(free({ now: new Date(at(23)) }).remainingMinutes).toBe(0);
  });
  it.each([[5, 210], [12, 180], [17, 90], [20, 30]])('在 %i 点只使用剩余空档，日程重叠部分不重复扣', (hour, minutes) => {
    const result = free({ now: new Date(at(hour)), calendar: calendar([event(9, 11), event(13, 14), event(20, 21)]) });
    expect(result.remainingMinutes).toBe(minutes);
    expect(result.slots.every(([start]) => start >= Date.parse(at(hour)))).toBe(true);
  });
  it('上午约定已经过去但任务未完成，晚上仍要为它留时间', () => {
    const important = task('reading', { title: '阅读 45分钟', priority: 5 });
    expect(free({ now: new Date(at(20)), calendar: calendar([event(9, 10, important.title)]),
      tasks: [important] }).remainingMinutes).toBe(37);
    expect(free({ now: new Date(at(20)), tasks: [task('timed', { priority: 5, isAllDay: false,
      startDate: at(9), dueDate: at(10) })] }).remainingMinutes).toBe(30);
  });
  it('正在进行的约定只占剩余部分，未来日期仍按完整一天参与周期分配', () => {
    const result = free({ now: new Date(`${today}T20:30:00+08:00`), calendar: calendar([event(20, 21, '阅读')]),
      tasks: [task('reading', { title: '阅读', priority: 5 })] });
    expect(result.remainingMinutes).toBe(30);
    expect(free({ now: new Date(at(20)), day: '2026-10-05' }).remainingMinutes).toBe(330);
  });
  it('已完成任务若已在日历中占用时间，不再扣一次；未记在日历的完成量仍占额度', () => {
    const done = task('done', { title: '阅读', status: 2, completedTime: at(10) });
    expect(free({ calendar: calendar([event(9, 10, '阅读')]), completed: [done] }).completedMinutes).toBe(0);
    expect(free({ completed: [done] }).completedMinutes).toBe(15);
  });
  it('跨午夜占用与连续空档正确裁剪', () => {
    expect(free({ calendar: calendar([{ title: '行程', start: '2026-10-03T23:00:00+08:00', end: at(10) }]) }).totalMinutes).toBe(300);
    const slots = freeSlots([[0, 120 * 60_000]], [[30 * 60_000, 60 * 60_000], [90 * 60_000, 120 * 60_000]]);
    expect(slotMinutes(slots)).toBe(60);
    expect(occupySlots(slots, 45)).toBe(false);
  });
});

describe('根据日历安排普通待办', () => {
  it('保存同次排期明细、日上限扣减、所选任务与估时来源，读取不需要重新推断', () => {
    const s = state([task('done', { content: '(45m)', status: 2, completedTime: at(10) })]);
    const result = plan([task('short', { title: '小任务', content: '（1m）' })], { state: s,
      now: new Date(at(20)), budgetMinutes: 60 });
    expect(s.briefing).toMatchObject({ date: today, generatedAt: new Date(at(20)).toISOString(),
      selected: [{ id: 'short', minutes: 1, durationBasis: '待办描述中的时长标注' }],
      breakdown: { afterBufferMinutes: 60, completedTodayMinutes: 45, dailyLimitMinutes: 60,
        dailyLimitReductionMinutes: 45, newTaskCapacityMinutes: 15 } });
    expect(s.briefing!.selected.reduce((sum, task) => sum + task.minutes, 0)).toBe(result.summary.plannedMinutes);
    expect(s.briefing!.selected).toHaveLength(result.summary.todayCount);
    expect(s.briefing!.selected[0].reasons.join('；')).toContain('可放入剩余空档');
  });
  it('四次执行逐次缩减未完成任务，摘要与实际剩余容量一致', () => {
    let tasks = Array.from({ length: 30 }, (_, i) => task(String(i), { repeatFlag: 'RRULE:FREQ=WEEKLY' }));
    const s = state();
    for (const [hour, minutes, count] of [[5, 330, 22], [12, 240, 16], [17, 120, 8], [20, 60, 4], [23, 0, 0]]) {
      const result = plan(tasks, { state: s, now: new Date(at(hour)) });
      expect(result.summary).toMatchObject({ availableMinutes: minutes, plannedMinutes: minutes, todayCount: count });
      tasks = tasks.map(t => ({ ...t, startDate: at(0, result.dates.get(t.id)), dueDate: at(0, result.dates.get(t.id)) }));
    }
  });
  it('延迟执行按实际时刻计算，上午完成的任务不能恢复已经过去的时间', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => task(String(i)));
    const history = Array.from({ length: 10 }, (_, i) => task(`done${i}`, { status: 2, completedTime: at(10) }));
    const result = plan(tasks, { now: new Date(`${today}T20:45:00+08:00`), state: state(history) });
    expect(result.summary).toMatchObject({ availableMinutes: 37, plannedMinutes: 30, todayCount: 2 });
  });
  it('设置手动每日上限时也受剩余时间约束，上限不会在每次执行时重置', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => task(String(i)));
    for (const availability of [calendar(), undefined]) {
      expect(plan(tasks, { availability, now: new Date(at(21)), budgetMinutes: 240 }).summary.availableMinutes).toBe(30);
      expect(plan(tasks, { availability, now: new Date(at(23)), budgetMinutes: 240 }).summary.todayCount).toBe(0);
      const history = [task('done', { title: '任务 45分钟', status: 2, completedTime: at(10) })];
      expect(plan(tasks, { availability, now: new Date(at(20)), budgetMinutes: 60, state: state(history) })
        .summary.availableMinutes).toBe(15);
    }
  });
  it('空闲日增加，繁忙日减少，场景限制始终保留', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(String(i), { repeatFlag: 'RRULE:FREQ=WEEKLY' }));
    const quiet = plan(tasks);
    const busy = plan(tasks, { availability: calendar([event(9, 20)]) });
    expect(quiet.summary.plannedMinutes).toBeGreaterThan(30);
    expect(busy.summary.plannedMinutes).toBeLessThan(quiet.summary.plannedMinutes);
    expect(busy.summary.plannedMinutes).toBeLessThanOrEqual(60);
    const scene = plan([task('home', { tags: ['寄'] })], { calendarState: { tagMap: { [today]: 'school', '2026-10-05': 'home' } } });
    expect(scene.dates.get('home')).toBe('2026-10-05');
  });
  it('总分钟足够但没有连续长空档时，长任务不塞进今日', () => {
    const busy = [event(9, 10), event(11, 12), event(13, 14), event(15, 16), event(17, 18), event(19, 20), event(21, 22)];
    const result = plan([task('long', { title: '电影' }), task('small', { title: '喷雾' })], { availability: calendar(busy) });
    expect(result.dates.get('long')).toBe('2026-10-05');
    expect(result.dates.get('small')).toBe(today);
  });
  it('同周期未来越忙，今天应分担越多；反复同步结果稳定', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(String(i), { repeatFlag: 'RRULE:FREQ=WEEKLY' }));
    const history = tasks.map(t => ({ ...t, status: 2, completedTime: '2026-10-01T09:00:00+08:00' }));
    const quiet = plan(tasks, { state: state(history) });
    const s = state(history);
    const availability = calendar(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map(day => event(9, 22, '满课', day)));
    const busy = plan(tasks, { state: s, availability });
    expect(busy.summary.todayCount).toBeGreaterThan(quiet.summary.todayCount);
    const moved = tasks.map(t => ({ ...t, startDate: at(0, busy.dates.get(t.id)), dueDate: at(0, busy.dates.get(t.id)) }));
    expect(plan(moved, { state: s, availability })).toEqual(busy);
  });
  it('完成后的额度不会无限回填，手动上限可选，范围不足则不猜空闲', () => {
    const history = Array.from({ length: 22 }, (_, i) => task(`done${i}`, { status: 2, completedTime: at(10) }));
    expect(plan([task('new')], { state: state(history) }).summary.todayCount).toBe(0);
    expect(plan(Array.from({ length: 10 }, (_, i) => task(String(i))), { budgetMinutes: 30 }).summary.plannedMinutes).toBe(30);
    expect(() => plan([task('new')], { availability: { ...calendar(), endDate: today } })).toThrow('范围不足');
  });
});
