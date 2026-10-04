import { calendarCells, type CycleSettings, type LifeEntries, type TrainingRecord } from './bonLife.js';
import { cycleDay, suggestedTraining } from './lifeCycle.js';

export interface TrainingTask {
  id: string;
  name: string;
  title: string;
  schedule: string;
  dates: string[];
  notes: string;
  links: { title: string; url: string }[];
}
export interface TrainingSource { year: number; tasks: TrainingTask[]; connected: boolean; syncedAt: string | null }

// Personal defaults based on the user's template, not physiological performance guarantees.
// Evidence supports individual adjustment: https://pmc.ncbi.nlm.nih.gov/articles/PMC7497427/
export function personalTraining(date: string, tasks: TrainingTask[], settings: CycleSettings, periods: string[], effort: TrainingRecord['effort'] = 'normal'): string {
  if (effort === 'rest') return '休息';
  if (!tasks.length) return '休息 · 可选散步或拉伸';
  const phase = cycleDay(date, settings, periods);
  if (effort === 'easy' || (phase?.phase === 'menstrual' && phase.day <= 3)) return '轻松散步 15 分钟 · 舒缓拉伸 5 分钟';
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
  return { plan: tasks ? personalTraining(date, tasks, settings, periods, effort) : suggestedTraining(date, settings, periods, effort),
    effort, completed: false, mode: 'auto' };
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
