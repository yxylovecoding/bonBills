import { kv } from './_accountKv.js';
import { createHash } from 'node:crypto';
import { decryptOutlookConnection, fetchCalendar, parseOutlookCalendar } from './_outlookCalendar.js';
import { OUTLOOK_CONNECTION_KEY, type OutlookConnection } from './_outlookSync.js';
import { deviceDate } from '../src/clothes/rules.js';
import { timePeriod } from '../src/clothes/feelings.js';
import { nextCalendarDate } from '../src/utils/outlookCalendar.js';
import type { ClothesCalendar, ClothesLocation, DayPeriod, WeatherSnapshot } from '../src/clothes/types.js';

export const ITEMS_KEY = 'bonclothes:items:v1';
export const CONTEXTS_KEY = 'bonclothes:contexts:v1';
export const WEAR_KEY = 'bonclothes:wear:v1';
export const photoKey = (id: string) => `bonclothes:photo:v1:${id}`;
export const receiptKey = (id: string) => `bonclothes:mutation:v1:${id}`;
export const signature = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// One atomic transaction covers revision checks, immutable photo storage, item snapshots and retry receipts.
export const SAVE_CLOTHES = `
local receipt = redis.call('GET', KEYS[2])
if receipt then
  local previous = cjson.decode(receipt)
  if previous.signature ~= ARGV[7] then return {-3, ''} end
  return {1, cjson.encode(previous.value)}
end
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local revision = ''
if raw then revision = cjson.decode(raw).revision end
if revision ~= ARGV[2] then return {0, raw or ''} end
for _, check in ipairs(cjson.decode(ARGV[6])) do
  local item = redis.call('HGET', KEYS[3], check.id)
  if not item then return {-2, ''} end
  item = cjson.decode(item)
  if item.deleted or item.status == '收起' or item.revision ~= check.revision then return {-2, ''} end
end
if KEYS[4] ~= '' then
  if ARGV[5] ~= '' then redis.call('SET', KEYS[4], ARGV[5], 'NX')
  elseif redis.call('EXISTS', KEYS[4]) == 0 then return {-1, ''} end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
redis.call('SET', KEYS[2], cjson.encode({signature=ARGV[7], value=cjson.decode(ARGV[4])}), 'EX', 2592000)
return {1, ARGV[4]}
`;

export async function upstream(url: URL) {
  const result = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!result.ok) throw new Error('天气服务暂不可用');
  return result.json();
}
export async function searchCities(query: string): Promise<ClothesLocation[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: query, count: '10', language: 'zh', format: 'json' }).toString();
  let result = await upstream(url) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string }[] };
  // Some Chinese cities are indexed only by their full municipal name.
  if (!result.results?.length && /^[\u4e00-\u9fff]{2,8}$/.test(query) && !query.endsWith('市')) {
    url.searchParams.set('name', `${query}市`);
    result = await upstream(url);
  }
  return (result.results ?? []).filter((city) => Number.isFinite(city.latitude) && Number.isFinite(city.longitude))
    .map((city) => ({ name: [...new Set([city.name, city.admin1, city.country].filter(Boolean))].join(' · '),
      latitude: city.latitude, longitude: city.longitude, timezone: city.timezone, source: 'manual' as const }));
}
export async function readWeather(location: ClothesLocation, date: string, timezone: string) {
  const latitude = Number(location.latitude.toFixed(3)), longitude = Number(location.longitude.toFixed(3));
  const key = `bonclothes:weather:v1:${latitude}:${longitude}:${date}:${timezone}`;
  const saved = await kv.get<WeatherSnapshot>(key);
  if (date < deviceDate(new Date(), timezone)) return { weather: saved, stale: false };
  if (saved && Date.now() - Date.parse(saved.fetchedAt) < 30 * 60 * 1000) return { weather: saved, stale: false };
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone,
      current: 'temperature_2m,apparent_temperature,precipitation,wind_speed_10m',
      hourly: 'temperature_2m',
      daily: 'temperature_2m_min,temperature_2m_max,apparent_temperature_min,precipitation_sum,wind_speed_10m_max',
      start_date: date, end_date: date }).toString();
    const data = await upstream(url);
    const current = data.current, daily = data.daily;
    const fields = [current?.temperature_2m, current?.apparent_temperature, daily?.temperature_2m_min?.[0],
      daily?.temperature_2m_max?.[0], daily?.apparent_temperature_min?.[0], daily?.precipitation_sum?.[0], daily?.wind_speed_10m_max?.[0]];
    if (!fields.every((v) => typeof v === 'number' && Number.isFinite(v)) || daily?.time?.[0] !== date) throw new Error();
    const [temperature, apparent, min, max, apparentMin, precipitation, wind] = fields;
    const periodValues = new Map<DayPeriod, number[]>();
    if (Array.isArray(data.hourly?.time) && Array.isArray(data.hourly?.temperature_2m)) {
      data.hourly.time.forEach((time: unknown, index: number) => {
        const value = data.hourly.temperature_2m[index];
        if (typeof time !== 'string' || !time.startsWith(`${date}T`) || typeof value !== 'number' || !Number.isFinite(value)) return;
        const period = timePeriod(time.slice(11, 16));
        periodValues.set(period, [...(periodValues.get(period) ?? []), value]);
      });
    }
    const periodTemperatures = Object.fromEntries([...periodValues].map(([period, values]) =>
      [period, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10])) as Partial<Record<DayPeriod, number>>;
    const weather: WeatherSnapshot = { date, timezone, latitude, longitude, fetchedAt: new Date().toISOString(),
      temperature, apparent, min, max, apparentMin, precipitation, wind,
      ...(Object.keys(periodTemperatures).length ? { periodTemperatures } : {}) };
    // Keep the observed day's weather for later reviews; never relabel live weather as a past day.
    await kv.set(key, weather);
    return { weather, stale: false };
  } catch {
    return { weather: saved, stale: true, error: '天气更新失败' };
  }
}
export async function readClothesCalendar(date: string, timezone: string): Promise<ClothesCalendar> {
  const archiveKey = `bonclothes:calendar-history:v1:${date}:${timezone}`;
  const saved = await kv.get<ClothesCalendar>(archiveKey);
  if (date < deviceDate(new Date(), timezone) && saved) return saved;
  const connection = await kv.get<OutlookConnection>(OUTLOOK_CONNECTION_KEY);
  if (!connection) return { connected: false, events: [], fetchedAt: new Date().toISOString() };
  const input = decryptOutlookConnection(connection.encrypted, (process.env.SYNC_SECRET || '').trim());
  try {
    const sources = [{ calendar: 'play' as const, url: input.playUrl }, { calendar: 'class' as const, url: input.classUrl }].filter((source) => source.url);
    const results = await Promise.all(sources.map(async (source) => parseOutlookCalendar(await fetchCalendar(source.url),
      source.calendar, date, nextCalendarDate(date), false, true, { includeLocation: true, timezone, includeFree: true })));
    const value = { connected: true, fetchedAt: new Date().toISOString(), events: results.flat()
      .map(({ title, location, startDate, endDate, allDay }) => ({ title, location, startDate, endDate, allDay }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title)) };
    if (date <= deviceDate(new Date(), timezone)) await kv.set(archiveKey, value);
    return value;
  } catch { throw new Error('日历更新失败'); }
}
