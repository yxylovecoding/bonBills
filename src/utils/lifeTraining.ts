import { calendarCells, type CycleSettings, type LifeEntries, type TrainingRecord } from './bonLife.js';
import { cycleDay, suggestedTraining } from './lifeCycle.js';
import { isCalendarDate } from './outlookCalendar.js';

export const TRAINING_MARKER = '运动是生活的第一个锚点';
export const trainingProjectKey = (name: string) => name.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
export const isTrainingTitle = (title: string) => trainingProjectKey(title).includes(TRAINING_MARKER)
  && trainingProjectKey(title) !== TRAINING_MARKER;
export const trainingName = (title: string) => (title.includes('运动') ? title.slice(0, title.indexOf('运动')).replace(/[\s·—\-:：]+$/u, '').trim() : title) || title;

export interface TrainingTask {
  id: string;
  name: string;
  title: string;
  schedule: string;
  dates: string[];
  notes: string;
  links: { title: string; url: string }[];
}
export interface TrainingCompletion { project: string; date: string }
export interface TrainingSource {
  year: number; tasks: TrainingTask[]; connected: boolean; syncedAt: string | null;
  completions?: TrainingCompletion[]; entries?: LifeEntries;
}

export function recordedTrainingProjects(record: TrainingRecord, tasks: TrainingTask[]) {
  if (record.effort === 'rest') return [];
  const keys = new Set(tasks.map((task) => trainingProjectKey(task.name)));
  // New records carry explicit project identities. Legacy/manual text is matched
  // only as an exact exercise heading, never as a mention such as “今天没练有氧”.
  return [...new Set((record.projects ?? record.plan.split('\n').map((line) => trainingProjectKey(line.split(' · ')[0].trim())))
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
      return `${task.name} · 轻量，减少训练量`;
    }
    if (phase.phase === 'earlyLuteal' && /力量|力训|臀|腿|上半身|下半身|背|胸|哑铃/.test(task.name)) return `${task.name} · 常规力量，按体感加量`;
    return `${task.name} · 常规强度`;
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

export function rollingTrainingPlan(year: number, month: number, today: string, source: TrainingSource,
  settings: CycleSettings, periods: string[], localEntries: LifeEntries) {
  const tasks = [...new Map([...source.tasks].sort((a, b) => a.id.localeCompare(b.id))
    .map((task) => [trainingProjectKey(task.name), task])).values()];
  const byKey = new Map(tasks.map((task) => [trainingProjectKey(task.name), task]));
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
  const coverage = tasks.map((task) => ({ task, lastCompleted: last.get(trainingProjectKey(task.name)),
    completed: (last.get(trainingProjectKey(task.name)) ?? '') >= shiftDay(today, -6) }));
  const plans = new Map<string, TrainingRecord>();
  const byDate = new Map<string, TrainingTask[]>();
  const days = calendarCells(year, month).filter((date): date is string => Boolean(date));
  for (const date of days) {
    const done = [...(actual.get(date) ?? [])].map((key) => byKey.get(key)!);
    byDate.set(date, done);
    const saved = entries[`training:${date}`]?.training;
    plans.set(date, saved ?? (done.length ? { plan: done.map((task) => task.name).join('\n'), effort: 'normal',
      completed: true, mode: 'auto', projects: done.map((task) => trainingProjectKey(task.name)) }
      : { plan: '', effort: 'normal', completed: false, mode: 'auto' }));
  }
  // Future days are a forecast. Each new visit starts from actual completions,
  // so an uncompleted past plan cannot silently move the rotation forward.
  for (let date = today; date <= days[days.length - 1]; date = shiftDay(date, 1)) {
    const saved = entries[`training:${date}`]?.training;
    const done = [...(actual.get(date) ?? [])].map((key) => byKey.get(key)!);
    let selected: TrainingTask[] = [];
    let record: TrainingRecord;
    if (saved && (saved.completed || saved.mode !== 'auto')) {
      record = saved;
      selected = recordedTrainingProjects(saved, tasks).map((key) => byKey.get(key)!);
    } else if (done.length) {
      selected = done;
      record = { plan: done.map((task) => task.name).join('\n'), effort: 'normal', completed: true,
        mode: 'auto', projects: done.map((task) => trainingProjectKey(task.name)) };
    } else {
      const phase = cycleDay(date, settings, periods);
      const effort = saved?.effort ?? 'normal';
      selected = tasks.filter((task) => {
        if (phase?.phase === 'menstrual' && task.title.includes('游泳')) return false;
        if (['menstrual', 'lateLuteal'].includes(phase?.phase ?? '') && /HIIT|间歇/i.test(task.name)) return false;
        return (last.get(trainingProjectKey(task.name)) ?? '') <= shiftDay(date, -7);
      }).sort((a, b) => (last.get(trainingProjectKey(a.name)) ?? '').localeCompare(last.get(trainingProjectKey(b.name)) ?? '')
        || trainingProjectKey(a.name).localeCompare(trainingProjectKey(b.name))).slice(0, 1);
      record = automaticTraining(date, selected, settings, periods, effort);
    }
    // Only simulate future planned sessions; they never enter the actual history.
    for (const key of recordedTrainingProjects(record, tasks)) last.set(key, date);
    if (plans.has(date)) { plans.set(date, record); byDate.set(date, selected); }
  }
  return { plans, byDate, coverage };
}
