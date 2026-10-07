import { environmentWarmth, itemWarmth, warmthTotals } from './warmth';
import { describe, expect, it } from 'vitest';
import { eligibleItems, calendarDestinations, chooseLocation, deviceDate, effectiveContext, emptyContext, inferActivities, recentCounts, totalWearCounts, recommend, replacePiece, replacements } from './rules';
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
  it('炎热时把薄衣物排在厚衣物前面', () => {
    const hot = { ...weather, temperature: 34, apparent: 34, apparentMin: 29, min: 29, max: 35 };
    expect(recommend([...wardrobe, item('thick', '上装', { thickness: 3 })], context, hot)[0].items.every((i) => i.id !== 'thick')).toBe(true);
  });
  it('寒冷时选保暖主体、厚外套并补充配饰', () => {
    const coldItems = [...wardrobe.map((i) => ({ ...i, thickness: 3 as const })), item('coat', '外套', { thickness: 3 }), item('scarf', '配饰', { thickness: 3 })];
    const result = recommend(coldItems, { ...context, scene: '长时间室外' }, { ...weather, temperature: 0, apparent: 0, apparentMin: -2, min: -2, max: 5 })[0];
    expect(result.missing).toEqual(['帽子', '口罩', '手套']); expect(result.items).toHaveLength(5);
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
    const windy = { ...weather, wind: 30, temperature: 15, apparent: 15, min: 12, max: 18 };
    const result = recommend([...wardrobe, item('coat', '外套'), item('wind', '外套', { windproof: true })], { ...context, scene: '有室外' }, windy)[0];
    expect(result.items.map((i) => i.id)).toContain('wind');
  });
  it('收起、已删除以及不方便活动的衣物不可用于活动场景', () => {
    const excluded = [item('stored', '上装', { status: '收起' }), item('deleted', '上装', { deleted: true }), item('tight', '上装', { active: false })];
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
    expect(recentCounts([...records, { date: '2026-10-04', kind: 'styled', items: [items[3]] } as WearRecord], context.date)).toEqual({ top: 1 });
  });
  it('单件替换保留其余衣物，排除不可活动的候选', () => {
    const alt = item('alt', '上装'), no = item('no', '上装', { active: false });
    const activeContext = { ...context, active: true };
    const original = recommend(wardrobe, activeContext, weather)[0];
    expect(replacements(wardrobe[0], original, [...wardrobe, alt, no], activeContext, weather)).toEqual([alt]);
    expect(replacePiece(original, 'top', alt, [...wardrobe, alt], activeContext, weather).items.map((i) => i.id)).toEqual(['alt', 'bottom', 'shoes']);
  });
  it('休闲优先温度合适且累计穿得少的单品，包含较早记录并排除仅搭过的', () => {
    const seldom = item('seldom', '上衣', { warmth: 3 });
    const perfect = item('perfect', '上衣', { warmth: 2 });
    const tooWarm = item('too-warm', '上衣', { warmth: 12 });
    const records = [
      ...Array.from({ length: 6 }, () => ({ date: '2025-01-01', items: [perfect] })),
      { date: '2025-01-02', items: [seldom] },
      ...Array.from({ length: 10 }, () => ({ date: '2026-10-04', kind: 'styled', items: [seldom] })),
    ] as WearRecord[];
    const counts = totalWearCounts(records);
    expect(counts).toEqual({ perfect: 6, seldom: 1 });
    // Only the last page is present in the client; the server supplies lifetime counts.
    const result = recommend([perfect, seldom, tooWarm, ...wardrobe.slice(1)], { ...context, purpose: '休闲' }, weather, [], counts);
    expect(result[0].items.map((piece) => piece.id)).toContain('seldom');
    expect(result[0].items.map((piece) => piece.id)).not.toContain('too-warm');
  });
  it('休闲优先不穿内衣，并在温度合适的方案中轮换少穿单品', () => {
    const underwear = item('underwear', '内衣', { warmth: 0 });
    const result = recommend([...wardrobe, underwear], { ...context, purpose: '休闲' }, weather, [], { top: 20, bottom: 20, shoes: 20 });
    expect(result[0].items).not.toContainEqual(underwear);
  });
  it('见朋友或重要的人时，在温度适配的方案中优先历史完整搭配', () => {
    const styledTop = item('styled-top', '上衣');
    const styledBottom = item('styled-bottom', '下装');
    const styledShoes = item('styled-shoes', '鞋');
    const styled = { id: 'styled-look', date: context.date, confirmedAt: `${context.date}T10:00:00Z`, kind: 'styled' as const,
      purpose: '见朋友' as const, items: [styledTop, styledBottom, styledShoes] } as WearRecord;
    const result = recommend([...wardrobe, styledTop, styledBottom, styledShoes], { ...context, purpose: '见朋友' }, weather, [styled]);
    expect(result[0].items.map((piece) => piece.id).sort()).toEqual(['styled-bottom', 'styled-shoes', 'styled-top']);
  });
  it('用途为运动时，少穿但不方便活动的衣服仍不能推荐', () => {
    const tight = item('tight', '上衣', { active: false });
    const sporty = { ...context, active: false, purpose: '运动' as const };
    expect(effectiveContext(sporty, null).active).toBe(true);
    const result = recommend([tight, ...wardrobe], sporty, weather, [], { top: 30 });
    expect(result[0].items.map((piece) => piece.id)).toContain('top');
    expect(result.every((outfit) => outfit.items.every((piece) => piece.id !== 'tight'))).toBe(true);
  });
  it('无天气可以手填继续推荐', () => {
    expect(recommend(wardrobe, { ...context, manualWeather: { temperature: 24, rain: false } }, null)[0].missing).toEqual([]);
  });
  it('保暖内胆与薄防风外壳按叠穿组合，不再误报缺少外套', () => {
    const liner = item('liner', '上装', { thickness: 3 });
    const shell = item('shell', '外套', { thickness: 1, windproof: true, waterproof: true });
    const changeable = { ...weather, temperature: 19, apparent: 19, apparentMin: 6, min: 9, max: 24 };
    expect(recommend([liner, shell], context, changeable)[0]).toMatchObject({ items: [liner, shell], missing: ['下装', '鞋'] });
    const thin = item('thin', '上装');
    const rainy = { ...changeable, apparentMin: 12, precipitation: 2, wind: 30 };
    const options = recommend([thin, liner, shell, ...wardrobe.slice(1).map((piece) => ({ ...piece, waterproof: true }))], { ...context, scene: '有室外' }, rainy);
    expect(options[0].items.map((piece) => piece.id)).toEqual(expect.arrayContaining([liner.id, shell.id]));
  });
  it('叠穿仍排除不满足防风防雨及活动条件的外壳', () => {
    const liner = item('liner', '上装', { thickness: 3 });
    const shell = item('shell', '外套', { thickness: 1, windproof: true, waterproof: true });
    const cold = { ...weather, temperature: 10, apparent: 10, apparentMin: 6, min: 9, max: 24, precipitation: 2, wind: 30 };
    const outside = { ...context, scene: '有室外' as const, active: true };
    for (const patch of [{ windproof: false }, { waterproof: false }, { active: false }, { status: '收起' as const }]) {
      expect(recommend([liner, { ...shell, ...patch }], outside, cold)[0].items).not.toContainEqual({ ...shell, ...patch });
    }
  });
  it('替换内层或外套可自行调整薄厚，不按旧厚薄等级拦截', () => {
    const liner = item('liner', '上装', { thickness: 3 });
    const shell = item('shell', '外套', { thickness: 1, windproof: true });
    const warmCoat = item('warm-coat', '外套', { thickness: 3 });
    const cool = { ...weather, apparent: 16, apparentMin: 12, min: 12, max: 20 };
    const pieces = [liner, shell, warmCoat, ...wardrobe];
    const outfit = { items: [liner, shell], missing: ['下装', '鞋'], key: 'liner:shell' };
    expect(replacements(liner, outfit, pieces, context, cool)).toContainEqual(wardrobe[0]);
    expect(replacements(warmCoat, { ...outfit, items: [liner, warmCoat] }, pieces, context, cool)).toContainEqual(shell);
  });
  it('支持同一层级（如上衣）叠穿多件衣物，保暖值正确累加', () => {
    const shirt = item('shirt', '上衣', { warmth: 2 });
    const sweater = item('sweater', '上衣', { warmth: 4 });
    const fixed = [shirt, sweater, item('bottom', '下装', { warmth: 5 }), item('shoes', '鞋', { warmth: 2 })];
    const result = recommend([shirt, sweater, ...wardrobe], context, weather, [], {}, { fixedItems: fixed });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const outfit = result[0];
    expect(outfit.items.map(i => i.id)).toContain('shirt');
    expect(outfit.items.map(i => i.id)).toContain('sweater');
    expect(warmthTotals(outfit.items).upper).toBe(6);
  });
});
describe('分层穿搭与文胸', () => {
  const bra = item('bra', '文胸');
  const top = item('shirt', '上衣', { braRequirement: 'required' });
  const pieces = [top, bra, ...wardrobe.slice(1)];
  const cool = { ...weather, temperature: 7, apparent: 7, apparentMin: 6, min: 6, max: 12 };
  it('旧上装默认需穿文胸，新旧上衣都能参与推荐', () => {
    for (const category of ['上装', '上衣'] as const) {
      const result = recommend([{ ...top, category, braRequirement: undefined }, bra, ...wardrobe.slice(1)], context, weather)[0];
      expect(result.items.map((piece) => piece.id)).toEqual(['bra', 'shirt', 'bottom', 'shoes']);
      expect(result.missing).toEqual([]);
    }
  });
  it('文胸不足仍展示现有衣物，排除收起及不方便活动的文胸', () => {
    const shell = item('shell', '外套', { windproof: true });
    const liner = { ...top, thickness: 3 as const };
    expect(recommend([liner, shell], context, cool)[0]).toMatchObject({ items: [liner, shell], missing: ['文胸', '下装', '鞋'] });
    for (const patch of [{ status: '收起' as const }, { active: false }, { deleted: true }]) {
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
    expect(recommend([inner, ...pieces], context, { ...weather, temperature: 32, apparent: 32, apparentMin: 29 })[0].items).not.toContainEqual(inner);
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


const uncovered = { head: 0, face: 0, neck: 0, feet: 0, hands: 0 };

describe('七部位穿搭推荐', () => {
  const accessories = [item('厚帽子', '配饰', { thickness: 3 }), item('口罩', '配饰', { thickness: 2 }),
    item('围巾', '配饰', { thickness: 3 }), item('手套', '配饰', { thickness: 3 })];
  const pieces = [item('top', '上衣', { warmth: 5 }), item('pants', '下装', { warmth: 5 }), item('coat', '外套', { warmth: 8 }),
    ...([1, 2, 3] as const).flatMap((thickness) => [item(`鞋${thickness}`, '鞋', { thickness }), item(`袜子${thickness}`, '配饰', { thickness })]), ...accessories];
  const cool = { ...weather, temperature: 21, min: 21, max: 21 };
  const cold = { ...cool, temperature: 4, min: 4, max: 4 };
  it('21度上下身匹配26度，同时选择薄鞋袜，不要求保暖帽、围巾、口罩和手套', () => {
    const result = recommend(pieces, context, cool)[0];
    expect(result.items.map((piece) => piece.id).sort()).toEqual(['top', 'pants', '鞋1', '袜子1'].sort());
    expect(warmthTotals(result.items)).toEqual({ upper: 5, lower: 5, head: 0, face: 0, neck: 0, feet: 1.5, hands: 0 });
    expect(recommend([...pieces].reverse(), context, cool)[0]).toEqual(result);
  });
  it('袜子随温度选择薄、常规、厚款，不叠穿多双袜子去凑26度', () => {
    for (const [temperature, thickness] of [[26, 1], [20, 1], [19, 2], [10, 2], [9, 3], [-10, 3]]) {
      const result = recommend(pieces, context, { ...cool, temperature })[0];
      expect(result.items.filter((piece) => piece.name.startsWith('袜子')).map((piece) => piece.id)).toEqual([`袜子${thickness}`]);
      expect(result.items.find((piece) => piece.category === '鞋')?.id).toBe(`鞋${thickness}`);
    }
  });
  it('厚保暖帽仅在低于5度时推荐，低温可以同时选用所有部位配饰', () => {
    for (const temperature of [26, 15, 10, 5]) {
      const result = recommend(pieces, context, { ...cool, temperature })[0];
      expect(result.items.some((piece) => piece.id === '厚帽子')).toBe(false);
      expect(eligibleItems(accessories, '配饰', context, { ...cool, temperature }).some((piece) => piece.id === '厚帽子')).toBe(false);
    }
    const result = recommend(pieces, { ...context, scene: '有室外' }, cold)[0];
    expect(result.items).toHaveLength(9);
    expect(result.missing).toEqual([]);
    expect(warmthTotals(result.items)).toMatchObject({ head: 3, face: 1, neck: 3, feet: 5, hands: 2 });
  });
  it('连体围巾帽不会重复叠加帽子和围巾', () => {
    const wardrobe = [...pieces.filter((piece) => !['厚帽子', '围巾'].includes(piece.id)), item('围巾帽', '配饰', { thickness: 3 })];
    const result = recommend(wardrobe, context, cold)[0];
    expect(result.items.filter((piece) => piece.id === '围巾帽')).toHaveLength(1);
    expect(warmthTotals(result.items)).toMatchObject({ head: 3, neck: 3 });
    expect(new Set(result.items.map((piece) => piece.id)).size).toBe(result.items.length);
  });
  it('替换帽子只提供相同部位配饰并保留其他配饰，不用手套替代', () => {
    const original = recommend(pieces, context, cold)[0];
    const hat = original.items.find((piece) => piece.id === '厚帽子')!;
    const alternate = item('新帽子', '配饰', { thickness: 3 });
    const wardrobe = [...pieces, alternate, item('新手套', '配饰', { thickness: 3 })];
    expect(replacements(hat, original, wardrobe, context, cold)).toEqual([alternate]);
    const next = replacePiece(original, hat.id, alternate, wardrobe, context, cold);
    expect(next.items.map((piece) => piece.id).sort()).toEqual(original.items.map((piece) => piece.id === hat.id ? alternate.id : piece.id).sort());
  });
  it('室内温暖时减少保暖配饰，运动场景仍排除不便活动的配饰', () => {
    const warmer = recommend(pieces, { ...context, indoorTemperature: 26 }, cold)[0];
    expect(warmer.items.filter((piece) => piece.category === '配饰').map((piece) => piece.id)).toEqual(['袜子1']);
    const sport = recommend(pieces.map((piece) => piece.id === '手套' ? { ...piece, active: false } : piece), { ...context, active: true }, cold)[0];
    expect(sport.items.some((piece) => piece.id === '手套')).toBe(false);
  });
});

describe('26度上下身独立匹配', () => {
  it('室内默认脱外套，保留内搭和下装；室外仍计入全部外套', () => {
    const pieces = [item('tee', '上装', { warmth: 1 }), item('inner', '内衣', { warmth: .5 }),
      item('coat', '外套', { warmth: 4 }), item('vest', '外套', { warmth: 2 }), item('pants', '下装', { warmth: 3 })];
    expect(environmentWarmth(pieces)).toEqual({ indoor: { ...uncovered, upper: 1.5, lower: 3 }, outdoor: { ...uncovered, upper: 7.5, lower: 3 } });
    expect(environmentWarmth(pieces, true)).toEqual({ indoor: { ...uncovered, upper: 7.5, lower: 3 }, outdoor: { ...uncovered, upper: 7.5, lower: 3 } });
    expect(pieces).toHaveLength(5);
    expect(environmentWarmth([item('dress', '连衣裙', { warmth: 2 }), pieces[2]])).toEqual({ indoor: { ...uncovered, upper: 2, lower: 2 }, outdoor: { ...uncovered, upper: 6, lower: 2 } });
    expect(environmentWarmth([])).toEqual({ indoor: { ...uncovered, upper: 0, lower: 0 }, outdoor: { ...uncovered, upper: 0, lower: 0 } });
  });
  it('睡衣披肩在室内保留，只给上身增加保暖值；日常推荐排除睡衣', () => {
    const dress = item('nightdress', '连衣裙', { sleepwear: true, warmth: 1.5 });
    const shrug = item('睡衣披肩', '外套', { sleepwear: true });
    const coat = item('outdoor-coat', '外套', { warmth: 4 });
    expect(itemWarmth(shrug)).toBe(2);
    expect(environmentWarmth([dress, shrug, coat]).indoor).toEqual({ ...uncovered, upper: 3.5, lower: 1.5 });
    expect(eligibleItems([dress], '连衣裙', context, weather)).toEqual([]);
    expect(eligibleItems([shrug, coat], '外套', context, weather).map((piece) => piece.id)).toEqual([coat.id]);
    expect(recommend([...wardrobe, dress, shrug], context, weather).every((outfit) => outfit.items.every((piece) => !piece.sleepwear))).toBe(true);
  });
  it('薄T恤初值1度，单件自定值优先，连衣裙分别计入上下身', () => {
    const tee = item('薄T恤', '上衣');
    expect(itemWarmth(tee)).toBe(1);
    expect(itemWarmth({ ...tee, warmth: 0 })).toBe(0);
    expect(warmthTotals([tee, item('coat', '外套', { warmth: 4 }), item('pants', '下装', { warmth: 2 })])).toEqual({ ...uncovered, upper: 5, lower: 2 });
    expect(warmthTotals([item('dress', '连衣裙', { warmth: 2 }), item('coat', '外套', { warmth: 3 }), item('bra', '文胸')])).toEqual({ ...uncovered, upper: 5, lower: 2 });
  });
  it('25度分别挑1度上下装；21度优先1度上衣加4度外套与5度下装', () => {
    const tee = item('tee', '上衣', { warmth: 1 });
    const pants = item('pants', '下装', { warmth: 5 });
    const shorts = item('shorts', '下装', { warmth: 1 });
    const coat = item('coat', '外套', { warmth: 4 });
    const pieces = [tee, pants, shorts, coat, item('shoes', '鞋')];
    expect(warmthTotals(recommend(pieces, context, { ...weather, temperature: 25 })[0].items)).toEqual({ ...uncovered, upper: 1, lower: 1, feet: 1 });
    expect(warmthTotals(recommend(pieces, context, { ...weather, temperature: 21 })[0].items)).toEqual({ ...uncovered, upper: 5, lower: 5, feet: 1 });
  });
  it('旧待洗衣物参与推荐', () => {
    expect(recommend([{ ...wardrobe[0], status: '待洗' }, ...wardrobe.slice(1)], context, weather)[0].missing).toEqual([]);
  });
});
