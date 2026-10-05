import { kv } from './_accountKv.js';
import { upstream } from './_bonClothes.js';
import type { SceneCity } from '../src/models/types.js';
import { readSceneCity } from '../src/utils/sceneCities.js';
import type { OutlookAvailability } from '../src/utils/outlookCalendar.js';
import { dayAvailability, type AvailabilityProfile } from './_dailyAvailability.js';
import { cycleEnd, estimateTaskMinutes } from './_ticktickDailyPlan.js';
import { calendarDateInTimeZone, routineOccurrenceKey, routineScenes, routineTaskDate, shiftTickTickDate,
  type TickTickApi, type TickTickTask, type TickTickTripSource } from './_ticktickTrips.js';

export const LAUNDRY_STATE_KEY = 'ticktick:laundry-weather:v1';
const DAY = 86_400_000;
const WEATHER_DAY_OFFSETS = [-1, 0, 1, 2] as const;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const normalize = (text: string) => text.normalize('NFKC').trim();
const pending = (task: TickTickTask) => (task.status ?? 0) === 0 && !task.completedTime;
export const isLaundryTask = (task: TickTickTask) => normalize(task.title) === '洗衣服'
  && !(task.tags ?? []).some(tag => normalize(tag) === '不关我事');
const scene = (value: unknown) => value === 'intern' || value === 'school' ? 'school' : value === 'home' ? 'home' : value === 'travel' ? 'travel' : null;
const tagMap = (state: unknown) => (state as { tagMap?: Record<string, string> } | null)?.tagMap ?? {};

export interface LaundryWeather { rain: number; probability: number; sunshine: number; code: number }
export interface LaundryForecast { fetchedAt: string; days: Record<string, LaundryWeather> }
interface Anchor { projectId: string; repeatFlag: string; completion?: string; target: string }
export interface LaundryState { connectionId: string; anchors: Record<string, Anchor> }
export interface LaundryDecision { id: string; target?: string; date?: string; reason: string; location?: string }

export function laundryLocation(configState: unknown): SceneCity | null {
  const config = (configState as { config?: { schoolCity?: unknown } } | null)?.config;
  return readSceneCity(config?.schoolCity);
}

export async function readLaundryForecast(location: SceneCity, today: string, now = new Date()): Promise<LaundryForecast> {
  const latitude = Number(location.latitude.toFixed(3)), longitude = Number(location.longitude.toFixed(3));
  const key = `ticktick:laundry-forecast:v1:${latitude}:${longitude}:${today}`;
  const saved = await kv.get<LaundryForecast>(key);
  if (saved && now.getTime() - Date.parse(saved.fetchedAt) >= 0 && now.getTime() - Date.parse(saved.fetchedAt) < 3 * 3600_000) return saved;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone: 'Asia/Shanghai',
    daily: 'precipitation_sum,precipitation_probability_max,sunshine_duration,weather_code',
    start_date: today, end_date: addDays(today, 15) }).toString();
  const data = await upstream(url), daily = data.daily;
  const days: Record<string, LaundryWeather> = {};
  for (let offset = 0; offset < 16; offset++) {
    const date = addDays(today, offset), index = daily?.time?.indexOf(date) ?? -1;
    const fields = ['precipitation_sum', 'precipitation_probability_max', 'sunshine_duration', 'weather_code'].map(key => daily?.[key]?.[index]);
    if (index < 0 || !fields.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('洗衣天气预报不完整');
    const [rain, probability, sunshine, code] = fields;
    if (probability > 100 || sunshine > 86400) throw new Error('洗衣天气预报无效');
    days[date] = { rain, probability, sunshine, code };
  }
  const result = { fetchedAt: now.toISOString(), days };
  await kv.set(key, result, { ex: 86400 });
  return result;
}

function lastCompletion(task: TickTickTask, tasks: TickTickTask[], history: TickTickTask[], now: Date) {
  const family = routineOccurrenceKey(task);
  const unique = tasks.filter(candidate => pending(candidate) && routineOccurrenceKey(candidate) === family).length === 1;
  return history.filter(record => record.projectId === task.projectId && (record.id === task.id
    || (unique && routineOccurrenceKey(record) === family)) && record.completedTime
    && Number.isFinite(Date.parse(record.completedTime)) && Date.parse(record.completedTime) <= now.getTime())
    .map(record => record.completedTime!).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function laundryAnchor(task: TickTickTask, tasks: TickTickTask[], history: TickTickTask[], state: LaundryState, now: Date): Anchor | null {
  // Do not change finite rules or reinterpret an unknown cadence as five days.
  if (!routineTaskDate(task) || !task.repeatFlag || /(?:COUNT|UNTIL|BYHOUR|BYMINUTE|BYSECOND)=/i.test(task.repeatFlag)) return null;
  const completion = lastCompletion(task, tasks, history, now), lastDay = calendarDateInTimeZone(completion, task.timeZone);
  const saved = state.anchors[task.id];
  const fromCompletion = lastDay ? cycleEnd(task, lastDay) : null;
  if (!cycleEnd(task, lastDay ?? routineTaskDate(task) ?? '')) return null;
  const target = fromCompletion ?? (saved?.projectId === task.projectId && saved.repeatFlag === task.repeatFlag
    && saved.completion === completion ? saved.target : routineTaskDate(task));
  if (!target) return null;
  return state.anchors[task.id] = { projectId: task.projectId, repeatFlag: task.repeatFlag, completion, target };
}

interface PlanOptions {
  tasks: TickTickTask[]; history: TickTickTask[]; calendarState: unknown; availability?: OutlookAvailability;
  configState?: unknown; trips?: TickTickTripSource[];
  profile?: AvailabilityProfile; now: Date; today: string;
}

export function laundryBeforeTrip(target: string, trips: TickTickTripSource[], completedDay?: string | null): string | null {
  const trip = trips.find(trip => trip.startDate <= target && target <= trip.endDate);
  if (!trip) return null;
  const date = addDays(trip.startDate, -1);
  // Finishing the pre-trip wash starts a new cycle; never move that next
  // occurrence back to an already completed day during a long trip.
  return completedDay && completedDay >= date ? null : date;
}

function hasTime(task: TickTickTask, date: string, options: PlanOptions) {
  const { availability, today, now, profile, calendarState } = options;
  if (!availability || date < availability.startDate || date >= availability.endDate) return false;
  const others = options.tasks.filter(other => other.id !== task.id && pending(other));
  const minutes = estimateTaskMinutes(task);
  const free = dayAvailability({ calendar: availability, day: date, today, now, profile,
    scene: tagMap(calendarState)[date], tasks: others,
    fixed: others.filter(other => routineTaskDate(other) === date && (other.priority ?? 0) < 5
      && !(other.tags ?? []).some(tag => ['routine', '不关我事'].includes(normalize(tag)))),
    completed: options.history.filter(record => calendarDateInTimeZone(record.completedTime) === date), estimate: estimateTaskMinutes });
  if (free.remainingMinutes < minutes || !free.slots.some(([start, end]) => end - start >= minutes * 60_000)) return false;
  if (task.isAllDay !== false) return true;
  // Preserve the existing time (including a morning 08:00 reminder), and reject
  // days when that time conflicts instead of silently moving an appointment.
  const start = Date.parse(shiftTickTickDate(task.startDate ?? task.dueDate, routineTaskDate(task)!, date) ?? '');
  const end = start + minutes * 60_000;
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(start) || start < now.getTime() || start < midnight + 8 * 3600_000 || end > midnight + 22 * 3600_000
    || (profile === 'evening' && start < midnight + 20 * 3600_000)) return false;
  if ([[11, 14], [18, 20]].some(([from, to]) => start < midnight + to * 3600_000 && end > midnight + from * 3600_000)) return false;
  if (tagMap(calendarState)[date] === 'intern' && start < midnight + 18 * 3600_000 && end > midnight + 9 * 3600_000) return false;
  const intervals = [...availability.events.map(event => [Date.parse(event.start), Date.parse(event.end)]),
    ...others.filter(other => other.isAllDay === false).map(other => {
      const from = Date.parse(other.startDate ?? other.dueDate ?? '');
      return [from, Math.max(Date.parse(other.dueDate ?? '') || from, from + estimateTaskMinutes(other) * 60_000)];
    })];
  return !intervals.some(([from, to]) => start < to && end > from);
}

const dry = (weather: LaundryWeather) => weather.rain <= 0.2 && weather.probability <= 30 && weather.code <= 3;
const sunny = (weather: LaundryWeather) => dry(weather) && weather.code <= 2 && weather.sunshine >= 4 * 3600;
function weatherRank(date: string, forecast: LaundryForecast) {
  const current = forecast.days[date], next = forecast.days[addDays(date, 1)], previous = forecast.days[addDays(date, -1)];
  if (!current || !next) return null;
  // Consecutive sunny/dry drying days dominate small forecast differences.
  const tier = sunny(current) && sunny(next) ? 3 : dry(current) && dry(next) ? 2 : dry(current) ? 1 : 0;
  return [tier, previous && sunny(previous) && tier === 3 ? 1 : 0,
    -Math.round((current.rain + next.rain) * 2), -Math.round(Math.max(current.probability, next.probability) / 10),
    Math.round((current.sunshine + next.sunshine) / 3600)];
}

export function chooseLaundryDay(task: TickTickTask, target: string, options: PlanOptions,
  forecastFor: (day: string) => LaundryForecast | undefined): string | null {
  const choices: { date: string; rank: number[] }[] = [], scenes = routineScenes(task), map = tagMap(options.calendarState);
  for (const offset of WEATHER_DAY_OFFSETS) {
    const date = addDays(target, offset), localScene = scene(map[date]);
    if (date < options.today || (scenes.length && (!localScene || !scenes.includes(localScene)))) continue;
    if (!hasTime(task, date, options)) continue;
    const forecast = forecastFor(date);
    if (!forecast || options.now.getTime() - Date.parse(forecast.fetchedAt) < 0
      || options.now.getTime() - Date.parse(forecast.fetchedAt) >= 6 * 3600_000) return null;
    const rank = weatherRank(date, forecast);
    if (!rank) return null; // Missing weather is unknown, never implicitly sunny.
    choices.push({ date, rank: [...rank, -Math.abs(offset), date === routineTaskDate(task) ? 1 : 0, -offset] });
  }
  choices.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i];
    return 0;
  });
  return choices[0]?.date ?? null;
}

async function moveLaundry(api: TickTickApi, original: TickTickTask, date: string) {
  const task = await api.getTask(original.projectId, original.id);
  // A user completion or edit during forecast loading takes precedence.
  if (!pending(task) || !isLaundryTask(task) || ['startDate', 'dueDate', 'repeatFlag', 'repeatFrom', 'isAllDay', 'timeZone', 'priority', 'tags']
    .some(key => JSON.stringify(task[key as keyof TickTickTask]) !== JSON.stringify(original[key as keyof TickTickTask]))) return undefined;
  const anchor = routineTaskDate(task)!;
  if (anchor === date) return false;
  const payload: Record<string, unknown> = { id: task.id, projectId: task.projectId, title: task.title };
  for (const key of ['content', 'desc', 'isAllDay', 'timeZone', 'reminders', 'tags', 'repeatFlag', 'repeatFrom', 'priority', 'sortOrder', 'kind', 'parentId'] as const)
    if (task[key] !== undefined) payload[key] = task[key];
  for (const key of ['startDate', 'dueDate'] as const) if (task[key]) payload[key] = shiftTickTickDate(task[key], anchor, date);
  if (task.items !== undefined) payload.items = task.items.map(item => item.completedTime || Number(item.status ?? 0) !== 0 ? item
    : { ...item, ...(item.startDate ? { startDate: shiftTickTickDate(item.startDate, anchor, date) } : {}) });
  await api.updateTask(task.id, payload);
  const saved = await api.getTask(task.projectId, task.id);
  const sameDate = (a: unknown, b: unknown) => a === b || (typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b));
  if (saved.id !== task.id || saved.projectId !== task.projectId || !pending(saved) || routineTaskDate(saved) !== date
    || ['startDate', 'dueDate'].some(key => payload[key] !== undefined && !sameDate(saved[key as keyof TickTickTask], payload[key]))
    || ['repeatFlag', 'repeatFrom', 'priority', 'isAllDay', 'timeZone', 'parentId'].some(key => String(saved[key as keyof TickTickTask] ?? '') !== String(task[key as keyof TickTickTask] ?? ''))
    || (Array.isArray(payload.items) && payload.items.some(item => {
      const found = saved.items?.find(candidate => candidate.id === item.id);
      return !found || !sameDate(found.startDate, item.startDate)
        || Boolean(found.completedTime || Number(found.status ?? 0)) !== Boolean(item.completedTime || Number(item.status ?? 0));
    }))
    || JSON.stringify([...(saved.tags ?? [])].sort()) !== JSON.stringify([...(task.tags ?? [])].sort())) throw new Error('TickTick 未正确保存洗衣排期');
  return true;
}

export async function syncLaundrySchedule(api: TickTickApi, options: PlanOptions & { connectionId: string; excludedTaskIds?: ReadonlySet<string> }) {
  const byId = new Map(options.tasks.map(task => [task.id, task]));
  const excluded = (task: TickTickTask) => {
    const seen = new Set<string>();
    let current: TickTickTask | undefined = task;
    while (current && !seen.has(current.id)) {
      if (options.excludedTaskIds?.has(current.id) || (current.parentId && options.excludedTaskIds?.has(current.parentId))) return true;
      seen.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  const tasks = options.tasks.filter(task => isLaundryTask(task) && pending(task) && !excluded(task));
  const managedTaskIds = new Set(tasks.map(task => task.id)), decisions: LaundryDecision[] = [];
  if (!tasks.length) return { updated: 0, managedTaskIds, decisions };
  const saved = await kv.get<LaundryState>(LAUNDRY_STATE_KEY);
  const state: LaundryState = saved?.connectionId === options.connectionId ? saved : { connectionId: options.connectionId, anchors: {} };
  const location = laundryLocation(options.configState);
  const forecasts = new Map<string, Promise<LaundryForecast>>();
  let updated = 0;
  for (const task of tasks) {
    const anchor = laundryAnchor(task, options.tasks, options.history, state, options.now);
    if (!anchor) { decisions.push({ id: task.id, reason: '周期或日期不可用，保留原排期' }); continue; }
    // Persist the original cycle before any write; failed/partial retries cannot drift the window.
    await kv.set(LAUNDRY_STATE_KEY, state);
    const beforeTrip = laundryBeforeTrip(anchor.target, options.trips ?? [], calendarDateInTimeZone(anchor.completion, task.timeZone));
    if (beforeTrip) {
      if (beforeTrip < options.today) {
        decisions.push({ id: task.id, target: anchor.target, reason: '出行前一天已过，保留待办等待补做' });
        continue;
      }
      // This explicit deadline takes precedence over weather, scene and free time.
      const changed = await moveLaundry(api, task, beforeTrip);
      if (changed) updated++;
      decisions.push(changed === undefined
        ? { id: task.id, target: anchor.target, reason: '任务已由用户更新，保留最新状态' }
        : { id: task.id, target: anchor.target, date: beforeTrip, reason: '周期目标日位于出行期间，固定到出行前一天' });
      continue;
    }
    if (!location) { decisions.push({ id: task.id, target: anchor.target, reason: '尚未设置居的城市，保留原排期' }); continue; }
    if (!options.availability) { decisions.push({ id: task.id, target: anchor.target, reason: '日程不可用，保留原排期' }); continue; }
    const weatherByDay = new Map<string, LaundryForecast>(), names = new Map<string, string>();
    for (const offset of WEATHER_DAY_OFFSETS) {
      const date = addDays(anchor.target, offset);
      if (date < options.today || date > addDays(options.today, 14)) continue;
      const key = `${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}`;
      if (!forecasts.has(key)) forecasts.set(key, readLaundryForecast(location, options.today, options.now));
      try { weatherByDay.set(date, await forecasts.get(key)!); names.set(date, location.name); }
      catch { /* An outage never means dry weather and never blocks unrelated planning. */ }
    }
    const date = chooseLaundryDay(task, anchor.target, options, day => weatherByDay.get(day));
    if (!date) { decisions.push({ id: task.id, target: anchor.target, reason: '暂无完整天气或合适空闲，保留原排期' }); continue; }
    const changed = await moveLaundry(api, task, date);
    if (changed === undefined) { decisions.push({ id: task.id, target: anchor.target, reason: '任务已由用户更新，保留最新状态' }); continue; }
    if (changed) updated++;
    decisions.push({ id: task.id, target: anchor.target, date, location: names.get(date), reason: '周期前一天至后两天内优先连续晴天并避开日程冲突' });
  }
  return { updated, managedTaskIds, decisions };
}
