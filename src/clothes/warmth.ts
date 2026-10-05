import { categoryLabel, type ClothesItem } from './types.js';

// Initial personal estimates. An explicit wardrobe value always takes precedence.
export function estimateWarmth(item: ClothesItem): number {
  const category = categoryLabel(item.category), name = item.name;
  if (['文胸', '鞋', '配饰'].includes(category)) return 0;
  if (category === '下装') {
    if (/短裤|短裙|运动裙/.test(name)) return 1;
    if (/牛仔|工装/.test(name)) return item.thickness === 3 ? 6 : 3;
    return [1.5, 3, 6][item.thickness - 1];
  }
  if (category === '连衣裙') return [1.5, 3, 5][item.thickness - 1];
  if (category === '外套') {
    if (item.sleepwear && /披肩/.test(name)) return 2;
    if (/长款.*(?:棉服|羽绒)/.test(name)) return 10;
    if (/棉服|羽绒|斯凯奇立领短/.test(name)) return 8;
    if (/马甲/.test(name)) return 5;
    if (/外壳|冲锋衣/.test(name)) return 3;
    if (/针织开衫/.test(name)) return 3;
    if (/风衣/.test(name)) return 4;
    return [2, 4, 8][item.thickness - 1];
  }
  if (/内胆/.test(name)) return 7;
  if (/蕾丝/.test(name)) return 1;
  if (/背心|吊带/.test(name)) return .5;
  if (/长袖|衬衫/.test(name) && item.thickness === 1) return 1.5;
  return [1, 3, 5][item.thickness - 1];
}
export function itemWarmth(item: ClothesItem): number { return item.learnedWarmth ?? item.warmth ?? estimateWarmth(item); }
export function warmthTotals(items: ClothesItem[]) {
  return items.reduce((total, item) => {
    const category = categoryLabel(item.category), warmth = itemWarmth(item);
    if (['内衣', '上衣', '外套', '连衣裙'].includes(category)) total.upper += warmth;
    if (['下装', '连衣裙'].includes(category)) total.lower += warmth;
    return total;
  }, { upper: 0, lower: 0 });
}
export function isOutdoorCoat(item: ClothesItem) { return categoryLabel(item.category) === '外套' && !item.sleepwear; }
export function environmentWarmth(items: ClothesItem[], indoorCoat = false) {
  return {
    indoor: warmthTotals(indoorCoat ? items : items.filter((item) => !isOutdoorCoat(item))),
    outdoor: warmthTotals(items),
  };
}
export function wearable(item: ClothesItem) { return !item.deleted && item.status !== '收起'; }
export function normalizeItem(item: ClothesItem): ClothesItem {
  return { ...item, status: item.status === '待洗' ? '可穿' : item.status };
}
