import { isCalendarDate, nextCalendarDate } from './outlookCalendar.js';

export const LIFE_KINDS = ['skin', 'mood', 'body', 'training'] as const;
export type LifeKind = typeof LIFE_KINDS[number];
export type LifeView = LifeKind | 'done';
export const LIFE_LABELS: Record<LifeView, string> = { skin: '皮肤', mood: '情绪', body: '体围', training: '训练', done: 'DoneList' };
export const LIFE_TEXT_LIMIT = 2000;
export const SKIN_FIELDS = { morningMedication: '早间用药', morningProducts: '早间护肤品', eveningMedication: '晚间用药', eveningProducts: '晚间护肤品' } as const;
export const BODY_FIELDS = {
  weight: { label: '体重', unit: 'kg', max: 500 },
  bmi: { label: 'BMI', unit: '', max: 150 },
  bodyFat: { label: '体脂率', unit: '%', max: 100 },
  chest: { label: '胸围', unit: 'cm', max: 300 },
  waist: { label: '腰围', unit: 'cm', max: 300 },
  hips: { label: '臀围', unit: 'cm', max: 300 },
  upperArm: { label: '上臂围', unit: 'cm', max: 300 },
  thigh: { label: '大腿围', unit: 'cm', max: 300 },
  calf: { label: '小腿围', unit: 'cm', max: 300 },
} as const;
export type BodyMetric = keyof typeof BODY_FIELDS;
export const CIRCUMFERENCE_FIELDS = ['chest', 'waist', 'hips', 'upperArm', 'thigh', 'calf'] as const;
export type SkinRecord = Partial<Record<keyof typeof SKIN_FIELDS, string>>;
export type BodyRecord = Partial<Record<keyof typeof BODY_FIELDS, number>>;
export interface TrainingRecord { plan: string; effort: 'normal' | 'easy' | 'rest'; completed: boolean; mode?: 'auto' | 'manual' }
export interface LifeEntry { text: string; revision: string; skin?: SkinRecord; body?: BodyRecord; training?: TrainingRecord }
export type LifeEntries = Record<string, LifeEntry>;
export interface LifeYear {
  year: number;
  entries: LifeEntries;
  periodDays: string[];
  syncedAt: string | null;
  connected: boolean;
  cycle?: CycleSettings;
}
export interface CycleSettings {
  lastPeriodStart: string;
  cycleLength: number;
  periodLength: number;
  trainingDays: number[];
  revision: string;
  periodStarts?: string[];
}
export const DEFAULT_CYCLE: CycleSettings = { lastPeriodStart: '', cycleLength: 28, periodLength: 5, trainingDays: [1, 3, 5], revision: '' };
export interface DoneItem { id: string; taskId: string; projectId: string; title: string; completedAt: string; date: string; tags?: string[]; category?: '课' | '活' | '玩' | '未分类'; projectName?: string }
export interface DoneMonth { month: string; items: DoneItem[]; connected: boolean; syncedAt: string | null; needsTagSync?: boolean }
export interface PeriodEvent { uid: string; startDate: string; endDate: string }

export function lifeYear(value: unknown): number {
  if (!/^[0-9]{4}$/.test(String(value))) throw new Error('年份无效');
  const year = Number(value);
  if (year < 1900 || year > 2200) throw new Error('年份无效');
  return year;
}

export function parseLifeEdit(value: unknown) {
  const edit = value as Record<string, unknown> | null;
  if (!edit || !LIFE_KINDS.includes(edit.kind as LifeKind) || typeof edit.date !== 'string'
    || !isCalendarDate(edit.date) || typeof edit.text !== 'string' || edit.text.length > LIFE_TEXT_LIMIT
    || typeof edit.revision !== 'string' || edit.revision.length > 80
    || typeof edit.mutationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(edit.mutationId)) {
    throw new Error('记录内容无效');
  }
  const details: Pick<LifeEntry, 'skin' | 'body' | 'training'> = {};
  for (const field of ['skin', 'body', 'training']) {
    if (edit[field] !== undefined && edit.kind !== field) throw new Error('记录类型不匹配');
  }
  if (edit.skin !== undefined) {
    if (!edit.skin || typeof edit.skin !== 'object' || Array.isArray(edit.skin)) throw new Error('护肤记录无效');
    details.skin = {};
    for (const [key, value] of Object.entries(edit.skin)) {
      if (!Object.prototype.hasOwnProperty.call(SKIN_FIELDS, key) || typeof value !== 'string' || value.length > 500) throw new Error('护肤记录无效');
      details.skin[key as keyof SkinRecord] = value;
    }
  }
  if (edit.body !== undefined) {
    if (!edit.body || typeof edit.body !== 'object' || Array.isArray(edit.body)) throw new Error('体围记录无效');
    details.body = {};
    for (const [key, value] of Object.entries(edit.body)) {
      if (!Object.prototype.hasOwnProperty.call(BODY_FIELDS, key) || !isBodyValue(key as BodyMetric, value)) throw new Error('身体数据无效');
      details.body[key as keyof BodyRecord] = value;
    }
  }
  if (edit.training !== undefined) {
    const training = edit.training as TrainingRecord | null;
    if (!training || typeof training.plan !== 'string' || training.plan.length > 1000
      || !['normal', 'easy', 'rest'].includes(training.effort) || typeof training.completed !== 'boolean'
      || (training.mode !== undefined && !['auto', 'manual'].includes(training.mode))) throw new Error('训练记录无效');
    details.training = { plan: training.plan, effort: training.effort, completed: training.completed,
      ...(training.mode ? { mode: training.mode } : {}) };
  }
  const year = lifeYear(edit.date.slice(0, 4));
  return { year, kind: edit.kind as LifeKind, date: edit.date, text: edit.text,
    revision: edit.revision, mutationId: edit.mutationId, ...details };
}

export function parseCycleSettings(value: unknown): CycleSettings {
  const input = value as CycleSettings | null;
  if (!input || typeof input.lastPeriodStart !== 'string'
    || (input.lastPeriodStart !== '' && !isCalendarDate(input.lastPeriodStart))
    || !Number.isInteger(input.cycleLength) || input.cycleLength < 21 || input.cycleLength > 45
    || !Number.isInteger(input.periodLength) || input.periodLength < 1 || input.periodLength > 10
    || !Array.isArray(input.trainingDays) || input.trainingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    || typeof input.revision !== 'string' || input.revision.length > 80) throw new Error('经期设置无效');
  if (input.lastPeriodStart) lifeYear(input.lastPeriodStart.slice(0, 4));
  return { lastPeriodStart: input.lastPeriodStart, cycleLength: input.cycleLength, periodLength: input.periodLength,
    trainingDays: [...new Set(input.trainingDays)].sort(), revision: input.revision };
}

export function entrySummary(kind: LifeKind, entry?: LifeEntry): string {
  if (!entry) return '';
  const details = kind === 'skin' ? Object.entries(SKIN_FIELDS).flatMap(([key, label]) => {
    const value = entry.skin?.[key as keyof SkinRecord]; return value ? [`${label} · ${value}`] : [];
  }) : kind === 'body' ? Object.entries(BODY_FIELDS).flatMap(([key, { label, unit }]) => {
    const value = entry.body?.[key as BodyMetric]; return isBodyValue(key as BodyMetric, value) ? [`${label} ${value}${unit ? ` ${unit}` : ''}`] : [];
  }) : kind === 'training' && entry.training ? [`${entry.training.completed ? '✓ ' : ''}${entry.training.plan}`] : [];
  return [...details, entry.text].filter(Boolean).join('\n');
}

export function isBodyValue(metric: BodyMetric, value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= BODY_FIELDS[metric].max;
}

export function calendarCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const size = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length: size }, (_, index) => index < offset || index >= offset + count ? null
    : `${year}-${String(month).padStart(2, '0')}-${String(index - offset + 1).padStart(2, '0')}`);
}

export function periodDays(events: PeriodEvent[], year: number): string[] {
  const days = new Set<string>();
  const from = `${year}-01-01`;
  const until = `${year + 1}-01-01`;
  for (const event of events) {
    if (!isCalendarDate(event.startDate) || !isCalendarDate(event.endDate)) continue;
    const start = event.startDate < from ? from : event.startDate;
    const end = event.endDate > until ? until : event.endDate;
    for (let day = start; day < end; day = nextCalendarDate(day)) days.add(day);
  }
  return [...days].sort();
}

// A published feed can stop including older events. Preserve that history, but
// replace any series still present (including cancellations, moves and renames).
export function reconcilePeriodEvents(previous: PeriodEvent[], next: PeriodEvent[], seenUids: string[], today: string): PeriodEvent[] {
  const seen = new Set(seenUids);
  const retained = previous.filter((event) => !seen.has(event.uid) && event.startDate < today)
    .map((event) => ({ ...event, endDate: event.endDate < today ? event.endDate : today }));
  return [...retained, ...next];
}
