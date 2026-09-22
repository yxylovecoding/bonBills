import { describe, expect, it } from 'vitest';
import type { WishItem } from '../models/types';
import {
  applyWishDebtRepayment,
  calculateWishDebtSummary,
  calculateWishFunding,
  calculateWishPlan,
  resolveWishTravelBudget,
  wishTravelLifeAmount,
} from './wishes';

const wish = (patch: Partial<WishItem> = {}): WishItem => ({
  id: 'trip', name: '旅行', targetAmount: 10000, savedAmount: 3000,
  repaidAmount: 2000, deadline: '2026-12-01', isActive: true,
  spentItems: [{ id: 'ticket', name: '机票', amount: 4000 }],
  ...patch,
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
  it('外部总欠款减去所有心愿欠款，包含暂停心愿', () => {
    const paused = wish({ id: 'paused', isActive: false, repaidAmount: 3500 });
    expect(calculateWishDebtSummary([wish(), paused], 7000)).toEqual({
      totalAmount: 7000, assignedAmount: 2500, unassignedAmount: 4500, discrepancyAmount: 0,
    });
  });

  it('明确的零总额与未填写区分，并报告低于心愿合计的差额', () => {
    expect(calculateWishDebtSummary([wish()])).toMatchObject({ totalAmount: 2000, unassignedAmount: 0 });
    expect(calculateWishDebtSummary([wish()], 0)).toMatchObject({ totalAmount: 0, unassignedAmount: 0, discrepancyAmount: 2000 });
    expect(calculateWishDebtSummary([], 7000).unassignedAmount).toBe(7000);
  });
});

describe('根据总欠款自动登记还款', () => {
  it('总欠款减少两千时推算已还两千，已攒三千保持不变', () => {
    const original = wish({ repaidAmount: 0 });
    const [updated] = applyWishDebtRepayment([original], 7000, 5000);
    expect(updated).toMatchObject({ savedAmount: 3000, repaidAmount: 2000 });
    expect(calculateWishFunding(updated)).toMatchObject({ debtAmount: 2000, remainingAmount: 5000 });
    expect(original.repaidAmount).toBe(0);
    expect(calculateWishDebtSummary([updated], 5000).unassignedAmount).toBe(3000);
  });

  it('只增加已攒或提高总欠款不会新增还款', () => {
    const original = wish({ savedAmount: 8000, repaidAmount: 0 });
    expect(applyWishDebtRepayment([original], 7000, 7000)[0].repaidAmount).toBe(0);
    expect(applyWishDebtRepayment([original], 7000, 8000)[0].repaidAmount).toBe(0);
  });

  it('优先偿还截止日近的心愿，欠款包括暂停心愿且保持列表顺序', () => {
    const wishes = [
      wish({ id: 'later', deadline: '2027-01-01', repaidAmount: 0 }),
      wish({ id: 'earlier', deadline: '2026-11-01', repaidAmount: 0, isActive: false }),
    ];
    const updated = applyWishDebtRepayment(wishes, 10000, 5000);
    expect(updated.map((item) => [item.id, item.repaidAmount])).toEqual([['later', 1000], ['earlier', 4000]]);
    expect(calculateWishDebtSummary(updated, 5000)).toMatchObject({ assignedAmount: 3000, unassignedAmount: 2000 });
  });

  it('心愿还清后的减少额继续抵扣未归属部分，已还不超过已花', () => {
    const original = wish({ spentItems: [{ id: 'fee', name: '代拍费', amount: 200 }], repaidAmount: 0 });
    const updated = applyWishDebtRepayment([original], 5120.51, 4000);
    expect(updated[0].repaidAmount).toBe(200);
    expect(calculateWishDebtSummary(updated, 4000)).toMatchObject({ assignedAmount: 0, unassignedAmount: 4000 });
  });

  it('小数还款和连续更新按本次总欠款差额累计，不重复记账', () => {
    const original = wish({ spentItems: [{ id: 'fee', name: '代拍费', amount: 200 }], repaidAmount: 0 });
    const first = applyWishDebtRepayment([original], 5120.51, 5000);
    expect(first[0].repaidAmount).toBe(120.51);
    expect(calculateWishFunding(first[0]).debtAmount).toBe(79.49);
    const second = applyWishDebtRepayment(first, 5000, 4950);
    expect(second[0].repaidAmount).toBe(170.51);
    expect(applyWishDebtRepayment(second, 4950, 4950)[0].repaidAmount).toBe(170.51);
  });

  it('首次填写总欠款从已有心愿欠款推算，清空总额不会伪造还款', () => {
    const original = wish({ repaidAmount: 0 });
    expect(applyWishDebtRepayment([original], undefined, 2000)[0].repaidAmount).toBe(2000);
    expect(applyWishDebtRepayment([original], 4000, undefined)[0].repaidAmount).toBe(0);
    expect(applyWishDebtRepayment([], 4000, 2000)).toEqual([]);
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
