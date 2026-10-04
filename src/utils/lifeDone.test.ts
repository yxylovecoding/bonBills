import { describe, expect, it } from 'vitest';
import type { DoneItem } from './bonLife';
import { classifyDoneCategory, groupDoneCategories, splitDoneDays } from './lifeDone';

const item = (id: string, date: string, category?: DoneItem['category']): DoneItem => ({
  id, taskId: id, projectId: 'inbox', title: id, date, completedAt: `${date}T09:00:00Z`, category,
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
