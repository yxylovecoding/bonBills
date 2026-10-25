import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN_SETTINGS, rankedSkinProducts, skinCareAvailable, skinCareGroup, skinPlanValues, type SkinProduct } from './lifeSkin';

describe('用品选择按当前肤况排序', () => {
  it('痤疮专用护肤品排在沿用受损护理之前，保留其他季节用品', () => {
    const products = rankedSkinProducts(DEFAULT_SKIN_SETTINGS, 'acne', 'autumn', 'skincare', 'morning');
    expect(products.map((item) => item.name)).toEqual(['安修泽油橄榄精华', '珂润霜', '珂润乳']);
    expect(skinPlanValues(DEFAULT_SKIN_SETTINGS, 'acne', 1, 'autumn').morningProducts).toBe('珂润霜');
  });

  it('护肤品只保留当前肤况和已启用的沿用护理，关闭沿用后同步隐藏', () => {
    expect(rankedSkinProducts(DEFAULT_SKIN_SETTINGS, 'damaged', 'autumn', 'skincare').map((item) => item.name))
      .toEqual(['珂润霜', '珂润乳']);
    expect(rankedSkinProducts(DEFAULT_SKIN_SETTINGS, 'allergic', 'autumn', 'skincare')).toEqual([]);
    const settings = { ...DEFAULT_SKIN_SETTINGS, plans: { ...DEFAULT_SKIN_SETTINGS.plans, acne: { days: DEFAULT_SKIN_SETTINGS.plans.acne.days } } };
    expect(rankedSkinProducts(settings, 'acne', 'autumn', 'skincare').map((item) => item.name)).toEqual(['安修泽油橄榄精华']);
    expect(skinCareAvailable(settings, '珂润霜', 'acne')).toBe(false);
    expect(skinCareAvailable(DEFAULT_SKIN_SETTINGS, '珂润霜', 'acne')).toBe(true);
    expect(skinCareAvailable(DEFAULT_SKIN_SETTINGS, '安修泽油橄榄精华', 'damaged')).toBe(false);
    expect(skinCareAvailable({ ...DEFAULT_SKIN_SETTINGS, products: DEFAULT_SKIN_SETTINGS.products.map((item) => ({ ...item, active: false })) }, '珂润霜', 'damaged')).toBe(false);
  });

  it('药品仅显示对应肤况，并隐藏不匹配时段，不沿用其他肤况的药', () => {
    expect(rankedSkinProducts(DEFAULT_SKIN_SETTINGS, 'damaged', 'autumn', 'medication', 'morning').map((item) => item.name))
      .toEqual(['生长因子']);
    expect(rankedSkinProducts(DEFAULT_SKIN_SETTINGS, 'acne', 'autumn', 'medication', 'evening').map((item) => item.name))
      .toEqual(['炉甘石', '阿达帕林', '酸']);
    expect(rankedSkinProducts(DEFAULT_SKIN_SETTINGS, 'healthy', 'autumn', 'medication')).toEqual([]);
    expect(rankedSkinProducts(DEFAULT_SKIN_SETTINGS, 'allergic', 'autumn', 'medication', 'morning')).toEqual([]);
  });

  it.each(['medication', 'skincare'] as const)('%s 只显示对应肤况或通用品，按季节和早晚排序，停用品不出现', (kind) => {
    const product = (id: string, overrides: Partial<SkinProduct> = {}): SkinProduct => ({
      id, name: id, kind, active: true, states: ['damaged'], seasons: [], times: [], tags: [], notes: '', ...overrides,
    });
    const settings = { ...DEFAULT_SKIN_SETTINGS, products: [
      product('other', { states: ['allergic'] }), product('general', { states: [] }),
      product('summer', { seasons: ['summer'] }), product('evening', { times: ['evening'] }),
      product('first'), product('second'), product('inactive', { active: false }),
      product('other-kind', { kind: kind === 'medication' ? 'skincare' : 'medication' }),
    ] };
    const original = structuredClone(settings);
    expect(rankedSkinProducts(settings, 'damaged', 'autumn', kind, 'morning').map((item) => item.id))
      .toEqual(kind === 'medication' ? ['first', 'second', 'summer', 'general'] : ['first', 'second', 'summer', 'evening', 'general']);
    expect(settings).toEqual(original);
  });

  it('未选肤况时按季节时段排序，没有在用品时返回空列表', () => {
    expect(rankedSkinProducts(DEFAULT_SKIN_SETTINGS, undefined, 'summer', 'skincare', 'morning').map((item) => item.name))
      .toEqual(['珂润乳', '安修泽油橄榄精华', '珂润霜']);
    expect(rankedSkinProducts({ ...DEFAULT_SKIN_SETTINGS, products: [] }, 'acne', 'autumn', 'medication')).toEqual([]);
  });
});

describe('护肤品分组', () => {
  it('区分水乳霜和精华，支持精华水和分类标签，未知用品归入其他', () => {
    for (const name of ['珂润霜', '珂润乳', '海蓝之谜水', '保湿精华水', '保湿精华乳', '保湿精华霜', 'Moisturizing Cream']) {
      expect(skinCareGroup(name)).toBe('水乳霜');
    }
    for (const name of ['安修泽油橄榄精华', '补水精华', 'Hydrating Serum']) expect(skinCareGroup(name)).toBe('精华');
    expect(skinCareGroup('小棕瓶', ['精华'])).toBe('精华');
    expect(skinCareGroup('自定义精华面霜', ['水乳霜'])).toBe('水乳霜');
    expect(skinCareGroup('面膜')).toBe('其他');
  });
});
