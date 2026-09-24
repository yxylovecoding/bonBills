import { describe, expect, it } from 'vitest';
import type { WishItem } from '../models/types';
import {
  resolveWishRepayments,
  calculateWishDebtSummary,
  calculateWishFunding,
  calculateWishPlan,
  resolveWishTravelBudget,
  wishTravelLifeAmount,
  sortWishesForDisplay,
} from './wishes';
import { detectAllTrips } from './trips';

const wish = (patch: Partial<WishItem> = {}): WishItem => ({
  id: 'trip', name: '旅行', targetAmount: 10000, savedAmount: 3000,
  repaidAmount: 2000, deadline: '2026-12-01', isActive: true,
  spentItems: [{ id: 'ticket', name: '机票', amount: 4000 }],
  ...patch,
});

describe('心愿清单排序', () => {
  const trips = detectAllTrips(Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [`2026-09-${24 + index}`, 'travel' as const]),
  ));
  const pingyao = wish({ id: 'pingyao', name: '平遥影展', linkedTripStartDate: '2026-09-24', deadline: '2026-09-23' });

  it.each(['2026-09-24', '2026-09-25', '2026-09-30'])('%s 尚在行程内，攒钱截止日已过仍排在当天和未来心愿之前', (today) => {
    const wishes = [wish({ id: 'future' }), wish({ id: 'today', deadline: today }), pingyao];
    const original = structuredClone(wishes);
    expect(sortWishesForDisplay(wishes, trips, today).map((item) => item.id)).toEqual(['pingyao', 'today', 'future']);
    expect(wishes).toEqual(original);
    expect(sortWishesForDisplay(wishes, trips, today)[0]).toBe(pingyao);
  });

  it('结束次日不再置顶，未开始、已结束和无日期心愿沿用原排序', () => {
    const wishes = [pingyao, wish({ id: 'future', deadline: '2026-10-05' }), wish({ id: 'undated', deadline: null }),
      wish({ id: 'earlier', deadline: '2026-10-03' })];
    expect(sortWishesForDisplay(wishes, trips, '2026-10-01').map((item) => item.id)).toEqual(['earlier', 'future', 'pingyao', 'undated']);
    expect(sortWishesForDisplay([pingyao, wish({ id: 'nearer', deadline: '2026-09-22' })], trips, '2026-09-21').map((item) => item.id))
      .toEqual(['nearer', 'pingyao']);
  });

  it('已攒足不代表旅行结束，只有关联到实际进行中行程的心愿置顶', () => {
    const funded = { ...pingyao, savedAmount: 10000 };
    const missing = wish({ id: 'missing', linkedTripStartDate: '2026-09-20', deadline: '2026-09-19', plannedTravelDays: 20 });
    expect(sortWishesForDisplay([missing, wish({ id: 'future' }), funded], trips, '2026-09-25').map((item) => item.id))
      .toEqual(['pingyao', 'future', 'missing']);
  });

  it('行程切分后分别按各自结束日期判断，空清单正常返回', () => {
    const splitTrips = detectAllTrips(Object.fromEntries(trips[0].dates.map((date) => [date, 'travel' as const])), { '2026-09-27': true });
    const nextTrip = wish({ id: 'next-trip', linkedTripStartDate: '2026-09-27', deadline: '2026-09-26' });
    expect(sortWishesForDisplay([pingyao, nextTrip], splitTrips, '2026-09-27').map((item) => item.id)).toEqual(['next-trip', 'pingyao']);
    expect(sortWishesForDisplay([], trips, '2026-09-25')).toEqual([]);
  });
});

describe('心愿资金', () => {
  it('目标一万、已花四千、已攒三千、已还两千时欠两千且还需攒五千', () => {
    expect(calculateWishFunding(wish())).toMatchObject({
      spentAmount: 4000, savedAmount: 3000, repaidAmount: 2000,
      debtAmount: 2000, remainingAmount: 5000, progress: 0.5,
    });
  });

  it('增加已攒不会自动偿还欠款，资金攒足仍可有欠款', () => {
    expect(calculateWishFunding(wish({ savedAmount: 8000 }))).toMatchObject({
      debtAmount: 2000, remainingAmount: 0, progress: 1,
    });
  });

  it('还清后只需准备剩余开销，不重复计入还款', () => {
    expect(calculateWishFunding(wish({ repaidAmount: 4000 }))).toMatchObject({
      debtAmount: 0, remainingAmount: 3000,
    });
  });

  it('已花超出目标时仍覆盖真实支出', () => {
    expect(calculateWishFunding(wish({ targetAmount: 1000, savedAmount: 200, repaidAmount: 400 })))
      .toMatchObject({ fundingTarget: 4000, debtAmount: 3600, remainingAmount: 3400 });
  });

  it('旧心愿缺省已花和已还为零', () => {
    expect(calculateWishFunding(wish({ spentItems: undefined, repaidAmount: undefined })))
      .toMatchObject({ spentAmount: 0, repaidAmount: 0, debtAmount: 0, remainingAmount: 7000 });
  });

  it('旅行生活费只从预算扣除，不冲减已欠的本金', () => {
    expect(calculateWishFunding(wish(), 1000).remainingAmount).toBe(4000);
    expect(calculateWishFunding(wish({ targetAmount: 4000, savedAmount: 0, repaidAmount: 0 }), 1000))
      .toMatchObject({ debtAmount: 4000, remainingAmount: 4000 });
  });

  it('月度规划和关联旅行采用相同的剩余金额', () => {
    const trip = wish({ linkedTripStartDate: '2026-12-02', travelLifeCorrectionAmount: 100 });
    const trips = { '2026-12-02': ['2026-12-02', '2026-12-03', '2026-12-04'] };
    expect(wishTravelLifeAmount(trip, 200, trips)).toBe(500);
    const plan = calculateWishPlan([trip], {
      today: new Date(2026, 8, 22), stateDailyAvg: { home: 0, school: 0, intern: 0, travel: 200 }, tripDatesByStart: trips,
    });
    expect(plan.items[0].remainingAmount).toBe(4500);
    expect(plan.months.reduce((sum, month) => sum + month.wishAmount, 0)).toBe(4500);
  });
});

describe('总欠款拆分', () => {
  it('从当前总欠款拆出心愿内和未归属金额，包含暂停心愿且忽略旧已还', () => {
    const paused = wish({ id: 'paused', isActive: false, repaidAmount: 3500 });
    expect(calculateWishDebtSummary([wish(), paused], 9000)).toEqual({
      totalAmount: 9000, assignedAmount: 8000, unassignedAmount: 1000, repaidAmount: 0,
    });
    expect(calculateWishDebtSummary([wish(), paused], 7000)).toEqual({
      totalAmount: 7000, assignedAmount: 7000, unassignedAmount: 0, repaidAmount: 1000,
    });
  });

  it('未填总额时默认已花全部待还，明确填零时全部还清，无心愿时全部未归属', () => {
    expect(calculateWishDebtSummary([wish()])).toMatchObject({ totalAmount: 4000, assignedAmount: 4000, repaidAmount: 0 });
    expect(calculateWishDebtSummary([wish()], 0)).toMatchObject({ totalAmount: 0, assignedAmount: 0, unassignedAmount: 0, repaidAmount: 4000 });
    expect(calculateWishDebtSummary([], 7000).unassignedAmount).toBe(7000);
  });
});

describe('仅用当前总欠款与已花推算还款', () => {
  it('首次输入已花四千、当前欠两千，就推算已还两千，已攒保持不变', () => {
    const original = wish({ repaidAmount: 123 });
    const [updated] = resolveWishRepayments([original], 2000);
    expect(updated).toMatchObject({ savedAmount: 3000, repaidAmount: 2000 });
    expect(calculateWishFunding(updated)).toMatchObject({ debtAmount: 2000, remainingAmount: 5000 });
    expect(original.repaidAmount).toBe(123);
    expect(calculateWishDebtSummary([updated], 2000).unassignedAmount).toBe(0);
  });

  it('已攒即使高于已花也不算还款', () => {
    const original = wish({ savedAmount: 8000 });
    expect(resolveWishRepayments([original], 5000)[0].repaidAmount).toBe(0);
    expect(resolveWishRepayments([original], 3000)[0].repaidAmount).toBe(1000);
  });

  it('优先偿还截止日近的心愿，欠款包括暂停心愿且保持列表顺序', () => {
    const wishes = [
      wish({ id: 'later', deadline: '2027-01-01', repaidAmount: 0 }),
      wish({ id: 'earlier', deadline: '2026-11-01', repaidAmount: 0, isActive: false }),
    ];
    const updated = resolveWishRepayments(wishes, 3000);
    expect(updated.map((item) => [item.id, item.repaidAmount])).toEqual([['later', 1000], ['earlier', 4000]]);
    expect(calculateWishDebtSummary(updated, 3000)).toMatchObject({ assignedAmount: 3000, unassignedAmount: 0 });
  });

  it('只记录代拍费两百时，总欠款超过已花的部分始终未归属，不把余额下降当成该项还款', () => {
    const original = wish({ spentItems: [{ id: 'fee', name: '代拍费', amount: 200 }] });
    const first = resolveWishRepayments([original], 5120.51);
    const updated = resolveWishRepayments(first, 5000);
    expect(updated[0].repaidAmount).toBe(0);
    expect(calculateWishDebtSummary(updated, 5000)).toMatchObject({ assignedAmount: 200, unassignedAmount: 4800 });
  });

  it('先录欠款或先录明细结果相同，重复计算、调大欠款与恢复原值不会累计已还', () => {
    const original = wish({ repaidAmount: undefined });
    const debtFirst = resolveWishRepayments([wish({ spentItems: [] })], 2000);
    debtFirst[0].spentItems = original.spentItems;
    expect(resolveWishRepayments(debtFirst, 2000)).toEqual(resolveWishRepayments([original], 2000));
    const first = resolveWishRepayments([original], 2000);
    expect(resolveWishRepayments(first, 2000)).toEqual(first);
    const raised = resolveWishRepayments(first, 3500);
    expect(raised[0].repaidAmount).toBe(500);
    expect(resolveWishRepayments(raised, 2000)).toEqual(first);
  });

  it('小数按分分配，同截止日按编号稳定分配，无截止日排最后', () => {
    const wishes = [
      wish({ id: 'undated', deadline: null, spentItems: [{ id: '1', name: '酒店', amount: 100 }] }),
      wish({ id: 'b', spentItems: [{ id: '2', name: '机票', amount: 0.2 }] }),
      wish({ id: 'a', spentItems: [{ id: '3', name: '机票', amount: 0.1 }] }),
    ];
    const updated = resolveWishRepayments(wishes, 100.01);
    expect(updated.map((item) => item.repaidAmount)).toEqual([0, 0.19, 0.1]);
    expect(calculateWishDebtSummary(updated, 100.01)).toMatchObject({ assignedAmount: 100.01, repaidAmount: 0.29 });
  });

  it('更正或删除已花后立即重算，不保留之前分配的还款', () => {
    const [first] = resolveWishRepayments([wish()], 2000);
    const corrected = { ...first, spentItems: [{ id: 'fee', name: '代拍费', amount: 200 }] };
    expect(resolveWishRepayments([corrected], 2000)[0].repaidAmount).toBe(0);
    expect(calculateWishDebtSummary([corrected], 2000).unassignedAmount).toBe(1800);
    expect(resolveWishRepayments([{ ...first, spentItems: [] }], 2000)[0].repaidAmount).toBe(0);
  });

  it('清空总欠款不推断已还，明确填零则全部已花都还清，兼容无明细旧数据', () => {
    expect(resolveWishRepayments([wish()])[0].repaidAmount).toBe(0);
    expect(resolveWishRepayments([wish()], 0)[0].repaidAmount).toBe(4000);
    expect(resolveWishRepayments([wish({ spentItems: undefined })], 0)[0].repaidAmount).toBe(0);
    expect(resolveWishRepayments([], 2000)).toEqual([]);
  });
});

describe('已花锁定预估', () => {
  it('机票与高铁合计覆盖交通，酒店采用总价，同名额外消费覆盖原值', () => {
    const trip = wish({
      travelTicketAmount: 3000, travelLodgingDailyAmount: 500,
      travelExtraExpenseItems: [{ id: 'surf', name: '冲浪', amount: 700 }, { id: 'discount', name: '优惠', amount: -100 }],
      spentItems: [
        { id: '1', name: '机票', amount: 1200 }, { id: '2', name: '高铁', amount: 500 },
        { id: '3', name: '机票 ／ 高铁', amount: 300 }, { id: '4', name: '酒店', amount: 1400 },
        { id: '5', name: ' 冲浪 ', amount: 600 }, { id: '6', name: '纪念品', amount: 50 },
      ],
    });
    const budget = resolveWishTravelBudget(trip, 4, 100);
    expect(budget).toMatchObject({ ticketActual: 2000, lodgingActual: 1400 });
    expect(budget.original).toMatchObject({ ticketAmount: 3000, lodgingAmount: 1500 });
    expect(budget.estimate).toMatchObject({ ticketAmount: 2000, lodgingAmount: 1400, extraExpenseAmount: 500, targetAmount: 4300 });
    expect(budget.extras[0]).toMatchObject({ amount: 700, actualAmount: 600 });
    expect(budget.extras[1].actualAmount).toBeUndefined();
  });

  it('删除或改名最后一笔匹配明细后恢复原预估，原数据不被覆盖', () => {
    const trip = wish({ travelTicketAmount: 3000, travelLodgingDailyAmount: 500 });
    const original = structuredClone(trip);
    expect(resolveWishTravelBudget(trip, 4, 100).ticketActual).toBe(4000);
    expect(trip).toEqual(original);
    const deleted = resolveWishTravelBudget({ ...trip, spentItems: [] }, 4, 100);
    expect(deleted.ticketActual).toBeUndefined();
    expect(deleted.estimate.ticketAmount).toBe(3000);
    expect(resolveWishTravelBudget({ ...trip, spentItems: [{ id: 'ticket', name: '其他', amount: 4000 }] }, 4, 100).ticketActual).toBeUndefined();
  });

  it('同名多笔已花合计，重名的额外预估合并锁定且只计算一次', () => {
    const budget = resolveWishTravelBudget(wish({
      travelExtraExpenseItems: [{ id: 'a', name: '冲浪', amount: 300 }, { id: 'b', name: ' 冲浪 ', amount: 400 }],
      spentItems: [{ id: '1', name: '冲浪', amount: 200 }, { id: '2', name: '冲浪', amount: 350 }],
    }), 1, 0);
    expect(budget.extras).toHaveLength(1);
    expect(budget.extras[0]).toMatchObject({ amount: 700, actualAmount: 550, sourceIds: ['a', 'b'] });
    expect(budget.estimate.targetAmount).toBe(550);
  });

  it('零元已花也能锁定，并兼容旧酒店总价与额外消费', () => {
    const budget = resolveWishTravelBudget(wish({
      travelTicketAmount: 800, travelLodgingAmount: 1200, travelExtraExpenseAmount: 100,
      spentItems: [{ id: 'free', name: '机票/高铁', amount: 0 }],
    }), 4, 100);
    expect(budget.ticketActual).toBe(0);
    expect(budget.estimate).toMatchObject({ ticketAmount: 0, lodgingAmount: 1200, extraExpenseAmount: 100, targetAmount: 1700 });
  });
});
