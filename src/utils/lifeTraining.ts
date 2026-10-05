import { calendarCells, type CycleSettings, type LifeEntries, type TrainingRecord } from './bonLife.js';
import ICAL from 'ical.js';
import { afterMenstrualPeriod, cycleDay, suggestedTraining } from './lifeCycle.js';
import { isCalendarDate } from './outlookCalendar.js';

export const TRAINING_MARKER = '运动是生活的第一个锚点';
export const trainingProjectKey = (name: string) => name.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
export const isTrainingTitle = (title: string) => trainingProjectKey(title).includes(TRAINING_MARKER)
  && trainingProjectKey(title) !== TRAINING_MARKER;
export const trainingName = (title: string) => (title.includes('运动') ? title.slice(0, title.indexOf('运动')).replace(/[\s·—\-:：]+$/u, '').trim() : title) || title;

export const TRAINING_TAGS = ['有氧', '力量'] as const;
export type TrainingTag = typeof TRAINING_TAGS[number];
export const isTrainingCategory = (name: string) => /^(有氧|力量)(运动|训练)?$/.test(trainingProjectKey(name));
export function trainingTags(project: { name: string; tags?: TrainingTag[] }): TrainingTag[] {
  if (project.tags) return project.tags;
  if (/爬坡|游泳|跑步|骑行|单车|椭圆机|有氧|HIIT/i.test(project.name)) return ['有氧'];
  if (/力量|力训|臀|腿|上半身|下半身|背|胸|哑铃/.test(project.name)) return ['力量'];
  return [];
}

export interface TrainingTask {
  id: string;
  key?: string;
  rotation?: boolean;
  tags?: TrainingTag[];
  name: string;
  title: string;
  schedule: string;
  dates: string[];
  scheduledDate?: string;
  repeatFlag?: string;
  notes: string;
  links: { title: string; url: string }[];
}
export interface TrainingCompletion { project: string; date: string }
export interface TrainingSource {
  year: number; tasks: TrainingTask[]; connected: boolean; syncedAt: string | null;
  completions?: TrainingCompletion[]; entries?: LifeEntries; periodDays?: string[];
  settings?: TrainingSettings;
}

export interface TrainingProject { key: string; name: string; notes: string; rotation: boolean; tags?: TrainingTag[] }
export interface TrainingSettings { projects: TrainingProject[]; revision: string }
export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = { projects: [], revision: '' };
export const trainingIdentity = (task: TrainingTask) => task.key ?? trainingProjectKey(task.name);
export const isSwimmingTraining = (task: Pick<TrainingTask, 'title' | 'name'>) => `${task.title}${task.name}`.includes('游泳');

export function parseTrainingSettings(value: unknown): TrainingSettings {
  const input = value as TrainingSettings | null;
  if (!input || typeof input.revision !== 'string' || input.revision.length > 80
    || !Array.isArray(input.projects) || input.projects.length > 60) throw new Error('训练项目设置无效');
  const keys = new Set<string>(); const names = new Set<string>();
  const projects = input.projects.map((project) => {
    if (!project || typeof project.key !== 'string' || !project.key || project.key.length > 120
      || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 60 || !trainingProjectKey(project.name)
      || typeof project.notes !== 'string' || project.notes.length > 500 || typeof project.rotation !== 'boolean') throw new Error('训练项目信息无效');
    if (project.tags !== undefined && (!Array.isArray(project.tags) || project.tags.length > TRAINING_TAGS.length
      || project.tags.some((tag) => !TRAINING_TAGS.includes(tag)))) throw new Error('训练项目标签无效');
    const name = trainingProjectKey(project.name);
    if (keys.has(project.key) || names.has(name)) throw new Error('训练项目不能重复');
    keys.add(project.key); names.add(name);
    return { key: project.key, name: project.name.trim(), notes: project.notes.trim(), rotation: project.rotation,
      ...(project.tags !== undefined ? { tags: TRAINING_TAGS.filter((tag) => project.tags!.includes(tag)) } : {}) };
  });
  return { projects, revision: input.revision };
}

export function trainingLibrary(tasks: TrainingTask[], settings = DEFAULT_TRAINING_SETTINGS): TrainingTask[] {
  const reusable = (name: string): TrainingTask => ({ id: `template:${name}`, key: trainingProjectKey(name), name, title: name,
    notes: '', rotation: false, schedule: '', dates: [], links: [] });
  const library = new Map(['爬坡', '游泳'].map((name) => [trainingProjectKey(name), reusable(name)]));
  for (const task of tasks) library.set(trainingIdentity(task), { ...task, key: trainingIdentity(task), rotation: task.rotation ?? true });
  for (const project of settings.projects) {
    const previous = library.get(project.key);
    library.set(project.key, { ...(previous ?? reusable(project.name)), ...project, id: previous?.id ?? `template:${project.key}` });
  }
  return [...library.values()].filter((task) => !isTrainingCategory(task.name)).map((task) => ({ ...task, tags: trainingTags(task) }));
}

export function reuseTrainingProjects(tasks: TrainingTask[]): TrainingRecord {
  const plan = tasks.map((task) => `${task.name}${task.notes ? ` · ${task.notes.replace(/\n/g, '；')}` : ''}`).join('\n');
  if (plan.length > 1000) throw new Error('训练内容过长，请减少项目或简化项目内容');
  return { plan, projects: tasks.map(trainingIdentity), effort: 'normal', completed: false, mode: 'manual' };
}

export function recordedTrainingProjects(record: TrainingRecord, tasks: TrainingTask[]) {
  if (record.effort === 'rest') return [];
  const keys = new Set(tasks.map(trainingIdentity));
  const names = new Map(tasks.map((task) => [trainingProjectKey(task.name), trainingIdentity(task)]));
  // New records carry explicit project identities. Legacy/manual text is matched
  // only as an exact exercise heading, never as a mention such as “今天没练有氧”.
  return [...new Set((record.projects ?? record.plan.split('\n').map((line) => names.get(trainingProjectKey(line.split(' · ')[0].trim())) ?? ''))
    .filter((key) => keys.has(key)))];
}

// Personal defaults based on the user's template, not physiological performance guarantees.
// Evidence supports individual adjustment: https://pmc.ncbi.nlm.nih.gov/articles/PMC7497427/
export function personalTraining(date: string, tasks: TrainingTask[], settings: CycleSettings, periods: string[], effort: TrainingRecord['effort'] = 'normal'): string {
  if (effort === 'rest') return '休息';
  const phase = cycleDay(date, settings, periods);
  if (effort === 'easy' || (phase?.phase === 'menstrual' && phase.day <= 3)) return '轻松散步 15 分钟 · 舒缓拉伸 5 分钟';
  if (!tasks.length) return '休息 · 可选散步或拉伸';
  return [...new Set(tasks.map((task) => {
    if (!phase) return task.name;
    if (phase?.phase === 'menstrual' || phase?.phase === 'lateLuteal') {
      if (/HIIT|间歇/i.test(task.name)) return '低强度有氧 20 分钟';
      return `${task.name} · 轻量`;
    }
    if (phase.phase === 'earlyLuteal' && trainingTags(task).includes('力量')) return `${task.name} · 可加量`;
    return task.name;
  }))].join('\n');
}

export function automaticTraining(date: string, tasks: TrainingTask[] | undefined, settings: CycleSettings, periods: string[], effort: TrainingRecord['effort'] = 'normal'): TrainingRecord {
  const record: TrainingRecord = { plan: tasks ? personalTraining(date, tasks, settings, periods, effort) : suggestedTraining(date, settings, periods, effort),
    effort, completed: false, mode: 'auto' };
  if (tasks) record.projects = recordedTrainingProjects(record, tasks);
  return record;
}

// Replan future automatic entries whenever cycle/source data changes. Manual, legacy and
// completed entries remain snapshots; opening or syncing the calendar never rewrites them.
export function plannedTraining(date: string, today: string, tasks: TrainingTask[] | undefined, settings: CycleSettings, periods: string[], saved?: TrainingRecord): TrainingRecord {
  if (saved && (saved.completed || saved.mode !== 'auto' || date < today)) return saved;
  if (date < today) return { plan: '', effort: 'normal', completed: false, mode: 'auto' };
  return automaticTraining(date, tasks, settings, periods, saved?.effort);
}

export function monthlyTrainingPlan(year: number, month: number, today: string, tasksByDate: Map<string, TrainingTask[]> | undefined, settings: CycleSettings, periods: string[], entries: LifeEntries) {
  return new Map(calendarCells(year, month).filter((date): date is string => Boolean(date)).map((date) => [date,
    plannedTraining(date, today, tasksByDate ? tasksByDate.get(date) ?? [] : undefined, settings, periods, entries[`training:${date}`]?.training)]));
}

const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Swimming keeps its own task dates and recurrence. It never consumes the
// daily rotation slot, and postponed menstrual occurrences merge on one date.
export function swimmingTrainingDates(task: TrainingTask, today: string, through: string, settings: CycleSettings, periods: string[]) {
  const dates = new Set<string>();
  const add = (date: string) => {
    const target = afterMenstrualPeriod(date < today ? today : date, settings, periods);
    if (target <= through) dates.add(target);
  };
  if (task.scheduledDate) {
    add(task.scheduledDate);
    if (task.repeatFlag) {
      const rule = ICAL.Recur.fromString(task.repeatFlag.replace(/^RRULE:/i, ''));
      const iterator = rule.iterator(ICAL.Time.fromDateString(task.scheduledDate));
      for (let i = 0; i < 150_000; i++) {
        const next = iterator.next();
        if (!next) break;
        const date = next.toString().slice(0, 10);
        if (date > through) break;
        if (date >= today) add(date);
      }
    }
  } else if (task.dates.length) task.dates.forEach(add);
  else if (!task.schedule) add(today); // An enabled undated local project has one next session, no invented repeat rule.
  return dates;
}

export function rollingTrainingPlan(year: number, month: number, today: string, source: TrainingSource,
  settings: CycleSettings, periods: string[], localEntries: LifeEntries) {
  // Category-only TickTick tasks remain readable as history, but cannot become
  // a selectable project or count as a completed climb/swim session.
  const categoryHistory: TrainingTask[] = [
    ...source.tasks.filter((task) => isTrainingCategory(task.name)),
    ...(source.settings?.projects ?? []).filter((project) => isTrainingCategory(project.name)).map((project) => ({
      ...project, id: `history:${project.key}`, title: project.name, schedule: '', dates: [], links: [],
    })),
    ...(source.completions ?? []).filter((completion) => isTrainingCategory(completion.project)).map((completion) => ({
      id: `history:${completion.project}`, key: completion.project, name: completion.project, title: completion.project,
      notes: '', schedule: '', dates: [], links: [],
    })),
  ];
  const tasks = [...new Map([...categoryHistory.map((task) => ({ ...task, rotation: false })),
    ...trainingLibrary([...source.tasks].sort((a, b) => a.id.localeCompare(b.id)), source.settings)]
    .map((task) => [trainingIdentity(task), task])).values()];
  const byKey = new Map(tasks.map((task) => [trainingIdentity(task), task]));
  const entries = { ...source.entries, ...localEntries };
  const actual = new Map<string, Set<string>>();
  const add = (date: string, projects: string[]) => {
    if (!isCalendarDate(date) || date > today) return;
    const done = actual.get(date) ?? new Set<string>();
    projects.filter((key) => byKey.has(key)).forEach((key) => done.add(key));
    actual.set(date, done);
  };
  for (const completion of source.completions ?? []) add(completion.date, [completion.project]);
  for (const [key, entry] of Object.entries(entries)) {
    if (key.startsWith('training:') && entry.training?.completed) add(key.slice(9), recordedTrainingProjects(entry.training, tasks));
  }
  const last = new Map<string, string>();
  for (const [date, projects] of actual) for (const key of projects) if (date > (last.get(key) ?? '')) last.set(key, date);
  const coverage = tasks.filter((task) => task.rotation !== false).map((task) => ({ task, lastCompleted: last.get(trainingIdentity(task)),
    completed: (last.get(trainingIdentity(task)) ?? '') >= shiftDay(today, -6) }));
  const plans = new Map<string, TrainingRecord>();
  const byDate = new Map<string, TrainingTask[]>();
  const days = calendarCells(year, month).filter((date): date is string => Boolean(date));
  const swims = new Map(tasks.filter(task => task.rotation !== false && isSwimmingTraining(task))
    .map(task => [trainingIdentity(task), swimmingTrainingDates(task, today, days.at(-1)!, settings, periods)]));
  for (const date of days) {
    const done = [...(actual.get(date) ?? [])].map((key) => byKey.get(key)!);
    byDate.set(date, done);
    const saved = entries[`training:${date}`]?.training;
    plans.set(date, saved ?? (done.length ? { plan: done.map((task) => task.name).join('\n'), effort: 'normal',
      completed: true, mode: 'auto', projects: done.map(trainingIdentity) }
      : { plan: '', effort: 'normal', completed: false, mode: 'auto' }));
  }
  // Future days are a forecast. Each new visit starts from actual completions,
  // so an uncompleted past plan cannot silently move the rotation forward.
  for (let date = today; date <= days[days.length - 1]; date = shiftDay(date, 1)) {
    const saved = entries[`training:${date}`]?.training;
    const done = [...(actual.get(date) ?? [])].map((key) => byKey.get(key)!);
    const phase = cycleDay(date, settings, periods);
    const mainDone = done.some(task => !isSwimmingTraining(task));
    const main = tasks.filter((task) => {
      if (task.rotation === false || isSwimmingTraining(task) || mainDone) return false;
      if (['menstrual', 'lateLuteal'].includes(phase?.phase ?? '') && /HIIT|间歇/i.test(task.name)) return false;
      return true;
    }).sort((a, b) => (last.get(trainingIdentity(a)) ?? '').localeCompare(last.get(trainingIdentity(b)) ?? '')
      || trainingIdentity(a).localeCompare(trainingIdentity(b))).slice(0, 1);
    const suggested = [...main, ...tasks.filter(task => swims.get(trainingIdentity(task))?.has(date)
      && !actual.get(date)?.has(trainingIdentity(task)))];
    let record: TrainingRecord;
    if (saved && (saved.completed || saved.mode !== 'auto')) {
      record = saved;
    } else {
      const effort = saved?.effort ?? 'normal';
      record = automaticTraining(date, suggested, settings, periods, effort);
      if (done.length) {
        const pending = recordedTrainingProjects(record, tasks);
        record = { ...record, completed: pending.length === 0,
          plan: [...(pending.length ? [record.plan] : []), ...done.map(task => `${task.name}${pending.length ? ' · 已完成' : ''}`)].join('\n'),
          projects: [...pending, ...done.map(trainingIdentity)] };
      }
    }
    // Only simulate future planned sessions; they never enter the actual history.
    for (const key of recordedTrainingProjects(record, tasks)) last.set(key, date);
    if (plans.has(date)) { plans.set(date, record); byDate.set(date, record.completed ? done : suggested); }
  }
  return { plans, byDate, coverage, completedByDate: actual };
}
