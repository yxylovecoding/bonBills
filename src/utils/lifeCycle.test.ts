import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE, entrySummary, parseCycleSettings, parseLifeEdit } from './bonLife';
import { cycleDay, suggestedTraining } from './lifeCycle';
import { draftKey, readDraft } from '../life/client';

const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-09-28' };
const edit = { kind: 'skin', date: '2026-10-04', text: '旧记录', revision: '', mutationId: 'mutation-123456789' };

describe('经期与训练计划', () => {
  it('跨月覆盖五个阶段，预计日期与已记录经期有区别', () => {
    const phases = ['2026-09-28', '2026-10-04', '2026-10-11', '2026-10-15', '2026-10-20', '2026-10-26']
      .map((date) => cycleDay(date, cycle, []));
    expect(phases.map((value) => value?.phase)).toEqual(['menstrual', 'follicular', 'ovulatory', 'earlyLuteal', 'lateLuteal', 'menstrual']);
    expect(phases[0]?.estimated).toBe(false);
    expect(phases.slice(1).every((value) => value?.estimated)).toBe(true);
    expect(cycleDay('2026-10-04', cycle, ['2026-10-04'])).toEqual({ phase: 'menstrual', day: 1, estimated: false });
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
