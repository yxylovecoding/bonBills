import { describe, expect, it } from 'vitest';
import { calibratedItems } from './thermalLearning';
import { emptyContext, recommend } from './rules';
import { feelingEntries, outdoorTemperatureForPeriod, timePeriod } from './feelings';
import type { ClothesItem, WearRecord, WeatherSnapshot } from './types';

const top: ClothesItem = { id: 'top', name: '短袖', category: '上衣', revision: 'v1', photoId: 'photo', color: '白', thickness: 1,
  status: '可穿', active: true, windproof: false, waterproof: false, warmth: 4, braRequirement: 'optional' };
const coat: ClothesItem = { ...top, id: 'coat', category: '外套', warmth: 8 };
const context = { ...emptyContext('2026-10-05', 'Asia/Shanghai'), indoorTemperature: 25, scene: '基本室内' as const, active: false };
const record = (id: string, patch: Partial<WearRecord> = {}): WearRecord => ({ id, date: context.date, confirmedAt: '', revision: id, items: [top, coat], context, weather: null,
  feelings: { 上午: { indoor: '舒适', outdoor: null, indoorTemperature: 25, outdoorTemperature: null } }, ...patch });
describe('按分时段体感校准保暖值', () => {
  it('全身体感不用于反推帽子、口罩、围巾、鞋袜和手套的保暖值', () => {
    const accessories: ClothesItem[] = ['帽子', '口罩', '围巾', '手套'].map((name) => ({ ...top, id: name, name, category: '配饰' }));
    const shoes: ClothesItem = { ...top, id: '鞋', category: '鞋', warmth: 2 };
    const socks: ClothesItem = { ...top, id: '袜子', name: '袜子', category: '配饰', warmth: 2 };
    const jewellery: ClothesItem = { ...top, id: '项链', name: '项链', category: '配饰' };
    const pieces = [...accessories, shoes, socks, jewellery];
    const result = calibratedItems(pieces, [record('one', { items: pieces }), record('two', { items: pieces })], context.date);
    expect(result.map((piece) => piece.learnedWarmth)).toEqual(Array(7).fill(undefined));
    expect(pieces.map((piece) => piece.learnedWarmth)).toEqual(Array(7).fill(undefined));
  });
  it('连体配饰也不因全身体感改变本身的保暖值', () => {
    const hood: ClothesItem = { ...top, id: 'hood', name: '围巾帽', category: '配饰' };
    const records = [record('one', { items: [hood] }), record('two', { items: [hood] })];
    expect(calibratedItems([hood], records.slice(0, 1), context.date)[0].learnedWarmth).toBeUndefined();
    expect(calibratedItems([hood], records, context.date)[0].learnedWarmth).toBeUndefined();
  });
  it('室内脱外套的记录只校准内搭，保留原始估值和历史快照', () => {
    const records = [record('one'), record('two')];
    const result = calibratedItems([top, coat], records, context.date);
    expect(result[0]).toMatchObject({ warmth: 4, learnedWarmth: 2.5 });
    expect(result[1].learnedWarmth).toBeUndefined();
    expect(records[0].items[0].warmth).toBe(4);
    expect(calibratedItems([top], [record('one')], context.date)[0].learnedWarmth).toBeUndefined();
  });
  it('仅搭过、未来、运动和无温度的体感不会改变保暖值', () => {
    const records = [record('styled', { kind: 'styled' }), record('future', { date: '2026-10-06' }),
      record('sport', { purpose: '运动' }), record('walk', { context: { ...context, active: true } }),
      record('unknown', { feelings: { 上午: { indoor: '很冷', outdoor: null, indoorTemperature: null, outdoorTemperature: null } } })];
    expect(calibratedItems([top], records, context.date)[0].learnedWarmth).toBeUndefined();
  });
  it('补记和修改历史会重新校准，重复记录不累计，偏冷降低原先高估的保暖值', () => {
    const cold = record('cold', { items: [top], feelings: { 上午: { indoor: null, outdoor: '偏冷', indoorTemperature: null, outdoorTemperature: 22 } } });
    const second = { ...cold, id: 'another' };
    expect(calibratedItems([top], [cold, cold], context.date)[0].learnedWarmth).toBeUndefined();
    expect(calibratedItems([top], [cold, second], context.date)[0].learnedWarmth).toBe(3);
    expect(calibratedItems([top], [cold, { ...second, kind: 'styled' }], context.date)[0].learnedWarmth).toBeUndefined();
  });
  it('每套室内只学习一次，骑车单独记录且不混入普通室外学习', () => {
    const entry = { indoor: '很冷' as const, outdoor: null, cycling: '很冷' as const, indoorTemperature: 10, outdoorTemperature: 10 };
    const one = record('one', { indoor: '舒适', indoorTemperature: 25, feelings: { 上午: entry, 晚上: entry } });
    expect(feelingEntries(one)).toHaveLength(2);
    expect(calibratedItems([top], [one], context.date)[0].learnedWarmth).toBeUndefined();
    expect(calibratedItems([top], [one, { ...one, id: 'two' }], context.date)[0].learnedWarmth).toBe(2.5);
    const cyclingOnly = record('bike', { indoor: null, indoorTemperature: null, feelings: { 上午: { ...entry, indoor: null } } });
    expect(calibratedItems([top], [cyclingOnly, { ...cyclingOnly, id: 'bike-two' }], context.date)[0].learnedWarmth).toBeUndefined();
  });
  it('旧体感可回顾且时段按早、上午、中午、下午、晚上划分', () => {
    expect(['07:00', '10:00', '12:00', '15:00', '20:00'].map(timePeriod)).toEqual(['早晨', '上午', '中午', '下午', '晚上']);
    const entries = feelingEntries(record('legacy', { feelings: undefined, time: '15:00', indoor: '舒适', outdoor: '偏冷' }));
    expect(entries).toMatchObject([{ period: '下午', indoor: '舒适', outdoor: '偏冷', indoorTemperature: 25, outdoorTemperature: null }]);
  });
  it('逐小时天气可为补记时段填温度，手填天气优先且旧快照仅匹配抓取时段', () => {
    const weather: WeatherSnapshot = { date: context.date, timezone: context.timezone, latitude: 0, longitude: 0, fetchedAt: '', temperature: 23, apparent: 23,
      min: 15, max: 25, apparentMin: 15, wind: 0, precipitation: 0, periodTemperatures: { 上午: 18, 下午: 24 } };
    expect(outdoorTemperatureForPeriod(context, weather, '上午', '15')).toBe(18);
    expect(outdoorTemperatureForPeriod({ ...context, manualWeather: { temperature: 20, rain: false } }, weather, '上午', '15')).toBe(20);
    expect(outdoorTemperatureForPeriod(context, { ...weather, periodTemperatures: undefined }, '上午', '15')).toBeNull();
    expect(outdoorTemperatureForPeriod(context, { ...weather, periodTemperatures: undefined }, '下午', '15')).toBe(23);
  });
  it('室内25度室外16度时优先薄内搭加外套，分别满足室内外温度', () => {
    const weather: WeatherSnapshot = { date: context.date, timezone: context.timezone, latitude: 0, longitude: 0, fetchedAt: '', temperature: 16, apparent: 16, min: 15, max: 18, apparentMin: 15, wind: 0, precipitation: 0 };
    const thin = { ...top, id: 'thin', warmth: 1 }, thick = { ...top, id: 'thick', warmth: 5 };
    const bottom = { ...top, id: 'pants', category: '下装' as const, warmth: 1 }, shoes = { ...top, id: 'shoes', category: '鞋' as const, warmth: 0 };
    const result = recommend([thin, thick, coat, bottom, shoes], context, weather)[0];
    expect(result.items.map((item) => item.id)).toContain('thin');
    expect(result.items.map((item) => item.id)).not.toContain('thick');
    expect(result.items.map((item) => item.id)).toContain('coat');
  });
});
