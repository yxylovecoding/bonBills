import { describe, expect, it } from 'vitest';
import type { DoneItem } from './bonLife';
import { classifyDoneCategory, doneWeekDates, doneWeekMonths, doneWeekNumber, earlierDoneWeeks, groupDoneCategories, groupDoneWeek, shiftDoneDate, splitDoneDays } from './lifeDone';

const item = (id: string, date: string, category?: DoneItem['category']): DoneItem => ({
  id, taskId: id, projectId: 'inbox', title: id, date, completedAt: `${date}T09:00:00Z`, category,
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
