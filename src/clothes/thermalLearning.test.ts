import { describe, expect, it } from 'vitest';
import { calibratedItems } from './thermalLearning';
import { emptyContext, recommend } from './rules';
import { feelingEntries, timePeriod } from './feelings';
import type { ClothesItem, WearRecord, WeatherSnapshot } from './types';

const top: ClothesItem = { id: 'top', name: '短袖', category: '上衣', revision: 'v1', photoId: 'photo', color: '白', thickness: 1,
  status: '可穿', active: true, windproof: false, waterproof: false, warmth: 4, braRequirement: 'optional' };
const coat: ClothesItem = { ...top, id: 'coat', category: '外套', warmth: 8 };
const context = { ...emptyContext('2026-10-05', 'Asia/Shanghai'), indoorTemperature: 25, scene: '基本室内' as const, active: false };
const record = (id: string, patch: Partial<WearRecord> = {}): WearRecord => ({ id, date: context.date, confirmedAt: '', revision: id, items: [top, coat], context, weather: null,
  feelings: { 上午: { indoor: '舒适', outdoor: null, indoorTemperature: 25, outdoorTemperature: null } }, ...patch });
describe('按分时段体感校准保暖值', () => {
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
  it('旧体感可回顾且时段按早、上午、中午、下午、晚上划分', () => {
    expect(['07:00', '10:00', '12:00', '15:00', '20:00'].map(timePeriod)).toEqual(['早晨', '上午', '中午', '下午', '晚上']);
    const entries = feelingEntries(record('legacy', { feelings: undefined, time: '15:00', indoor: '舒适', outdoor: '偏冷' }));
    expect(entries).toMatchObject([{ period: '下午', indoor: '舒适', outdoor: '偏冷', indoorTemperature: 25, outdoorTemperature: null }]);
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
