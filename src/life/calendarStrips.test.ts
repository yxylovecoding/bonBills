import { describe, expect, it } from 'vitest';
import { calendarStripSegments, lifeCalendarStripItems, type CalendarStripItem } from './calendarStrips';

const cells = (offset = 0) => Array.from({ length: 14 }, (_, index) => index < offset ? null : `2026-10-${String(index - offset + 1).padStart(2, '0')}`);
const items = (input: Record<string, string[]>) => new Map(Object.entries(input).map(([date, keys]) => [date,
  keys.map((key): CalendarStripItem => ({ key, label: key }))]));

describe('各日历 tab 条带提取', () => {
  const base = { text: '', revision: '' };

  it('提取皮肤、眼睛、身体和训练的稳定 key，不从情绪文本发明标签', () => {
    expect(lifeCalendarStripItems('skin', { ...base, skin: { status: 'acne', acneMarks: true } }).map((item) => item.key))
      .toEqual(['skin:acne', 'skin:acneMarks']);
    expect(lifeCalendarStripItems('eyes', { ...base, eyes: { symptoms: {
      'eye:干涩': { area: 'eye', name: '干涩', status: 'ongoing', note: '' },
    } } })).toEqual([{ key: 'eye:干涩', label: '干涩 · 持续' }]);
    expect(lifeCalendarStripItems('discomfort', { ...base, discomfort: { symptoms: {
      'body:头痛': { area: 'body', name: '头痛', status: 'appeared', note: '' },
    } } })).toEqual([{ key: 'body:头痛', label: '通用身体 · 头痛 · 出现' }]);
    expect(lifeCalendarStripItems('training', base, { plan: '游泳', effort: 'normal', completed: false, projects: ['swim'] },
      new Map([['swim', '游泳']]))).toEqual([{ key: 'training:swim', label: '游泳' }]);
    expect(lifeCalendarStripItems('mood', { ...base, text: '#开心' })).toEqual([]);
  });

  it('痤疮消失保留当天文字，痘印条带继续，复发后重新起头', () => {
    const entries = new Map(['ongoing', 'resolved', 'appeared'].map((status, index) => [`2026-10-0${index + 1}`,
      lifeCalendarStripItems('skin', { ...base, skin: {
        status: 'acne', acneProgress: status as 'ongoing' | 'resolved' | 'appeared', acneMarks: true,
      } })]));
    expect(entries.get('2026-10-02')).toContainEqual({ key: 'skin:acne', label: '痤疮 · 消失', resolved: true });
    const result = calendarStripSegments(cells(), entries);
    expect(result.get('2026-10-01')?.find((item) => item.key === 'skin:acne')).toMatchObject({ starts: true, ends: true });
    expect(result.get('2026-10-02')?.map((item) => item.key)).toEqual(['skin:acneMarks']);
    expect(result.get('2026-10-02')?.[0]).toMatchObject({ starts: false, ends: false });
    expect(result.get('2026-10-03')?.find((item) => item.key === 'skin:acne')).toMatchObject({ starts: true, ends: true });
  });

  it.each(['eyes', 'discomfort'] as const)('%s 症状消失后断开条带，其他症状不受影响', (kind) => {
    const area = kind === 'eyes' ? 'eye' : 'body';
    const key = `${area}:疼痛`;
    const entries = new Map((['ongoing', 'resolved', 'resolved', 'appeared'] as const).map((status, index) => [`2026-10-0${index + 1}`,
      lifeCalendarStripItems(kind, { ...base, [kind]: { symptoms: {
        [key]: { area, name: '疼痛', status, note: '' },
        [`${area}:发痒`]: { area, name: '发痒', status: 'ongoing', note: '' },
      } } })]));
    expect(entries.get('2026-10-02')?.find((item) => item.key === key)).toMatchObject({ resolved: true, label: expect.stringContaining('消失') });
    const result = calendarStripSegments(cells(), entries);
    expect(result.get('2026-10-01')?.find((item) => item.key === key)).toMatchObject({ starts: true, ends: true });
    for (const date of ['2026-10-02', '2026-10-03']) {
      expect(result.get(date)?.map((item) => item.key)).toEqual([`${area}:发痒`]);
      expect(result.get(date)?.[0]).toMatchObject({ starts: false, ends: false });
    }
    expect(result.get('2026-10-04')?.find((item) => item.key === key)).toMatchObject({ starts: true, ends: true });
  });
});

describe('日历连续条带', () => {
  it('标记连续区间首尾，中间无圆角；间断后重新形成区间', () => {
    const result = calendarStripSegments(cells(), items({
      '2026-10-01': ['a'], '2026-10-02': ['a'], '2026-10-03': ['a'], '2026-10-05': ['a'],
    }));
    expect(result.get('2026-10-01')?.[0]).toMatchObject({ starts: true, ends: false });
    expect(result.get('2026-10-02')?.[0]).toMatchObject({ starts: false, ends: false });
    expect(result.get('2026-10-03')?.[0]).toMatchObject({ starts: false, ends: true });
    expect(result.get('2026-10-05')?.[0]).toMatchObject({ starts: true, ends: true });
  });

  it('多条记录使用稳定且不冲突的堆叠轨道', () => {
    const result = calendarStripSegments(cells(), items({
      '2026-10-01': ['b', 'a'], '2026-10-02': ['a', 'b'], '2026-10-03': ['b'],
    }));
    const lane = (date: string, key: string) => result.get(date)?.find((item) => item.key === key)?.lane;
    expect(lane('2026-10-01', 'a')).toBe(lane('2026-10-02', 'a'));
    expect(lane('2026-10-01', 'b')).toBe(lane('2026-10-03', 'b'));
    expect(lane('2026-10-01', 'a')).not.toBe(lane('2026-10-01', 'b'));
  });

  it('跨周在周末收尾并于下一周重新起头', () => {
    const result = calendarStripSegments(cells(), items({
      '2026-10-06': ['a'], '2026-10-07': ['a'], '2026-10-08': ['a'], '2026-10-09': ['a'],
    }));
    expect(result.get('2026-10-07')?.[0]).toMatchObject({ starts: false, ends: true });
    expect(result.get('2026-10-08')?.[0]).toMatchObject({ starts: true, ends: false });
  });

  it('月首空格不影响同一周内连续判断', () => {
    const result = calendarStripSegments(cells(3), items({ '2026-10-01': ['a'], '2026-10-02': ['a'] }));
    expect(result.get('2026-10-01')?.[0]).toMatchObject({ starts: true, ends: false });
    expect(result.get('2026-10-02')?.[0]).toMatchObject({ starts: false, ends: true });
  });
});
