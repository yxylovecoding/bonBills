import { describe, expect, it } from 'vitest';
import type { WishItem } from '../models/types';
import type { BillExpenseItem, BillExpenseMonth } from './importBill';
import {
  resolveWishRepayments,
  calculateWishDebtSummary,
  calculateWishFunding,
  calculateWishPlan,
  resolveWishTravelBudget,
  wishTravelLifeAmount,
  sortWishesForDisplay,
  reconcileWishTripLinks,
  resolveWishBillSpending,
} from './wishes';
import { detectAllTrips, flattenExpenseItems, sumBillsByTag } from './trips';

const wish = (patch: Partial<WishItem> = {}): WishItem => ({
  id: 'trip', name: '旅行', targetAmount: 10000, savedAmount: 3000,
  repaidAmount: 2000, deadline: '2026-12-01', isActive: true,
  spentItems: [{ id: 'ticket', name: '机票', amount: 4000 }],
  ...patch,
});

describe('心愿按账单标签统计实际支出', () => {
  const tripTags = { '2026-09-30': '26.9.30 旅行', '2026-10-02': '26.10.2 郊游' };
  const trips = detectAllTrips({
    '2026-09-30': 'travel', '2026-10-01': 'travel',
    '2026-10-02': 'travel', '2026-10-03': 'travel',
  }, { '2026-10-02': true });
  const bill = (date: string, amount: number, tags = tripTags['2026-09-30']): BillExpenseItem => ({
    date, amount, tags, category: '旅行', subcategory: '', note: '', account: '银行卡',
  });
  const expenses: Record<string, BillExpenseMonth> = {
    '2026-08': [bill('2026-08-20', 2000)],
    '2026-09': [bill('2026-09-30', 800, `消费, ${tripTags['2026-09-30']}, 红`)],
    '2026-10': [bill('2026-10-01', -300), bill('2026-10-02', 500, tripTags['2026-10-02']), bill('2026-10-01', 90, '26.9.30 旅行其他')],
  };
  const linked = wish({ linkedTripStartDate: '2026-09-30', deadline: '2026-09-29', savedAmount: 500 });
  const resolve = (today = '2026-10-02', items = expenses, value = linked) => (
    resolveWishBillSpending([value], trips, tripTags, items, today)[0]
  );

  it('已花与本月出游一致，跨月、行前账单和退款都计入，手填明细不重复累加', () => {
    const original = structuredClone(linked);
    const resolved = resolve();
    const summary = sumBillsByTag(flattenExpenseItems(expenses), tripTags['2026-09-30']);
    expect(summary.totalAmount).toBe(2500);
    expect(resolved.billSpending).toMatchObject({ amount: summary.totalAmount, count: summary.count, tags: [tripTags['2026-09-30']] });
    expect(calculateWishFunding(resolved).spentAmount).toBe(2500);
    expect(linked).toEqual(original);
    expect(resolved.spentItems).toEqual([{ id: 'bill_旅行', name: '旅行', amount: 2500 }]);
    expect(resolved.billSpending?.estimatedTargetAmount).toBe(10000);
  });

  it.each(['2026-09-29', '2026-09-30', '2026-10-01'])('%s 尚未结束，只联动已花，仍保留目标', (today) => {
    const resolved = resolve(today);
    expect(resolved.targetAmount).toBe(10000);
    expect(resolved.billSpending?.ended).toBe(false);
    expect(calculateWishFunding(resolved).spentAmount).toBe(2500);
    expect(wishTravelLifeAmount(resolved, 100, { '2026-09-30': trips[0].dates })).toBe(200);
  });

  it('结束次日实际替代目标，同步重算已还、剩余和规划，不再扣预估生活费', () => {
    const [resolved] = resolveWishRepayments([resolve()], 1500);
    expect(resolved.targetAmount).toBe(2500);
    expect(wishTravelLifeAmount(resolved, 100, { '2026-09-30': trips[0].dates })).toBe(0);
    expect(calculateWishFunding(resolved, 200)).toMatchObject({
      spentAmount: 2500, fundingTarget: 2500, repaidAmount: 1000,
      debtAmount: 1500, remainingAmount: 1000, progress: 0.6,
    });
    const plan = calculateWishPlan([resolved], {
      today: new Date(2026, 9, 2), stateDailyAvg: { travel: 100, school: 0, home: 0, intern: 0 },
      tripDatesByStart: { '2026-09-30': trips[0].dates },
    });
    expect(plan.items[0]).toMatchObject({ targetAmount: 2500, remainingAmount: 1000, monthlyWishAmount: 1000 });
    expect(calculateWishDebtSummary([resolved], 1500)).toMatchObject({ assignedAmount: 1500, repaidAmount: 1000 });
  });

  it('后补账单、退款和账单移除都会重新计算，不固化首次实际金额', () => {
    const updated = { ...expenses, '2026-11': [bill('2026-11-01', 123.45), bill('2026-11-02', -23.45)] };
    expect(resolve('2026-11-03', updated).targetAmount).toBe(2600);
    expect(resolve('2026-11-03').targetAmount).toBe(2500);
    const empty = resolve('2026-11-03', {});
    expect(empty.targetAmount).toBe(10000);
    expect(empty.billSpending).toMatchObject({ amount: 0, count: 0, ended: false });
    expect(calculateWishFunding(empty).spentAmount).toBe(0);
  });

  it('实际超预算时使用实际金额，全额退款后的零元行程也能完成', () => {
    expect(resolve('2026-10-02', expenses, { ...linked, targetAmount: 1000 }).targetAmount).toBe(2500);
    const refunded = resolve('2026-10-02', { '2026-09': [bill('2026-09-30', 300), bill('2026-09-30', -300)] });
    expect(refunded.targetAmount).toBe(0);
    expect(refunded.billSpending).toMatchObject({ amount: 0, count: 2, ended: true });
    expect(calculateWishFunding(refunded)).toMatchObject({ spentAmount: 0, remainingAmount: 0, debtAmount: 0 });
    expect(calculateWishPlan([refunded], { today: new Date(2026, 9, 2) }).items[0].deadlineState).toBe('completed');
  });

  it('没有关联行程时也按心愿名称匹配标签，但不替代目标', () => {
    const unlinked = { ...linked, linkedTripStartDate: null };
    expect(resolve('2026-10-02', expenses, unlinked)).toMatchObject({ targetAmount: 10000, billSpending: { amount: 2500, ended: false } });
    expect(resolveWishBillSpending([linked], [], tripTags, expenses, '2026-10-02')[0]).toMatchObject({ targetAmount: 10000, billSpending: { amount: 2500, ended: false } });
    expect(resolveWishBillSpending([linked], trips, {}, expenses, '2026-10-02')[0]).toMatchObject({ targetAmount: 2500, billSpending: { amount: 2500, ended: true } });
  });

  it('无匹配账单时已花为零，忽略历史手填数据并保留目标', () => {
    const resolved = resolve('2026-10-02', { '2026-10': [bill('2026-10-01', 90, '无关标签')] });
    expect(resolved).toMatchObject({ targetAmount: 10000, spentItems: [], billSpending: { amount: 0, count: 0, ended: false } });
    expect(calculateWishFunding(resolved).spentAmount).toBe(0);
    expect(linked.spentItems?.[0].amount).toBe(4000);
  });

  it('普通心愿按完整标签名统计，排除相似名称和系统标签', () => {
    const items = { '2026-10': [bill('2026-10-01', 1200, '消费, 相机'), bill('2026-10-01', 80, '相机包')] };
    const wishes = [wish({ name: '相机' }), wish({ name: '消费' }), wish({ name: '   ' })];
    const result = resolveWishBillSpending(wishes, [], {}, items, '2026-10-02');
    expect(result.map((item) => calculateWishFunding(item).spentAmount)).toEqual([1200, 0, 0]);
    expect(result[0].billSpending).toMatchObject({ tags: ['相机'], count: 1, month: '2026-10' });
  });

  it('明确的完整标签优先于同名日期标签，出游所选标签优先于心愿名称', () => {
    const items = { '2026-10': [bill('2026-10-01', 1200, '相机'), bill('2026-10-01', 600, '26.10相机')] };
    expect(resolveWishBillSpending([wish({ name: '相机' })], [], {}, items, '2026-10-02')[0].billSpending?.amount).toBe(1200);
    expect(resolve('2026-10-02', expenses, { ...linked, name: '郊游' }).billSpending?.amount).toBe(2500);
  });

  it('按名称匹配多个日期标签时同一笔只计一次，独立的相同账单仍分别计入', () => {
    const entry = bill('2026-10-01', 100, '26.9.30 旅行,26.10旅行');
    const items = { '2026-10': [entry, { ...entry }, bill('2026-10-01', -20, '26.10旅行')] };
    const resolved = resolveWishBillSpending([wish()], [], {}, items, '2026-10-02')[0];
    expect(resolved.billSpending).toMatchObject({ amount: 180, count: 3, tags: ['26.9.30 旅行', '26.10旅行'] });
  });

  it('关联出游按名称匹配时仅接收行程月份的同名日期标签', () => {
    const items = { ...expenses, '2026-11': [bill('2026-11-01', 9000, '26.11旅行')] };
    expect(resolveWishBillSpending([linked], trips, {}, items, '2026-10-02')[0].billSpending?.amount).toBe(2500);
  });

  it('已花明细按账单分类覆盖预估，退款先抵扣同类费用，旧手填明细不再锁定预估', () => {
    const items = { '2026-09': [
      { ...bill('2026-09-24', 2000), subcategory: '机票' },
      { ...bill('2026-09-24', -300), subcategory: '机票' },
      { ...bill('2026-09-24', 800), subcategory: '住宿' },
    ] };
    const budget = resolveWishTravelBudget(resolve('2026-09-25', items), 7, 100);
    expect(budget).toMatchObject({ ticketActual: 1700, lodgingActual: 800 });
    expect(resolveWishTravelBudget(resolve('2026-09-25', {}), 7, 100).ticketActual).toBeUndefined();
  });

  it('切分的相邻行程各自统计、各自按结束日期结算', () => {
    const nextWish = { ...linked, id: 'next', linkedTripStartDate: '2026-10-02' };
    const [first, second] = resolveWishBillSpending([linked, nextWish], trips, tripTags, expenses, '2026-10-02');
    expect(first).toMatchObject({ targetAmount: 2500, billSpending: { amount: 2500, ended: true } });
    expect(second).toMatchObject({ targetAmount: 10000, billSpending: { amount: 500, ended: false } });
    expect(resolveWishBillSpending([nextWish], trips, tripTags, expenses, '2026-10-04')[0].targetAmount).toBe(500);
  });

  it('行程改期后使用修复后的出游关联和标签', () => {
    const [relinked] = reconcileWishTripLinks([{ ...linked, linkedTripStartDate: '2026-09-29' }], trips, tripTags);
    expect(resolve('2026-10-02', expenses, relinked)).toMatchObject({
      linkedTripStartDate: '2026-09-30', targetAmount: 2500, billSpending: { amount: 2500, ended: true },
    });
  });
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

describe('心愿关联出游日期更新', () => {
  const trips = detectAllTrips(Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [`2026-09-${24 + index}`, 'travel' as const]),
  ));
  const pingyao = wish({ id: 'pingyao', name: '平遥影展', linkedTripStartDate: '2026-09-23', deadline: '2026-09-22' });
  const tripTags = { '2026-09-24': '26.9平遥影展' };

  it.each(['2026-09-24', '2026-09-25', '2026-09-30'])('%s 出发日改动后按同名行程恢复关联，进行中的心愿仍置顶', (today) => {
    const original = structuredClone(pingyao);
    const [updated] = reconcileWishTripLinks([pingyao], trips, tripTags);
    expect(updated).toEqual({ ...pingyao, linkedTripStartDate: '2026-09-24', deadline: '2026-09-23' });
    expect(pingyao).toEqual(original);
    expect(sortWishesForDisplay([wish({ id: 'future' }), updated], trips, today).map((item) => item.id))
      .toEqual(['pingyao', 'future']);
    expect(sortWishesForDisplay([updated, wish({ id: 'future' })], trips, '2026-10-01').map((item) => item.id))
      .toEqual(['future', 'pingyao']);
    expect(reconcileWishTripLinks([updated], trips, tripTags)[0]).toBe(updated);
  });

  it('提前出发或合并行程后，旧起点落在新行程内也能恢复关联', () => {
    const [updated] = reconcileWishTripLinks([{ ...pingyao, linkedTripStartDate: '2026-09-25' }], trips);
    expect(updated.linkedTripStartDate).toBe('2026-09-24');
    expect(wishTravelLifeAmount(updated, 100, { '2026-09-24': trips[0].dates })).toBe(700);
  });

  it('没有账单标签时使用 Outlook 行程名称，也支持旧关联标签与心愿名称不同', () => {
    expect(reconcileWishTripLinks([pingyao], trips, {}, { '2026-09-24': '平遥影展' })[0].linkedTripStartDate)
      .toBe('2026-09-24');
    expect(reconcileWishTripLinks([{ ...pingyao, name: '看电影' }], trips,
      { ...tripTags, '2026-09-23': '26.9.23 平遥影展' })[0].linkedTripStartDate).toBe('2026-09-24');
  });

  it('已有明确关联保留切分边界，不合并同名行程', () => {
    const splitTrips = detectAllTrips(Object.fromEntries(trips[0].dates.map((date) => [date, 'travel' as const])), { '2026-09-27': true });
    const linked = { ...pingyao, linkedTripStartDate: '2026-09-24' };
    expect(reconcileWishTripLinks([linked], splitTrips, tripTags)[0]).toBe(linked);
    expect(sortWishesForDisplay([linked, wish({ id: 'future' })], splitTrips, '2026-09-27')[0].id).toBe('future');
  });

  it('未关联、行程已删除或同名候选不唯一时不自动改动心愿', () => {
    const unlinked = { ...pingyao, linkedTripStartDate: null, plannedTravelDays: 7 };
    expect(reconcileWishTripLinks([unlinked], trips, tripTags)[0]).toBe(unlinked);
    expect(reconcileWishTripLinks([pingyao], [], tripTags)[0]).toBe(pingyao);
    const duplicateTrips = [...trips, { startDate: '2026-10-24', endDate: '2026-10-24', dates: ['2026-10-24'] }];
    expect(reconcileWishTripLinks([pingyao], duplicateTrips, { ...tripTags, '2026-10-24': '26.10平遥影展' })[0]).toBe(pingyao);
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
