import type { CycleSettings, TrainingRecord } from './bonLife.js';
import { isCalendarDate } from './outlookCalendar.js';

export const CYCLE_GUIDANCE = {
  menstrual: { label: '月经期', subtitle: '卵泡早期', exercise: '前 3 天偏轻量；低强度有氧、瑜伽，舒适时加轻量上肢', food: '富铁食物：瘦红肉、豆类；主食搭配粗粮', plan: '低强度有氧 20 分钟 · 轻量上肢 10 分钟' },
  ovulatory: { label: '排卵期', subtitle: '卵泡中后期', exercise: '逐渐恢复力量与有氧；已有间歇训练习惯且状态好时可选短间歇', food: '每餐搭配鱼、蛋、奶或豆制品，保证蛋白质摄入', plan: '全身力量 25 分钟 · 中等强度有氧 10 分钟' },
  earlyLuteal: { label: '黄体早期', subtitle: '', exercise: '以力量训练为主；状态好时小幅增加训练量', food: '营养均衡；按训练量补充米饭、薯类等碳水', plan: '全身力量 30 分钟 · 拉伸 5 分钟' },
  lateLuteal: { label: '黄体中晚期', subtitle: '', exercise: '中低强度有氧、轻量力量；疲劳时减量或休息', food: '鱼类、坚果、全谷物；可选香蕉、南瓜籽、少量黑巧', plan: '中低强度有氧 20 分钟 · 轻量力量 10 分钟' },
} as const;
export type CyclePhase = keyof typeof CYCLE_GUIDANCE;
export interface CycleDay { phase: CyclePhase; day: number; estimated: boolean }
const DAY = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const shanghaiToday = () => dateFormatter.format(new Date());
const addDays = (date: string, days: number) => new Date((dayNumber(date) + days) * DAY).toISOString().slice(0, 10);

function periodHistory(settings: CycleSettings, periodDays: string[]) {
  const days = [...new Set(periodDays.filter(isCalendarDate))].sort();
  const runs: { start: string; end: string; length: number }[] = [];
  for (const day of days) {
    const previous = runs[runs.length - 1];
    if (previous && dayNumber(day) - dayNumber(previous.end) === 1) {
      previous.end = day; previous.length++;
    } else runs.push({ start: day, end: day, length: 1 });
  }
  // A manually entered day inside an Outlook period is the same period, not a new cycle.
  const manual = [...(settings.periodStarts ?? []), settings.lastPeriodStart].filter(isCalendarDate)
    .filter((start) => !runs.some((run) => start >= run.start && start <= run.end));
  return { days, runs, starts: [...new Set([...runs.map((run) => run.start), ...manual])].sort() };
}

function recentMedian(values: number[], fallback: number) {
  const recent = values.slice(-6).sort((a, b) => a - b);
  const middle = Math.floor(recent.length / 2);
  return recent.length ? Math.round((recent[middle] + recent[Math.floor((recent.length - 1) / 2)]) / 2) : fallback;
}

export function estimateCycle(settings: CycleSettings, periodDays: string[], today = shanghaiToday()) {
  const { runs, starts } = periodHistory(settings, periodDays);
  const recordedStarts = starts.filter((start) => start <= today);
  const intervals = recordedStarts.slice(1).map((start, index) => dayNumber(start) - dayNumber(recordedStarts[index]))
    .filter((length) => length >= 21 && length <= 45);
  // A single-day event may only mark the start; an ongoing range is not a completed duration.
  const durations = runs.filter((run) => dayNumber(today) - dayNumber(run.end) > 1 && run.length >= 2 && run.length <= 10)
    .map((run) => run.length);
  const automatic = settings.automatic !== false;
  const cycleLength = automatic ? recentMedian(intervals, settings.cycleLength) : settings.cycleLength;
  const periodLength = automatic ? recentMedian(durations, settings.periodLength) : settings.periodLength;
  const lastPeriodStart = recordedStarts[recordedStarts.length - 1] ?? '';
  // Keep an overdue estimate anchored to the last record, rather than pretending a period happened.
  return { cycleLength, periodLength, lastPeriodStart, cycleSamples: Math.min(6, intervals.length),
    periodSamples: Math.min(6, durations.length), nextPeriodStart: lastPeriodStart ? addDays(lastPeriodStart, cycleLength) : '' };
}

// The supplied chart is a training template, not a physiological ovulation model.
// Scale the later bands with the cycle, but use the recorded/estimated period
// length for the menstrual band instead of a fixed seven days.
export function cyclePhaseRanges(settings: CycleSettings): { phase: CyclePhase; start: number; end: number }[] {
  const first = settings.periodLength;
  const second = Math.max(first + 1, Math.round(settings.cycleLength * 13 / 28));
  const third = Math.max(second + 1, Math.round(settings.cycleLength * 19 / 28));
  return [
    { phase: 'menstrual', start: 1, end: first },
    { phase: 'ovulatory', start: first + 1, end: second },
    { phase: 'earlyLuteal', start: second + 1, end: third },
    { phase: 'lateLuteal', start: third + 1, end: settings.cycleLength },
  ];
}

export function cycleDay(date: string, settings: CycleSettings, periodDays: string[]): CycleDay | null {
  if (!isCalendarDate(date)) return null;
  const { days, starts } = periodHistory(settings, periodDays);
  const anchor = starts.filter((start) => start <= date).pop();
  if (!anchor) return null;
  const today = shanghaiToday();
  const effective = { ...settings, ...estimateCycle(settings, periodDays, date < today ? date : today) };
  const offset = dayNumber(date) - dayNumber(anchor);
  const day = offset % effective.cycleLength + 1;
  if (days.includes(date)) return { phase: 'menstrual', day, estimated: false };
  const phase = cyclePhaseRanges(effective).find((range) => day <= range.end)!.phase;
  return { phase, day, estimated: offset !== 0 };
}

export function visibleCycleDay(date: string, settings: CycleSettings, periodDays: string[],
  today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())): CycleDay | null {
  const phase = cycleDay(date, settings, periodDays);
  // Past predictions are not historical records; retain only recorded period days/starts.
  return date < today && phase?.estimated ? null : phase;
}

// User preference: swimming resumes on the first day outside the menstrual band.
export function afterMenstrualPeriod(date: string, settings: CycleSettings, periods: string[]): string {
  let next = date;
  for (let count = 0; count < 90; count++) {
    if (cycleDay(next, settings, periods)?.phase !== 'menstrual') return next;
    next = new Date(Date.parse(`${next}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  }
  throw new Error('经期日期过长，请检查经期记录');
}

export function suggestedTraining(date: string, settings: CycleSettings, periods: string[], effort: TrainingRecord['effort'] = 'normal'): string {
  const phase = cycleDay(date, settings, periods);
  if (!phase) return '';
  if (effort === 'rest') return '休息';
  if (!settings.trainingDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) return '休息 · 可选散步或拉伸';
  if (effort === 'easy') return '轻松散步 15 分钟 · 舒缓拉伸 5 分钟';
  if (phase.phase === 'menstrual' && phase.day <= 3) return '轻松散步 15 分钟 · 舒缓瑜伽 10 分钟';
  return CYCLE_GUIDANCE[phase.phase].plan;
}
