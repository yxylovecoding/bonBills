import { kv } from './_accountKv.js';
import { OUTLOOK_CONNECTION_KEY, type OutlookConnection } from './_outlookSync.js';
import { decryptOutlookConnection, fetchCalendar, parseOutlookCalendar } from './_outlookCalendar.js';
import { applyOutlookSnapshotToState, buildOutlookSnapshot } from '../src/utils/outlookCalendar.js';
import { addTripDays, buildClothesTrips, tripDates } from '../src/clothes/tripRules.js';
import { deviceDate } from '../src/clothes/rules.js';
import { CATEGORIES, MAX_OUTFIT_ITEMS, PURPOSES, SCENES, categoryLabel, type ClothesEvent, type ClothesLocation, type ClothesTripPlan, type ClothesTripsData, type TripForecast } from '../src/clothes/types.js';
import { dateInput, id, locationInput, requireInput } from './_clothesValidation.js';
import { readDailyWeather } from './_dailyWeather.js';
import { resolveDestination } from './_calendarWeather.js';
import { tripDestinationQueries } from '../src/utils/tripDestinations.js';

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
  await Promise.all(trips.map(async (trip) => {
    const names = tripDestinationQueries(trip.title);
    const locations = await Promise.all(names.map((name) => resolveDestination(name).catch(() => null)));
    trip.locations = locations.filter((city): city is ClothesLocation => !!city);
    trip.unresolvedDestinations = names.filter((_, index) => !locations[index]);
  }));
  return { trips: trips.sort((a, b) => a.startDate.localeCompare(b.startDate)), plans, connected: Boolean(connection), calendarError };
}

export async function readTripForecast(location: ClothesLocation, start: string, end: string, timezone: string): Promise<TripForecast> {
  requireInput(start <= end && Date.parse(end) - Date.parse(start) < 366 * 86400000, '行程日期无效');
  const today = deviceDate(new Date(), timezone);
  return readDailyWeather(location, start > today ? start : today, end, timezone);
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
      && (day.active === null || typeof day.active === 'boolean')
      && (day.purpose == null || PURPOSES.includes(day.purpose)), '每日条件无效');
    requireInput(day.itemIds === null || (Array.isArray(day.itemIds) && day.itemIds.length <= MAX_OUTFIT_ITEMS && new Set(day.itemIds).size === day.itemIds.length), '搭配无效');
    requireInput(day.itemCategories === undefined || (day.itemCategories && typeof day.itemCategories === 'object' && !Array.isArray(day.itemCategories)
      && Object.entries(day.itemCategories).every(([id, role]) => day.itemIds?.includes(id) && CATEGORIES.includes(categoryLabel(role)))), '穿着位置无效');
    days[date] = { ...(day.itemCategories ? { itemCategories: day.itemCategories } : {}), ...(day.purpose ? { purpose: day.purpose } : {}), scene: day.scene, active: day.active, itemIds: day.itemIds?.map((value) => id(value)) ?? null };
  }
  return { tripId: v.tripId, revision: id(v.revision, true), title: v.title.trim(), startDate, endDate, location: locationInput(v.location), days };
}
