import { kv } from './_accountKv.js';
import { upstream } from './_weatherClient.js';
import { deviceDate } from '../src/clothes/rules.js';
import { shiftDay } from '../src/utils/internship.js';
import type { SceneCity } from '../src/models/types.js';
import type { TripForecast, WeatherSnapshot } from '../src/clothes/types.js';

const fields = ['temperature_2m_min', 'temperature_2m_max', 'apparent_temperature_min', 'apparent_temperature_max', 'precipitation_sum', 'wind_speed_10m_max'];
export async function readDailyWeather(location: SceneCity, start: string, end: string, timezone: string): Promise<TripForecast> {
  if (start > end) return { days: {}, stale: false };
  const today = deviceDate(new Date(), timezone), boundary = shiftDay(today, -5);
  const latitude = Number(location.latitude.toFixed(3)), longitude = Number(location.longitude.toFixed(3));
  const requests: { start: string; end: string; archive: boolean }[] = [];
  if (start < boundary) requests.push({ start, end: end < boundary ? end : shiftDay(boundary, -1), archive: true });
  if (end >= boundary && start <= shiftDay(today, 15)) requests.push({ start: start > boundary ? start : boundary, end: end < shiftDay(today, 15) ? end : shiftDay(today, 15), archive: false });
  const results = await Promise.all(requests.map(async (range): Promise<TripForecast> => {
    // All near-term days share one cache, including the current day and BonClothes trip forecasts.
    const key = `weather:daily:v1:${latitude}:${longitude}:${timezone}:${range.archive ? `${range.start}:${range.end}` : today}`;
    const saved = await kv.get<TripForecast>(key);
    if (saved?.fetchedAt && Date.now() - Date.parse(saved.fetchedAt) < (range.archive ? 7 * 86400000 : 30 * 60000)) return saved;
    try {
      const url = new URL(range.archive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone,
        daily: [...fields, 'weather_code'].join(','),
        ...(range.archive ? { start_date: range.start, end_date: range.end } : { forecast_days: '16', past_days: '5' }) }).toString();
      const { daily } = await upstream(url);
      const fetchedAt = new Date().toISOString(), days: Record<string, WeatherSnapshot> = {};
      if (!Array.isArray(daily?.time)) throw new Error('暂无天气');
      daily.time.forEach((date: unknown, index: number) => {
        if (typeof date !== 'string') return;
        const values = fields.map((key) => daily[key]?.[index]);
        // Missing forecast tails stay blank, never become sunny or 0°C.
        if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return;
        const [min, max, apparentMin, apparent, precipitation, wind] = values;
        const code = daily.weather_code?.[index];
        days[date] = { date, timezone, latitude, longitude, fetchedAt, temperature: max, apparent, apparentMin, min, max, precipitation, wind,
          ...(typeof code === 'number' && Number.isInteger(code) ? { code } : {}) };
      });
      if (!Object.keys(days).length) throw new Error('暂无天气');
      const result = { days, fetchedAt, stale: false };
      await kv.set(key, result, { ex: range.archive ? 30 * 86400 : 86400 });
      return result;
    } catch { return { days: saved?.days ?? {}, fetchedAt: saved?.fetchedAt, stale: true, error: '天气更新失败' }; }
  }));
  return { days: Object.fromEntries(results.flatMap((r) => Object.entries(r.days)).filter(([date]) => date >= start && date <= end)),
    stale: results.some((r) => r.stale), fetchedAt: results.map((r) => r.fetchedAt).filter((v): v is string => !!v).sort()[0],
    ...(results.some((r) => r.error) ? { error: '天气更新失败' } : {}) };
}
