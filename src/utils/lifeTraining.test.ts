import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE, parseLifeEdit, type LifeEntries, type TrainingRecord } from './bonLife';
import { automaticTraining, monthlyTrainingPlan, personalTraining, plannedTraining, recordedTrainingProjects, rollingTrainingPlan, trainingProjectKey, type TrainingSource, type TrainingTask } from './lifeTraining';

const task = (name: string): TrainingTask => ({ id: name, name, title: name, schedule: '', dates: [], notes: '', links: [] });
const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-01', trainingDays: [] };
describe('按个人训练分化调整经期计划', () => {
  it('使用 TickTick 当日分化，不被旧的训练日设置覆盖；无经期也保留原计划', () => {
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [])).toBe('上半身');
    expect(personalTraining('2026-10-14', [task('全身力训')], cycle, [])).toBe('全身力训 · 可加量');
    expect(personalTraining('2026-10-08', [task('臀腿')], DEFAULT_CYCLE, [])).toBe('臀腿');
    expect(personalTraining('2026-10-08', [], cycle, [])).toContain('休息');
  });
  it('经期初段和轻量选项降强度，黄体后段保留各项训练并标轻量', () => {
    expect(personalTraining('2026-10-02', [task('臀腿')], cycle, [])).toBe('轻松散步 15 分钟 · 舒缓拉伸 5 分钟');
    expect(personalTraining('2026-10-22', [task('HIIT')], cycle, [])).toBe('HIIT · 轻量');
    expect(personalTraining('2026-10-22', [task('上半身')], cycle, [])).toContain('上半身 · 轻量');
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [], 'easy')).toContain('舒缓拉伸');
    expect(personalTraining('2026-10-08', [task('上半身')], cycle, [], 'rest')).toBe('休息');
  });
  it('同日多个任务都保留，已记录的经期覆盖估计阶段', () => {
    expect(personalTraining('2026-10-08', [task('上半身'), task('爬坡')], cycle, [])).toBe('上半身\n爬坡');
    expect(personalTraining('2026-10-14', [task('HIIT')], cycle, ['2026-10-14'])).toContain('轻松散步');
  });
  it('经期初段把同日多个训练合并为一次恢复训练', () => {
    expect(personalTraining('2026-10-02', [task('臀腿'), task('游泳')], cycle, []).split('\n')).toHaveLength(1);
  });
});

describe('按实际完成滚动轮换', () => {
  const names = ['爬坡', '上半身', '臀腿', '全身力训', 'HIIT', '游泳'];
  const source = (completed: [string, string][] = [], tasks = names.map(task)): TrainingSource => ({ year: 2026, tasks,
    connected: true, syncedAt: '2026-10-14T00:00:00Z', hairWash: { scheduledDate: '2026-10-01', repeatFlag: 'FREQ=DAILY' }, completions: completed.map(([name, date]) => ({ project: trainingProjectKey(name), date })) });
  const record = (plan: string, extra: Partial<TrainingRecord> = {}) => ({ text: '', revision: 'saved', training: {
    plan, effort: 'normal' as const, completed: true, mode: 'auto' as const, ...extra } });
  const run = (today: string, input = source(), entries: LifeEntries = {}, settings = DEFAULT_CYCLE, year = 2026, month = 10) =>
    rollingTrainingPlan(year, month, today, input, settings, [], entries);
  const project = (result: ReturnType<typeof run>, date: string) => result.plans.get(date)?.projects?.[0];

  it('上周三爬坡后停一周，下周三接漏练项目，不按原星期重置', () => {
    const input = source([['爬坡', '2026-10-07']], names.map((name) => ({ ...task(name), schedule: '每周三', dates: ['2026-10-14'] })));
    const result = run('2026-10-14', input);
    expect(project(result, '2026-10-14')).toBeTruthy();
    expect(project(result, '2026-10-14')).not.toBe('爬坡');
    expect(result.coverage.every((item) => !item.completed)).toBe(true);
    expect(result.coverage.find((item) => item.task.name === '爬坡')?.lastCompleted).toBe('2026-10-07');
    const week = Array.from({ length: 6 }, (_, i) => result.plans.get(`2026-10-${14 + i}`)?.projects ?? []).flat();
    expect(new Set(week)).toEqual(new Set(names.map(trainingProjectKey)));
  });
  it('没练不推进；完成后才推进，跨过周日也不重置', () => {
    const first = run('2026-10-10');
    const missed = { 'training:2026-10-10': record(first.plans.get('2026-10-10')!.plan, { ...first.plans.get('2026-10-10'), completed: false }) };
    const retry = run('2026-10-12', source(), missed);
    expect(project(retry, '2026-10-12')).toBe(project(first, '2026-10-10'));
    missed['training:2026-10-10'].training.completed = true;
    expect(project(run('2026-10-12', source(), missed), '2026-10-12')).not.toBe(project(first, '2026-10-10'));
    expect(run('2026-10-12', source(), missed).coverage.filter((item) => item.completed && item.task.name !== '游泳')).toHaveLength(1);
  });
  it('覆盖一轮后继续轮换，不强制每项间隔七天；最久未练优先', () => {
    const first = run('2026-10-14');
    const week = Array.from({ length: 7 }, (_, i) => project(first, `2026-10-${14 + i}`)).filter(Boolean);
    expect(week).toHaveLength(5);
    expect(new Set(week).size).toBe(5);
    expect(project(first, '2026-10-21')).toBe(project(first, '2026-10-14'));
    const history = names.map((name, i): [string, string] => [name, `2026-10-${String(2 + i).padStart(2, '0')}`]);
    expect(project(run('2026-10-14', source(history)), '2026-10-14')).toBe('爬坡');
  });
  it('Web 和 TickTick 完成记录共同推进，项目改 ID、重复实例和重复完成不重复计数', () => {
    const input = source([['爬坡', '2026-10-13'], ['爬坡', '2026-10-13'], ['上半身', '2026-10-20']], [...names.map(task), { ...task('爬坡'), id: 'other-id' }]);
    const result = run('2026-10-14', input, { 'training:2026-10-13': record('爬坡'), 'training:2026-10-12': record('上半身 · 常规强度') });
    expect(result.coverage).toHaveLength(6);
    expect(result.coverage.filter((item) => item.completed)).toHaveLength(2);
    expect(result.plans.get('2026-10-13')?.completed).toBe(true);
    expect(['爬坡', '上半身']).not.toContain(project(result, '2026-10-14'));
  });
  it('今天在 TickTick 已练就展示完成记录，明天接着排', () => {
    const result = run('2026-10-14', source([['爬坡', '2026-10-14']], names.filter(name => name !== '游泳').map(task)));
    expect(result.plans.get('2026-10-14')).toMatchObject({ completed: true, projects: ['爬坡'] });
    expect(project(result, '2026-10-15')).not.toBe('爬坡');
  });
  it('休息日和轻量日不消耗项目，恢复按计划时仍能取回待练内容', () => {
    const first = project(run('2026-10-14'), '2026-10-14');
    for (const effort of ['rest', 'easy'] as const) {
      const result = run('2026-10-14', source(), { 'training:2026-10-14': record('旧计划', { effort, completed: false }) });
      expect(result.plans.get('2026-10-14')?.projects).toEqual([]);
      expect(project(result, '2026-10-15')).toBe(first);
      expect(automaticTraining('2026-10-14', result.byDate.get('2026-10-14'), DEFAULT_CYCLE, []).projects).toEqual([first, '游泳']);
    }
    expect(recordedTrainingProjects({ plan: '爬坡', effort: 'rest', completed: true, projects: ['爬坡'] }, names.map(task))).toEqual([]);
    expect(recordedTrainingProjects({ plan: '今天没练爬坡', effort: 'normal', completed: true }, names.map(task))).toEqual([]);
  });
  it('经期前三天暂停轮换，游泳和间歇延后，不把替代训练记成原项目', () => {
    const input = source([], [task('游泳'), task('HIIT')]);
    const result = run('2026-10-01', input, {}, cycle);
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03']) {
      expect(result.plans.get(date)?.plan).toContain('轻松散步');
      expect(result.plans.get(date)?.projects).toEqual([]);
    }
    expect(result.plans.get('2026-10-04')?.projects).toEqual([]);
    expect(result.plans.get('2026-10-06')?.projects).toEqual(['hiit', '游泳']);
    expect(result.plans.get('2026-10-07')?.projects).toEqual(['hiit']);
    expect(automaticTraining('2026-10-22', [task('HIIT')], cycle, []).projects).toEqual(['hiit']);
  });
  it('跨年衔接历史完成，并保留手动计划与完成快照', () => {
    const manual = record('上半身', { mode: 'manual', completed: false });
    const input = { ...source([['爬坡', '2026-12-31']]), entries: { 'training:2026-12-30': record('臀腿') } };
    const result = run('2027-01-01', input, { 'training:2027-01-01': manual }, DEFAULT_CYCLE, 2027, 1);
    expect(result.plans.get('2027-01-01')).toBe(manual.training);
    expect(result.coverage.filter((item) => item.completed)).toHaveLength(2);
    expect(['爬坡', '臀腿', '上半身']).not.toContain(project(result, '2027-01-02'));
  });
  it('项目标识可保存、去重；非法项目数据拒绝写入', () => {
    const edit = { kind: 'training', date: '2026-10-14', text: '', revision: '', mutationId: 'mutation-123456789', training: record('爬坡').training };
    expect(parseLifeEdit({ ...edit, training: { ...edit.training, projects: ['爬坡', '爬坡'] } }).training?.projects).toEqual(['爬坡']);
    for (const projects of ['爬坡', [4], [''], Array(31).fill('爬坡')]) {
      expect(() => parseLifeEdit({ ...edit, training: { ...edit.training, projects } })).toThrow();
    }
  });
});

describe('游泳独立安排', () => {
  const swim: TrainingTask = { ...task('游泳'), scheduledDate: '2026-10-05', repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=2', schedule: '每 2 天' };
  const run = (completions: TrainingSource['completions'] = [], swimming = swim, today = '2026-10-05', cycle = DEFAULT_CYCLE, year = 2026, month = 10) =>
    rollingTrainingPlan(year, month, today, { year, connected: true, syncedAt: null,
      tasks: ['上半身', '全身力训', '臀腿'].map(task).concat(swimming), completions,
      hairWash: { scheduledDate: today, repeatFlag: 'FREQ=DAILY;INTERVAL=2', repeatFrom: '1' } }, cycle, [], {});
  it('同一天保留主训练和游泳，主训练连续轮换，游泳跟随洗头频率', () => {
    const result = run();
    for (let day = 5; day <= 11; day++) {
      const projects = result.plans.get(`2026-10-${String(day).padStart(2, '0')}`)!.projects!;
      expect(projects.filter(key => key !== '游泳')).toHaveLength([8, 11].includes(day) ? 0 : 1);
      expect(projects.includes('游泳')).toBe(day % 2 === 1);
    }
    expect(result.plans.get('2026-10-05')?.projects).toEqual(['上半身', '游泳']);
    expect(result.plans.get('2026-10-08')?.plan).toBe('休息');
    expect(result.plans.get('2026-10-09')?.projects).toContain('上半身');
  });
  it('只完成游泳不完成主训练，只完成主训练也保留待游泳', () => {
    const swimmingDone = run([{ project: '游泳', date: '2026-10-05' }]);
    expect(swimmingDone.plans.get('2026-10-05')).toMatchObject({ completed: false, projects: ['上半身', '游泳'] });
    expect(swimmingDone.plans.get('2026-10-05')?.plan).toContain('游泳 · 已完成');
    const mainDone = run([{ project: '上半身', date: '2026-10-05' }]);
    expect(mainDone.plans.get('2026-10-05')).toMatchObject({ completed: false, projects: ['游泳', '上半身'] });
    expect(mainDone.plans.get('2026-10-05')?.plan).not.toContain('全身力训');
    expect(run([{ project: '上半身', date: '2026-10-05' }, { project: '游泳', date: '2026-10-05' }]).plans.get('2026-10-05')?.completed).toBe(true);
  });
  it('经期仅顺延游泳，不挤掉经后当天主训练；跨年保持同一重复规则', () => {
    const result = run([], { ...swim, scheduledDate: '2026-12-29' }, '2026-12-29',
      { ...DEFAULT_CYCLE, lastPeriodStart: '2026-12-29', automatic: false }, 2027, 1);
    expect(result.plans.get('2027-01-01')?.projects).not.toContain('游泳');
    expect(result.plans.get('2027-01-04')?.plan).toContain('主训练休息');
    expect(result.plans.get('2027-01-03')?.projects).not.toContain('游泳');
    expect(result.plans.get('2027-01-04')?.projects).toContain('游泳');
    expect(result.plans.get('2027-01-05')?.projects).not.toContain('游泳');
  });
  it('一次性游泳不变成每天，移到非洗头日的待办继续对齐洗头', () => {
    const one = run([], { ...swim, repeatFlag: undefined });
    expect(one.plans.get('2026-10-05')?.projects).toContain('游泳');
    expect(one.plans.get('2026-10-07')?.projects).not.toContain('游泳');
    const moved = run([], { ...swim, scheduledDate: '2026-10-06', repeatFlag: 'RRULE:FREQ=WEEKLY;BYDAY=MO' });
    expect(moved.plans.get('2026-10-06')?.projects).not.toContain('游泳');
    expect(moved.plans.get('2026-10-07')?.projects).toContain('游泳');
    expect(moved.plans.get('2026-10-12')?.projects).not.toContain('游泳');
    expect(moved.plans.get('2026-10-13')?.projects).toContain('游泳');
    expect(moved.plans.get('2026-10-05')?.projects).not.toContain('游泳');
  });
  it('经后游泳也只选洗头日，主训练恢复不改变独立游泳日期', () => {
    const result = run([], swim, '2026-10-05', { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-15', automatic: false });
    for (let day = 15; day <= 20; day++) expect(result.plans.get(`2026-10-${day}`)?.projects).not.toContain('游泳');
    expect(result.plans.get('2026-10-20')?.projects).not.toContain('游泳');
    expect(result.plans.get('2026-10-21')?.plan).toContain('主训练休息');
    expect(result.plans.get('2026-10-21')?.projects).toContain('游泳');
    expect(result.plans.get('2026-10-23')?.projects?.filter(key => key === '游泳')).toHaveLength(1);
    expect(result.plans.get('2026-10-22')?.projects).not.toContain('游泳');
    expect(result.plans.get('2026-10-23')?.projects).toContain('游泳');
  });
  it('洗头完成后日期改变会重排未来游泳；无日期来源不凭空安排', () => {
    const source: TrainingSource = { year: 2026, connected: true, syncedAt: null, tasks: [task('上半身'), swim],
      hairWash: { scheduledDate: '2026-10-06', repeatFlag: 'FREQ=DAILY;INTERVAL=2', repeatFrom: '1' } };
    const plan = () => rollingTrainingPlan(2026, 10, '2026-10-05', source, DEFAULT_CYCLE, [], {}).plans;
    expect(plan().get('2026-10-05')?.projects).not.toContain('游泳');
    expect(plan().get('2026-10-06')?.projects).toContain('游泳');
    expect(plan().get('2026-10-07')?.projects).not.toContain('游泳');
    source.hairWash = null;
    expect([...plan().values()].some(record => record.projects?.includes('游泳'))).toBe(false);
  });
});

describe('未来训练自动排期', () => {
  const saved: TrainingRecord = { plan: '旧的自动计划', effort: 'normal', completed: false, mode: 'auto' };
  it('整月安排包含下个周期与休息日，并尊重来源的实际日期', () => {
    const dates = new Map(['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'].map((date) => [date, [task('上半身')]]));
    const plans = monthlyTrainingPlan(2026, 10, '2026-10-04', dates, cycle, [], {});
    expect(plans.size).toBe(31);
    expect(plans.get('2026-10-08')?.plan).toBe('上半身');
    expect(plans.get('2026-10-15')?.plan).toBe('上半身 · 可加量');
    expect(plans.get('2026-10-22')?.plan).toContain('轻量');
    expect(plans.get('2026-10-29')?.plan).toContain('轻松散步');
    expect(plans.get('2026-10-09')?.plan).toContain('休息');
  });
  it('新的经期设置、经期记录和训练来源都会更新未来自动计划', () => {
    const resolve = (settings = cycle, periods: string[] = [], name = 'HIIT') => plannedTraining('2026-10-22', '2026-10-04', [task(name)], settings, periods, saved);
    expect(resolve().plan).toBe('HIIT · 轻量');
    expect(resolve({ ...cycle, lastPeriodStart: '2026-10-15' }).plan).toBe('HIIT');
    expect(resolve(cycle, ['2026-10-22']).plan).toContain('轻松散步');
    expect(resolve(cycle, [], '游泳').plan).toContain('游泳 · 轻量');
  });
  it('跨年与闰月逐日排期，不限于当前任务的下一次发生', () => {
    const plans = monthlyTrainingPlan(2027, 1, '2026-12-20', new Map([['2027-01-07', [task('上半身')]]]), { ...cycle, lastPeriodStart: '2026-12-31' }, [], {});
    expect(plans.get('2027-01-07')?.plan).toBe('上半身');
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
