import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE } from './bonLife';
import { hairWashDates, swimmingHairWashDates } from './lifeSwimming';

describe('洗头日期是游泳的必要条件', () => {
  it('按当前未完成实例展开完成时间重复，遵守有限次数和截止日期', () => {
    const schedule = { scheduledDate: '2026-10-06', repeatFlag: 'FREQ=DAILY;INTERVAL=2;COUNT=3', repeatFrom: '1' };
    expect(hairWashDates(schedule, '2026-10-05', '2026-10-31')).toEqual(['2026-10-06', '2026-10-08', '2026-10-10']);
    expect(hairWashDates({ ...schedule, repeatFlag: 'FREQ=DAILY;INTERVAL=2;UNTIL=20261009' }, '2026-10-05', '2026-10-31'))
      .toEqual(['2026-10-06', '2026-10-08']);
  });
  it('未设日期、一次性洗头和逾期洗头不变成每日洗头', () => {
    expect(hairWashDates(undefined, '2026-10-05', '2026-10-31')).toEqual([]);
    expect(hairWashDates({ repeatFlag: 'FREQ=DAILY' }, '2026-10-05', '2026-10-31')).toEqual([]);
    expect(hairWashDates({ scheduledDate: '2026-10-04' }, '2026-10-05', '2026-10-31')).toEqual([]);
    expect(hairWashDates({ scheduledDate: '2026-10-06' }, '2026-10-05', '2026-10-31')).toEqual(['2026-10-06']);
  });
  it('今天已完成洗头仍可游泳，后续沿用新的待办日期', () => {
    expect(hairWashDates({ scheduledDate: '2026-10-07', completedDates: ['2026-10-05'], repeatFlag: 'FREQ=DAILY;INTERVAL=2' },
      '2026-10-05', '2026-10-09')).toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
  });
  it('跨年经期结束日不洗头就继续等，实际经期覆盖预测', () => {
    const wash = { scheduledDate: '2026-12-29', repeatFlag: 'FREQ=DAILY;INTERVAL=2' };
    const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-12-29', automatic: false };
    expect(swimmingHairWashDates(wash, '2026-12-29', '2027-01-07', cycle, [])).toEqual(['2027-01-04', '2027-01-06']);
    expect(swimmingHairWashDates(wash, '2026-12-29', '2027-01-07', cycle, ['2027-01-04'])).not.toContain('2027-01-04');
  });
});
