import { BODY_REGIONS, categoryLabel, type BodyRegion, type ClothesItem } from './types.js';

export type WarmthTotals = Record<BodyRegion, number>;
export const COMFORT_TEMPERATURE = 26;
export function itemRegions(item: ClothesItem): BodyRegion[] {
  if (item.warmthRegions) return item.warmthRegions;
  const category = categoryLabel(item.category);
  if (category === '连衣裙') return ['upper', 'lower'];
  if (category === '下装' || (category === '内衣' && /裤/.test(item.name))) return ['lower'];
  if (['内衣', '上衣', '外套'].includes(category)) return ['upper'];
  if (category === '鞋') return ['feet'];
  if (category !== '配饰') return [];
  const names: [BodyRegion, RegExp][] = [
    ['head', /帽|耳罩|hat|beanie|cap|earmuff/i], ['face', /口罩|面罩|mask/i],
    ['neck', /围巾|围脖|脖套|领套|scarf|neckwarmer/i], ['feet', /袜|sock/i], ['hands', /手套|glove|mitten/i],
  ];
  return names.filter(([, pattern]) => pattern.test(item.name)).map(([region]) => region);
}
export function accessoriesOverlap(a: ClothesItem, b: ClothesItem) {
  if (categoryLabel(a.category) !== '配饰' || categoryLabel(b.category) !== '配饰') return false;
  const first = itemRegions(a), second = itemRegions(b);
  return (!first.length && !second.length) || first.some((region) => second.includes(region));
}

// Initial personal estimates. An explicit wardrobe value always takes precedence.
export function estimateWarmth(item: ClothesItem): number {
  const category = categoryLabel(item.category), name = item.name;
  if (category === '文胸') return 0;
  if (category === '鞋') {
    if (/凉鞋|拖鞋|sandal|slipper/i.test(name)) return .5;
    return [1, 2, 3][item.thickness - 1];
  }
  if (category === '配饰') {
    const regions = itemRegions(item);
    if (!regions.length) return 0;
    return (regions.some((region) => region === 'head' || region === 'neck') ? [.5, 1.5, 3] : [.5, 1, 2])[item.thickness - 1];
  }
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
export function warmthTotals(items: ClothesItem[]): WarmthTotals {
  return items.reduce((total, item) => {
    const warmth = itemWarmth(item);
    for (const region of itemRegions(item)) total[region] += warmth;
    return total;
  }, { upper: 0, lower: 0, head: 0, face: 0, neck: 0, feet: 0, hands: 0 });
}
// Personal clothing preferences, not measured body temperatures. Extremities
// have smaller warmth ranges and independent activation temperatures.
export function warmthTargets(temperature: number): WarmthTotals {
  const torso = Math.max(0, COMFORT_TEMPERATURE - temperature);
  const shoes = temperature >= 20 ? 1 : temperature >= 10 ? 2 : 3;
  const socks = temperature >= 20 ? .5 : temperature >= 10 ? 1 : 2;
  return { upper: torso, lower: torso,
    head: temperature >= 10 ? 0 : temperature >= 5 ? 1.5 : 3,
    face: temperature >= 5 ? 0 : temperature >= -5 ? 1 : 2,
    neck: temperature >= 15 ? 0 : temperature >= 5 ? 1.5 : 3,
    feet: shoes + socks, hands: temperature >= 10 ? 0 : temperature >= 5 ? 1 : 2 };
}
export function warmthGap(items: ClothesItem[], temperature: number, tolerance = 0) {
  const totals = warmthTotals(items), targets = warmthTargets(temperature);
  const regions = BODY_REGIONS.filter((region) => region !== 'feet').reduce((sum, region) =>
    sum + Math.max(0, Math.abs(totals[region] - targets[region]) - (region === 'upper' || region === 'lower' ? tolerance : 0)), 0);
  const shoesTarget = temperature >= 20 ? 1 : temperature >= 10 ? 2 : 3;
  const shoes = items.filter((item) => categoryLabel(item.category) === '鞋').reduce((sum, item) => sum + itemWarmth(item), 0);
  // A thicker sock does not substitute for warmer shoes (or vice versa).
  return regions + Math.abs(shoes - shoesTarget) + Math.abs(totals.feet - shoes - (targets.feet - shoesTarget));
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
