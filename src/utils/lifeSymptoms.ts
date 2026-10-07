import type { LifeEntries } from './bonLife.js';
import { isCalendarDate } from './outlookCalendar.js';

export const EYE_FIELDS = { leftEye: '左眼', rightEye: '右眼' } as const;
export const DISCOMFORT_FIELDS = { leftSacroiliac: '左骶髂', rightSacroiliac: '右骶髂', lowerBack: '腰' } as const;
export const GENERAL_DISCOMFORT_AREA = 'body' as const;
export const SYMPTOM_AREAS = { eye: '眼睛', body: '通用身体', ...DISCOMFORT_FIELDS } as const;
export const SYMPTOM_STATES = { appeared: '出现', ongoing: '持续', improving: '好转', worsening: '加重', resolved: '消失', recorded: '已记录' } as const;
export const SYMPTOM_TEXT_LIMIT = 500;
export const SYMPTOM_LIMIT = 30;
export type SymptomKind = 'eyes' | 'discomfort';
export type SymptomArea = keyof typeof SYMPTOM_AREAS;
export type SymptomState = keyof typeof SYMPTOM_STATES;
export interface SymptomObservation { area: SymptomArea; name: string; status: SymptomState; note: string }
// Objects retain their shape through Redis Lua's JSON encoding, including when empty.
export type SymptomObservations = Record<string, SymptomObservation>;
export type SymptomNames = Partial<Record<SymptomArea, string>>;
export type EyeRecord = Partial<Record<keyof typeof EYE_FIELDS, string>> & { symptoms?: SymptomObservations };
export type DiscomfortRecord = Partial<Record<keyof typeof DISCOMFORT_FIELDS, string>> & { symptoms?: SymptomObservations };
export interface SymptomPoint extends SymptomObservation { date: string }
export interface SymptomHistory { key: string; area: SymptomArea; name: string; points: SymptomPoint[] }

export function symptomKey(area: SymptomArea, name: string): string {
  return `${area}:${name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

export function reusableSymptom(area: SymptomArea, name: string, date: string, history: SymptomHistory[]): SymptomObservation {
  const previous = history.find((item) => item.key === symptomKey(area, name))?.points.find((item) => item.date < date);
  return { area, name: name.trim(), status: previous && previous.status !== 'resolved' ? 'ongoing' : 'appeared', note: '' };
}

export function parseSymptomNames(value: unknown, kind: SymptomKind): SymptomNames {
  const names: SymptomNames = {};
  for (const [area, name] of Object.entries(record(value))) {
    if (!has(SYMPTOM_AREAS, area) || (kind === 'eyes' ? area !== 'eye' : area === 'eye')) throw new Error('症状部位无效');
    names[area as SymptomArea] = symptomText(name);
  }
  return names;
}
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('症状记录无效');
  return value as Record<string, unknown>;
}
function symptomText(value: unknown): string {
  if (typeof value !== 'string' || value.length > SYMPTOM_TEXT_LIMIT) throw new Error('症状内容过长或无效');
  return value;
}

export function parseSymptomRecord(value: unknown, kind: SymptomKind): EyeRecord | DiscomfortRecord {
  const input = record(value);
  const fields = kind === 'eyes' ? EYE_FIELDS : DISCOMFORT_FIELDS;
  const result: Record<string, string | SymptomObservations> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'symptoms') {
      if (!has(fields, key)) throw new Error('症状部位无效');
      result[key] = symptomText(value);
      continue;
    }
    const items = Object.entries(record(value));
    if (items.length > SYMPTOM_LIMIT) throw new Error('每天最多记录 30 项症状');
    const symptoms: SymptomObservations = {};
    for (const [id, raw] of items) {
      const item = record(raw);
      const name = symptomText(item.name).trim();
      if (!name || typeof item.area !== 'string' || !has(SYMPTOM_AREAS, item.area)
        || (kind === 'eyes' ? item.area !== 'eye' : item.area === 'eye')
        || typeof item.status !== 'string' || !has(SYMPTOM_STATES, item.status)
        || id !== symptomKey(item.area as SymptomArea, name)
        || Object.keys(item).some((field) => !['area', 'name', 'status', 'note'].includes(field))) throw new Error('症状记录无效');
      symptoms[id] = { area: item.area as SymptomArea, name, status: item.status as SymptomState, note: symptomText(item.note ?? '') };
    }
    result.symptoms = symptoms;
  }
  return result;
}

export function symptomObservations(kind: SymptomKind, value?: EyeRecord | DiscomfortRecord): SymptomObservations {
  if (value?.symptoms !== undefined) return value.symptoms;
  const symptoms: SymptomObservations = {};
  const fields = kind === 'eyes' ? EYE_FIELDS : DISCOMFORT_FIELDS;
  for (const [field, label] of Object.entries(fields)) {
    const name = (value as Record<string, string> | undefined)?.[field]?.trim();
    if (!name) continue;
    const area = kind === 'eyes' ? 'eye' : field as SymptomArea;
    const key = symptomKey(area, name);
    const note = kind === 'eyes' ? label : '';
    if (symptoms[key]) symptoms[key] = { ...symptoms[key], note: [symptoms[key].note, note].filter(Boolean).join('、') };
    else symptoms[key] = { name, area, status: 'recorded', note };
  }
  return symptoms;
}

export function symptomSummary(kind: SymptomKind, value?: EyeRecord | DiscomfortRecord): string[] {
  return Object.values(symptomObservations(kind, value)).map((item) =>
    [kind === 'discomfort' ? SYMPTOM_AREAS[item.area] : '', item.name, SYMPTOM_STATES[item.status], item.note].filter(Boolean).join(' · '));
}

export function symptomHistory(kind: SymptomKind, entries: LifeEntries): SymptomHistory[] {
  const histories = new Map<string, SymptomHistory>();
  for (const [entryKey, entry] of Object.entries(entries)) {
    if (!entryKey.startsWith(`${kind}:`)) continue;
    const date = entryKey.slice(kind.length + 1);
    if (!isCalendarDate(date)) continue;
    for (const [key, item] of Object.entries(symptomObservations(kind, entry[kind]))) {
      const history = histories.get(key) ?? { key, area: item.area, name: item.name, points: [] };
      history.points.push({ ...item, date });
      histories.set(key, history);
    }
  }
  for (const history of histories.values()) {
    history.points.sort((a, b) => b.date.localeCompare(a.date));
    history.name = history.points[0].name;
  }
  return [...histories.values()].sort((a, b) => b.points[0].date.localeCompare(a.points[0].date) || a.name.localeCompare(b.name, 'zh-CN'));
}
