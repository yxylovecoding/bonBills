import { describe, expect, it } from 'vitest';
import { calendarDestinations, chooseLocation, deviceDate, effectiveContext, emptyContext, inferActivities, recentCounts, recommend, replacePiece, replacements } from './rules';
import type { Category, ClothesItem, ClothesLocation, WearRecord, WeatherSnapshot } from './types';

const context = { ...emptyContext('2026-10-05', 'Asia/Shanghai'), scene: '基本室内' as const, active: false };
const weather: WeatherSnapshot = { date: context.date, timezone: context.timezone, latitude: 30, longitude: 120, fetchedAt: '2026-10-05T00:00:00Z', temperature: 24, apparent: 24, min: 22, max: 26, apparentMin: 22, precipitation: 0, wind: 10 };
const item = (id: string, category: Category, patch: Partial<ClothesItem> = {}): ClothesItem => ({ id, category, name: id, revision: id, photoId: id, color: '白', thickness: 1, active: true, windproof: false, waterproof: false, status: '可穿', braRequirement: 'optional', ...patch });
const wardrobe = [item('top', '上装'), item('bottom', '下装'), item('shoes', '鞋')];

describe('BonClothes 规则推荐', () => {
  it('空衣柜和不完整条件不虚构单品', () => {
    expect(recommend([], context, weather)[0].items).toEqual([]);
    expect(recommend([], context, weather)[0].missing.length).toBeGreaterThan(0);
    expect(recommend(wardrobe, { ...context, scene: null }, weather)).toEqual([]);
    expect(recommend(wardrobe, context, null)).toEqual([]);
  });
  it('缺少类别仍展示已有上装，不为减少评分选择空搭配', () => {
    expect(recommend([wardrobe[0]], context, weather)[0]).toMatchObject({ items: [wardrobe[0]], missing: ['下装', '鞋'] });
  });
  it('可选上装下装或连衣裙，不混搭两种结构', () => {
    const candidates = recommend([...wardrobe, item('dress', '连衣裙')], context, weather);
    expect(candidates.some((v) => v.items.some((i) => i.category === '连衣裙'))).toBe(true);
    for (const outfit of candidates) expect(outfit.items.filter((i) => ['上装', '连衣裙'].includes(i.category))).toHaveLength(1);
  });
  it('炎热只选薄的主体衣物', () => {
    const hot = { ...weather, apparent: 34, apparentMin: 29, min: 29, max: 35 };
    expect(recommend([...wardrobe, item('thick', '上装', { thickness: 3 })], context, hot).every((o) => !o.items.some((i) => i.id === 'thick'))).toBe(true);
  });
  it('寒冷时选保暖主体、厚外套并补充配饰', () => {
    const coldItems = [...wardrobe.map((i) => ({ ...i, thickness: 3 as const })), item('coat', '外套', { thickness: 3 }), item('scarf', '配饰', { thickness: 3 })];
    const result = recommend(coldItems, { ...context, scene: '长时间室外' }, { ...weather, apparent: 0, apparentMin: -2, min: -2, max: 5 })[0];
    expect(result.missing).toEqual([]); expect(result.items).toHaveLength(5);
  });
  it('降雨优先防雨外套和鞋，室内不额外要求', () => {
    const wet = { ...weather, precipitation: 5 };
    const protectedItems = [...wardrobe, item('raincoat', '外套', { waterproof: true }), item('rainshoes', '鞋', { waterproof: true })];
    const result = recommend(protectedItems, { ...context, scene: '有室外' }, wet)[0];
    expect(result.items.map((i) => i.id)).toContain('raincoat'); expect(result.items.map((i) => i.id)).toContain('rainshoes');
    expect(recommend(wardrobe, context, wet)[0].missing).toEqual([]);
    expect(recommend(wardrobe, { ...context, scene: '有室外' }, wet)[0].missing).toContain('防雨外套');
  });
  it('温差和强风分别补充外套、防风外套', () => {
    expect(recommend(wardrobe, context, { ...weather, min: 17, max: 29 })[0].missing).toContain('外套');
    const result = recommend([...wardrobe, item('coat', '外套'), item('wind', '外套', { windproof: true })], { ...context, scene: '有室外' }, { ...weather, wind: 30 })[0];
    expect(result.items.map((i) => i.id)).toContain('wind');
  });
  it('待洗、收起、已删除以及不方便活动的衣物不可用于活动场景', () => {
    const excluded = [item('laundry', '上装', { status: '待洗' }), item('stored', '上装', { status: '收起' }), item('deleted', '上装', { deleted: true }), item('tight', '上装', { active: false })];
    const result = recommend([...excluded, ...wardrobe.slice(1)], { ...context, active: true }, weather)[0];
    expect(result.items.every((i) => !excluded.some((e) => e.id === i.id))).toBe(true);
    expect(result.missing).toContain('上衣');
  });
  it('先满足天气，再考虑颜色和近七天重复，结果不受输入顺序影响', () => {
    const items = [...wardrobe, item('new-top', '上装')];
    const records = [{ date: '2026-10-04', items: [wardrobe[0]] }, { date: '2026-09-27', items: [items[3]] }] as WearRecord[];
    const result = recommend(items, context, weather, records);
    expect(result[0].items.map((i) => i.id)).toContain('new-top');
    expect(recommend([...items].reverse(), context, weather, records)).toEqual(result);
    expect(new Set(result.map((o) => o.key)).size).toBe(result.length);
    expect(recentCounts(records, context.date)).toEqual({ top: 1 });
  });
  it('单件替换保留其余衣物，排除不可活动的候选', () => {
    const alt = item('alt', '上装'), no = item('no', '上装', { active: false });
    const activeContext = { ...context, active: true };
    const original = recommend(wardrobe, activeContext, weather)[0];
    expect(replacements(wardrobe[0], original, [...wardrobe, alt, no], activeContext, weather)).toEqual([alt]);
    expect(replacePiece(original, 'top', alt, [...wardrobe, alt], activeContext, weather).items.map((i) => i.id)).toEqual(['alt', 'bottom', 'shoes']);
  });
  it('无天气可以手填继续推荐', () => {
    expect(recommend(wardrobe, { ...context, manualWeather: { temperature: 24, rain: false } }, null)[0].missing).toEqual([]);
  });
  it('保暖内胆与薄防风外壳按叠穿组合，不再误报缺少外套', () => {
    const liner = item('liner', '上装', { thickness: 3 });
    const shell = item('shell', '外套', { thickness: 1, windproof: true, waterproof: true });
    const changeable = { ...weather, apparent: 19, apparentMin: 6, min: 9, max: 24 };
    expect(recommend([liner, shell], context, changeable)[0]).toMatchObject({ items: [liner, shell], missing: ['下装', '鞋'] });
    const thin = item('thin', '上装');
    const rainy = { ...changeable, apparentMin: 12, precipitation: 2, wind: 30 };
    const options = recommend([thin, liner, shell, ...wardrobe.slice(1).map((piece) => ({ ...piece, waterproof: true }))], { ...context, scene: '有室外' }, rainy);
    expect(options.every((outfit) => outfit.items.some((piece) => piece.id === liner.id) && outfit.items.some((piece) => piece.id === shell.id))).toBe(true);
  });
  it('叠穿仍排除不满足防风防雨、活动或严寒条件的外壳', () => {
    const liner = item('liner', '上装', { thickness: 3 });
    const shell = item('shell', '外套', { thickness: 1, windproof: true, waterproof: true });
    const cold = { ...weather, apparent: 10, apparentMin: 6, min: 9, max: 24, precipitation: 2, wind: 30 };
    const outside = { ...context, scene: '有室外' as const, active: true };
    for (const patch of [{ windproof: false }, { waterproof: false }, { active: false }, { status: '待洗' as const }]) {
      expect(recommend([liner, { ...shell, ...patch }], outside, cold)[0].items).not.toContainEqual({ ...shell, ...patch });
    }
    expect(recommend([liner, shell], outside, { ...cold, apparentMin: -5 })[0].items).not.toContainEqual(shell);
  });
  it('替换内层或外套时重新检查整套叠穿保暖条件', () => {
    const liner = item('liner', '上装', { thickness: 3 });
    const shell = item('shell', '外套', { thickness: 1, windproof: true });
    const warmCoat = item('warm-coat', '外套', { thickness: 3 });
    const cool = { ...weather, apparent: 16, apparentMin: 12, min: 12, max: 20 };
    const pieces = [liner, shell, warmCoat, ...wardrobe];
    const outfit = { items: [liner, shell], missing: ['下装', '鞋'], key: 'liner:shell' };
    expect(replacements(liner, outfit, pieces, context, cool)).not.toContainEqual(wardrobe[0]);
    expect(replacements(warmCoat, { ...outfit, items: [liner, warmCoat] }, pieces, context, cool)).toContainEqual(shell);
  });
});
describe('分层穿搭与文胸', () => {
  const bra = item('bra', '文胸');
  const top = item('shirt', '上衣', { braRequirement: 'required' });
  const pieces = [top, bra, ...wardrobe.slice(1)];
  const cool = { ...weather, apparent: 7, apparentMin: 6, min: 6, max: 12 };
  it('旧上装默认需穿文胸，新旧上衣都能参与推荐', () => {
    for (const category of ['上装', '上衣'] as const) {
      const result = recommend([{ ...top, category, braRequirement: undefined }, bra, ...wardrobe.slice(1)], context, weather)[0];
      expect(result.items.map((piece) => piece.id)).toEqual(['bra', 'shirt', 'bottom', 'shoes']);
      expect(result.missing).toEqual([]);
    }
  });
  it('文胸不足仍展示现有衣物，排除待洗及不方便活动的文胸', () => {
    const shell = item('shell', '外套', { windproof: true });
    const liner = { ...top, thickness: 3 as const };
    expect(recommend([liner, shell], context, cool)[0]).toMatchObject({ items: [liner, shell], missing: ['文胸', '下装', '鞋'] });
    for (const patch of [{ status: '待洗' as const }, { active: false }, { deleted: true }]) {
      const result = recommend([top, { ...bra, ...patch }, ...wardrobe.slice(1)], { ...context, active: true }, weather)[0];
      expect(result.items).not.toContainEqual({ ...bra, ...patch });
      expect(result.missing).toEqual(['文胸']);
    }
  });
  it('可不穿文胸的上衣和连衣裙省略文胸', () => {
    for (const category of ['上衣', '连衣裙'] as const) {
      const free = { ...top, category, braRequirement: 'optional' as const };
      const result = recommend([free, bra, ...wardrobe.slice(1)], context, weather)[0];
      expect(result.items).toContainEqual(free);
      expect(result.items).not.toContainEqual(bra);
      expect(result.missing).toEqual([]);
    }
  });
  it('保暖内衣是可选内层，薄上衣加保暖内衣可以满足低温', () => {
    const inner = item('thermal', '内衣', { thickness: 3, braRequirement: 'required' });
    const winter = [inner, ...pieces, item('coat', '外套', { thickness: 3 }), ...wardrobe.slice(1).map((piece) => ({ ...piece, thickness: 3 as const }))];
    const coldOutfit = recommend(winter, context, cool)[0];
    expect(coldOutfit.items.map((piece) => piece.id)).toEqual(['bra', 'thermal', 'shirt', 'bottom', 'coat', 'shoes']);
    expect(coldOutfit.missing).toEqual([]);
    expect(recommend([inner, ...pieces], context, { ...weather, apparent: 32, apparentMin: 29 })[0].items).not.toContainEqual(inner);
    expect(recommend(pieces, context, weather)[0].missing).not.toContain('内衣');
  });
  it('内衣不参与文胸判断，旧标签也不覆盖上衣或连衣裙要求', () => {
    for (const category of ['上衣', '连衣裙'] as const) {
      for (const braRequirement of [undefined, 'required', 'optional'] as const) {
        const inner = item('thermal', '内衣', { thickness: 3, braRequirement });
        const covering = { ...top, category };
        const winter = [inner, covering, bra, item('coat', '外套', { thickness: 3 }), ...wardrobe.slice(1).map((piece) => ({ ...piece, thickness: 3 as const }))];
        const result = recommend(winter, context, cool)[0];
        expect(result.items).toContainEqual(inner);
        expect(result.items).toContainEqual(bra);
        const without = replacePiece(result, covering.id, { ...covering, braRequirement: 'optional' }, winter, context, cool);
        expect(without.items).toContainEqual(inner);
        expect(without.items).not.toContainEqual(bra);
        expect(without.missing).not.toContain('文胸');
        const free = winter.map((piece) => piece.id === covering.id ? { ...piece, braRequirement: 'optional' as const } : piece);
        expect(recommend(free, context, cool)[0].items).not.toContainEqual(bra);
        expect(recommend([...winter].reverse(), context, cool)).toEqual(recommend(winter, context, cool));
      }
    }
  });
  it('替换内衣不改变文胸选择，单独内衣也不要求补文胸', () => {
    const inner = item('thermal', '内衣', { thickness: 3, braRequirement: 'required' });
    const next = item('other-thermal', '内衣', { thickness: 3, braRequirement: 'optional' });
    const winter = [inner, ...pieces, item('coat', '外套', { thickness: 3 }), ...wardrobe.slice(1).map((piece) => ({ ...piece, thickness: 3 as const }))];
    const result = recommend(winter, context, cool)[0];
    expect(replacePiece(result, inner.id, next, [...winter, next], context, cool).items).toContainEqual(bra);
    expect(recommend([inner, bra], context, cool)[0].items).not.toContainEqual(bra);
    expect(recommend([inner], context, cool)[0].missing).not.toContain('文胸');
  });
  it('替换上衣会同步增减文胸及缺失提示，文胸也可单件替换', () => {
    const free = item('free', '上衣');
    const second = item('second-bra', '文胸');
    const available = [...pieces, free, second];
    const original = recommend(pieces, context, weather)[0];
    const without = replacePiece(original, top.id, free, available, context, weather);
    expect(without.items.map((piece) => piece.id)).toEqual(['free', 'bottom', 'shoes']);
    expect(replacePiece(without, free.id, top, available, context, weather)).toEqual(original);
    expect(replacePiece(without, free.id, top, [top], context, weather).missing).toEqual(['文胸']);
    expect(replacements(bra, original, available, context, weather)).toEqual([second]);
    expect(replacePiece(original, bra.id, second, available, context, weather).items[0]).toEqual(second);
  });
});
describe('BonClothes 日期、地点和条件', () => {
  it('仅提取明确目的地，仍由用户选择具体城市', () => {
    const events = ['上海→杭州', '北京出差', '旅行', '出门'].map((title) => ({ title, allDay: true, startDate: '', endDate: '' }));
    expect(calendarDestinations(events)).toEqual(['杭州', '北京']);
  });
  it('跨日使用设备时区', () => {
    const now = new Date('2026-10-05T02:00:00Z');
    expect(deviceDate(now, 'America/Los_Angeles')).toBe('2026-10-04');
    expect(deviceDate(now, 'Asia/Shanghai')).toBe('2026-10-05');
  });
  it('明确活动推断场景，未知场景待选择', () => {
    const events = (title: string) => [{ title, allDay: true, startDate: '2026-10-05', endDate: '2026-10-06' }];
    expect(inferActivities(events('爬山'))).toEqual({ scene: '长时间室外', active: true });
    expect(inferActivities(events('电影'))).toEqual({ scene: '基本室内', active: false });
    expect(inferActivities(events('约会'))).toEqual({ scene: null, active: null });
    expect(effectiveContext(context, { events: events('爬山'), connected: true, fetchedAt: '' }).scene).toBe('基本室内');
    expect(effectiveContext(context, null).active).toBe(false);
  });
  it('手选地点优先，定位失败回退到上次手选', () => {
    const manual: ClothesLocation = { name: '杭州', latitude: 30, longitude: 120, source: 'manual' };
    const geo: ClothesLocation = { name: '当前位置', latitude: 40, longitude: 116, source: 'geo' };
    expect(chooseLocation(manual, geo, null)).toBe(manual);
    expect(chooseLocation(null, null, manual)).toBe(manual);
    expect(chooseLocation(null, null, null)).toBeNull();
  });
});
