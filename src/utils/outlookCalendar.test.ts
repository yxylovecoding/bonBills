import { beforeEach, describe, expect, it } from 'vitest';
import { buildOutlookSnapshot, DEFAULT_OUTLOOK_RULES, normalizeOutlookCalendarState, reconcileOutlookSnapshot, type OutlookDayEvent } from './outlookCalendar';
import { useCalendarStore } from '../stores/calendarStore';

const start = '2026-09-01';
const end = '2026-10-01';
const event = (values: Partial<OutlookDayEvent> = {}): OutlookDayEvent => ({ calendar: 'play', title: '出游', startDate: '2026-09-22', endDate: '2026-09-23', allDay: true, ...values });
const snapshot = (events: OutlookDayEvent[]) => buildOutlookSnapshot(events, start, end, DEFAULT_OUTLOOK_RULES);

describe('Outlook 月历映射', () => {
  it('识别在家、玩和课的全天出行、实习，忽略节日提醒、新卡池和非全天日程', () => {
    expect(snapshot([
      event({ title: '🏠', startDate: '2026-08-30', endDate: '2026-09-03' }),
      event({ title: '新卡池', startDate: '2026-09-03', endDate: '2026-09-04' }),
      event({ calendar: 'class', title: '上海出差', startDate: '2026-09-10', endDate: '2026-09-11' }),
      event({ calendar: 'class', title: '普通课程', allDay: false, startDate: '2026-09-12', endDate: '2026-09-13' }),
      event({ calendar: 'class', title: '教师节', startDate: '2026-09-14', endDate: '2026-09-15' }),
      event({ calendar: 'class', title: '平遥电影节', startDate: '2026-09-15', endDate: '2026-09-16' }),
      event({ calendar: 'class', title: ' 实习 ', startDate: '2026-09-20', endDate: '2026-09-21' }),
      event(), event({ allDay: false, startDate: '2026-09-25', endDate: '2026-09-26' }),
      event({ cancelled: true, startDate: '2026-09-27', endDate: '2026-09-28' }),
    ]).tags).toEqual({ '2026-09-01': 'home', '2026-09-02': 'home', '2026-09-10': 'travel', '2026-09-15': 'travel', '2026-09-20': 'intern', '2026-09-22': 'travel' });
  });
  it('跨月、跨年与闰年按日期展开，不包含结束日', () => {
    expect(buildOutlookSnapshot([event({ startDate: '2028-02-28', endDate: '2028-03-02' })], '2028-02-01', '2028-03-01', DEFAULT_OUTLOOK_RULES).tags)
      .toEqual({ '2028-02-28': 'travel', '2028-02-29': 'travel' });
    expect(buildOutlookSnapshot([event({ startDate: '2026-12-31', endDate: '2027-01-02' })], '2026-12-01', '2027-02-01', DEFAULT_OUTLOOK_RULES).tags)
      .toEqual({ '2026-12-31': 'travel', '2027-01-01': 'travel' });
  });
  it('重复条目不多算；冲突先出游，再在家，再实习，与输入顺序无关', () => {
    const values = [event(), event({ title: '🏠' }), event({ calendar: 'class', title: '实习' }), event()];
    expect(snapshot(values).tags).toEqual({ '2026-09-22': 'travel' });
    expect(snapshot(values.reverse()).tags).toEqual({ '2026-09-22': 'travel' });
  });
  it('无效日期和过大的窗口报错，避免写入部分结果', () => {
    expect(() => snapshot([event({ startDate: '2026-02-30' })])).toThrow();
    expect(() => buildOutlookSnapshot([], start, '2030-01-01', DEFAULT_OUTLOOK_RULES)).toThrow();
  });
});

describe('Outlook 标记来源与手动修改', () => {
  beforeEach(() => useCalendarStore.setState({ tagMap: {}, outlookApplied: {}, manualTagDates: {}, confirmedExpenses: {} }));
  it('自动标记替换学；改期后恢复原标记，窗口外日期保持不变', () => {
    const first = reconcileOutlookSnapshot({ '2026-09-22': 'school', '2026-08-22': 'home' }, {}, {}, snapshot([event()]), 'manual');
    const second = reconcileOutlookSnapshot(first.tagMap, first.outlookApplied, first.manualTagDates,
      snapshot([event({ startDate: '2026-09-23', endDate: '2026-09-24' })]), 'manual');
    expect(second.tagMap).toEqual({ '2026-09-22': 'school', '2026-08-22': 'home', '2026-09-23': 'travel' });
    expect(second.outlookApplied).toEqual({ '2026-09-23': { tag: 'travel', previousTag: null } });
    expect(reconcileOutlookSnapshot(second.tagMap, second.outlookApplied, second.manualTagDates, snapshot([]), 'manual').tagMap)
      .toEqual({ '2026-09-22': 'school', '2026-08-22': 'home' });
  });
  it('同一结果多次同步保留最初标签，取消后恢复', () => {
    const store = useCalendarStore.getState();
    useCalendarStore.setState({ tagMap: { '2026-09-22': 'home' } });
    store.applyOutlookSnapshot(snapshot([event()]), 'outlook');
    store.applyOutlookSnapshot(snapshot([event()]), 'outlook');
    store.applyOutlookSnapshot(snapshot([]), 'outlook');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('home');
  });
  it('手动点击相同标签也解除自动接管，取消日程不会清除手动结果', () => {
    const store = useCalendarStore.getState();
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    store.setTag('2026-09-22', 'travel');
    store.applyOutlookSnapshot(snapshot([]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('travel');
    expect(useCalendarStore.getState().outlookApplied).toEqual({});
  });
  it('手动清除不被补学或自动同步重新覆盖', () => {
    const store = useCalendarStore.getState();
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    store.removeTag('2026-09-22');
    store.bulkFillSchool('2026-09-22', '2026-09-22');
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    expect(useCalendarStore.getState().tagMap).toEqual({});
  });
  it('首次保护旧非学标记，明确手填学也保留；Outlook 优先可覆盖并恢复', () => {
    const store = useCalendarStore.getState();
    useCalendarStore.setState({ tagMap: { '2026-09-22': 'intern' } });
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('intern');
    store.setTag('2026-09-22', 'school');
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('school');
    store.applyOutlookSnapshot(snapshot([event()]), 'outlook');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('travel');
    store.applyOutlookSnapshot(snapshot([]), 'outlook');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('school');
  });
  it('从旧备份加载不会继承另一个快照的来源信息', () => {
    expect(normalizeOutlookCalendarState({ tagMap: { '2026-09-22': 'home' } })).toEqual({ outlookApplied: {}, manualTagDates: {} });
    expect(normalizeOutlookCalendarState({ manualTagDates: { '2026-02-30': true }, outlookApplied: { bad: { tag: 'intern' } } }))
      .toEqual({ outlookApplied: {}, manualTagDates: {} });
  });
});
