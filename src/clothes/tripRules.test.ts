import { describe, expect, it } from 'vitest';
import { buildClothesTrips, newTripPlan, tripDayContext, tripDates, tripEventsOnDate } from './tripRules';
import { inferActivities } from './rules';
import type { ClothesEvent } from './types';
const event = (title: string, extra: Partial<ClothesEvent> = {}): ClothesEvent => ({ title, allDay: true, startDate: '2026-10-05', endDate: '2026-10-07', ...extra });
describe('出行条件与计划', () => {
  it('运动或大量步行需要活动便利，普通室外活动不等同于运动', () => {
    for (const title of ['健身', '跑步', '羽毛球', '瑜伽', '走很多路', '徒步']) expect(inferActivities([event(title)]).active).toBe(true);
    for (const title of ['公园', '露营', '电影', '室内，无运动']) expect(inferActivities([event(title)]).active).toBe(false);
    expect(inferActivities([event('羽毛球')]).scene).toBeNull();
    expect(inferActivities([event('出游')])).toEqual({ scene: null, active: null });
  });
  it('关联已有出游分段与自定义名称，不更改账本状态', () => {
    const calendar = { tagMap: { '2026-10-04': 'travel', '2026-10-05': 'travel', '2026-10-06': 'travel', '2026-10-07': 'school' }, outlookTravelTitles: { '2026-10-05': '杭州' } };
    const before = JSON.stringify(calendar);
    const trips = buildClothesTrips(calendar, { tripSplits: { '2026-10-06': true }, tripTags: { '2026-10-06': '朋友婚礼' } }, [event('杭州旅行', { location: '杭州' })], '2026-10-05', 'Asia/Shanghai');
    expect(trips.map((trip) => [trip.id, trip.title, trip.dates])).toEqual([
      ['trip:2026-10-04', '杭州', ['2026-10-04', '2026-10-05']], ['trip:2026-10-06', '朋友婚礼', ['2026-10-06']],
    ]);
    expect(trips[0].destinations).toEqual(['杭州']); expect(JSON.stringify(calendar)).toBe(before);
  });
  it('全天按日期，跨午夜定时日程按设备时区且结束时间不多占一天', () => {
    const events = [event('全天'), event('运动', { allDay: false, startDate: '2026-10-06T03:00:00Z', endDate: '2026-10-06T07:00:00Z' })];
    expect(tripEventsOnDate(events, '2026-10-05', 'America/Los_Angeles')).toHaveLength(2);
    expect(tripEventsOnDate(events, '2026-10-06', 'America/Los_Angeles')).toHaveLength(1);
    expect(tripDates('2026-03-07', '2026-03-09')).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });
  it('逐日手动条件不被新日历覆盖，预报使用目的地时区', () => {
    const trip = buildClothesTrips({ tagMap: { '2026-10-05': 'travel', '2026-10-06': 'travel' } }, {}, [event('爬山')], '2026-10-05', 'Asia/Shanghai')[0];
    const plan = newTripPlan(trip); plan.days['2026-10-05'] = { scene: '基本室内', active: false, itemIds: null };
    plan.location = { name: '纽约', latitude: 40, longitude: -74, source: 'manual', timezone: 'America/New_York' };
    expect(tripDayContext(trip, plan, '2026-10-05', 'Asia/Shanghai')).toMatchObject({ scene: '基本室内', active: false, timezone: 'America/New_York' });
    expect(tripDayContext(trip, plan, '2026-10-06', 'Asia/Shanghai')).toMatchObject({ scene: '长时间室外', active: true });
  });
});
