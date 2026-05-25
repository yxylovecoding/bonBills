import type {
  PossessionCategoryConfig,
  PossessionItem,
  PossessionKind,
} from '../models/types';

export const UNCATEGORIZED = '未分类';

export const DEFAULT_CATEGORY_CONFIG: PossessionCategoryConfig = {
  consumable: {
    categories: ['洗漱', '护肤', '沐浴', '化妆', '食品', '清洁', '纸品', '药品', '其他'],
    tagToCategory: {},
  },
  durable: {
    categories: ['电子', '家具', '衣物', '书籍', '餐具', '工具', '装饰', '其他'],
    tagToCategory: {},
  },
};

export function bucketFor(
  config: PossessionCategoryConfig,
  kind: PossessionKind,
) {
  return config[kind];
}

export function getItemCategory(
  item: PossessionItem,
  tagToCategory: Record<string, string>,
  itemTags: string[],
): string {
  const manual = item.category?.trim();
  if (manual) return manual;
  for (const tag of itemTags) {
    const hit = tagToCategory[tag];
    if (hit) return hit;
  }
  return UNCATEGORIZED;
}
