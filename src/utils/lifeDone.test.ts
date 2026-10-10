import { describe, expect, it } from 'vitest';
import type { DoneItem } from './bonLife';
import { classifyDoneCategory, computeDoneDurations, mergeDoneItems, doneWeekDates, doneWeekMonths, doneWeekNumber, earlierDoneWeeks, groupDoneCategories, groupDoneWeek, shiftDoneDate, splitDoneDays } from './lifeDone';

const item = (id: string, date: string, category?: DoneItem['category']): DoneItem => ({
  id, taskId: id, projectId: 'inbox', title: id, date, completedAt: `${date}T09:00:00Z`, category,
});

describe('完成记录的时长与跨来源去重', () => {
  const date = '2026-10-04';
  const event = (id: string, title: string, hour = '09', fields: Partial<DoneItem> = {}): DoneItem => ({
    ...item(id, date), source: 'outlook', title, startedAt: `${date}T${hour}:00:00Z`, completedAt: `${date}T${hour}:30:00Z`,
    durationMinutes: 30, durationBasis: 'outlook', ...fields,
  });
  it('按标注的 30m 与 1.5h 得到 1:3，勾选时间相同或相隔半天都不影响', () => {
    const a = { ...item('a', date), title: '阅读(30m)', completedAt: `${date}T00:00:00Z` };
    const b = { ...item('b', date), title: '学习(1.5h)', completedAt: `${date}T12:00:00Z` };
    expect([...computeDoneDurations([a, b])]).toEqual([['a', 30], ['b', 90]]);
    expect([...computeDoneDurations([a, { ...b, completedAt: a.completedAt }])]).toEqual([['a', 30], ['b', 90]]);
    expect(computeDoneDurations([{ ...a, durationMinutes: 45, durationBasis: 'task' }]).get('a')).toBe(45);
  });
  it('旧记录与无效时长采用标注或固定默认值，Outlook 保留不足一分钟的真实区间', () => {
    expect([...computeDoneDurations([item('a', date), { ...item('b', date), durationMinutes: NaN },
      { ...item('c', date), durationMinutes: -10, title: '任务(5m)' }, event('d', '短日程', '09', { durationMinutes: 0.5 })])])
      .toEqual([['a', 15], ['b', 15], ['c', 5], ['d', 0.5]]);
  });
  it('同日忽略时长标注和装饰符号，保留 TickTick 的时长；其他日期和不同标题不误删', () => {
    const task = { ...item('a', date), title: '阅读📖（30m）', durationMinutes: 30 };
    const result = mergeDoneItems([task], [event('same', ' 阅读 '), event('other', '日语阅读'),
      event('tomorrow', '阅读', '09', { date: '2026-10-05' })]);
    expect(result.map(item => item.id).sort()).toEqual(['a', 'other', 'tomorrow']);
    expect(result.find(item => item.id === 'a')?.durationMinutes).toBe(30);
  });
  it('同名的多次日程逐项匹配，只有一个完成任务时保留其余时段', () => {
    const task = { ...item('a', date), title: '阅读', completedAt: `${date}T09:30:00Z` };
    expect(mergeDoneItems([task], [event('one', '阅读'), event('two', '阅读', '10')]).map(item => item.id).sort()).toEqual(['a', 'two']);
    expect(mergeDoneItems([task], [event('early', '阅读', '08'), event('closest', '阅读')]).map(item => item.id).sort()).toEqual(['a', 'early']);
    expect(mergeDoneItems([task, { ...task, id: 'b', completedAt: `${date}T10:30:00Z` }],
      [event('one', '阅读'), event('two', '阅读', '10')]).map(item => item.id).sort()).toEqual(['a', 'b']);
  });
  it('任务链接优先于标题，明确关联其他任务的同名日程仍保留', () => {
    const task = { ...item('a', date), title: '洗衣服(50m)' };
    const linked = event('linked', '洗衣日程', '10', { linkedTaskId: 'a', linkedProjectId: 'inbox' });
    const wrong = event('different', '洗衣服', '11', { linkedTaskId: 'b' });
    expect(mergeDoneItems([task], [event('title', '洗衣服'), wrong, linked]).map(item => item.id).sort()).toEqual(['a', 'different', 'title']);
  });
  it('重复订阅的同一时段只计一次，保留有任务链接的一份用于去重', () => {
    const task = { ...item('a', date), title: '已更名' };
    expect(mergeDoneItems([task], [event('copy', '日程'), event('linked-copy', '日程', '09', { linkedTaskId: 'a' })])).toEqual([task]);
    expect(mergeDoneItems([], [event('one', '日程'), event('copy', '日程'), event('later', '日程', '10')])).toHaveLength(2);
  });
  it('routine 待办先用于去重再隐藏，避免从 Outlook 副本重新显示', () => {
    const task = { ...item('a', date), title: '夜间 routine', tags: ['routine'] };
    const merged = mergeDoneItems([task], [event('copy', '夜间 routine')]);
    expect(groupDoneWeek(merged, date, date).flatMap(day => day.items)).toEqual([]);
  });
});

describe('连续周本', () => {
  it('每页从周一到周日，跨月跨年均为连续七天', () => {
    expect(doneWeekDates('2026-10-04')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(doneWeekDates('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    expect(doneWeekDates('2028-03-01')).toContain('2028-02-29');
    expect(doneWeekDates('not-a-date')).toEqual([]);
  });
  it('向左追加的周页保持时间递增，与已有首周无断层', () => {
    const weeks = [...earlierDoneWeeks('2026-09-28'), '2026-09-28'];
    expect(weeks).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    for (let index = 1; index < weeks.length; index++) expect(shiftDoneDate(weeks[index - 1], 7)).toBe(weeks[index]);
    expect(earlierDoneWeeks('1900-01-08')).toEqual(['1900-01-01']);
  });
  it('读取跨月两端数据，不向未来月份请求完成记录', () => {
    expect(doneWeekMonths('2026-10-04', '2026-10-04')).toEqual(['2026-09', '2026-10']);
    expect(doneWeekMonths('2026-12-31', '2026-12-31')).toEqual(['2026-12']);
    expect(doneWeekMonths('2027-01-03', '2027-01-03')).toEqual(['2026-12', '2027-01']);
  });
  it('归入真实完成日，每项仅一次，保留空白日和所有今天的完成项', () => {
    const history = item('history', '2026-09-30', '课');
    const today = item('today', '2026-10-04', '玩');
    const week = groupDoneWeek([history, today, today, item('outside', '2026-09-27'), item('future', '2026-10-05')], '2026-10-04', '2026-10-04');
    expect(week).toHaveLength(7);
    expect(week[0].items).toEqual([]);
    expect(week[2].items).toEqual([history]);
    expect(week[6].items).toEqual([today]);
    expect(week.flatMap((day) => day.items)).toHaveLength(2);
  });
  it('年末周次正确，元旦可属于上一年的第 53 周', () => {
    expect(doneWeekNumber('2026-10-04')).toBe(40);
    expect(doneWeekNumber('2027-01-01')).toBe(53);
    expect(doneWeekNumber('2027-01-04')).toBe(1);
  });
  it('今天和历史都排除 routine 标签，分类数量仅包含可见项，不按标题或标签子串排除', () => {
    const keep = [item('普通完成', '2026-10-04', '课'), { ...item('routine 写在标题里', '2026-09-30', '活'), tags: ['my-routine'] }];
    const hidden = ['routine', ' Routine ', '#routine', 'ｒｏｕｔｉｎｅ'].map((tag, index) => ({
      ...item(`hidden-${index}`, index % 2 ? '2026-09-30' : '2026-10-04', '玩'), tags: ['玩', tag],
    }));
    const week = groupDoneWeek([...keep, ...hidden], '2026-10-04', '2026-10-04');
    expect(week.flatMap((day) => day.items).map((entry) => entry.id).sort()).toEqual(keep.map((entry) => entry.id).sort());
    expect(groupDoneCategories(week[6].items).map((group) => group.items.length)).toEqual([1, 0, 0]);
    expect(week[2].items).toHaveLength(1);
  });
});
describe('DoneList 分类与日期分组', () => {
  it('标签优先、清单兜底，兼容前后符号但不猜测含义', () => {
    expect(classifyDoneCategory(['# 活 ', '当天'], '玩')).toBe('活');
    expect(classifyDoneCategory(['📚课', '课'], '玩')).toBe('课');
    expect(classifyDoneCategory([], ' 🎮 玩 ')).toBe('玩');
    expect(classifyDoneCategory(['routine', '动'], '收集箱')).toBe('未分类');
    expect(classifyDoneCategory([], '课程采购')).toBe('未分类');
    expect(classifyDoneCategory(['课', '活'], '活')).toBe('活');
    expect(classifyDoneCategory(['课', '活'], '玩')).toBe('未分类');
  });
  it('每项恰好属于一组，固定课活玩顺序；未分类只在需要时出现', () => {
    const entries = [item('play', '2026-10-04', '玩'), item('life', '2026-10-04', '活'), item('unknown', '2026-10-04'), item('study', '2026-10-04', '课')];
    const groups = groupDoneCategories(entries);
    expect(groups.map((group) => group.category)).toEqual(['课', '活', '玩', '未分类']);
    expect(groups.flatMap((group) => group.items).map((entry) => entry.id).sort()).toEqual(entries.map((entry) => entry.id).sort());
    expect(groupDoneCategories([]).map((group) => group.category)).toEqual(['课', '活', '玩']);
  });
  it('今天与历史分开，只保留选中月份，历史按日期倒序', () => {
    const entries = [item('today', '2026-10-04'), item('earlier', '2026-10-01'), item('yesterday', '2026-10-03'), item('other-month', '2026-09-30'), item('future', '2026-10-05')];
    const result = splitDoneDays(entries, '2026-10', '2026-10-04');
    expect(result.current.map((entry) => entry.id)).toEqual(['today']);
    expect(result.history.map(([date]) => date)).toEqual(['2026-10-03', '2026-10-01']);
    expect(splitDoneDays(entries, '2026-09', '2026-10-04').current).toEqual([]);
    expect(splitDoneDays(entries, '2026-09', '2026-10-04').history[0][1][0].id).toBe('other-month');
  });
  it('跨日后旧的今天转入历史，分组内按完成时间倒序且保留重复任务的不同完成', () => {
    const first = { ...item('a', '2026-12-31', '活'), completedAt: '2026-12-31T01:00:00Z' };
    const second = { ...first, id: 'b', completedAt: '2026-12-31T02:00:00Z' };
    expect(splitDoneDays([first, second], '2026-12', '2027-01-01').current).toEqual([]);
    expect(groupDoneCategories([first, second]).find((group) => group.category === '活')?.items.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});
