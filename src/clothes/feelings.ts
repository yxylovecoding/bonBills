import { DAY_PERIODS, type ClothesDayContext, type DayPeriod, type PeriodFeeling, type WearRecord } from './types.js';

export function timePeriod(time: string): DayPeriod {
  const hour = Number(time.slice(0, 2));
  return hour < 9 ? '早晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : '晚上';
}
export function blankFeeling(context: ClothesDayContext): PeriodFeeling {
  return { indoor: null, outdoor: null, indoorTemperature: context.indoorTemperature ?? null, outdoorTemperature: context.manualWeather?.temperature ?? null };
}
export function recordFeelings(record: WearRecord) {
  if (record.feelings) return record.feelings;
  if (!record.indoor && !record.outdoor) return {};
  return { [timePeriod(record.time ?? '12:00')]: { indoor: record.indoor ?? null, outdoor: record.outdoor ?? null,
    indoorTemperature: record.context.indoorTemperature ?? null, outdoorTemperature: record.context.manualWeather?.temperature ?? record.weather?.temperature ?? null } };
}
export function feelingEntries(record: WearRecord) {
  const feelings = recordFeelings(record);
  return DAY_PERIODS.flatMap((period) => feelings[period] && (feelings[period]!.indoor || feelings[period]!.outdoor) ? [{ period, ...feelings[period]! }] : []);
}
