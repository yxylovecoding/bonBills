import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE, entrySummary, parseCycleSettings, parseLifeEdit } from './bonLife';
import { cycleDay, cyclePhaseRanges, suggestedTraining } from './lifeCycle';
import { draftKey, readDraft } from '../life/client';

const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-09-28' };
const edit = { kind: 'skin', date: '2026-10-04', text: '旧记录', revision: '', mutationId: 'mutation-123456789' };

describe('经期与训练计划', () => {
  it('跨月采用图示四阶段，预计日期与已记录经期有区别', () => {
    const phases = ['2026-09-28', '2026-10-05', '2026-10-11', '2026-10-17', '2026-10-26']
      .map((date) => cycleDay(date, cycle, []));
    expect(phases.map((value) => value?.phase)).toEqual(['menstrual', 'ovulatory', 'earlyLuteal', 'lateLuteal', 'menstrual']);
    expect(phases[0]?.estimated).toBe(false);
    expect(phases.slice(1).every((value) => value?.estimated)).toBe(true);
    expect(cycleDay('2026-10-04', cycle, ['2026-10-04'])).toEqual({ phase: 'menstrual', day: 1, estimated: false });
  });
  it('28 天模板在第 8、14、20 天切换，每一天恰好属于一个阶段', () => {
    expect(cyclePhaseRanges(cycle)).toEqual([
      { phase: 'menstrual', start: 1, end: 7 }, { phase: 'ovulatory', start: 8, end: 13 },
      { phase: 'earlyLuteal', start: 14, end: 19 }, { phase: 'lateLuteal', start: 20, end: 28 },
    ]);
    const settings = { ...cycle, lastPeriodStart: '2026-10-01' };
    for (const [start, end, phase] of [[1, 7, 'menstrual'], [8, 13, 'ovulatory'], [14, 19, 'earlyLuteal'], [20, 28, 'lateLuteal']] as const) {
      for (let day = start; day <= end; day++) expect(cycleDay(`2026-10-${String(day).padStart(2, '0')}`, settings, [])?.phase).toBe(phase);
    }
  });
  it.each([21, 28, 30, 45])('%i 天周期完整覆盖，长经期优先且没有重叠空隙', (cycleLength) => {
    const ranges = cyclePhaseRanges({ ...cycle, cycleLength, periodLength: 10 });
    expect(ranges[0].end).toBeGreaterThanOrEqual(10);
    expect(ranges[0].start).toBe(1);
    expect(ranges[3].end).toBe(cycleLength);
    ranges.forEach((range, index) => {
      expect(range.end).toBeGreaterThanOrEqual(range.start);
      if (index) expect(range.start).toBe(ranges[index - 1].end + 1);
    });
  });
  it('经期前 3 天默认轻量，上肢安排在之后；减量和休息仍优先', () => {
    const daily = { ...cycle, trainingDays: [0, 1, 2, 3, 4, 5, 6] };
    for (const date of ['2026-09-28', '2026-09-29', '2026-09-30']) {
      expect(suggestedTraining(date, daily, [])).toBe('轻松散步 15 分钟 · 舒缓瑜伽 10 分钟');
    }
    expect(suggestedTraining('2026-10-01', daily, [])).toContain('上肢');
    expect(suggestedTraining('2026-10-11', daily, [])).toContain('全身力量 30 分钟');
    expect(suggestedTraining('2026-10-17', daily, [])).toContain('中低强度有氧');
    expect(suggestedTraining('2026-09-28', daily, [], 'rest')).toBe('休息');
    expect(suggestedTraining('2026-10-11', daily, [], 'easy')).toContain('轻松散步');
  });
  it('新的经期重置周期，跨年和闰年日期正常，不反推记录前的日期', () => {
    expect(cycleDay('2026-09-27', cycle, [])).toBeNull();
    expect(cycleDay('2027-01-02', DEFAULT_CYCLE, ['2026-12-30', '2026-12-31', '2027-01-01'])?.day).toBe(4);
    expect(cycleDay('2024-03-01', { ...cycle, lastPeriodStart: '2024-02-28' }, [])?.day).toBe(3);
    expect(cycleDay('2026-10-22', cycle, ['2026-10-19', '2026-10-20'])?.day).toBe(4);
    expect(cycleDay('2026-10-04', DEFAULT_CYCLE, [])).toBeNull();
  });
  it('按训练日生成，可减量或休息，无经期不生成计划', () => {
    expect(suggestedTraining('2026-10-05', cycle, [])).toContain('力量');
    expect(suggestedTraining('2026-10-06', cycle, [])).toContain('休息');
    expect(suggestedTraining('2026-10-05', cycle, [], 'easy')).toContain('15 分钟');
    expect(suggestedTraining('2026-10-05', cycle, [], 'rest')).toBe('休息');
    expect(suggestedTraining('2026-10-05', DEFAULT_CYCLE, [])).toBe('');
    expect(suggestedTraining('2026-10-05', { ...cycle, trainingDays: [] }, [])).toContain('休息');
  });
  it('拒绝非法经期设置，训练日去重', () => {
    expect(parseCycleSettings({ ...cycle, trainingDays: [1, 1, 3] }).trainingDays).toEqual([1, 3]);
    for (const invalid of [{ cycleLength: 0 }, { periodLength: 11 }, { trainingDays: [7] }, { lastPeriodStart: '2026-02-30' }]) {
      expect(() => parseCycleSettings({ ...cycle, ...invalid })).toThrow();
    }
  });
});

describe('结构化健康记录', () => {
  it('兼容旧文字、早晚护肤与用药可独立保存和清空', () => {
    expect(parseLifeEdit(edit).text).toBe('旧记录');
    const skin = { morningMedication: '药 A', morningProducts: '乳液', eveningMedication: '药 B', eveningProducts: '' };
    expect(parseLifeEdit({ ...edit, skin }).skin).toEqual(skin);
    expect(entrySummary('skin', { text: edit.text, revision: '', skin })).toContain('晚间用药 · 药 B');
    expect(parseLifeEdit({ ...edit, skin: {} }).skin).toEqual({});
    expect(() => parseLifeEdit({ ...edit, skin: { morningMedication: 'a'.repeat(501) } })).toThrow();
    expect(() => parseLifeEdit({ ...edit, kind: 'mood', skin })).toThrow();
  });
  it('体围支持小数和留空，拒绝零、负数、非数和越界值', () => {
    expect(parseLifeEdit({ ...edit, kind: 'body', body: { waist: 66.5 } }).body).toEqual({ waist: 66.5 });
    expect(parseLifeEdit({ ...edit, kind: 'body', body: {} }).body).toEqual({});
    for (const waist of [0, -1, NaN, Infinity, 301, '66']) {
      expect(() => parseLifeEdit({ ...edit, kind: 'body', body: { waist } })).toThrow();
    }
  });
  it('训练完成状态可持久保存，草稿恢复全部结构化字段', () => {
    const draft = { ...edit, kind: 'training', training: { plan: '骑行', effort: 'easy', completed: true } };
    expect(parseLifeEdit(draft).training?.completed).toBe(true);
    localStorage.setItem(draftKey('tester'), JSON.stringify(draft));
    expect(readDraft('tester')).toEqual(draft);
    localStorage.removeItem(draftKey('tester'));
    expect(() => parseLifeEdit({ ...draft, training: { ...draft.training, completed: 'yes' } })).toThrow();
  });
});
