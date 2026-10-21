import type { AppConfig, SceneCity, SchoolPeriod } from '../models/types.js';
import { readSceneCity } from './sceneCities.js';

export const NANJING: SceneCity = { name: '南京', latitude: 32.0603, longitude: 118.7969, timezone: 'Asia/Shanghai' };
const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

export function schoolPeriodError(period: SchoolPeriod, others: SchoolPeriod[] = []): string | null {
  if (!validMonth(period.startMonth) || !validMonth(period.endMonth)) return '请填写起止月份';
  if (period.startMonth > period.endMonth) return '结束月份不能早于开始月份';
  if (!readSceneCity(period.city)) return '请选择上学城市';
  if (others.some(p => p.id !== period.id && !schoolPeriodError(p)
    && period.startMonth <= p.endMonth && p.startMonth <= period.endMonth)) return '上学日期不能重叠';
  return null;
}

export function schoolPeriodAt(date: string, config: Partial<AppConfig>): SchoolPeriod | undefined {
  const month = date.slice(0, 7);
  if (!validMonth(month)) return undefined;
  const matches = (config.schoolPeriods ?? []).filter(p => !schoolPeriodError(p) && p.startMonth <= month && month <= p.endMonth);
  return matches.length === 1 ? matches[0] : undefined;
}

