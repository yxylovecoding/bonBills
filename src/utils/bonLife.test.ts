import { describe, expect, it } from 'vitest';
import { calendarCells, lifeYear, parseLifeEdit, periodDays, reconcilePeriodEvents } from './bonLife';

describe('BonLife 日历记录', () => {
  it('闰年二月及跨年月份按周一对齐，不丢失月末', () => {
    const feb = calendarCells(2024, 2);
    expect(feb.slice(0, 4)).toEqual([null, null, null, '2024-02-01']);
    expect(feb.filter(Boolean)).toHaveLength(29);
    expect(feb).toContain('2024-02-29');
    expect(feb.length % 7).toBe(0);
    expect(calendarCells(2023, 1)).toHaveLength(42);
  });
  it.each(['2026x', '26', null, 1899, 2201, 2026.5])('拒绝无效年份 %s', (year) => {
    expect(() => lifeYear(year)).toThrow();
  });
  it('允许往年记录和清空文字，皮肤与情绪保留独立类型', () => {
    const input = { date: '2020-02-29', kind: 'skin', text: '', revision: '', mutationId: 'unique-mutation-id' };
    expect(parseLifeEdit(input)).toMatchObject({ year: 2020, kind: 'skin', text: '' });
    expect(parseLifeEdit({ ...input, kind: 'mood' }).kind).toBe('mood');
    expect(() => parseLifeEdit({ ...input, date: '2021-02-29' })).toThrow();
    expect(() => parseLifeEdit({ ...input, kind: 'other' })).toThrow();
    expect(() => parseLifeEdit({ ...input, text: '字'.repeat(2001) })).toThrow();
  });
  it('经期覆盖每一天，跨年裁切、重叠去重、结束日不包含', () => {
    const events = [
      { uid: 'a', startDate: '2023-12-30', endDate: '2024-01-03' },
      { uid: 'b', startDate: '2024-01-02', endDate: '2024-01-04' },
      { uid: 'c', startDate: '2024-12-31', endDate: '2025-01-03' },
    ];
    expect(periodDays(events, 2024)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-12-31']);
  });
  it('发布订阅缩短时保留往年经期，仍在源中的改期和取消以新结果为准', () => {
    const past = { uid: 'old', startDate: '2024-01-01', endDate: '2024-01-05' };
    const cancelled = { uid: 'cancelled', startDate: '2024-03-01', endDate: '2024-03-04' };
    const future = { uid: 'future', startDate: '2027-01-01', endDate: '2027-01-04' };
    const moved = { uid: 'moved', startDate: '2024-05-01', endDate: '2024-05-04' };
    const updated = { ...moved, startDate: '2024-05-02', endDate: '2024-05-05' };
    expect(reconcilePeriodEvents([past, cancelled, future, moved], [updated], ['cancelled', 'moved'], '2026-10-02')).toEqual([past, updated]);
  });
});
