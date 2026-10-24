import { kv } from './_accountKv.js';
import { upstream } from './_weatherClient.js';
import { readDailyWeather } from './_dailyWeather.js';
import { cityLabel, readSceneCity } from '../src/utils/sceneCities.js';
import { dateRange, normalizeDayOverrides, resolveDailyContext } from '../src/utils/internship.js';
import { detectAllTrips } from '../src/utils/trips.js';
import { getTripDisplayTitle } from '../src/utils/outlookCalendar.js';
import { tripDestinationQueries } from '../src/utils/tripDestinations.js';
import type { AppConfig, DayOverrides, TagKind } from '../src/models/types.js';
import type { ClothesDayContext, ClothesLocation, ClothesTripPlan } from '../src/clothes/types.js';
import type { CalendarLocationDay, CalendarWeather } from '../src/utils/calendarWeather.js';
import { deviceDate } from '../src/clothes/rules.js';

interface GeocodedCity { name: string; latitude: number; longitude: number; timezone?: string; population?: number; feature_code?: string }
const normalizedName = (name: string) => name.trim().toLocaleLowerCase().replace(/市$/, '');
export function selectDestinationCity(query: string, cities: GeocodedCity[]): ClothesLocation | null {
  const matches = cities.filter((city) => normalizedName(city.name) === normalizedName(query) && readSceneCity(city));
  const unique = [...new Map(matches.map((city) => [`${city.latitude.toFixed(2)}:${city.longitude.toFixed(2)}`, city])).values()]
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  const first = unique[0];
  if (!first || (unique.length > 1 && ((first.population ?? 0) < 100000 || (first.population ?? 0) < (unique[1].population ?? 0) * 10))) return null;
  return { name: cityLabel(first), latitude: first.latitude, longitude: first.longitude, timezone: first.timezone, source: 'calendar' };
}
export async function resolveDestination(query: string): Promise<ClothesLocation | null> {
  if (!/^[\p{L}\s·.-]{2,40}$/u.test(query)) return null;
  const key = `weather:destination:v1:${query}`;
  const cached = await kv.get<{ city: ClothesLocation | null }>(key);
  if (cached) return cached.city;
  const queries = /^[\u4e00-\u9fff]{2,8}$/.test(query) && !query.endsWith('市') ? [query, `${query}市`] : [query];
  const results = await Promise.all(queries.map(async (name) => {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name, count: '10', language: 'zh', format: 'json' }).toString();
    return (await upstream(url)).results ?? [];
  }));
  const city = selectDestinationCity(query, results.flat());
  await kv.set(key, { city }, { ex: city ? 30 * 86400 : 3600 });
  return city;
}

export async function readCalendarLocations(start: string, end: string): Promise<Record<string, CalendarLocationDay>> {
  const [configState, calendar, settings, contexts, plans] = await Promise.all([
    kv.get<{ config?: Partial<AppConfig> }>('app-config'),
    kv.get<{ tagMap?: Record<string, TagKind>; dayOverrides?: DayOverrides; outlookTravelTitles?: Record<string, string> }>('calendar-tags'),
    kv.get<{ tripTags?: Record<string, string>; tripSplits?: Record<string, true> }>('trip-tags'),
    kv.hgetall<Record<string, ClothesDayContext>>('bonclothes:contexts:v1'),
    kv.hgetall<Record<string, ClothesTripPlan>>('bonclothes:trip-plans:v1'),
  ]);
  const config = configState?.config ?? {}, dayOverrides = normalizeDayOverrides(calendar?.dayOverrides);
  const trips = detectAllTrips(calendar?.tagMap ?? {}, settings?.tripSplits);
  const today = deviceDate(new Date(), 'Asia/Shanghai');
  const queries = new Map<string, Promise<ClothesLocation | null>>();
  const resolve = (query: string) => {
    if (!queries.has(query)) queries.set(query, resolveDestination(query).catch(() => null));
    return queries.get(query)!;
  };
  const rows = await Promise.all(dateRange(start, end).map(async (date) => {
    const daily = resolveDailyContext(date, calendar?.tagMap?.[date], { config, dayOverrides });
    const context = contexts?.[date], trip = trips.find((trip) => trip.dates.includes(date));
    const plan = trip && plans?.[`trip:${trip.startDate}`];
    const tripDay = plan?.days[date];
    const title = trip ? getTripDisplayTitle(settings?.tripTags?.[trip.startDate], trip.dates, calendar?.outlookTravelTitles ?? {}) : '';
    const plannedLocation = plan?.location?.source !== 'calendar' || plan.title === title ? readSceneCity(plan?.location) : null;
    const explicit = (context?.location?.source === 'manual' || (date <= today && context?.location?.source === 'geo') ? readSceneCity(context.location) : null)
      ?? readSceneCity(dayOverrides[date]?.city);
    const fixed = explicit ?? (daily.tag === 'travel' ? plannedLocation : daily.city);
    let locations: ClothesLocation[] = fixed ? [{ ...fixed, source: 'calendar' }] : [];
    if (!fixed && trip) {
      locations = (await Promise.all(tripDestinationQueries(title).map(resolve))).filter((city): city is ClothesLocation => !!city);
    }
    return [date, { locations, travel: daily.tag === 'travel', scene: context?.scene ?? tripDay?.scene, active: context?.active ?? tripDay?.active }] as const;
  }));
  return Object.fromEntries(rows);
}

export async function readCalendarWeather(start: string, end: string): Promise<CalendarWeather> {
  const locations = await readCalendarLocations(start, end);
  const requests = new Map<string, ReturnType<typeof readDailyWeather>>();
  const key = (location: ClothesLocation) => `${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}:${location.timezone ?? 'Asia/Shanghai'}`;
  for (const day of Object.values(locations)) for (const city of day.locations) {
    if (!requests.has(key(city))) requests.set(key(city), readDailyWeather(city, start, end, city.timezone ?? 'Asia/Shanghai'));
  }
  const results = new Map(await Promise.all([...requests].map(async ([key, request]) => [key, await request] as const)));
  return { days: Object.fromEntries(Object.entries(locations).map(([date, day]) => [date, day.locations.map((location) => {
    const result = results.get(key(location))!;
    return { location, weather: result.days[date] ?? null, stale: result.stale };
  })])), ...(Array.from(results.values()).some((r) => r.error) ? { error: '天气更新失败' } : {}) };
}
