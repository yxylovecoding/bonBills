import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE } from './bonLife';
import { personalTraining, type TrainingTask } from './lifeTraining';

const task = (name: string): TrainingTask => ({ id: name, name, title: name, schedule: '', dates: [], notes: '', links: [] });
const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-01', trainingDays: [] };
describe('按个人训练分化调整经期计划', () => {
  it('使用 TickTick 当日分化，不被旧的训练日设置覆盖；无经期也保留原计划', () => {
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [])).toBe('上半身');
    expect(personalTraining('2026-10-14', [task('全身力训')], cycle, [])).toBe('全身力训');
    expect(personalTraining('2026-10-08', [task('臀腿')], DEFAULT_CYCLE, [])).toBe('臀腿');
    expect(personalTraining('2026-10-08', [], cycle, [])).toContain('休息');
  });
  it('经期初段和轻量选项降强度，黄体后段保留分化或替换间歇', () => {
    expect(personalTraining('2026-10-02', [task('臀腿')], cycle, [])).toBe('臀腿 → 轻松散步或舒缓拉伸');
    expect(personalTraining('2026-10-22', [task('HIIT')], cycle, [])).toBe('HIIT → 低强度有氧');
    expect(personalTraining('2026-10-22', [task('上半身')], cycle, [])).toContain('上半身 · 轻量');
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [], 'easy')).toContain('舒缓拉伸');
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [], 'rest')).toBe('休息');
  });
  it('同日多个任务都保留，已记录的经期覆盖估计阶段', () => {
    expect(personalTraining('2026-10-08', [task('上半身'), task('有氧')], cycle, [])).toBe('上半身\n有氧');
    expect(personalTraining('2026-10-14', [task('HIIT')], cycle, ['2026-10-14'])).toContain('轻松散步');
  });
});
