import { describe, expect, it } from 'vitest';
import { itemCategories, outfitPairCounts, pairingScore, updatePairCounts, wearAs } from './pairing';
import { environmentWarmth, itemWarmth } from './warmth';
import { emptyContext, recommend, replacements } from './rules';
import type { ClothesItem, WearRecord, WeatherSnapshot } from './types';

const shirt: ClothesItem = { id: 'shirt', revision: 'shirt', photoId: 'shirt', name: '衬衫', category: '上衣', wearAs: ['上衣', '外套'], color: '白', thickness: 1,
  active: true, windproof: false, waterproof: false, status: '可穿', braRequirement: 'optional' };
const pants = { ...shirt, id: 'pants', category: '下装' as const, wearAs: [] };
const coat = { ...shirt, id: 'coat', category: '外套' as const, wearAs: [] };
const context = { ...emptyContext('2026-10-05', 'Asia/Shanghai'), scene: '基本室内' as const, active: false };
const weather: WeatherSnapshot = { date: context.date, timezone: context.timezone, latitude: 0, longitude: 0, fetchedAt: '', temperature: 16, apparent: 16, min: 15, max: 18, apparentMin: 15, wind: 0, precipitation: 0 };
const record = (id: string, items: ClothesItem[], kind: 'worn' | 'styled' = 'worn'): WearRecord => ({ id, items, kind, date: context.date, confirmedAt: '', revision: id, context, weather });
describe('穿着位置与常搭推荐', () => {
  it('穿过和搭过的套装参与常搭，同一记录不重复累计，编辑移除旧配对', () => {
    const first = record('one', [shirt, pants, coat]);
    const counts = outfitPairCounts([first, first, record('two', [shirt, pants], 'styled')]);
    expect(pairingScore(pants, [shirt], counts)).toBe(2);
    expect(pairingScore(coat, [shirt], counts)).toBe(1);
    expect(pairingScore(shirt, [shirt], counts)).toBe(0);
    const edited = updatePairCounts(updatePairCounts(counts, first.items, -1), [shirt, coat], 1);
    expect(pairingScore(pants, [shirt], edited)).toBe(1);
    expect(edited.pants.coat).toBeUndefined();
    expect(counts.pants.coat).toBe(1);
  });
  it('同件作外套保暖值不变，室内脱掉只影响这次作为外套的记录', () => {
    const asCoat = wearAs(shirt, '外套');
    expect(itemCategories(asCoat)).toContain('上衣');
    expect(itemWarmth(asCoat)).toBe(itemWarmth(shirt));
    expect(environmentWarmth([asCoat]).indoor.upper).toBe(0);
    expect(environmentWarmth([wearAs(asCoat, '上衣')]).indoor.upper).toBe(itemWarmth(shirt));
    expect(shirt.category).toBe('上衣');
  });
  it('推荐可将衬衫作外套，不会把同件衣服同时作为内外两层', () => {
    const tee = { ...shirt, id: 'tee', wearAs: [] };
    const shoes = { ...pants, id: 'shoes', category: '鞋' as const };
    const wardrobe = [shirt, tee, pants, shoes];
    const outfits = recommend(wardrobe, context, weather);
    expect(outfits.some((outfit) => outfit.items.some((item) => item.id === shirt.id && item.category === '外套'))).toBe(true);
    for (const outfit of outfits) expect(new Set(outfit.items.map((item) => item.id)).size).toBe(outfit.items.length);
    const original = { items: [tee, pants, coat, shoes], missing: [], key: 'original' };
    expect(replacements(coat, original, [...wardrobe, coat], context, weather)).toContainEqual(wearAs(shirt, '外套'));
  });
});
