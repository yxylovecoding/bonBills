import { describe, expect, it } from 'vitest';
import type { PossessionCategoryBucket, PossessionItem } from '../models/types';
import { usePossessionStore } from '../stores/possessionStore';
import { getItemCategory, UNCATEGORIZED } from './possessionCategories';

const item: PossessionItem = {
  id: 'cream', name: '面霜', kind: 'consumable', category: '护肤',
  status: 'active', createdAt: '2026-09-18', txns: [],
};
const bucket: PossessionCategoryBucket = {
  categories: ['其他', '日用品', '💊药', '🪥漱', '🧴护', '🛁浴'],
  tagToCategory: { 面霜: '🧴护' },
};

describe('物品用途分类与设置同步', () => {
  it('导入的旧分类不会覆盖设置中的自定义标签映射', () => {
    expect(getItemCategory(item, bucket, ['消耗品', '面霜'])).toBe('🧴护');
    expect(getItemCategory(item, { ...bucket, categories: [...bucket.categories, '护肤'] }, ['面霜'])).toBe('🧴护');
  });

  it('显式手动选择优先，取消手动选择后恢复标签映射', () => {
    expect(getItemCategory({ ...item, categoryOverride: '日用品' }, bucket, ['面霜'])).toBe('日用品');
    expect(getItemCategory({ ...item, categoryOverride: undefined }, bucket, ['面霜'])).toBe('🧴护');
  });

  it('未配置的旧名称归为未分类，不重新变成可选分类', () => {
    expect(getItemCategory({ ...item, category: '保健' }, bucket, [])).toBe(UNCATEGORIZED);
    expect(getItemCategory(item, { ...bucket, tagToCategory: { 面霜: '护肤' } }, ['面霜'])).toBe(UNCATEGORIZED);
  });

  it('保留仍在设置列表中的旧分类', () => {
    expect(getItemCategory({ ...item, category: '日用品' }, bucket, [])).toBe('日用品');
  });

  it('忽略已删除的手动分类和映射，继续查找有效映射', () => {
    expect(getItemCategory(
      { ...item, categoryOverride: '护肤' },
      { ...bucket, tagToCategory: { 旧标签: '护肤', 面霜: '🧴护' } },
      ['旧标签', '面霜'],
    )).toBe('🧴护');
  });

  it('删除分类同步清除对应的手动选择与标签映射，其他物品类型不受影响', () => {
    const store = usePossessionStore;
    const previous = store.getState();
    try {
      store.setState({
        items: [{ ...item, categoryOverride: '🧴护' }, { ...item, id: 'durable', kind: 'durable', categoryOverride: '🧴护' }],
        categoryConfig: { consumable: bucket, durable: bucket },
      });
      store.getState().removeCategory('consumable', '🧴护');
      const next = store.getState();
      expect(next.categoryConfig.consumable.categories).not.toContain('🧴护');
      expect(next.categoryConfig.consumable.tagToCategory.面霜).toBeUndefined();
      expect(next.items[0].categoryOverride).toBeUndefined();
      expect(getItemCategory(next.items[0], next.categoryConfig.consumable, ['面霜'])).toBe(UNCATEGORIZED);
      expect(next.items[1].categoryOverride).toBe('🧴护');
      expect(next.categoryConfig.durable).toEqual(bucket);
    } finally {
      store.setState(previous);
    }
  });
});
