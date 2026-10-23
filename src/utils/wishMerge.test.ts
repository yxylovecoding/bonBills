import { describe, expect, it } from 'vitest';
import type { WishItem } from '../models/types';
import { applyWishMerge, isWishExpiredForMerge, previewWishMerge, undoWishMerge } from './wishMerge';
import { wishAssociationStatus } from './wishAssociations';
import { normalizeOutlookWishEvents, buildOutlookSnapshot, applyOutlookSnapshotToState, DEFAULT_OUTLOOK_RULES } from './outlookCalendar';
import { resolveWishBillSpending, reconcileTripWishes, wishTravelLifeAmount } from './wishes';
import { detectAllTrips } from './trips';
const event = { key: '', uid: 'uid-1', calendar: 'play' as const, title: '日程', startDate: '2026-11-01', endDate: '2026-11-03' };
const events = normalizeOutlookWishEvents([event]);
const sources: WishItem[] = [
  { id: 'a', name: '甲', targetAmount: 1000, savedAmount: 100, isActive: true, deadline: '2026-10-30', linkedTripStartDate: '2026-11-01', billTag: '共同', outlookEventKeys: [events[0].key], spentItems: [{ id: 'old', name: '历史', amount: 10 }] },
  { id: 'b', name: '乙', targetAmount: 2000, savedAmount: 200, isActive: true, deadline: '2026-10-31', linkedTripStartDate: '2026-11-04', billTags: ['共同', '额外'], outlookEventKeys: [events[0].key] },
];
const choices = { primary: 'a', target: 'b', saved: 'a', deadline: 'b', details: 'a' };
const trips = detectAllTrips({ '2026-11-01': 'travel', '2026-11-02': 'travel', '2026-11-04': 'travel' });
describe('手动合并心愿', () => {
  it('普通心愿排除过期项，保留当天截止、未来和未设截止日的心愿', () => {
    const wish = { ...sources[0], linkedTripStartDate: null };
    expect(isWishExpiredForMerge({ ...wish, deadline: '2026-10-22' }, [], '2026-10-23')).toBe(true);
    for (const deadline of ['2026-10-23', '2026-10-24', null]) {
      expect(isWishExpiredForMerge({ ...wish, deadline }, [], '2026-10-23')).toBe(false);
    }
  });
  it('出行按最后结束日期判断，无账单也隐藏已结束行程，筹款截止不隐藏进行中或未来行程', () => {
    const wish = { ...sources[0], deadline: '2026-10-30' };
    expect(isWishExpiredForMerge(wish, trips, '2026-11-03')).toBe(true);
    for (const today of ['2026-10-31', '2026-11-01', '2026-11-02']) {
      expect(isWishExpiredForMerge(wish, trips, today)).toBe(false);
    }
    expect(isWishExpiredForMerge({ ...wish, linkedTripStartDates: ['2026-11-01', '2026-11-04'] }, trips, '2026-11-03')).toBe(false);
    expect(isWishExpiredForMerge(wish, [], '2026-11-03')).toBe(true);
  });
  it('缺项按真实引用判断，标题相同不冒充 Outlook 关联', () => {
    expect(wishAssociationStatus(sources[0], trips, events, {}).complete).toBe(true);
    expect(wishAssociationStatus({ ...sources[0], outlookEventKeys: [] }, trips, events, {}).outlook).toBe(false);
    expect(wishAssociationStatus({ ...sources[0], outlookEventKeys: ['标题日程'] }, trips, events, {}).complete).toBe(false);
    expect(wishAssociationStatus(sources[0], [], events, {}).trip).toBe(false);
    expect(wishAssociationStatus({ ...sources[0], billTag: null }, trips, events, {}).tags).toBe(false);
  });
  it('预览不修改数据，冲突必须选择，关联去重且金额不相加', () => {
    const before = structuredClone(sources);
    expect(() => previewWishMerge(sources, { ...choices, saved: '' }, {}, {})).toThrow('请选择');
    const result = previewWishMerge(sources, choices, {}, {});
    expect(result).toMatchObject({ id: 'a', targetAmount: 2000, savedAmount: 100, deadline: '2026-10-31', mergedWishIds: ['b'], billTags: ['共同', '额外'], linkedTripStartDates: ['2026-11-01', '2026-11-04'], outlookEventKeys: [events[0].key] });
    expect(sources).toEqual(before);
    const duplicatedHistory = [{ ...sources[0], spentItems: [{ id: 'x', name: '机票', amount: 100 }] }, { ...sources[1], spentItems: [{ id: 'y', name: '机票', amount: 100 }] }];
    expect(previewWishMerge(duplicatedHistory, choices, {}, {}).spentItems).toEqual(duplicatedHistory[0].spentItems);
    expect(wishTravelLifeAmount(result, 10, Object.fromEntries(trips.map((t) => [t.startDate, t.dates])))).toBe(30);
  });
  it('确认、序列化刷新及撤销保留原始字段和引用，并阻止过期确认/覆盖后续编辑', () => {
    const result = previewWishMerge(sources, choices, {}, {});
    const change = applyWishMerge(sources, sources, result, 'merge-1', '2026-10-23');
    const refreshed = JSON.parse(JSON.stringify(change));
    expect(refreshed.record.sources).toEqual(sources);
    expect(undoWishMerge(refreshed.wishes, refreshed.record)).toEqual(sources);
    expect(() => applyWishMerge([{ ...sources[0], savedAmount: 500 }, sources[1]], sources, result, 'm', 'date')).toThrow('已变更');
    expect(() => undoWishMerge([{ ...result, savedAmount: 600 }], refreshed.record)).toThrow('已有更改');
    expect(() => undoWishMerge([...refreshed.wishes, sources[1]], refreshed.record)).toThrow();
  });
  it('同一账单被多个合并标签匹配仍只计一次，合并后不重新生成第二个出行心愿', () => {
    const result = previewWishMerge(sources, choices, {}, {});
    const bills = { '2026-10': [{ date: '2026-10-22', category: '旅行', subcategory: '', account: '', note: '', amount: 50, tags: '消费,共同,额外' }] };
    const resolved = resolveWishBillSpending([result], trips, {}, bills, '2026-10-23')[0];
    expect(resolved.billSpending).toMatchObject({ amount: 50, count: 1 });
    expect(resolveWishBillSpending([result], trips.slice(0, 1), {}, bills, '2027-01-01')[0].billSpending?.ended).toBe(false);
    expect(reconcileTripWishes([result], trips, { '2026-11-01': '甲', '2026-11-04': '乙' })).toEqual([result]);
  });
});
describe('Outlook 稳定引用', () => {
  it('身份不依赖标题及改期日期，无 UID 的旧数据不生成引用', () => {
    const snapshot = buildOutlookSnapshot([{ ...event, allDay: true }, { ...event, uid: undefined, title: '旧数据', allDay: true }], '2026-10-01', '2026-12-01', DEFAULT_OUTLOOK_RULES);
    expect(snapshot.wishEvents).toHaveLength(1);
    const renamed = normalizeOutlookWishEvents([{ ...event, title: '改名', startDate: '2026-11-02' }]);
    expect(renamed[0].key).toBe(events[0].key);
    const updated = applyOutlookSnapshotToState({ outlookWishEvents: events }, { ...snapshot, wishEvents: [] }, 'manual', '2026-10-23');
    expect(updated.outlookWishEvents).toEqual([]);
    const outside = applyOutlookSnapshotToState({ outlookWishEvents: events }, { startDate: '2027-01-01', endDate: '2027-02-01', tags: {} }, 'manual', '2026-10-23');
    expect(outside.outlookWishEvents[0]).toMatchObject({ uid: event.uid, available: false });
    expect(wishAssociationStatus(sources[0], trips, outside.outlookWishEvents, {}).outlook).toBe(false);
  });
});
