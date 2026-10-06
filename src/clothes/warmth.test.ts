import { describe, expect, it } from 'vitest';
import { accessoriesOverlap, environmentWarmth, itemRegions, itemWarmth, warmthGap, warmthTargets, warmthTotals } from './warmth';
import type { ClothesItem } from './types';

const piece = (name: string, category: ClothesItem['category'], patch: Partial<ClothesItem> = {}): ClothesItem => ({
  id: name, name, category, revision: '', photoId: '', color: '白', thickness: 1, active: true, windproof: false, waterproof: false, status: '可穿', ...patch,
});

describe('全身各部位保暖', () => {
  it('鞋袜只叠加脚，帽子、口罩、围巾、手套分别计入覆盖部位', () => {
    const items = [piece('上衣', '上衣', { warmth: 4 }), piece('长裤', '下装', { warmth: 5 }),
      piece('帽子', '配饰', { warmth: 2 }), piece('口罩', '配饰', { warmth: 1 }), piece('围巾', '配饰', { warmth: 3 }),
      piece('鞋', '鞋', { warmth: 4 }), piece('袜子', '配饰', { warmth: 2 }), piece('手套', '配饰', { warmth: 3 })];
    expect(warmthTotals(items)).toEqual({ upper: 4, lower: 5, head: 2, face: 1, neck: 3, feet: 6, hands: 3 });
    expect(warmthTotals([])).toEqual({ upper: 0, lower: 0, head: 0, face: 0, neck: 0, feet: 0, hands: 0 });
  });
  it('保暖裤计入下身，未识别的配饰不猜测部位，明确部位可覆盖名称推断', () => {
    expect(itemRegions(piece('秋裤', '内衣'))).toEqual(['lower']);
    expect(itemRegions(piece('项链', '配饰'))).toEqual([]);
    expect(itemWarmth(piece('项链', '配饰'))).toBe(0);
    expect(itemRegions(piece('围巾帽', '配饰', { warmthRegions: ['face'] }))).toEqual(['face']);
    expect(itemWarmth(piece('帽子', '配饰', { warmth: 0 }))).toBe(0);
    expect(itemWarmth(piece('手套', '配饰', { thickness: 3 }))).toBeGreaterThan(itemWarmth(piece('手套', '配饰')));
    expect(itemWarmth(piece('棉鞋', '鞋', { thickness: 3 }))).toBeGreaterThan(itemWarmth(piece('凉鞋', '鞋')));
  });
  it('连体配饰可覆盖多个部位，室内脱外套不移除其他衣物', () => {
    const hood = piece('围巾帽', '配饰', { warmth: 5 });
    const coat = piece('外套', '外套', { warmth: 8 });
    expect(itemRegions(hood)).toEqual(['head', 'neck']);
    expect(environmentWarmth([hood, coat])).toEqual({
      indoor: { upper: 0, lower: 0, head: 5, face: 0, neck: 5, feet: 0, hands: 0 },
      outdoor: { upper: 8, lower: 0, head: 5, face: 0, neck: 5, feet: 0, hands: 0 },
    });
    expect(accessoriesOverlap(hood, piece('帽子', '配饰'))).toBe(true);
    expect(accessoriesOverlap(hood, piece('手套', '配饰'))).toBe(false);
    expect(accessoriesOverlap(piece('袜子', '配饰'), piece('鞋', '鞋'))).toBe(false);
  });
  it('26度仅用于上下身，鞋袜的档位差距较小，其他部位按各自低温阈值启用', () => {
    expect(warmthTargets(21)).toEqual({ upper: 5, lower: 5, head: 0, face: 0, neck: 0, feet: 1.5, hands: 0 });
    expect(warmthTargets(10)).toEqual({ upper: 16, lower: 16, head: 0, face: 0, neck: 1.5, feet: 3, hands: 0 });
    expect(warmthTargets(5)).toEqual({ upper: 21, lower: 21, head: 1.5, face: 0, neck: 1.5, feet: 5, hands: 1 });
    expect(warmthTargets(0)).toEqual({ upper: 26, lower: 26, head: 3, face: 1, neck: 3, feet: 5, hands: 2 });
    expect([1, 2, 3].map((thickness) => itemWarmth(piece('袜子', '配饰', { thickness: thickness as 1 | 2 | 3 })))).toEqual([.5, 1, 2]);
  });
  it('鞋袜分别匹配，不用厚袜代替保暖鞋，也不让厚上衣抵消薄下装', () => {
    const balanced = [piece('上衣', '上衣', { warmth: 5 }), piece('下装', '下装', { warmth: 5 }), piece('鞋', '鞋'), piece('袜子', '配饰')];
    expect(warmthGap(balanced, 21)).toBe(0);
    expect(warmthGap(balanced.map((item) => ({ ...item, warmth: item.category === '上衣' ? 10 : item.category === '下装' ? 0 : itemWarmth(item) })), 21)).toBe(10);
    expect(warmthGap(balanced.map((item) => item.category === '上衣' ? { ...item, warmth: 7 } : item), 21, 2)).toBe(0);
    const wrongFeet = balanced.map((item) => item.category === '鞋' ? { ...item, warmth: .5 } : item.name === '袜子' ? { ...item, warmth: 1 } : item);
    expect(warmthTotals(wrongFeet).feet).toBe(warmthTotals(balanced).feet);
    expect(warmthGap(wrongFeet, 21)).toBeGreaterThan(warmthGap(balanced, 21));
  });
});
