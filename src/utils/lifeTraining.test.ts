import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE, parseLifeEdit, type LifeEntries, type TrainingRecord } from './bonLife';
import { automaticTraining, monthlyTrainingPlan, personalTraining, plannedTraining, recordedTrainingProjects, rollingTrainingPlan, trainingProjectKey, type TrainingSource, type TrainingTask } from './lifeTraining';

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

describe('按实际完成滚动轮换', () => {
  const names = ['有氧', '上半身', '臀腿', '全身力训', 'HIIT', '游泳'];
  const source = (completed: [string, string][] = [], tasks = names.map(task)): TrainingSource => ({ year: 2026, tasks,
    connected: true, syncedAt: '2026-10-14T00:00:00Z', completions: completed.map(([name, date]) => ({ project: trainingProjectKey(name), date })) });
  const record = (plan: string, extra: Partial<TrainingRecord> = {}) => ({ text: '', revision: 'saved', training: {
    plan, effort: 'normal' as const, completed: true, mode: 'auto' as const, ...extra } });
  const run = (today: string, input = source(), entries: LifeEntries = {}, settings = DEFAULT_CYCLE, year = 2026, month = 10) =>
    rollingTrainingPlan(year, month, today, input, settings, [], entries);
  const project = (result: ReturnType<typeof run>, date: string) => result.plans.get(date)?.projects?.[0];

  it('上周三有氧后停一周，下周三接漏练项目，不按原星期重置', () => {
    const input = source([['有氧', '2026-10-07']], names.map((name) => ({ ...task(name), schedule: '每周三', dates: ['2026-10-14'] })));
    const result = run('2026-10-14', input);
    expect(project(result, '2026-10-14')).toBeTruthy();
    expect(project(result, '2026-10-14')).not.toBe('有氧');
    expect(result.coverage.every((item) => !item.completed)).toBe(true);
    expect(result.coverage.find((item) => item.task.name === '有氧')?.lastCompleted).toBe('2026-10-07');
    const week = Array.from({ length: 6 }, (_, i) => project(result, `2026-10-${14 + i}`));
    expect(new Set(week)).toEqual(new Set(names.map(trainingProjectKey)));
  });
  it('没练不推进；完成后才推进，跨过周日也不重置', () => {
    const first = run('2026-10-10');
    const missed = { 'training:2026-10-10': record(first.plans.get('2026-10-10')!.plan, { ...first.plans.get('2026-10-10'), completed: false }) };
    const retry = run('2026-10-12', source(), missed);
    expect(project(retry, '2026-10-12')).toBe(project(first, '2026-10-10'));
    missed['training:2026-10-10'].training.completed = true;
    expect(project(run('2026-10-12', source(), missed), '2026-10-12')).not.toBe(project(first, '2026-10-10'));
    expect(run('2026-10-12', source(), missed).coverage.filter((item) => item.completed)).toHaveLength(1);
  });
  it('每个项目七天一次，覆盖后休息；优先最久未练，保留七天以前的顺序', () => {
    const first = run('2026-10-14');
    expect(new Set(Array.from({ length: 6 }, (_, i) => project(first, `2026-10-${14 + i}`))).size).toBe(6);
    expect(first.plans.get('2026-10-20')?.plan).toContain('休息');
    expect(project(first, '2026-10-21')).toBe(project(first, '2026-10-14'));
    const history = names.map((name, i): [string, string] => [name, `2026-10-${String(2 + i).padStart(2, '0')}`]);
    expect(project(run('2026-10-14', source(history)), '2026-10-14')).toBe('有氧');
  });
  it('Web 和 TickTick 完成记录共同推进，项目改 ID、重复实例和重复完成不重复计数', () => {
    const input = source([['有氧', '2026-10-13'], ['有氧', '2026-10-13'], ['上半身', '2026-10-20']], [...names.map(task), { ...task('有氧'), id: 'other-id' }]);
    const result = run('2026-10-14', input, { 'training:2026-10-13': record('有氧'), 'training:2026-10-12': record('上半身 · 常规强度') });
    expect(result.coverage).toHaveLength(6);
    expect(result.coverage.filter((item) => item.completed)).toHaveLength(2);
    expect(result.plans.get('2026-10-13')?.completed).toBe(true);
    expect(['有氧', '上半身']).not.toContain(project(result, '2026-10-14'));
  });
  it('今天在 TickTick 已练就展示完成记录，明天接着排', () => {
    const result = run('2026-10-14', source([['有氧', '2026-10-14']]));
    expect(result.plans.get('2026-10-14')).toMatchObject({ completed: true, projects: ['有氧'] });
    expect(project(result, '2026-10-15')).not.toBe('有氧');
  });
  it('休息日和轻量日不消耗项目，恢复按计划时仍能取回待练内容', () => {
    const first = project(run('2026-10-14'), '2026-10-14');
    for (const effort of ['rest', 'easy'] as const) {
      const result = run('2026-10-14', source(), { 'training:2026-10-14': record('旧计划', { effort, completed: false }) });
      expect(result.plans.get('2026-10-14')?.projects).toEqual([]);
      expect(project(result, '2026-10-15')).toBe(first);
      expect(automaticTraining('2026-10-14', result.byDate.get('2026-10-14'), DEFAULT_CYCLE, []).projects).toEqual([first]);
    }
    expect(recordedTrainingProjects({ plan: '有氧', effort: 'rest', completed: true, projects: ['有氧'] }, names.map(task))).toEqual([]);
    expect(recordedTrainingProjects({ plan: '今天没练有氧', effort: 'normal', completed: true }, names.map(task))).toEqual([]);
  });
  it('经期前三天暂停轮换，游泳和间歇延后，不把替代训练记成原项目', () => {
    const input = source([], [task('游泳'), task('HIIT')]);
    const result = run('2026-10-01', input, {}, cycle);
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03']) {
      expect(result.plans.get(date)?.plan).toContain('轻松散步');
      expect(result.plans.get(date)?.projects).toEqual([]);
    }
    expect(result.plans.get('2026-10-04')?.projects).toEqual([]);
    expect(new Set(['2026-10-08', '2026-10-09'].map((date) => project(result, date)))).toEqual(new Set(['游泳', 'hiit']));
    expect(automaticTraining('2026-10-22', [task('HIIT')], cycle, []).projects).toEqual([]);
  });
  it('跨年衔接历史完成，并保留手动计划与完成快照', () => {
    const manual = record('上半身', { mode: 'manual', completed: false });
    const input = { ...source([['有氧', '2026-12-31']]), entries: { 'training:2026-12-30': record('臀腿') } };
    const result = run('2027-01-01', input, { 'training:2027-01-01': manual }, DEFAULT_CYCLE, 2027, 1);
    expect(result.plans.get('2027-01-01')).toBe(manual.training);
    expect(result.coverage.filter((item) => item.completed)).toHaveLength(2);
    expect(['有氧', '臀腿', '上半身']).not.toContain(project(result, '2027-01-02'));
  });
  it('项目标识可保存、去重；非法项目数据拒绝写入', () => {
    const edit = { kind: 'training', date: '2026-10-14', text: '', revision: '', mutationId: 'mutation-123456789', training: record('有氧').training };
    expect(parseLifeEdit({ ...edit, training: { ...edit.training, projects: ['有氧', '有氧'] } }).training?.projects).toEqual(['有氧']);
    for (const projects of ['有氧', [4], [''], Array(31).fill('有氧')]) {
      expect(() => parseLifeEdit({ ...edit, training: { ...edit.training, projects } })).toThrow();
    }
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
