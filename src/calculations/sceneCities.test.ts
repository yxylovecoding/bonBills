import { afterEach, expect, it, vi } from 'vitest';
import type { InternshipPeriod, TagKind } from '../models/types';
import { monthlyRecords } from '../data/mockData';
import { assignExpenseIds, type BillExpenseItem } from '../utils/importBill';
import { BEIJING, GUANGZHOU, DEFAULT_INTERNSHIP_RULES } from '../utils/internship';
import { sceneCitySummaries } from '../utils/sceneDaily';
import { dailyLivingAmount } from '../utils/cityLiving';
import { calcHistoryStats } from './history';

afterEach(() => vi.useRealTimers());

function fixture() {
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
  const records = [{ ...monthlyRecords[0], yearMonth: '2026-10', periodicLife: 21, volatileLife: 222, consumption: 130 }];
  return { context, stats: calcHistoryStats(records, tags, confirmed, { '2026-10': items }, undefined, {}, context) };
}

it('校班按城市筛选，班将工作和休息样本按天数合并，零支出日也计入', () => {
  const { stats } = fixture();
  const cities = sceneCitySummaries(stats, 'intern');
  expect(cities).toHaveLength(2);
  const bj = cities.find(row => row.city.name === '北京')!, gz = cities.find(row => row.city.name === '广州')!;
  expect(bj.days).toBe(2); expect(bj.lifeVal).toBeCloseTo(30 + stats.sharedLifeDailyBase); expect(bj.consumptionVal).toBe(20);
  expect(gz.days).toBe(3); expect(gz.lifeVal).toBeCloseTo(50 + stats.sharedLifeDailyBase); expect(gz.consumptionVal).toBe(30);
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
