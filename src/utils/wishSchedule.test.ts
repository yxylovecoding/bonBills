import { describe, expect, it } from 'vitest';
import type { WishItem, WishInternSavingRecord } from '../models/types';
import { defaultWishDeadline, visibleWishMilestones } from './wishDeadlineMilestones';
import { savedWishCalendarLabels } from './wishCalendarLabels';
import { calculateWishPlan, sortWishesForDisplay, reconcileTripWishes, resolveWishBillSpending, updateTripWishDismissals } from './wishes';
import { detectAllTrips } from './trips';
const wish: WishItem = { id: 'w', name: '旅行', targetAmount: 3000, savedAmount: 500, deadline: '2026-11-01', linkedTripStartDate: '2026-12-01', isActive: true };

describe('心愿时间与绑定编辑', () => {
  const trips = detectAllTrips({ '2026-12-01': 'travel' });
  it('自选日期和清空日期经重复行程同步仍保留，不改变金额', () => {
    for (const deadline of ['2026-10-30', null]) {
      const edited = { ...wish, deadlineMode: 'manual' as const, deadline };
      const result = reconcileTripWishes([edited], trips);
      expect(result[0]).toEqual(edited);
      expect(reconcileTripWishes(result, trips)[0]).toEqual(edited);
    }
    expect(reconcileTripWishes([wish], trips)[0].deadline).toBe('2026-11-30');
  });
  it('解绑后不会自动重建原行程心愿', () => {
    const edited = { ...wish, linkedTripStartDate: null, deadlineMode: 'manual' as const };
    const dismissed = updateTripWishDismissals([wish], [edited]);
    expect(reconcileTripWishes([edited], trips, { '2026-12-01': '旅行' }, {}, dismissed)).toEqual([edited]);
  });
  it('指定标签优先于原出行标签，取消绑定不改写原账单', () => {
    const bills = { '2026-10': [{ date: '2026-10-20', amount: 100, tags: '新标签,消费', category: '旅行', subcategory: '', account: '', note: '' }] };
    const snapshot = JSON.stringify(bills);
    const resolve = (billTag?: string | null) => resolveWishBillSpending([{ ...wish, billTag }], trips, { '2026-12-01': '旧标签' }, bills, '2026-10-23')[0];
    expect(resolve('新标签').billSpending?.amount).toBe(100);
    expect(resolve(null).billSpending?.amount).toBe(0);
    expect(resolve().billSpending?.amount).toBe(0);
    expect(JSON.stringify(bills)).toBe(snapshot);
  });
});

describe('时间节点默认及日期边界', () => {
  const nodes = [{ id: 'later', name: '毕业', date: '2028-06-20' }, { id: 'expired', name: '昨天', date: '2026-10-22' }, { id: 'today', name: '今天', date: '2026-10-23' }, { id: 'early', name: '过年', date: '2027-02-01' }];
  it('升序展示且过期仅隐藏，今天仍可选', () => {
    expect(visibleWishMilestones(nodes, '2026-10-23').map((n) => n.id)).toEqual(['today', 'early', 'later']);
    expect(nodes).toHaveLength(4);
    expect(defaultWishDeadline(nodes, 'today', '2026-10-23')).toBe('2026-10-23');
    expect(defaultWishDeadline(nodes, 'today', '2026-10-24')).toBeNull();
  });
  it('单一默认 ID 切换、缺失、删除、无效日期均安全回退', () => {
    expect(defaultWishDeadline(nodes, 'early', '2026-10-23')).toBe('2027-02-01');
    expect(defaultWishDeadline(nodes, 'later', '2026-10-23')).toBe('2028-06-20');
    for (const id of [null, undefined, 'deleted', 'expired']) expect(defaultWishDeadline(nodes, id, '2026-10-23')).toBeNull();
    expect(defaultWishDeadline([{ id: 'bad', name: '错误', date: '2027-02-30' }], 'bad', '2026-10-23')).toBeNull();
  });
});

it('攒钱日历不沿用已删除心愿、未确认或未来的旧主题，历史原记录不变', () => {
  const record = (date: string, wishId: string, confirmed = true): WishInternSavingRecord => ({ date, wishId, confirmed, amount: 100, theme: '旧名称、已删除心愿' });
  const records = [record('2026-10-21', 'current'), record('2026-10-22', 'deleted'), record('2026-10-20', 'current', false), record('2026-10-23', 'current'), record('2026-10-26', 'current')];
  const snapshot = structuredClone(records);
  expect([...savedWishCalendarLabels(records, { current: '当前名称' }, '2026-10-23')]).toEqual([['2026-10-21', '当前名称']]);
  expect(records).toEqual(snapshot);
});

it('自选日期改变攒钱预测与展示顺序，已有金额不被重写', () => {
  const first = { ...wish, id: 'first', deadline: '2026-11-30' };
  const second = { ...wish, id: 'second', deadline: '2026-12-30' };
  const moved = { ...second, deadline: '2026-10-30', deadlineMode: 'manual' as const };
  expect(sortWishesForDisplay([first, moved], [], '2026-10-23').map((item) => item.id)).toEqual(['second', 'first']);
  const before = calculateWishPlan([second], { today: new Date(2026, 9, 23) });
  const after = calculateWishPlan([moved], { today: new Date(2026, 9, 23) });
  expect(after.items[0].monthlyWishAmount).toBeGreaterThan(before.items[0].monthlyWishAmount);
  expect(after.items[0].savedAmount).toBe(second.savedAmount);
});
