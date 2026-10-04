import type { CycleSettings, TrainingRecord } from './bonLife.js';
import { isCalendarDate } from './outlookCalendar.js';

export const CYCLE_GUIDANCE = {
  menstrual: { label: '月经期', exercise: '散步、舒缓瑜伽；不适时休息', food: '瘦肉、豆类、绿叶菜，搭配水果', plan: '散步 20 分钟 · 舒缓拉伸 5 分钟' },
  follicular: { label: '卵泡期', exercise: '力量训练、快走或骑行，按体感安排', food: '全谷物、蛋白质、蔬果，规律三餐', plan: '全身力量 30 分钟 · 拉伸 5 分钟' },
  ovulatory: { label: '排卵期', exercise: '维持日常力量或有氧，充分热身', food: '均衡三餐，训练前后补水和进食', plan: '快走或骑行 30 分钟 · 拉伸 5 分钟' },
  earlyLuteal: { label: '黄体早期', exercise: '力量、快走或游泳，疲劳时减量', food: '全谷物、鱼蛋豆奶，足量饮水', plan: '全身力量 25 分钟 · 拉伸 5 分钟' },
  lateLuteal: { label: '黄体晚期', exercise: '快走、轻量力量或瑜伽，不适时休息', food: '全谷物、豆类、奶或豆奶；腹胀时少盐', plan: '舒缓瑜伽或快走 20 分钟' },
} as const;
export type CyclePhase = keyof typeof CYCLE_GUIDANCE;
export interface CycleDay { phase: CyclePhase; day: number; estimated: boolean }
const DAY = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

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
  const ovulation = settings.cycleLength - 14;
  const phase: CyclePhase = day <= settings.periodLength ? 'menstrual'
    : day < ovulation - 1 ? 'follicular' : day <= ovulation + 1 ? 'ovulatory'
      : day <= settings.cycleLength - 7 ? 'earlyLuteal' : 'lateLuteal';
  return { phase, day, estimated: !(anchor === settings.lastPeriodStart && offset === 0) };
}

export function suggestedTraining(date: string, settings: CycleSettings, periods: string[], effort: TrainingRecord['effort'] = 'normal'): string {
  const phase = cycleDay(date, settings, periods);
  if (!phase) return '';
  if (effort === 'rest') return '休息';
  if (!settings.trainingDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) return '休息 · 可选散步或拉伸';
  if (effort === 'easy') return '轻松散步 15 分钟 · 舒缓拉伸 5 分钟';
  return CYCLE_GUIDANCE[phase.phase].plan;
}
