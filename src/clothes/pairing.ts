import { categoryLabel, wearId, type Category, type ClothesItem, type PairCounts, type WearRecord } from './types.js';
import { itemWarmth } from './warmth.js';

export function itemCategories(item: ClothesItem) {
  const primary = categoryLabel(item.category);
  return [...new Set([primary, ...(item.wearAs ?? []).map(categoryLabel)])];
}
export function wearAs(item: ClothesItem, category: Category): ClothesItem {
  if (categoryLabel(item.category) === categoryLabel(category)) return item;
  return { ...item, category: categoryLabel(category), wearAs: itemCategories(item), warmth: itemWarmth(item) };
}
export function updatePairCounts(counts: PairCounts, items: ClothesItem[], delta: number): PairCounts {
  const result = { ...counts }, ids = [...new Set(items.map((item) => item.id))];
  for (const id of ids) {
    result[id] = { ...result[id] };
    for (const other of ids) if (id !== other) {
      const count = Math.max(0, (result[id][other] ?? 0) + delta);
      if (count) result[id][other] = count; else delete result[id][other];
    }
    if (!Object.keys(result[id]).length) delete result[id];
  }
  return result;
}
export function outfitPairCounts(records: WearRecord[]): PairCounts {
  return [...new Map(records.map((record) => [wearId(record), record])).values()]
    .reduce((counts, record) => updatePairCounts(counts, record.items, 1), {});
}
export function pairingScore(item: ClothesItem, selected: ClothesItem[], counts: PairCounts) {
  return selected.reduce((score, other) => score + (other.id === item.id ? 0 : counts[other.id]?.[item.id] ?? 0), 0);
}
