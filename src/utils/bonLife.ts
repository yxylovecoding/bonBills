import { isCalendarDate, nextCalendarDate } from './outlookCalendar';

export type LifeKind = 'skin' | 'mood';
export const LIFE_LABELS: Record<LifeKind, string> = { skin: '皮肤', mood: '情绪' };
export const LIFE_TEXT_LIMIT = 2000;
export interface LifeEntry { text: string; revision: string }
export type LifeEntries = Record<string, LifeEntry>;
export interface LifeYear {
  year: number;
  entries: LifeEntries;
  periodDays: string[];
  syncedAt: string | null;
  connected: boolean;
}
export interface PeriodEvent { uid: string; startDate: string; endDate: string }

export function lifeYear(value: unknown): number {
  if (!/^[0-9]{4}$/.test(String(value))) throw new Error('年份无效');
  const year = Number(value);
  if (year < 1900 || year > 2200) throw new Error('年份无效');
  return year;
}

export function parseLifeEdit(value: unknown) {
  const edit = value as Record<string, unknown> | null;
  if (!edit || !['skin', 'mood'].includes(String(edit.kind)) || typeof edit.date !== 'string'
    || !isCalendarDate(edit.date) || typeof edit.text !== 'string' || edit.text.length > LIFE_TEXT_LIMIT
    || typeof edit.revision !== 'string' || edit.revision.length > 80
    || typeof edit.mutationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(edit.mutationId)) {
    throw new Error('记录内容无效');
  }
  const year = lifeYear(edit.date.slice(0, 4));
  return { year, kind: edit.kind as LifeKind, date: edit.date, text: edit.text,
    revision: edit.revision, mutationId: edit.mutationId };
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
