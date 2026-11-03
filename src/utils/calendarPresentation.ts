import type { DailyContext } from './internship';
import type { CalendarLocationDay } from './calendarWeather';
import { cityLabel } from './sceneCities';
import type { TagKind } from '../models/types';

export const normalizedCityName = (name: string) => name.normalize('NFKC').split('·')[0].trim().toLowerCase().replace(/市$/, '');
export function calendarVisualTag(context: DailyContext): TagKind {
  return context.livingKind === 'rest' ? 'school' : context.tag;
}
export function monthCityLabels(dates: string[], locations: Record<string, CalendarLocationDay>): Record<string, string> {
  const labels: Record<string, string> = {};
  let previous: string | null = null, month = '';
  for (const date of [...dates].sort()) {
    if (date.slice(0, 7) !== month) { previous = null; month = date.slice(0, 7); }
    const names = [...new Set((locations[date]?.locations ?? []).map(city => cityLabel(city)).filter(Boolean))];
    const key = names.map(normalizedCityName).sort().join('|');
    if (key && key !== previous) labels[date] = names.join('／');
    previous = key || null;
  }
  return labels;
}
