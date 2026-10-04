import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE, parseLifeEdit, type TrainingRecord } from './bonLife';
import { automaticTraining, monthlyTrainingPlan, personalTraining, plannedTraining, type TrainingTask } from './lifeTraining';

const task = (name: string): TrainingTask => ({ id: name, name, title: name, schedule: '', dates: [], notes: '', links: [] });
const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-01', trainingDays: [] };
describe('按个人训练分化调整经期计划', () => {
  it('使用 TickTick 当日分化，不被旧的训练日设置覆盖；无经期也保留原计划', () => {
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [])).toBe('上半身 · 常规强度');
    expect(personalTraining('2026-10-14', [task('全身力训')], cycle, [])).toContain('全身力训 · 常规力量');
    expect(personalTraining('2026-10-08', [task('臀腿')], DEFAULT_CYCLE, [])).toBe('臀腿');
    expect(personalTraining('2026-10-08', [], cycle, [])).toContain('休息');
  });
  it('经期初段和轻量选项降强度，黄体后段保留分化或替换间歇', () => {
    expect(personalTraining('2026-10-02', [task('臀腿')], cycle, [])).toBe('轻松散步 15 分钟 · 舒缓拉伸 5 分钟');
    expect(personalTraining('2026-10-22', [task('HIIT')], cycle, [])).toBe('低强度有氧 20 分钟');
    expect(personalTraining('2026-10-22', [task('上半身')], cycle, [])).toContain('上半身 · 轻量');
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [], 'easy')).toContain('舒缓拉伸');
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [], 'rest')).toBe('休息');
  });
  it('同日多个任务都保留，已记录的经期覆盖估计阶段', () => {
    expect(personalTraining('2026-10-08', [task('上半身'), task('有氧')], cycle, [])).toBe('上半身 · 常规强度\n有氧 · 常规强度');
    expect(personalTraining('2026-10-14', [task('HIIT')], cycle, ['2026-10-14'])).toContain('轻松散步');
  });
  it('经期初段把同日多个训练合并为一次恢复训练', () => {
    expect(personalTraining('2026-10-02', [task('臀腿'), task('游泳')], cycle, []).split('\n')).toHaveLength(1);
  });
});

describe('未来训练自动排期', () => {
  const saved: TrainingRecord = { plan: '旧的自动计划', effort: 'normal', completed: false, mode: 'auto' };
  it('整月安排包含下个周期与休息日，并尊重来源的实际日期', () => {
    const dates = new Map(['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'].map((date) => [date, [task('上半身')]]));
    const plans = monthlyTrainingPlan(2026, 10, '2026-10-04', dates, cycle, [], {});
    expect(plans.size).toBe(31);
    expect(plans.get('2026-10-08')?.plan).toContain('常规强度');
    expect(plans.get('2026-10-15')?.plan).toContain('常规力量');
    expect(plans.get('2026-10-22')?.plan).toContain('轻量');
    expect(plans.get('2026-10-29')?.plan).toContain('轻松散步');
    expect(plans.get('2026-10-09')?.plan).toContain('休息');
  });
  it('新的经期设置、经期记录和训练来源都会更新未来自动计划', () => {
    const resolve = (settings = cycle, periods: string[] = [], name = 'HIIT') => plannedTraining('2026-10-22', '2026-10-04', [task(name)], settings, periods, saved);
    expect(resolve().plan).toContain('低强度有氧');
    expect(resolve({ ...cycle, lastPeriodStart: '2026-10-15' }).plan).toBe('HIIT · 常规强度');
    expect(resolve(cycle, ['2026-10-22']).plan).toContain('轻松散步');
    expect(resolve(cycle, [], '游泳').plan).toContain('游泳 · 轻量');
  });
  it('跨年与闰月逐日排期，不限于当前任务的下一次发生', () => {
    const plans = monthlyTrainingPlan(2027, 1, '2026-12-20', new Map([['2027-01-07', [task('上半身')]]]), { ...cycle, lastPeriodStart: '2026-12-31' }, [], {});
    expect(plans.get('2027-01-07')?.plan).toBe('上半身 · 常规强度');
    expect(monthlyTrainingPlan(2028, 2, '2028-02-01', undefined, { ...cycle, lastPeriodStart: '2028-02-01' }, [], {}).size).toBe(29);
  });
  it('重排保留手动安排、旧记录、已完成记录和过去的自动计划', () => {
    for (const record of [{ ...saved, mode: 'manual' as const }, { ...saved, mode: undefined }, { ...saved, completed: true }]) {
      expect(plannedTraining('2026-10-22', '2026-10-04', [task('HIIT')], cycle, [], record)).toBe(record);
    }
    expect(plannedTraining('2026-10-02', '2026-10-04', [task('HIIT')], cycle, [], saved)).toBe(saved);
    expect(plannedTraining('2026-10-02', '2026-10-04', [task('HIIT')], cycle, []).plan).toBe('');
  });
  it('减量和休息的个人选择优先，未接入 TickTick 时按已设置训练日排期', () => {
    expect(plannedTraining('2026-10-22', '2026-10-04', [task('HIIT')], cycle, [], { ...saved, effort: 'rest' }).plan).toBe('休息');
    expect(plannedTraining('2026-10-08', '2026-10-04', [task('HIIT')], cycle, [], { ...saved, effort: 'easy' }).plan).toContain('轻松散步');
    expect(automaticTraining('2026-10-08', undefined, { ...cycle, trainingDays: [4] }, []).plan).toContain('全身力量');
    expect(automaticTraining('2026-10-08', [], { ...cycle, trainingDays: [4] }, []).plan).toContain('休息');
  });
  it('自动/手动标记通过保存与草稿校验，非法标记不写入', () => {
    const edit = { kind: 'training', date: '2026-10-22', text: '', revision: '', mutationId: 'mutation-123456789', training: saved };
    expect(parseLifeEdit(edit).training?.mode).toBe('auto');
    expect(parseLifeEdit({ ...edit, training: { ...saved, mode: 'manual' } }).training?.mode).toBe('manual');
    expect(() => parseLifeEdit({ ...edit, training: { ...saved, mode: 'invalid' } })).toThrow();
  });
});
