import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CYCLE, parseCycleSettings } from './bonLife';
import { afterMenstrualPeriod, cycleDay, estimateCycle, visibleCycleDay } from './lifeCycle';

const add = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const period = (start: string, length: number) => Array.from({ length }, (_, index) => add(start, index));
const history = [...period('2026-07-01', 4), ...period('2026-08-01', 6), ...period('2026-08-31', 4)];

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-10T00:00:00+08:00')); });
afterEach(() => vi.useRealTimers());

describe('经期自动估算', () => {
  it('没有记录不凭空生成日期；单次开始记录使用初始周期', () => {
    expect(estimateCycle(DEFAULT_CYCLE, [])).toMatchObject({ cycleLength: 28, periodLength: 5, lastPeriodStart: '', nextPeriodStart: '', cycleSamples: 0 });
    expect(cycleDay('2026-10-01', DEFAULT_CYCLE, [])).toBeNull();
    expect(estimateCycle({ ...DEFAULT_CYCLE, lastPeriodStart: '2026-09-01', cycleLength: 30 }, [])).toMatchObject({ nextPeriodStart: '2026-10-01', cycleLength: 30 });
  });
  it('根据开始间隔与完整经期估算，日历和游泳使用同一结果', () => {
    expect(estimateCycle(DEFAULT_CYCLE, history)).toMatchObject({ cycleLength: 31, periodLength: 4, cycleSamples: 2, periodSamples: 3, lastPeriodStart: '2026-08-31', nextPeriodStart: '2026-10-01' });
    expect(cycleDay('2026-09-28', DEFAULT_CYCLE, history)?.phase).not.toBe('menstrual');
    expect(cycleDay('2026-10-01', DEFAULT_CYCLE, history)).toEqual({ day: 1, phase: 'menstrual', estimated: true });
    expect(afterMenstrualPeriod('2026-10-01', DEFAULT_CYCLE, history)).toBe('2026-10-05');
    expect(visibleCycleDay('2026-09-04', DEFAULT_CYCLE, history)).toBeNull();
  });
  it('补入新记录后重新校准，不修改原始设置或历史', () => {
    vi.setSystemTime(new Date('2026-10-03T00:00:00+08:00'));
    const settings = { ...DEFAULT_CYCLE };
    const updated = [...history, ...period('2026-09-29', 4)];
    expect(estimateCycle(settings, updated)).toMatchObject({ cycleLength: 30, lastPeriodStart: '2026-09-29', nextPeriodStart: '2026-10-29' });
    expect(cycleDay('2026-10-29', settings, updated)).toMatchObject({ day: 1, estimated: true });
    expect(settings).toEqual(DEFAULT_CYCLE);
    expect(updated).toHaveLength(18);
  });
  it('只取最近六次有效间隔，异常长短间隔不拉偏结果', () => {
    let start = '2025-01-01';
    const starts = [start];
    for (const gap of [22, 23, 24, 31, 31, 31, 31, 31, 31, 5, 90]) { start = add(start, gap); starts.push(start); }
    expect(estimateCycle({ ...DEFAULT_CYCLE, periodStarts: starts }, [], '2026-12-31')).toMatchObject({ cycleLength: 31, cycleSamples: 6 });
  });
  it('去重、乱序和经期内手动标记不增加样本或重置实际天数', () => {
    const settings = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-08-02', periodStarts: ['2026-08-01', '2026-08-01', 'bad'] };
    const days = [...history, ...history, '2026-02-30'].reverse();
    expect(estimateCycle(settings, days)).toEqual(estimateCycle(DEFAULT_CYCLE, history));
    expect(cycleDay('2026-08-03', settings, days)).toEqual({ day: 3, phase: 'menstrual', estimated: false });
  });
  it('单日开始标记、仍在进行及未来区间不用于学习经期长度', () => {
    const days = [...period('2026-08-01', 6), '2026-09-01', ...period('2026-09-09', 5), ...period('2026-10-01', 2)];
    expect(estimateCycle(DEFAULT_CYCLE, days)).toMatchObject({ periodLength: 6, periodSamples: 1, cycleLength: 31, cycleSamples: 1, lastPeriodStart: '2026-09-09' });
  });
  it('仅开始日期也能学习周期；不足样本的字段独立回退', () => {
    expect(estimateCycle({ ...DEFAULT_CYCLE, periodStarts: ['2026-07-01', '2026-08-02'], lastPeriodStart: '2026-09-03', periodLength: 6 }, []))
      .toMatchObject({ cycleLength: 32, periodLength: 6, cycleSamples: 2, periodSamples: 0 });
  });
  it('跨年和闰年按日历天数计算，不按月份长度硬编码', () => {
    expect(estimateCycle(DEFAULT_CYCLE, [...period('2025-12-20', 5), ...period('2026-01-20', 5)], '2026-02-01'))
      .toMatchObject({ cycleLength: 31, nextPeriodStart: '2026-02-20' });
    expect(estimateCycle(DEFAULT_CYCLE, ['2024-01-29', '2024-02-29'], '2024-03-05'))
      .toMatchObject({ cycleLength: 31, nextPeriodStart: '2024-03-31' });
  });
  it('手动模式保持设定天数，重新开启自动后恢复估算；旧设置默认自动', () => {
    const manual = { ...DEFAULT_CYCLE, automatic: false, cycleLength: 27, periodLength: 7 };
    expect(estimateCycle(manual, history)).toMatchObject({ cycleLength: 27, periodLength: 7 });
    expect(estimateCycle({ ...manual, automatic: true }, history)).toMatchObject({ cycleLength: 31, periodLength: 4 });
    expect(parseCycleSettings({ ...DEFAULT_CYCLE, automatic: undefined }).automatic).toBe(true);
    expect(parseCycleSettings(manual).automatic).toBe(false);
    expect(() => parseCycleSettings({ ...DEFAULT_CYCLE, automatic: 'true' })).toThrow();
  });
  it('未来日程不参与学习，也不把逾期预计值滚动成实际开始日', () => {
    const result = estimateCycle(DEFAULT_CYCLE, [...history, ...period('2026-10-10', 9)]);
    expect(result).toEqual(estimateCycle(DEFAULT_CYCLE, history));
    expect(estimateCycle(DEFAULT_CYCLE, history, '2026-11-01').nextPeriodStart).toBe('2026-10-01');
  });
});
