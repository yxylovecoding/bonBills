import { afterEach, expect, it, vi } from 'vitest';
import type { InternshipPeriod, TagKind } from '../models/types';
import { monthlyRecords } from '../data/mockData';
import { assignExpenseIds, type BillExpenseItem } from '../utils/importBill';
import { BEIJING, GUANGZHOU, DEFAULT_INTERNSHIP_RULES } from '../utils/internship';
import { sceneCitySummaries } from '../utils/sceneDaily';
import { dailyLivingAmount } from '../utils/cityLiving';
import { calcHistoryStats } from './history';
import { NANJING } from '../utils/schoolPeriods';

afterEach(() => vi.useRealTimers());

it('南京北京上学按月份划分旧记录，城市天数加总与学的综合一致', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T04:00:00Z'));
  const records = ['2021-09', '2025-06', '2025-09', '2026-09'].map(yearMonth => ({ ...monthlyRecords[0], yearMonth,
    schoolDays: 20, internDays: 5, homeDays: 5, travelDays: 0, periodicLife: 300, volatileLife: 900, consumption: 600 }));
  const context = { config: { schoolCity: BEIJING, internshipLegacyCity: BEIJING, schoolPeriods: [
    { id: 'nj', city: NANJING, startMonth: '2021-09', endMonth: '2025-06' },
    { id: 'bj', city: BEIJING, startMonth: '2025-09', endMonth: '2028-06' },
  ] } };
  const stats = calcHistoryStats(records, {}, {}, {}, undefined, {}, context);
  const cities = sceneCitySummaries(stats, 'school');
  expect(cities.map(row => [row.city.name, row.days])).toEqual([['南京', 40], ['北京', 40]]);
  expect(cities.reduce((sum, row) => sum + row.days, 0)).toBe(stats.stateDailyConfidence.school);
  expect(cities.reduce((sum, row) => sum + row.lifeVal * row.days, 0) / 80).toBeCloseTo(stats.stateDailyAvg.school);
  expect(sceneCitySummaries(stats, 'intern').map(row => [row.city.name, row.days])).toEqual([['北京', 20]]);
});

it('学的南京和北京账单明细与预测样本按日期隔离，共享仍均摊', () => {
  const context = { config: { schoolCity: BEIJING, schoolPeriods: [
    { id: 'nj', city: NANJING, startMonth: '2021-09', endMonth: '2025-06' },
    { id: 'bj', city: BEIJING, startMonth: '2025-09', endMonth: '2028-06' },
  ] } };
  const items: BillExpenseItem[] = ['2025-06-03', '2025-09-03'].flatMap((date, i) => [
    { date, amount: i ? 90 : 30, category: i ? '交通' : '餐饮', subcategory: '', tags: '波动生活', note: '', account: '' },
    { date, amount: 20, category: '订阅', subcategory: '', tags: '周期生活', note: '', account: '' },
  ]);
  const months = ['2025-06', '2025-09'];
  const dates = ['2025-06-03', '2025-09-03'];
  const confirmed = Object.fromEntries(dates.map(date => {
    const rows = assignExpenseIds(items.filter(i => i.date === date));
    return [date, { reviewed: true, localIds: [rows[0].id], sharedIds: [rows[1].id] }];
  }));
  const records = months.map((yearMonth, i) => ({ ...monthlyRecords[0], yearMonth, schoolDays: 1, internDays: 0, homeDays: 0, travelDays: 0,
    periodicLife: 20, volatileLife: i ? 90 : 30, consumption: 0 }));
  const stats = calcHistoryStats(records, Object.fromEntries(dates.map(d => [d, 'school'])), confirmed,
    Object.fromEntries(months.map(m => [m, items.filter(i => i.date.startsWith(m))])), undefined, {}, context);
  const cities = sceneCitySummaries(stats, 'school');
  expect(cities.map(c => c.localLifeBreakdown.map(r => r.category))).toEqual([['餐饮'], ['交通']]);
  expect(cities[0].lifeVal).toBeCloseTo(30 + stats.sharedLifeDailyBase);
  expect(cities[1].lifeVal).toBeCloseTo(90 + stats.sharedLifeDailyBase);
  expect((cities[0].lifeVal + cities[1].lifeVal) / 2).toBeCloseTo(stats.stateDailyAvg.school);
  expect(dailyLivingAmount('2025-06-20', 'school', stats, context)).toBe(cities[0].lifeVal);
  expect(dailyLivingAmount('2026-10-21', 'school', stats, context)).toBe(cities[1].lifeVal);
});

function fixture(unassignedLife = 0) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T04:00:00Z'));
  const period: InternshipPeriod = { id: 'bj', profileId: 'company', profileName: '公司', revision: 1,
    startDate: '2026-10-19', endDate: '2026-10-20', city: BEIJING, schoolCity: BEIJING,
    rules: { ...DEFAULT_INTERNSHIP_RULES, salary: 100, workweek: 'weekdays' } };
  const context = { config: { schoolCity: BEIJING, internshipPeriods: [period,
    { ...period, id: 'gz', city: GUANGZHOU, startDate: '2026-10-21', endDate: '2026-10-25' }] } };
  const expense = (date: string, amount: number, category: string, tags = '波动生活'): BillExpenseItem =>
    ({ date, amount, category, subcategory: `${category}明细`, tags, note: '', account: '' });
  const items = [
    expense('2026-10-18', 12, '餐饮'),
    expense('2026-10-19', 20, '餐饮'), expense('2026-10-19', 10, '购物', '消费'),
    expense('2026-10-19', 21, '订阅', '周期生活'),
    expense('2026-10-20', 40, '餐饮'), expense('2026-10-20', 30, '购物', '消费'),
    expense('2026-10-21', 100, '交通'), expense('2026-10-21', 60, '购物', '消费'),
    expense('2026-10-24', 50, '交通'), expense('2026-10-24', 30, '购物', '消费'),
    expense('2026-10-28', 999, '预测'),
  ];
  const dates = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-24', '2026-10-25', '2026-10-28'];
  const tags: Record<string, TagKind> = Object.fromEntries(dates.map(date => [date, date === '2026-10-18' || date === '2026-10-28' ? 'school' : 'intern']));
  const confirmed = Object.fromEntries(dates.map(date => {
    const entries = assignExpenseIds(items.filter(item => item.date === date));
    return [date, { reviewed: true, localIds: entries.filter(e => e.item.category !== '订阅').map(e => e.id),
      sharedIds: entries.filter(e => e.item.category === '订阅').map(e => e.id) }];
  }));
  const records = [{ ...monthlyRecords[0], yearMonth: '2026-10', periodicLife: 21, volatileLife: 222 + unassignedLife, consumption: 130 }];
  return { context, stats: calcHistoryStats(records, tags, confirmed, { '2026-10': items }, undefined, {}, context) };
}

it('校班按完整场景天数筛选，未逐日确认和零支出日也计入', () => {
  const { stats } = fixture();
  const cities = sceneCitySummaries(stats, 'intern');
  expect(cities).toHaveLength(2);
  const bj = cities.find(row => row.city.name === '北京')!, gz = cities.find(row => row.city.name === '广州')!;
  expect(bj.days).toBe(2); expect(bj.lifeVal).toBeCloseTo(30 + stats.sharedLifeDailyBase); expect(bj.consumptionVal).toBe(20);
  expect(gz.days).toBe(5); expect(gz.lifeVal).toBeCloseTo(30 + stats.sharedLifeDailyBase); expect(gz.consumptionVal).toBe(18);
  const school = sceneCitySummaries(stats, 'school');
  expect(school).toHaveLength(1); expect(school[0].days).toBe(1);
  expect(school[0].lifeVal).toBeCloseTo(12 + stats.sharedLifeDailyBase);
  expect(sceneCitySummaries(stats, 'home')).toEqual([]);
  expect(sceneCitySummaries(stats, 'travel')).toEqual([]);
});

it('城市分类、消费和共享均摊与筛选后金额一致，不混入其他城市或预测日', () => {
  const { stats, context } = fixture();
  const before = structuredClone(stats);
  for (const city of sceneCitySummaries(stats, 'intern')) {
    const expectedCategory = city.city.name === '北京' ? '餐饮' : '交通';
    expect(city.localLifeBreakdown.map(row => row.category)).toEqual([expectedCategory]);
    expect(city.localLifeBreakdown.reduce((sum, row) => sum + row.dailyBase, 0) + stats.sharedLifeDailyBase).toBeCloseTo(city.lifeVal);
    expect(city.localLifeBreakdown[0].subcategories[0].dailyBase).toBe(city.localLifeBreakdown[0].dailyBase);
  }
  expect(stats.sharedLifeBreakdown.map(row => row.category)).toEqual(['订阅']);
  expect(dailyLivingAmount('2026-10-21', 'intern', stats, context)).toBeCloseTo(100 + stats.sharedLifeDailyBase);
  expect(dailyLivingAmount('2026-10-24', 'intern', stats, context)).toBeCloseTo(25 + stats.sharedLifeDailyBase);
  expect(stats).toEqual(before);
});

it('没有城市样本时不提供虚构的城市统计', () => {
  expect(sceneCitySummaries(calcHistoryStats([]), 'school')).toEqual([]);
  expect(sceneCitySummaries(calcHistoryStats([]), 'intern')).toEqual([]);
});

it('六个月北京实习只有17天确认账单时，北京仍等于综合且显示120个历史场景日', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T04:00:00Z'));
  const records = Array.from({ length: 6 }, (_, i) => ({ ...monthlyRecords[0], yearMonth: `2026-${String(i + 4).padStart(2, '0')}`,
    internDays: 20, schoolDays: 10, homeDays: 0, travelDays: 0, periodicLife: 300, volatileLife: 1500, consumption: 900 }));
  const dates = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  const tagMap: Record<string, TagKind> = Object.fromEntries(dates.map((date, i) => [date, i < 20 ? 'intern' : 'school']));
  const items: BillExpenseItem[] = dates.slice(0, 17).map(date => ({ date, amount: 20, category: '餐饮', subcategory: '午餐', tags: '波动生活', note: '', account: '' }));
  const confirmed = Object.fromEntries(items.map(item => [item.date, { reviewed: true, localIds: [assignExpenseIds([item])[0].id], sharedIds: [] }]));
  const context = { config: { schoolCity: BEIJING, internshipLegacyCity: BEIJING, internshipPeriods: [{
    id: 'future', profileId: 'company', profileName: '广州公司', revision: 1, startDate: '2026-11-01', endDate: '2026-11-30',
    city: GUANGZHOU, schoolCity: BEIJING, rules: { ...DEFAULT_INTERNSHIP_RULES, salary: 100 },
  }] } };
  const stats = calcHistoryStats(records, tagMap, confirmed, { '2026-09': items }, undefined, {}, context);
  expect(Object.values(stats.cityLivingStats!).reduce((sum, row) => sum + row.days, 0)).toBe(17);
  const cities = sceneCitySummaries(stats, 'intern');
  expect(cities).toHaveLength(1);
  expect(cities[0].city).toEqual(BEIJING);
  expect(cities[0].days).toBe(120);
  expect(cities[0].days).toBe(stats.stateDailyConfidence.intern);
  expect(cities[0].lifeVal).toBe(stats.stateDailyAvg.intern);
  expect(cities[0].consumptionVal).toBe(stats.stateConsumptionDailyAvg.intern);
  expect(cities[0].localLifeBreakdown).toEqual(stats.localLifeBreakdown.intern);
  expect(cities[0].lifeVal - stats.sharedLifeDailyBase - cities[0].localLifeBreakdown.reduce((sum, row) => sum + row.dailyBase, 0)).toBeGreaterThan(0);
  const school = sceneCitySummaries(stats, 'school')[0];
  expect(school.days).toBe(60);
  expect(school.lifeVal).toBe(stats.stateDailyAvg.school);
});

it('北京广州的金额、消费、分类和天数按天数加权后严格还原综合，保留未拆分估算', () => {
  const { stats } = fixture(300);
  const rows = sceneCitySummaries(stats, 'intern');
  const days = rows.reduce((sum, row) => sum + row.days, 0);
  expect(days).toBe(stats.stateDailyConfidence.intern);
  expect(rows.reduce((sum, row) => sum + row.lifeVal * row.days, 0) / days).toBeCloseTo(stats.stateDailyAvg.intern);
  expect(rows.reduce((sum, row) => sum + row.consumptionVal * row.days, 0) / days).toBeCloseTo(stats.stateConsumptionDailyAvg.intern);
  for (const category of stats.localLifeBreakdown.intern) {
    const total = rows.reduce((sum, row) => sum + (row.localLifeBreakdown.find(r => r.category === category.category)?.dailyBase ?? 0) * row.days, 0);
    expect(total / days).toBeCloseTo(category.dailyBase);
  }
  const bj = rows.find(row => row.city.name === '北京')!, gz = rows.find(row => row.city.name === '广州')!;
  expect(bj.lifeVal).toBeCloseTo(30 + stats.sharedLifeDailyBase);
  expect(gz.lifeVal).toBeCloseTo(90 + stats.sharedLifeDailyBase);
});

it('不把同月预测日期或今天加入历史场景天数，即使尚未配置实习段', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T04:00:00Z'));
  const tags: Record<string, TagKind> = { '2026-10-19': 'intern', '2026-10-20': 'intern', '2026-10-21': 'intern', '2026-10-22': 'intern' };
  const stats = calcHistoryStats([{ ...monthlyRecords[0], yearMonth: '2026-10' }], tags, {}, {}, undefined, {}, { config: { schoolCity: BEIJING } });
  const row = sceneCitySummaries(stats, 'intern')[0];
  expect(row.days).toBe(2);
  expect(row.days).toBe(stats.stateDailyConfidence.intern);
  expect(row.lifeVal).toBe(stats.stateDailyAvg.intern);
});
