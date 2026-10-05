import { kv } from './_accountKv.js';
import { OUTLOOK_CONNECTION_KEY, type OutlookConnection } from './_outlookSync.js';
import { decryptOutlookConnection, fetchCalendar, parseOutlookCalendar } from './_outlookCalendar.js';
import { applyOutlookSnapshotToState, buildOutlookSnapshot } from '../src/utils/outlookCalendar.js';
import { addTripDays, buildClothesTrips, tripDates } from '../src/clothes/tripRules.js';
import { deviceDate } from '../src/clothes/rules.js';
import { CATEGORIES, SCENES, type ClothesEvent, type ClothesLocation, type ClothesTripPlan, type ClothesTripsData, type TripForecast, type WeatherSnapshot } from '../src/clothes/types.js';
import { dateInput, id, locationInput, requireInput } from './_clothesValidation.js';
import { upstream } from './_bonClothes.js';

export const TRIP_PLANS_KEY = 'bonclothes:trip-plans:v1';
export async function readClothesTrips(today: string, timezone: string): Promise<ClothesTripsData> {
  const [storedCalendar, settings, connection, saved] = await Promise.all([
    kv.get<Record<string, unknown>>('calendar-tags'), kv.get<Record<string, unknown>>('trip-tags'),
    kv.get<OutlookConnection>(OUTLOOK_CONNECTION_KEY), kv.hgetall<Record<string, ClothesTripPlan>>(TRIP_PLANS_KEY),
  ]);
  let calendar = storedCalendar ?? {}, events: ClothesEvent[] = [], calendarError: string | undefined;
  if (connection) {
    try {
      const input = decryptOutlookConnection(connection.encrypted, (process.env.SYNC_SECRET || '').trim());
      const start = addTripDays(today, -30), end = addTripDays(today, 181);
      const sources = [{ calendar: 'play' as const, url: input.playUrl }, { calendar: 'class' as const, url: input.classUrl }].filter((source) => source.url);
      const results = (await Promise.all(sources.map(async (source) => parseOutlookCalendar(await fetchCalendar(source.url),
        source.calendar, start, end, false, true, { includeLocation: true, timezone, includeFree: true })))).flat();
      // Reconcile in memory only. Clothing plans never modify the ledger or calendar.
      calendar = applyOutlookSnapshotToState(calendar, buildOutlookSnapshot(results, start, end, input.rules), input.policy, today);
      events = results.map(({ title, location, startDate, endDate, allDay }) => ({ title, location, startDate, endDate, allDay }));
    } catch { calendarError = '日历更新失败'; }
  }
  const trips = buildClothesTrips(calendar, settings ?? {}, events, today, timezone);
  const plans = Object.values(saved ?? {}).filter((plan) => plan.endDate >= today);
  for (const plan of plans) if (!trips.some((trip) => trip.id === plan.tripId)) {
    trips.push({ id: plan.tripId, title: plan.title, startDate: plan.startDate, endDate: plan.endDate,
      dates: tripDates(plan.startDate, plan.endDate), destinations: [], events: [], archived: true });
  }
  return { trips: trips.sort((a, b) => a.startDate.localeCompare(b.startDate)), plans, connected: Boolean(connection), calendarError };
}

export async function readTripForecast(location: ClothesLocation, start: string, end: string, timezone: string): Promise<TripForecast> {
  requireInput(start <= end && Date.parse(end) - Date.parse(start) < 366 * 86400000, '行程日期无效');
  const today = deviceDate(new Date(), timezone), last = addTripDays(today, 15);
  const from = start > today ? start : today, to = end < last ? end : last;
  if (from > to) return { days: {}, stale: false };
  const latitude = Number(location.latitude.toFixed(3)), longitude = Number(location.longitude.toFixed(3));
  const key = `bonclothes:forecast:v1:${latitude}:${longitude}:${from}:${to}:${timezone}`;
  const saved = await kv.get<TripForecast>(key);
  if (saved?.fetchedAt && Date.now() - Date.parse(saved.fetchedAt) < 30 * 60000) return saved;
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone,
      daily: 'temperature_2m_min,temperature_2m_max,apparent_temperature_min,apparent_temperature_max,precipitation_sum,wind_speed_10m_max',
      start_date: from, end_date: to }).toString();
    const data = await upstream(url), daily = data.daily;
    const fetchedAt = new Date().toISOString(), days: Record<string, WeatherSnapshot> = {};
    for (const date of tripDates(from, to)) {
      const index = daily?.time?.indexOf(date) ?? -1;
      const fields = ['temperature_2m_min', 'temperature_2m_max', 'apparent_temperature_min', 'apparent_temperature_max', 'precipitation_sum', 'wind_speed_10m_max'].map((key) => daily?.[key]?.[index]);
      if (index < 0 || !fields.every((value) => typeof value === 'number' && Number.isFinite(value))) throw new Error();
      const [min, max, apparentMin, apparent, precipitation, wind] = fields;
      days[date] = { date, timezone, latitude, longitude, fetchedAt, temperature: max, apparent, apparentMin, min, max, precipitation, wind };
    }
    const result = { days, fetchedAt, stale: false };
    await kv.set(key, result, { ex: 7 * 86400 });
    return result;
  } catch { return { days: saved?.days ?? {}, fetchedAt: saved?.fetchedAt, stale: true, error: '预报更新失败' }; }
}

export function tripPlanInput(value: unknown): ClothesTripPlan {
  const v = value as ClothesTripPlan;
  requireInput(v && typeof v.tripId === 'string' && /^trip:\d{4}-\d{2}-\d{2}$/.test(v.tripId), '行程标识无效');
  const startDate = dateInput(v.startDate), endDate = dateInput(v.endDate);
  requireInput(v.tripId === `trip:${startDate}` && startDate <= endDate && Date.parse(endDate) - Date.parse(startDate) < 366 * 86400000, '行程日期无效');
  requireInput(typeof v.title === 'string' && v.title.trim().length > 0 && v.title.length <= 500, '行程名称无效');
  requireInput(v.days && typeof v.days === 'object' && !Array.isArray(v.days) && Object.keys(v.days).length <= 366, '计划无效');
  const days: ClothesTripPlan['days'] = {};
  for (const [date, day] of Object.entries(v.days)) {
    dateInput(date);
    requireInput(date >= startDate && date <= endDate && day && (day.scene === null || SCENES.includes(day.scene))
      && (day.active === null || typeof day.active === 'boolean'), '每日条件无效');
    requireInput(day.itemIds === null || (Array.isArray(day.itemIds) && day.itemIds.length <= CATEGORIES.length && new Set(day.itemIds).size === day.itemIds.length), '搭配无效');
    days[date] = { scene: day.scene, active: day.active, itemIds: day.itemIds?.map((value) => id(value)) ?? null };
  }
  return { tripId: v.tripId, revision: id(v.revision, true), title: v.title.trim(), startDate, endDate, location: locationInput(v.location), days };
}
