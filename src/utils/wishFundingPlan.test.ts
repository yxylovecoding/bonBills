import { describe, expect, it } from 'vitest';
import type { WishItem } from '../models/types';
import { calculateWishInternPlan, type WishInternPlanOptions } from './wishInternPlan';
import { calculateWishMilestonePlan } from './wishMilestonePlan';
import { calculateWishPlan, resolveWishRepayments } from './wishes';

const baseWish: WishItem = {
  id: 'trip', name: '旅行', isActive: true, deadline: '2026-12-01',
  targetAmount: 10000, savedAmount: 3000, repaidAmount: 2000,
  spentItems: [{ id: 'ticket', name: '机票', amount: 4000 }],
};
const options: WishInternPlanOptions = {
  today: new Date(2026, 8, 22), deadline: '2026-12-01', wishes: [baseWish],
  incomeItems: [], tagMap: {}, stateDailyAvg: { intern: 0, school: 0, home: 0, travel: 0 },
  repaymentsByMonth: {}, holidayDataByYear: {},
};

describe('欠款与实习规划', () => {
  it('首次录入欠款与明细后，月度、累计与阶段规划共用推算结果，忽略历史已还', () => {
    const wishes = resolveWishRepayments([{ ...baseWish, repaidAmount: 999 }], 2000);
    expect(calculateWishPlan(wishes, options).items[0].remainingAmount).toBe(5000);
    expect(calculateWishInternPlan({ ...options, wishes }).wishAmount).toBe(5000);
    expect(calculateWishMilestonePlan({ ...options, wishes, repaymentDues: [] })
      .segmentByWishId.trip.cumulativePlan.wishAmount).toBe(5000);
  });

  it('累计规划只需再攒五千，欠自己两千不另加一遍', () => {
    expect(calculateWishInternPlan(options)).toMatchObject({
      wishAmount: 5000, wishAmountIncludingLife: 5000, requiredIncome: 12500,
    });
    const plan = calculateWishMilestonePlan({ ...options, repaymentDues: [] });
    expect(plan.segmentByWishId.trip.cumulativePlan.wishAmount).toBe(5000);
  });

  it('已攒加已还足够时退出攒款规划，不自动消除实际欠款', () => {
    const wishes = [{ ...baseWish, savedAmount: 8000 }];
    expect(calculateWishInternPlan({ ...options, wishes }).wishAmount).toBe(0);
    expect(calculateWishMilestonePlan({ ...options, wishes, repaymentDues: [] }).segments).toHaveLength(0);
    expect(wishes[0].repaidAmount).toBe(2000);
  });

  it('生活费扣除不抵掉超出预算后的真实欠款', () => {
    const wishes = [{ ...baseWish, targetAmount: 4000, savedAmount: 0, repaidAmount: 0, plannedTravelDays: 4 }];
    const plan = calculateWishInternPlan({ ...options, wishes, stateDailyAvg: { ...options.stateDailyAvg, travel: 250 } });
    expect(plan.wishAmount).toBe(4000);
    expect(plan.excludedLifeExpense).toBe(0);
  });

  it('多个心愿按各自截止日累积资金需求，暂停心愿不进入规划', () => {
    const wishes = [baseWish, { ...baseWish, id: 'later', deadline: '2027-01-01', repaidAmount: 4000 }, { ...baseWish, id: 'paused', isActive: false }];
    const plan = calculateWishMilestonePlan({ ...options, wishes, repaymentDues: [] });
    expect(plan.segments).toHaveLength(2);
    expect(plan.segmentByWishId.trip.cumulativePlan.wishAmount).toBe(5000);
    expect(plan.segmentByWishId.later.cumulativePlan.wishAmount).toBe(8000);
    expect(plan.segmentByWishId.paused).toBeUndefined();
  });
});
