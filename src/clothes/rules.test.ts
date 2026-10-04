import { describe, expect, it } from 'vitest';
import { calendarDestinations, chooseLocation, deviceDate, effectiveContext, emptyContext, inferActivities, recentCounts, recommend, replacePiece, replacements } from './rules';
import type { Category, ClothesItem, ClothesLocation, WearRecord, WeatherSnapshot } from './types';

const context = { ...emptyContext('2026-10-05', 'Asia/Shanghai'), scene: '基本室内' as const, active: false };
const weather: WeatherSnapshot = { date: context.date, timezone: context.timezone, latitude: 30, longitude: 120, fetchedAt: '2026-10-05T00:00:00Z', temperature: 24, apparent: 24, min: 22, max: 26, apparentMin: 22, precipitation: 0, wind: 10 };
const item = (id: string, category: Category, patch: Partial<ClothesItem> = {}): ClothesItem => ({ id, category, name: id, revision: id, photoId: id, color: '白', thickness: 1, active: true, windproof: false, waterproof: false, status: '可穿', ...patch });
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
    expect(result.missing).toContain('上装');
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
    expect(replacePiece(original, 'top', alt).items.map((i) => i.id)).toEqual(['alt', 'bottom', 'shoes']);
  });
  it('无天气可以手填继续推荐', () => {
    expect(recommend(wardrobe, { ...context, manualWeather: { temperature: 24, rain: false } }, null)[0].missing).toEqual([]);
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
