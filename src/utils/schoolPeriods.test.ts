import { describe, expect, it } from 'vitest';
import type { AppConfig, SchoolPeriod } from '../models/types';
import { BEIJING, GUANGZHOU, DEFAULT_INTERNSHIP_RULES, resolveDailyContext, resolvedTagMap } from './internship';
import { NANJING, schoolPeriodAt, schoolPeriodError } from './schoolPeriods';
import { mergeSyncValue } from './syncMerge';

const schoolPeriods: SchoolPeriod[] = [
  { id: 'nj', city: NANJING, startMonth: '2021-09', endMonth: '2025-06' },
  { id: 'bj', city: BEIJING, startMonth: '2025-09', endMonth: '2028-06' },
];
const config: Partial<AppConfig> = { schoolCity: BEIJING, internshipLegacyCity: BEIJING, homeCity: GUANGZHOU, schoolPeriods };

describe('上学阶段按月份确定城市', () => {
  it.each(['2021-09-01', '2023-04-05', '2025-06-30'])('%s 的学属于南京，首尾月份包含在内', date => {
    expect(resolveDailyContext(date, 'school', { config })).toMatchObject({ city: NANJING, tag: 'school', livingKind: 'school', label: '南京·校', paid: false });
  });
  it.each(['2025-09-01', '2026-10-21', '2028-06-30'])('%s 的学属于北京，覆盖未来在读日期', date => {
    expect(resolveDailyContext(date, 'school', { config }).city).toEqual(BEIJING);
  });
  it('空档、毕业以后和未配置阶段沿用原默认，不新增日历或猜测回家', () => {
    for (const date of ['2021-08-31', '2025-07-01', '2025-08-31', '2028-07-01']) {
      expect(schoolPeriodAt(date, config)).toBeUndefined();
      expect(resolveDailyContext(date, 'school', { config }).city).toEqual(BEIJING);
    }
    const raw = { '2025-06-03': 'school' as const, '2025-06-04': 'home' as const };
    expect(resolvedTagMap(raw, { config })).toEqual(raw);
    expect(resolveDailyContext('2024-10-01', 'school', { config: { schoolCity: GUANGZHOU } }).city).toEqual(GUANGZHOU);
  });
  it('回家、出游、单日覆盖和旧北京实习不被南京上学经历覆盖', () => {
    expect(resolveDailyContext('2024-10-01', 'home', { config })).toMatchObject({ city: GUANGZHOU, tag: 'home' });
    expect(resolveDailyContext('2024-10-01', 'travel', { config })).toMatchObject({ city: null, tag: 'travel' });
    expect(resolveDailyContext('2024-10-01', 'school', { config, dayOverrides: { '2024-10-01': { city: GUANGZHOU } } }).city).toEqual(GUANGZHOU);
    expect(resolveDailyContext('2024-10-01', 'intern', { config })).toMatchObject({ city: BEIJING, paid: true });
  });
  it('实习所在地保持独立，本地休息按当时上学城市判断', () => {
    const period = { id: 'intern', profileId: 'company', profileName: '公司', revision: 1, city: NANJING, schoolCity: BEIJING,
      startDate: '2025-06-01', endDate: '2025-06-30', rules: { ...DEFAULT_INTERNSHIP_RULES, salary: 100, workweek: 'weekdays' as const } };
    expect(resolveDailyContext('2025-06-07', 'intern', { config: { ...config, internshipPeriods: [period] } }))
      .toMatchObject({ city: NANJING, tag: 'school', paid: false });
    expect(resolveDailyContext('2025-06-07', 'intern', { config: { ...config, internshipPeriods: [{ ...period, city: GUANGZHOU }] } }))
      .toMatchObject({ city: GUANGZHOU, tag: 'intern', livingKind: 'rest', paid: false });
  });
  it('拒绝缺失、倒序和重叠月份，允许相邻月份和编辑原阶段', () => {
    expect(schoolPeriodError({ ...schoolPeriods[0], startMonth: '2021-13' })).toBeTruthy();
    expect(schoolPeriodError({ ...schoolPeriods[0], startMonth: '2028-01' })).toBeTruthy();
    expect(schoolPeriodError({ ...schoolPeriods[0], city: null })).toBeTruthy();
    expect(schoolPeriodError({ ...schoolPeriods[1], startMonth: '2025-06' }, schoolPeriods)).toBeTruthy();
    expect(schoolPeriodError({ ...schoolPeriods[1], startMonth: '2025-07' }, schoolPeriods)).toBeNull();
    expect(schoolPeriodError(schoolPeriods[0], schoolPeriods)).toBeNull();
    expect(schoolPeriodAt('2025-06-01', { schoolPeriods: [schoolPeriods[0], { ...schoolPeriods[0], id: 'conflict' }] })).toBeUndefined();
  });
  it('多端独立编辑不同上学阶段时按 ID 合并，删除也保留', () => {
    const local = [schoolPeriods[0], { ...schoolPeriods[1], endMonth: '2028-07' }];
    const remote = [{ ...schoolPeriods[0], startMonth: '2021-08' }, schoolPeriods[1]];
    expect(mergeSyncValue(schoolPeriods, local, remote)).toEqual([remote[0], local[1]]);
    expect(mergeSyncValue(schoolPeriods, [schoolPeriods[1]], remote)).toEqual([schoolPeriods[1]]);
  });
});
