import { DAY_PERIODS, type ClothesDayContext, type DayPeriod, type PeriodFeeling, type WearRecord, type WeatherSnapshot } from './types.js';

export function timePeriod(time: string): DayPeriod {
  const hour = Number(time.slice(0, 2));
  return hour < 9 ? '早晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : '晚上';
}
export function blankFeeling(context: ClothesDayContext): PeriodFeeling {
  return { indoor: null, outdoor: null, indoorTemperature: context.indoorTemperature ?? null, outdoorTemperature: context.manualWeather?.temperature ?? null };
}
export function outdoorTemperatureForPeriod(context: ClothesDayContext, weather: WeatherSnapshot | null, period: DayPeriod, snapshotTime: string | null) {
  return weather?.periodTemperatures?.[period] ?? context.manualWeather?.temperature
    ?? (snapshotTime && period === timePeriod(snapshotTime) ? weather?.temperature ?? null : null);
}
export function recordFeelings(record: WearRecord) {
  if (record.feelings) return record.feelings;
  if (!record.indoor && !record.outdoor) return {};
  return { [timePeriod(record.time ?? '12:00')]: { indoor: record.indoor ?? null, outdoor: record.outdoor ?? null,
    indoorTemperature: record.context.indoorTemperature ?? null, outdoorTemperature: record.context.manualWeather?.temperature ?? record.weather?.temperature ?? null } };
}
export function feelingEntries(record: WearRecord) {
  const feelings = recordFeelings(record);
  return DAY_PERIODS.flatMap((period) => feelings[period] && (feelings[period]!.indoor || feelings[period]!.outdoor || feelings[period]!.cycling) ? [{ period, ...feelings[period]! }] : []);
}

// A per-outfit indoor observation must only contribute once, regardless of time slots.
export function calibrationFeelings(record: WearRecord) {
  const entries = feelingEntries(record);
  if (record.indoorTemperature === undefined) return entries;
  return [{ indoor: record.indoor ?? null, indoorTemperature: record.indoorTemperature, outdoor: null, outdoorTemperature: null },
    ...entries.map((entry) => ({ ...entry, indoor: null, indoorTemperature: null }))];
}
