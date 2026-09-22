import { describe, expect, it } from 'vitest';
import { buildTickTickTripSources, getTickTickTripName } from './tickTickTrips';

describe('TickTick 出游来源', () => {
  it('去掉账单标签中的日期前缀', () => {
    expect(getTickTickTripName('26.9.12 东京', '2026-09-12', '2026-09-15')).toBe('东京');
    expect(getTickTickTripName('26.9国庆', '2026-09-12', '2026-09-15')).toBe('国庆');
  });

  it('没有标签时使用日期范围', () => {
    expect(getTickTickTripName('', '2026-09-12', '2026-09-15')).toBe('9月12日–9月15日');
    expect(getTickTickTripName(undefined, '2026-09-12', '2026-09-12')).toBe('9月12日');
  });

  it('优先账单标签，其次日程名称，最后日期，日程名称按行程日期去重', () => {
    const dates = { '2026-10-16': 'travel', '2026-10-17': 'travel', '2026-10-18': 'travel' } as const;
    const titles = { '2026-10-16': '南京学术会议', '2026-10-17': '南京学术会议', '2026-10-18': '南京学术会议' };
    expect(buildTickTickTripSources(dates, {}, {}, {}, titles)[0].name).toBe('南京学术会议');
    expect(buildTickTickTripSources(dates, { '2026-10-16': '26.10南京出差' }, {}, {}, titles)[0].name).toBe('南京出差');
    expect(buildTickTickTripSources(dates, {}, {}, {})[0].name).toBe('10月16日–10月18日');
  });

  it('按连续日期和切分点生成唯一行程', () => {
    const sources = buildTickTickTripSources(
      {
        '2026-09-30': 'travel',
        '2026-10-01': 'travel',
        '2026-10-02': 'travel',
      },
      { '2026-09-30': '26.9 东京', '2026-10-02': '26.10 京都' },
      { '2026-10-02': '转场' },
      { '2026-10-02': true },
    );

    expect(sources).toEqual([
      {
        key: '2026-09-30',
        startDate: '2026-09-30',
        endDate: '2026-10-01',
        dates: ['2026-09-30', '2026-10-01'],
        name: '东京',
        note: '',
      },
      {
        key: '2026-10-02',
        startDate: '2026-10-02',
        endDate: '2026-10-02',
        dates: ['2026-10-02'],
        name: '京都',
        note: '转场',
      },
    ]);
  });
});
