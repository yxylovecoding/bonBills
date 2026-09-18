import type {
  PossessionCategoryBucket,
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
  bucket: PossessionCategoryBucket,
  itemTags: string[],
): string {
  const configured = new Set(bucket.categories);
  const manual = item.categoryOverride?.trim();
  if (manual && configured.has(manual)) return manual;
  for (const tag of itemTags) {
    const hit = bucket.tagToCategory[tag];
    if (hit && configured.has(hit)) return hit;
  }
  // 兼容账单导入的分类和旧物品分类，但不让它们覆盖用户的标签映射。
  const fallback = item.category?.trim();
  if (fallback && configured.has(fallback)) return fallback;
  return UNCATEGORIZED;
}
