import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import WearDetails from './WearDetails';
import { createWearDraft } from './WearEditor';
import { linkedClothesContext } from './calendarContext';
import { emptyContext } from './rules';
import { calibratedItems } from './thermalLearning';
import type { ClothesItem, WearRecord } from './types';

const context = { ...emptyContext('2026-10-21', 'Asia/Shanghai'), scene: '有室外' as const, active: false,
  location: { name: '北京', latitude: 39.9, longitude: 116.4, source: 'calendar' as const } };
const item: ClothesItem = { id: 'top', revision: 'v1', name: '上衣', category: '上衣', color: '白', thickness: 1, warmth: 4,
  active: true, waterproof: false, windproof: false, status: '可穿', photoId: 'photo' };
const record: WearRecord = { id: 'only-worn', date: context.date, revision: 'v1', confirmedAt: '', kind: 'worn', purpose: '休闲',
  context, items: [item], indoor: '舒适', indoorTemperature: 25,
  weather: { date: context.date, timezone: context.timezone, latitude: 39.9, longitude: 116.4, fetchedAt: '',
    code: 61, temperature: 18, apparent: 16, apparentMin: 8, min: 10, max: 20, precipitation: 2, wind: 10 } };
afterEach(() => vi.useRealTimers());
describe('穿搭历史保留实际天气和温度参考', () => {
  it('显示那天的天气与场景，隐藏各部位保暖温度而保留体感', () => {
    const html = renderToStaticMarkup(<WearDetails record={record} />);
    expect(html).toContain('北京'); expect(html).toContain('雨 · 10–20℃'); expect(html).toContain('有室外');
    expect(html).toContain('舒适'); expect(html).not.toContain('衣物保暖值'); expect(html).not.toContain('上身');
  });
  it('只穿过的记录仍参与温度校准，不需要先保存搭配', () => {
    expect(calibratedItems([item], [record, { ...record, id: 'worn-again' }], context.date)[0].learnedWarmth).toBe(2.5);
    expect(record.items[0].warmth).toBe(4);
  });
  it('补记旧记录不把今天的天气和室内温度填到过去', () => {
    const draft = createWearDraft({ ...context, date: '2026-10-25', indoorTemperature: 25 }, record.weather, [], { ...record, weather: null, indoorTemperature: undefined });
    expect(draft.weather).toBeNull(); expect(draft.indoorTemperature).toBeNull(); expect(draft.context.date).toBe('2026-10-21');
  });
  it('出游不会继承常住城市或未来 GPS，手动当天城市优先', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T01:00:00Z'));
    const day = { locations: [], travel: true };
    expect(linkedClothesContext(context, day).location).toBeNull();
    expect(linkedClothesContext({ ...context, date: '2026-10-27', location: { ...context.location, source: 'geo' } }, day).location).toBeNull();
    expect(linkedClothesContext({ ...context, location: { ...context.location, source: 'manual' } }, day).location?.name).toBe('北京');
  });
});
