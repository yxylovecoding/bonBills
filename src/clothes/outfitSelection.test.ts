import { describe, expect, it } from 'vitest';
import { emptyContext, recommend, replacements } from './rules';
import { pinReplacement, replacementChoices, replaceSelectedItem } from './outfitSelection';
import { wearAs } from './pairing';
import { categoryLabel, type Category, type ClothesItem } from './types';

const piece = (id: string, category: Category, patch: Partial<ClothesItem> = {}): ClothesItem => ({
  id, name: id, category, revision: id, photoId: id, color: '白', thickness: 1,
  active: true, windproof: false, waterproof: false, status: '可穿', braRequirement: 'optional', ...patch,
});
const context = { ...emptyContext('2026-10-06', 'Asia/Shanghai'), scene: '基本室内' as const, active: false, manualWeather: { temperature: 20, rain: false } };
const top = piece('top', '上衣', { warmth: 1 }), bottom = piece('bottom', '下装', { warmth: 6 }), shoes = piece('shoes', '鞋');
const light = piece('light-coat', '外套', { warmth: 1 }), heavy = piece('heavy-coat', '外套', { warmth: 5 });
const warm = piece('warm-top', '上衣', { warmth: 5 });
const wardrobe = [top, warm, bottom, shoes, light, heavy];

describe('推荐采纳与逐件选择', () => {
  it('采纳后替换只修改点击的单件，文胸和其余衣物也不被自动增减', () => {
    const bra = piece('bra', '文胸');
    const selected = [bra, top, bottom, heavy, shoes];
    const next = replaceSelectedItem(selected, top, warm);
    expect(next).toEqual([bra, warm, bottom, heavy, shoes]);
    selected.filter((item) => item !== top).forEach((item) => expect(next.find((value) => value.id === item.id)).toBe(item));
    expect(replaceSelectedItem(selected, top, { ...warm, braRequirement: 'required' })).toHaveLength(5);
  });
  it('推荐页换成更暖的上衣后，其余搭配会重新计算', () => {
    const before = recommend(wardrobe, context, null, [], undefined, { fixedItems: [top] })[0];
    expect(before.items).toContainEqual(heavy);
    const fixed = pinReplacement([], top, warm);
    const after = recommend(wardrobe, context, null, [], undefined, { fixedItems: fixed })[0];
    expect(after.items).toContainEqual(warm);
    expect(after.items).toContainEqual(light);
    expect(after.items).not.toContainEqual(heavy);
  });
  it('连续换上衣、裤子、外套时保留所有手选，换一套也不会丢失', () => {
    const pants = piece('pants', '下装', { warmth: 7 });
    let fixed = pinReplacement([], top, warm);
    fixed = pinReplacement(fixed, bottom, pants);
    fixed = pinReplacement(fixed, heavy, light);
    const results = recommend([...wardrobe, pants, piece('other-shoes', '鞋')], context, null, [], undefined, { fixedItems: fixed });
    expect(results.length).toBeGreaterThan(1);
    results.forEach((outfit) => fixed.forEach((item) => expect(outfit.items).toContainEqual(item)));
    fixed = pinReplacement(fixed, warm, top);
    expect(fixed.map((item) => item.id)).toEqual(['pants', 'light-coat', 'top']);
  });
  it('用户选中的单品不受候选池前24件和连衣裙排名的影响', () => {
    const many = Array.from({ length: 40 }, (_, i) => piece(`top-${i}`, '上衣', { warmth: 6 }));
    const dress = piece('dress', '连衣裙', { warmth: 6 });
    const results = recommend([...many, ...wardrobe, dress], context, null, [], undefined, { fixedItems: [top] });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((outfit) => { expect(outfit.items).toContainEqual(top); expect(outfit.items).not.toContainEqual(dress); });
    const dresses = recommend([...wardrobe, dress], context, null, [], undefined, { fixedItems: [dress] });
    dresses.forEach((outfit) => expect(outfit.items.some((item) => ['上衣', '下装'].includes(categoryLabel(item.category)))).toBe(false));
  });
  it('两用衬衫按外套位置替换和固定，不重复作为内搭出现', () => {
    const shirt = piece('shirt', '上衣', { wearAs: ['上衣', '外套'], warmth: 3 });
    const selected = [top, bottom, heavy, shoes];
    expect(replacementChoices(heavy, selected, [...wardrobe, shirt])).toContainEqual(wearAs(shirt, '外套'));
    expect(replaceSelectedItem(selected, heavy, shirt)).toEqual([top, bottom, wearAs(shirt, '外套'), shoes]);
    const results = recommend([...wardrobe, shirt], context, null, [], undefined, { fixedItems: pinReplacement([], heavy, shirt) });
    results.forEach((outfit) => expect(outfit.items.filter((item) => item.id === shirt.id)).toEqual([wearAs(shirt, '外套')]));
  });
  it('同等温度下优先给手选上衣配常搭裤子，仍保留休闲少穿优先级', () => {
    const paired = piece('paired', '下装', { warmth: 6 });
    const options = { fixedItems: [top], pairCounts: { top: { paired: 8 }, paired: { top: 8 } } };
    expect(recommend([...wardrobe, paired], context, null, [], undefined, options)[0].items).toContainEqual(paired);
    expect(recommend([...wardrobe, paired], { ...context, purpose: '休闲' }, null, [], { paired: 10 }, options)[0].items).toContainEqual(bottom);
  });
  it('手选变得不可用时不悄悄换掉，不满足场景的鞋也不能作为替换项', () => {
    expect(recommend(wardrobe.map((item) => item.id === top.id ? { ...item, status: '收起' as const } : item), context, null, [], undefined, { fixedItems: [top] })).toEqual([]);
    const sporty = { ...context, active: true };
    const tight = piece('tight-shoes', '鞋', { active: false });
    expect(replacements(shoes, { items: [top], missing: [], key: '' }, [...wardrobe, tight], sporty, null)).toEqual([]);
  });
  it('替换配饰只显示相同部位，排除已选单品并保持其他配饰', () => {
    const hat = piece('hat', '配饰', { warmthRegions: ['head'] });
    const cap = piece('cap', '配饰', { warmthRegions: ['head'] });
    const scarf = piece('scarf', '配饰', { warmthRegions: ['neck'] });
    expect(replacementChoices(hat, [hat, scarf], [hat, cap, scarf])).toEqual([cap]);
    expect(replaceSelectedItem([hat, scarf], hat, scarf)).toEqual([hat, scarf]);
    const results = recommend([...wardrobe, hat, cap, scarf], context, null, [], undefined, { fixedItems: [hat, scarf] });
    results.forEach((outfit) => { expect(outfit.items).toContainEqual(hat); expect(outfit.items).toContainEqual(scarf); expect(outfit.items).not.toContainEqual(cap); });
  });
});
