import { isTripTagFormat } from './trips';

// 6 类标签分类 = 3 类自动识别 + 4 类手动 + 1 未分类
// 自动：system（红黑白/周期/波动/消费等系统语义） · trip（出游 tag） · quantity（数字+单位）
// 手动：name（双抗精华等具体名称） · brand（珀莱雅等品牌） · person（人物） · ignore（忽略）
export type ManualTagCategory = 'name' | 'brand' | 'person' | 'ignore';
export type TagCategory = 'system' | 'trip' | 'quantity' | ManualTagCategory | 'unclassified';

export const MANUAL_TAG_CATEGORIES: ManualTagCategory[] = ['name', 'brand', 'person', 'ignore'];
export const AUTO_TAG_CATEGORIES: TagCategory[] = ['system', 'trip', 'quantity'];

export const TAG_CATEGORY_LABEL: Record<TagCategory, string> = {
  unclassified: '未分类',
  name:         '名称',
  brand:        '品牌',
  person:       '人物',
  ignore:       '忽略',
  system:       '系统',
  trip:         '出游',
  quantity:     '数量',
};

const SYSTEM_TAGS = new Set([
  '红', '黑', '白', '消费', '波动生活', '周期生活', '吃好喝好',
  '消耗品', '家', 'doing', 'done',
]);

const QUANTITY_TAG_PATTERN = /^\d+(\.\d+)?\s*(kg|mg|ml|l|g|斤|两|升|毫升|瓶|盒|支|个|包|袋|片|颗|粒|罐|条|卷|套|只|双|斤装|毫升装)$/i;

export function isSystemTag(tag: string): boolean {
  return SYSTEM_TAGS.has(tag);
}

export function isQuantityTag(tag: string): boolean {
  return QUANTITY_TAG_PATTERN.test(tag);
}

export function classifyTag(tag: string, manual: Record<string, ManualTagCategory>): TagCategory {
  if (isSystemTag(tag)) return 'system';
  if (isTripTagFormat(tag)) return 'trip';
  if (isQuantityTag(tag)) return 'quantity';
  return manual[tag] ?? 'unclassified';
}
