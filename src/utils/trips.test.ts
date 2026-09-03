import { describe, expect, it } from 'vitest';
import type { BillExpenseItem } from './importBill';
import { extractCandidateTags, getActiveTripTagsExcept } from './trips';

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
