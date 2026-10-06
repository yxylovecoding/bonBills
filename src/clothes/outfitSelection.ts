import { itemCategories, wearAs } from './pairing';
import { itemRegions, wearable } from './warmth';
import { categoryLabel, type ClothesItem } from './types';

export function sameOutfitPosition(a: ClothesItem, b: ClothesItem) {
  const category = categoryLabel(a.category);
  return itemCategories(b).includes(category) && (category !== '配饰'
    || (itemRegions(a).length === itemRegions(b).length && itemRegions(a).every((region) => itemRegions(b).includes(region))));
}

export function replacementChoices(previous: ClothesItem, selected: ClothesItem[], wardrobe: ClothesItem[]) {
  return wardrobe.filter((item) => wearable(item) && item.id !== previous.id && sameOutfitPosition(previous, item)
    && !selected.some((piece) => piece.id === item.id)).map((item) => wearAs(item, previous.category));
}

// Manual editing changes exactly one position, including its chosen wearing role.
export function replaceSelectedItem(selected: ClothesItem[], previous: ClothesItem, next: ClothesItem) {
  if (!sameOutfitPosition(previous, next) || selected.some((piece) => piece.id === next.id && piece.id !== previous.id)) return selected;
  return selected.map((piece) => piece.id === previous.id ? wearAs(next, previous.category) : piece);
}

export function pinReplacement(fixed: ClothesItem[], previous: ClothesItem, next: ClothesItem) {
  if (!sameOutfitPosition(previous, next) || fixed.some((piece) => piece.id === next.id && piece.id !== previous.id)) return fixed;
  return [...fixed.filter((piece) => piece.id !== previous.id), wearAs(next, previous.category)];
}
