import { isBodyValue, type BodyMetric, type LifeEntries } from './bonLife';
import { isCalendarDate } from './outlookCalendar';

export interface BodyPoint { date: string; time: number; value: number }

export function bodySeries(entries: LifeEntries, metric: BodyMetric, year: number, month?: number): BodyPoint[] {
  const prefix = `${year}-${month === undefined ? '' : `${String(month).padStart(2, '0')}-`}`;
  return Object.entries(entries).flatMap(([key, entry]) => {
    if (!key.startsWith(`body:${prefix}`)) return [];
    const date = key.slice(5);
    const value = entry.body?.[metric];
    if (!isCalendarDate(date) || !isBodyValue(metric, value)) return [];
    return [{ date, time: Date.parse(`${date}T00:00:00Z`), value }];
  }).sort((a, b) => a.time - b.time);
}

export function bodyDateLabel(time: number): string {
  const date = new Date(time);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
