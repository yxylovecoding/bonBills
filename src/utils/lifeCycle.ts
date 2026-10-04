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

// The supplied chart is a training template, not a physiological ovulation model.
// Its 28-day bands are 1–7, 8–13, 14–19 and 20–28. Scale the template for the
// configured cycle; a longer configured/recorded period takes precedence.
export function cyclePhaseRanges(settings: CycleSettings): { phase: CyclePhase; start: number; end: number }[] {
  const first = Math.max(settings.periodLength, Math.round(settings.cycleLength * 7 / 28));
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
  const days = [...new Set(periodDays.filter(isCalendarDate))].sort();
  const starts = days.filter((day, index) => index === 0 || dayNumber(day) - dayNumber(days[index - 1]) > 1);
  starts.push(...(settings.periodStarts ?? []).filter(isCalendarDate));
  if (settings.lastPeriodStart) starts.push(settings.lastPeriodStart);
  const anchor = starts.filter((start) => start <= date).sort().pop();
  if (!anchor) return null;
  const offset = dayNumber(date) - dayNumber(anchor);
  const day = offset % settings.cycleLength + 1;
  if (days.includes(date)) return { phase: 'menstrual', day, estimated: false };
  const phase = cyclePhaseRanges(settings).find((range) => day <= range.end)!.phase;
  return { phase, day, estimated: !(anchor === settings.lastPeriodStart && offset === 0) };
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
