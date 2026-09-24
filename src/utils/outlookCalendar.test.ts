import { beforeEach, describe, expect, it } from 'vitest';
import { applyOutlookSnapshotToState, buildOutlookSnapshot, DEFAULT_OUTLOOK_RULES, normalizeOutlookCalendarState, reconcileOutlookSnapshot, type OutlookDayEvent } from './outlookCalendar';
import { useCalendarStore } from '../stores/calendarStore';
import { detectAllTrips } from './trips';

const start = '2026-09-01';
const end = '2026-10-01';
const event = (values: Partial<OutlookDayEvent> = {}): OutlookDayEvent => ({ calendar: 'play', title: '出游', startDate: '2026-09-22', endDate: '2026-09-23', allDay: true, ...values });
const snapshot = (events: OutlookDayEvent[]) => buildOutlookSnapshot(events, start, end, DEFAULT_OUTLOOK_RULES);

describe('Outlook 月历映射', () => {
  it.each([
    ['play', '寒假'], ['play', '暑假'], ['class', '寒假'], ['class', '暑假'],
  ] as const)('%s 日历的 %s 不标记出游或保留出游标题，旧连接规则同样生效', (calendar, title) => {
    const result = buildOutlookSnapshot([
      event({ calendar, title: ` ${title} `, startDate: '2026-07-01', endDate: '2026-09-01' }),
    ], '2026-07-01', '2026-09-01', { homeTitles: ['🏠'], ignoredPlayTitles: [] });
    expect(result.tags).toEqual({});
    expect(result.travelTitles).toEqual({});
  });

  it('假期不覆盖寄或班，不延长其中的具体旅行，标题含假期的旅行仍保留', () => {
    const result = snapshot([
      event({ title: '暑假', startDate: start, endDate: end }),
      event({ calendar: 'class', title: '寒假', startDate: start, endDate: end }),
      event({ title: '🏠', startDate: '2026-09-01', endDate: '2026-09-02' }),
      event({ calendar: 'class', title: '实习', startDate: '2026-09-02', endDate: '2026-09-03' }),
      event({ title: '平遥电影节', startDate: '2026-09-25', endDate: end }),
      event({ title: '寒假旅行' }),
      event({ title: '暑假旅行', startDate: '2026-09-23', endDate: '2026-09-24' }),
    ]);
    expect(result.tags).toEqual({
      '2026-09-01': 'home', '2026-09-02': 'intern', '2026-09-22': 'travel', '2026-09-23': 'travel',
      '2026-09-25': 'travel', '2026-09-26': 'travel', '2026-09-27': 'travel',
      '2026-09-28': 'travel', '2026-09-29': 'travel', '2026-09-30': 'travel',
    });
    expect(result.travelTitles).toEqual({
      '2026-09-22': '寒假旅行', '2026-09-23': '暑假旅行',
      '2026-09-25': '平遥电影节', '2026-09-26': '平遥电影节', '2026-09-27': '平遥电影节',
      '2026-09-28': '平遥电影节', '2026-09-29': '平遥电影节', '2026-09-30': '平遥电影节',
    });
  });

  it('重新同步撤销假期的旧出游标记和标题，恢复原场景', () => {
    const state = {
      tagMap: { '2026-09-01': 'travel', '2026-09-02': 'travel', '2026-09-03': 'travel' },
      outlookApplied: {
        '2026-09-01': { tag: 'travel', previousTag: 'home' },
        '2026-09-02': { tag: 'travel', previousTag: null },
        '2026-09-03': { tag: 'travel', previousTag: 'school' },
      },
      manualTagDates: { '2026-09-03': true },
      outlookTravelTitles: { '2026-09-01': '暑假', '2026-09-02': '暑假', '2026-09-03': '暑假' },
    };
    const nextSnapshot = snapshot([event({ title: '暑假', startDate: start, endDate: end })]);
    const result = applyOutlookSnapshotToState(state, nextSnapshot, 'manual');
    expect(result.tagMap).toEqual({ '2026-09-01': 'home', '2026-09-03': 'school' });
    expect(result.outlookApplied).toEqual({});
    expect(result.outlookTravelTitles).toEqual({});
    expect(applyOutlookSnapshotToState(result, nextSnapshot, 'manual')).toEqual(result);
  });

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
  it('北海道完整日期覆盖工作日周模板、寄、学和手动留空，两个周末合为一段', () => {
    const dates = Array.from({ length: 9 }, (_, index) => `2027-01-${23 + index}`);
    const current = {
      '2027-01-10': 'travel', '2027-01-23': 'travel', '2027-01-24': 'travel',
      '2027-01-25': 'intern', '2027-01-26': 'intern', '2027-01-27': 'home', '2027-01-28': 'school',
      '2027-01-30': 'travel', '2027-01-31': 'travel',
    } as const;
    const expected = { '2027-01-10': 'travel', ...Object.fromEntries(dates.map((day) => [day, 'travel'])) };
    const state = { tagMap: current, manualTagDates: Object.fromEntries(dates.map((day) => [day, true])) };
    const trip = buildOutlookSnapshot([event({ title: '北海道', startDate: '2027-01-23', endDate: '2027-02-01' })], '2027-01-01', '2027-03-01', DEFAULT_OUTLOOK_RULES);
    const result = applyOutlookSnapshotToState(state, trip, 'manual');
    expect(result.tagMap).toEqual(expected);
    expect(result.manualTagDates).toEqual({});
    expect(detectAllTrips(result.tagMap)).toEqual([
      { startDate: '2027-01-10', endDate: '2027-01-10', dates: ['2027-01-10'] },
      { startDate: '2027-01-23', endDate: '2027-01-31', dates },
    ]);
    expect(applyOutlookSnapshotToState(result, trip, 'manual')).toEqual(result);
    const shortened = buildOutlookSnapshot([event({ title: '北海道', startDate: '2027-01-25', endDate: '2027-01-30' })], '2027-01-01', '2027-03-01', DEFAULT_OUTLOOK_RULES);
    const next = applyOutlookSnapshotToState(result, shortened, 'manual');
    expect(Object.keys(next.tagMap).sort()).toEqual(['2027-01-10', ...dates.slice(2, 7)]);
    expect(detectAllTrips(next.tagMap)[1]).toEqual({ startDate: '2027-01-25', endDate: '2027-01-29', dates: dates.slice(2, 7) });
    const moved = buildOutlookSnapshot([event({ title: '北海道', startDate: '2027-02-05', endDate: '2027-02-07' })], '2027-01-01', '2027-03-01', DEFAULT_OUTLOOK_RULES);
    const final = applyOutlookSnapshotToState(next, moved, 'manual');
    expect(final.tagMap).toEqual({
      '2027-01-10': 'travel', '2027-01-25': 'intern', '2027-01-26': 'intern', '2027-01-27': 'home', '2027-01-28': 'school',
      '2027-02-05': 'travel', '2027-02-06': 'travel',
    });
    expect(final.outlookTravelTitles).toEqual({ '2027-02-05': '北海道', '2027-02-06': '北海道' });
  });
  it('行程内手动改班或清空后重新同步仍恢复游，改期后保留相应日常基线', () => {
    const store = useCalendarStore.getState();
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    store.setTag('2026-09-22', 'intern');
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('travel');
    store.applyOutlookSnapshot(snapshot([]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('intern');
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    store.removeTag('2026-09-22');
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('travel');
  });
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
  it('手动重复标游保留日程来源，取消 Outlook 行程会清理旧日期', () => {
    const store = useCalendarStore.getState();
    store.applyOutlookSnapshot(snapshot([event()]), 'manual');
    store.setTag('2026-09-22', 'travel');
    store.applyOutlookSnapshot(snapshot([]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBeUndefined();
    expect(useCalendarStore.getState().outlookApplied).toEqual({});
    expect(useCalendarStore.getState().manualTagDates).toEqual({});
  });
  it('日常标记手动清除不被补学或自动同步重新覆盖', () => {
    const store = useCalendarStore.getState();
    store.applyOutlookSnapshot(snapshot([event({ title: '🏠' })]), 'manual');
    store.removeTag('2026-09-22');
    store.bulkFillSchool('2026-09-22', '2026-09-22');
    store.applyOutlookSnapshot(snapshot([event({ title: '🏠' })]), 'manual');
    expect(useCalendarStore.getState().tagMap).toEqual({});
  });
  it('日常场景仍按设置保护手动标记，Outlook 优先可覆盖并恢复', () => {
    const store = useCalendarStore.getState();
    useCalendarStore.setState({ tagMap: { '2026-09-22': 'intern' } });
    store.applyOutlookSnapshot(snapshot([event({ title: '🏠' })]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('intern');
    store.setTag('2026-09-22', 'school');
    store.applyOutlookSnapshot(snapshot([event({ title: '🏠' })]), 'manual');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('school');
    store.applyOutlookSnapshot(snapshot([event({ title: '🏠' })]), 'outlook');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('home');
    store.applyOutlookSnapshot(snapshot([]), 'outlook');
    expect(useCalendarStore.getState().tagMap['2026-09-22']).toBe('school');
  });
  it('从旧备份加载不会继承另一个快照的来源信息', () => {
    expect(normalizeOutlookCalendarState({ tagMap: { '2026-09-22': 'home' } })).toEqual({ outlookApplied: {}, manualTagDates: {} });
    expect(normalizeOutlookCalendarState({ manualTagDates: { '2026-02-30': true }, outlookApplied: { bad: { tag: 'intern' } } }))
      .toEqual({ outlookApplied: {}, manualTagDates: {} });
  });
});
