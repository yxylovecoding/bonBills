import { describe, expect, it } from 'vitest';
import type { PossessionItem } from '../models/types';
import { getEligibleConsumableNames, isVisiblePossession, mergePossessionsFromBills, type AutoPossessionImportParams } from './autoImportPossessions';
import { calcConsumableStats } from '../calculations/possessions';
import { assignExpenseIds, type BillExpenseItem } from './importBill';

const bill = (date: string, tags: string, patch: Partial<BillExpenseItem> = {}): BillExpenseItem => ({
  date, tags, category: '购物', subcategory: '沐浴', amount: 30, account: '银行卡', note: '', ...patch,
});

function merge(bills: BillExpenseItem[], patch: Partial<AutoPossessionImportParams> = {}) {
  let id = 0;
  const expenseItems: AutoPossessionImportParams['expenseItems'] = {};
  for (const item of bills) (expenseItems[item.date.slice(0, 7)] ??= []).push(item);
  return mergePossessionsFromBills({
    expenseItems, items: [], ignoredBillItemIds: [], tagCategory: { 沐浴露: 'name' },
    tagMap: {}, overrides: { categories: {}, subcategories: {}, notes: {}, tags: {} },
    makeId: () => `generated-${++id}`, today: '2026-09-18', ...patch,
  });
}

describe('按最新账单归集消耗品', () => {
  it('最新账单满足双标签时，同名历史账单全部归入消耗品', () => {
    const result = merge([
      bill('2026-09-17', '沐浴露,消耗品,周期生活'),
      bill('2026-08-01', '沐浴露,done', { category: '生活' }),
      bill('2026-07-01', '沐浴露,消耗品,done'),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: '沐浴露', kind: 'consumable' });
    expect(result.items[0].txns.map(txn => txn.date)).toEqual(['2026-07-01', '2026-08-01', '2026-09-17']);
  });

  it.each(['沐浴露,消耗品', '沐浴露,周期生活', '沐浴露'])('最新账单缺少双标签时不新建消耗品：%s', tags => {
    const result = merge([
      bill('2026-09-17', tags),
      bill('2026-08-01', '沐浴露,消耗品,周期生活,done'),
    ]);
    expect(result.items.filter(item => item.kind === 'consumable')).toEqual([]);
  });

  it('水果即使有消耗品和周期生活标签也不导入', () => {
    const result = merge([bill('2026-09-17', '苹果,消耗品,周期生活', { category: '饮食', subcategory: '水果' })]);
    expect(result.items).toEqual([]);
  });

  it('有 done 的批次已用完，移除 done 后恢复在用并清除用完日', () => {
    const bills = [bill('2026-09-01', '沐浴露,消耗品,周期生活,done')];
    const first = merge(bills);
    expect(first.items[0].txns[0]).toMatchObject({ done: true, doneAt: '2026-09-01' });
    const next = merge([{ ...bills[0], tags: '沐浴露,消耗品,周期生活' }], { items: first.items });
    expect(next.items[0].txns[0].done).not.toBe(true);
    expect(next.items[0].txns[0].doneAt).toBeUndefined();
    expect(next.changed).toBe(true);
  });

  it('重新归集已有长期物品中的同名历史账单，且不会重复导入', () => {
    const old = bill('2026-08-01', '沐浴露');
    const existing: PossessionItem = {
      id: 'existing', name: '沐浴露', kind: 'durable', status: 'active', createdAt: old.date,
      txns: [{ id: 'old-txn', date: old.date, amount: old.amount, kind: 'purchase', billItemId: assignExpenseIds([old])[0].id }],
    };
    const bills = [old, bill('2026-09-17', '沐浴露,消耗品,周期生活')];
    const first = merge(bills, { items: [existing] });
    expect(first.items).toHaveLength(1);
    expect(first.items[0].kind).toBe('consumable');
    expect(first.items[0].txns.map(txn => txn.id)).toContain('old-txn');
    const second = merge(bills, { items: first.items });
    expect(second.changed).toBe(false);
    expect(second.items).toEqual(first.items);
  });

  it('忽略的账单不重新导入，长期物品仍正常导入', () => {
    const ignored = bill('2026-09-17', '沐浴露,消耗品,周期生活');
    const result = merge([ignored, bill('2026-09-18', '键盘', { subcategory: '电子' })], {
      ignoredBillItemIds: [assignExpenseIds([ignored])[0].id],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: '键盘', kind: 'durable' });
  });

  it('最新账单按日期判断，品牌标签不拆分同名物品', () => {
    const result = merge([
      bill('2026-09-17', '品牌甲,沐浴露,消耗品,周期生活'),
      bill('2026-09-01', '品牌乙,沐浴露,消耗品,done'),
    ], { tagCategory: { 沐浴露: 'name', 品牌甲: 'brand', 品牌乙: 'brand' } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('沐浴露');
    expect(result.items[0].txns).toHaveLength(2);
    expect(calcConsumableStats(result.items[0], '2026-09-18')).toMatchObject({ activeQty: 1, consumedQty: 1 });
  });

  it('已有消耗品不满足最新账单条件时隐藏，条件恢复后保留原记录', () => {
    const bills = [bill('2026-09-01', '沐浴露,消耗品,周期生活')];
    const first = merge(bills);
    const saved = first.items[0];
    saved.txns[0].quantity = 3;
    const nonPeriodic = [{ ...bills[0], tags: '沐浴露,消耗品' }];
    const hidden = merge(nonPeriodic, { items: first.items });
    expect(hidden.items).toEqual(first.items);
    const hiddenNames = getEligibleConsumableNames({ '2026-09': nonPeriodic }, { 沐浴露: 'name' });
    expect(isVisiblePossession(hidden.items[0], hiddenNames, '沐浴', [])).toBe(false);
    const restored = merge(bills, { items: hidden.items });
    expect(restored.items[0].id).toBe(saved.id);
    expect(restored.items[0].txns[0].quantity).toBe(3);
    const restoredNames = getEligibleConsumableNames({ '2026-09': bills }, { 沐浴露: 'name' });
    expect(isVisiblePossession(restored.items[0], restoredNames, '沐浴', [])).toBe(true);
  });

  it.each([
    { category: '水果', subcategory: '' },
    { subcategory: '水果' },
    { tags: '苹果,水果,消耗品,周期生活' },
  ])('水果主分类、子分类或标签均不进入消耗品名单：%j', patch => {
    const fruit = bill('2026-09-17', '苹果,消耗品,周期生活', patch);
    expect(getEligibleConsumableNames({ '2026-09': [fruit] }, { 苹果: 'name' }).size).toBe(0);
  });

  it('已保存或手动映射为水果的消耗品也不显示', () => {
    const item = merge([bill('2026-09-17', '沐浴露,消耗品,周期生活')]).items[0];
    const names = new Set(['沐浴露']);
    expect(isVisiblePossession({ ...item, category: '水果' }, names, '食品', [])).toBe(false);
    expect(isVisiblePossession(item, names, '水果', [])).toBe(false);
    expect(isVisiblePossession(item, names, '沐浴', ['水果'])).toBe(false);
    expect(isVisiblePossession(item, new Set(), '沐浴', [])).toBe(false);
    expect(isVisiblePossession({ ...item, kind: 'durable' }, new Set(), '沐浴', [])).toBe(true);
  });
});
