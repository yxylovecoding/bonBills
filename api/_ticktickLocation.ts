import { validDate } from '../src/utils/internship.js';
import { cityLabel, readSceneCity } from '../src/utils/sceneCities.js';
import type { SceneCity } from '../src/models/types.js';
import type { TickTickTask } from './_ticktickTrips.js';

const cityName = (name: string) => name.normalize('NFKC').trim().toLowerCase().split('·')[0].trim().replace(/市$/, '');
const labels = (task: TickTickTask) => (task.tags ?? []).map(tag => tag.normalize('NFKC').trim());
interface LocationCalendar {
  tagMap?: Record<string, unknown>;
  cityMap?: Record<string, SceneCity | null>;
  locationCities?: SceneCity[];
  dayOverrides?: Record<string, { city?: SceneCity }>;
}
const calendar = (state: unknown) => (state ?? {}) as LocationCalendar;

export function taskCityTags(task: TickTickTask, state: unknown): string[] {
  const value = calendar(state);
  const known = new Set(['北京', '广州', '上海', '天津', '重庆', '香港', '澳门',
    ...(value.locationCities ?? []).map(cityLabel), ...Object.values(value.cityMap ?? {}).map(cityLabel),
    ...Object.values(value.dayOverrides ?? {}).map(day => cityLabel(day.city))].map(cityName));
  return labels(task).map(cityName).filter(tag => tag && known.has(tag));
}

export function hasTaskLocation(task: TickTickTask, state: unknown): boolean {
  return labels(task).some(tag => ['寄', '居', '寓', '旅'].includes(tag)) || taskCityTags(task, state).length > 0;
}

// Scene alternatives are OR; city alternatives are OR; the two groups are AND.
// Unknown locations never count as being in the requested city.
export function taskLocationAllowed(task: TickTickTask, state: unknown, date: string): boolean {
  const value = calendar(state), tags = labels(task);
  const scenes = tags.filter(tag => ['寄', '居', '寓', '旅'].includes(tag));
  return matchesLocation(value, date, scenes, taskCityTags(task, state));
}

function matchesLocation(value: LocationCalendar, date: string, scenes: string[], cities: string[]): boolean {
  const scene = value.tagMap?.[date];
  if (scenes.length && !scenes.some(tag => tag === '寄' ? scene === 'home'
    : tag === '旅' ? scene === 'travel' : scene === 'school' || scene === 'intern')) return false;
  const city = readSceneCity(value.dayOverrides?.[date]?.city) ?? readSceneCity(value.cityMap?.[date]);
  return !cities.length || Boolean(city && cities.includes(cityName(cityLabel(city))));
}

export function nextTaskLocationDate(task: TickTickTask, state: unknown, from: string): string | null {
  const value = calendar(state), scenes = labels(task).filter(tag => ['寄', '居', '寓', '旅'].includes(tag));
  const cities = taskCityTags(task, state);
  if (!scenes.length && !cities.length) return from;
  return [...new Set([...Object.keys(value.tagMap ?? {}), ...Object.keys(value.cityMap ?? {}),
    ...Object.keys(value.dayOverrides ?? {})])].filter(date => validDate(date) && date >= from)
    .sort().find(date => matchesLocation(value, date, scenes, cities)) ?? null;
}
