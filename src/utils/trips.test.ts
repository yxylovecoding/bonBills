import { describe, expect, it } from 'vitest';
import type { BillExpenseItem } from './importBill';
import { extractCandidateTags, getActiveTripTagsExcept, sumBillsByTag } from './trips';

const liuXianhuaBill: BillExpenseItem = {
  date: '2026-09-03',
  category: '生活',
  subcategory: '住宿',
  amount: 450.92,
  account: '信用卡',
  tags: '住宿,26.9刘宪华',
  note: '汉庭星空',
};

describe('出游候选标签', () => {
  it('账单不在行程日期内时仍按月份提供候选', () => {
    const candidates = extractCandidateTags(
      [liuXianhuaBill],
      new Set(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']),
    );

    expect(candidates).toEqual([{ tag: '26.9刘宪华', hitInRange: 0, totalHit: 1 }]);
  });

  it('孤立的历史关联不会隐藏候选，真实其他行程仍会去重', () => {
    const tripTags = {
      '2026-08-20': '26.9刘宪华',
      '2026-09-13': '26.9孙燕姿',
    };
    const activeTripStarts = new Set(['2026-09-13', '2026-09-20']);
    const excluded = getActiveTripTagsExcept(tripTags, activeTripStarts, '2026-09-20');

    expect([...excluded]).toEqual(['26.9孙燕姿']);
    expect(extractCandidateTags(
      [liuXianhuaBill],
      new Set(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']),
      excluded,
    )).toEqual([{ tag: '26.9刘宪华', hitInRange: 0, totalHit: 1 }]);
  });
});

describe('主行程包含子行程标签', () => {
  const parent = '26.10山西大同&临汾';
  const datong = '26.10山西大同';
  const linfen = '26.10山西临汾';
  const dates = new Set(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  const bill = (tags: string, amount = 100, date = '2026-10-27'): BillExpenseItem => ({
    ...liuXianhuaBill, tags, amount, date,
  });
  const items = [
    bill(`消费,${parent}`, 500, '2026-09-20'),
    bill(datong, 100),
    bill(linfen, 200, '2026-10-30'),
    bill(`${parent},${datong},${linfen}`, 50, '2026-10-29'),
    bill(linfen, -20, '2026-11-02'),
  ];

  it('27—31 日只显示全程标签，候选命中包含子行程且一笔只计一次', () => {
    expect(extractCandidateTags(items, dates)).toEqual([{ tag: parent, hitInRange: 3, totalHit: 5 }]);
    expect(extractCandidateTags([...items].reverse(), dates)).toEqual(extractCandidateTags(items, dates));
  });

  it('全程汇总包括仅标子行程、行前预订和后补退款，同笔多标签不重复', () => {
    const original = structuredClone(items);
    expect(sumBillsByTag(items, parent)).toEqual({ totalAmount: 830, count: 5, items });
    expect(items).toEqual(original);
  });

  it('主标签尚无账单时，选择主行程仍能包含子行程', () => {
    expect(sumBillsByTag([bill(datong), bill(linfen)], parent)).toMatchObject({ totalAmount: 200, count: 2 });
  });

  it('没有全程标签时保留独立子行程，单选子行程不会反向包含全程或兄弟', () => {
    expect(extractCandidateTags([bill(datong), bill(linfen)], dates).map(({ tag }) => tag).sort()).toEqual([datong, linfen].sort());
    expect(sumBillsByTag(items, datong)).toMatchObject({ totalAmount: 150, count: 2 });
  });

  it('主行程已被其他行程占用时，子行程不会重新作为独立候选出现', () => {
    expect(extractCandidateTags(items, dates, new Set([parent]))).toEqual([]);
  });

  it('其他年月、独立日期和相似目的地不并入本次行程', () => {
    const unrelated = ['26.9山西大同', '25.10山西临汾', '26.10山西大同古城', '26.10临汾演唱会', '26.10太原'];
    expect(sumBillsByTag(unrelated.map((tag) => bill(tag)), parent)).toMatchObject({ totalAmount: 0, count: 0 });
    expect(sumBillsByTag([bill('26.10.28大同')], '26.10.27大同&临汾')).toMatchObject({ count: 0 });
    expect(extractCandidateTags([bill(parent), ...unrelated.slice(2).map((tag) => bill(tag))], dates)).toHaveLength(4);
  });

  it('月份前导零、全角连接符和嵌套子路线仍只显示最完整行程', () => {
    const full = '26.10 山西大同＆临汾＆太原';
    const nested = [bill(full), bill(parent), bill(datong), bill(linfen), bill('26.10山西太原')];
    expect(extractCandidateTags(nested, dates)).toEqual([{ tag: full, hitInRange: 5, totalHit: 5 }]);
    expect(sumBillsByTag([bill('26.09 山西临汾')], '26.9 山西大同 & 临汾')).toMatchObject({ count: 1 });
  });
});
