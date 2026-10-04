import type { CycleSettings, TrainingRecord } from './bonLife.js';
import { cycleDay } from './lifeCycle.js';

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

// Keep the user's split. Phase adjustments are editable defaults, not mandatory restrictions.
export function personalTraining(date: string, tasks: TrainingTask[], settings: CycleSettings, periods: string[], effort: TrainingRecord['effort'] = 'normal'): string {
  if (effort === 'rest') return '休息';
  if (!tasks.length) return '休息 · 可选散步或拉伸';
  const phase = cycleDay(date, settings, periods);
  return tasks.map((task) => {
    if (effort === 'easy' || (phase?.phase === 'menstrual' && phase.day <= 3)) return `${task.name} → 轻松散步或舒缓拉伸`;
    if (phase?.phase === 'menstrual' || phase?.phase === 'lateLuteal') {
      if (/HIIT|间歇/i.test(task.name)) return `${task.name} → 低强度有氧`;
      return `${task.name} · 轻量，按体感调整`;
    }
    return task.name;
  }).join('\n');
}
