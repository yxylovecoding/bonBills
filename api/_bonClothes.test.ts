import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './_bonClothesRoute';
import dispatcher from './outlook-calendar';
import { ITEMS_KEY, CONTEXTS_KEY, WEAR_KEY, SAVE_CLOTHES, readClothesCalendar, readWeather, receiptKey } from './_bonClothes';
import { photoInput } from './_clothesValidation';
import { parseOutlookCalendar } from './_outlookCalendar';
import { emptyContext } from '../src/clothes/rules';
import type { ClothesItem } from '../src/clothes/types';

const { data, hashes, auth, origin, evalMock } = vi.hoisted(() => ({ data: new Map<string, any>(), hashes: new Map<string, Record<string, any>>(), auth: vi.fn(), origin: vi.fn(), evalMock: vi.fn() }));
vi.mock('./_auth.js', () => ({ authOk: auth, sameOrigin: origin }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => data.get(key) ?? null,
  set: async (key: string, value: unknown) => { data.set(key, value); }, hgetall: async (key: string) => hashes.get(key) ?? null,
  hget: async (key: string, field: string) => hashes.get(key)?.[field] ?? null, eval: evalMock } }));
const uid = (v: string) => v.padEnd(20, '0');
const context = { ...emptyContext('2026-10-05', 'Asia/Shanghai'), scene: '基本室内' as const, active: false };
const item: ClothesItem = { id: uid('item'), revision: uid('revision'), name: '白色上装', photoId: uid('photo'), category: '上装', color: '白', thickness: 1, active: true, status: '可穿', windproof: false, waterproof: false };
function jpeg(width = 960, height = 800) {
  const buffer = Buffer.from([255, 216, 255, 192, 0, 17, 8, 0, 0, 0, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
  buffer.writeUInt16BE(height, 7); buffer.writeUInt16BE(width, 9);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}
async function call(method: string, query: Record<string, string> = {}, body?: unknown) {
  const result = { status: 200, body: {} as any, headers: {} as Record<string, string> };
  const response = { status(code: number) { result.status = code; return this; }, setHeader(key: string, value: string) { result.headers[key] = value; }, json(value: unknown) { result.body = value; return this; }, send(value: unknown) { result.body = value; return this; } };
  await handler({ method, query, body, headers: {} } as VercelRequest, response as unknown as VercelResponse);
  return result;
}
beforeEach(() => {
  data.clear(); hashes.clear(); auth.mockResolvedValue(true); origin.mockReturnValue(true); evalMock.mockReset();
  evalMock.mockImplementation(async (_script, keys: string[], args: string[]) => {
    const hash = hashes.get(keys[0]) ?? {}, current = hash[args[0]];
    if ((current?.revision ?? '') !== args[1]) return [0, current ? JSON.stringify(current) : ''];
    const value = JSON.parse(args[3]); hash[args[0]] = value; hashes.set(keys[0], hash);
    data.set(keys[1], { signature: args[6], value });
    return [1, args[3]];
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('衣柜与实际穿搭接口', () => {
  it('生产使用现有 Outlook 函数分派到独立衣柜接口', async () => {
    let payload: any;
    const response = { status() { return this; }, setHeader() {}, json(value: unknown) { payload = value; return this; } };
    await dispatcher({ method: 'GET', headers: {}, query: { app: 'bonclothes', date: context.date } } as unknown as VercelRequest, response as unknown as VercelResponse);
    expect(payload).toEqual({ items: [], context: null, records: [] });
  });
  it('未登录和跨站请求不可读照片或修改，方法受限', async () => {
    auth.mockResolvedValue(false); expect((await call('GET', { view: 'photo', id: item.photoId })).status).toBe(401);
    auth.mockResolvedValue(true); origin.mockReturnValue(false); expect((await call('POST', {}, {})).status).toBe(403);
    origin.mockReturnValue(true); expect((await call('PUT')).status).toBe(405);
    expect(evalMock).not.toHaveBeenCalled();
  });
  it('照片校验类型、字节数和真实尺寸', () => {
    expect(photoInput(jpeg())).toBe(jpeg());
    expect(() => photoInput('data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
    expect(() => photoInput(jpeg(961))).toThrow('960');
    expect(() => photoInput(`data:image/jpeg;base64,${Buffer.alloc(205000).toString('base64')}`)).toThrow();
    expect(() => photoInput('data:image/jpeg;base64,YWJjZA==')).toThrow();
  });
  it('保存逐项使用 CAS 和同一事务照片，不触碰财务键', async () => {
    const result = await call('POST', {}, { action: 'save-item', item: { ...item, revision: '', name: '' }, photo: jpeg(), mutationId: uid('mutation') });
    expect(result.status).toBe(200); expect(result.body.value.name).toBe('白色上装');
    expect(evalMock.mock.calls[0][0]).toBe(SAVE_CLOTHES);
    expect(evalMock.mock.calls[0][1].every((key: string) => !key || key.startsWith('bonclothes:'))).toBe(true);
    expect(evalMock.mock.calls[0][2][4]).toBe(jpeg());
  });
  it('并发旧版本返回最新记录；客户端内容不作为成功保存', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: { ...item, revision: uid('newer') } });
    const result = await call('POST', {}, { action: 'save-item', item, mutationId: uid('mutation') });
    expect(result.status).toBe(409); expect(result.body.current.revision).toBe(uid('newer'));
  });
  it('重复请求返回第一次结果，旧请求不会在新版本后重新覆盖', async () => {
    const body = { action: 'save-context', context, mutationId: uid('mutation') };
    const first = await call('POST', {}, body); hashes.get(CONTEXTS_KEY)![context.date].scene = '有室外';
    const repeat = await call('POST', {}, body);
    expect(repeat.status).toBe(200); expect(repeat.body.value.revision).toBe(first.body.value.revision); expect(evalMock).toHaveBeenCalledTimes(1);
    expect((await call('POST', {}, { ...body, context: { ...context, active: true } })).status).toBe(400);
    expect(data.has(receiptKey(uid('mutation')))).toBe(true);
  });
  it('确认保存服务端衣物快照，同日替换，删除衣物后历史可读且不自动待洗', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: item });
    const body = { action: 'confirm', context, items: [{ id: item.id, revision: item.revision }], revision: '', weather: null, mutationId: uid('confirm1') };
    const first = await call('POST', {}, body); expect(first.status).toBe(200);
    expect(hashes.get(ITEMS_KEY)![item.id].status).toBe('可穿');
    expect(evalMock.mock.calls[0][2][5]).toBe(JSON.stringify(body.items));
    expect((await call('POST', {}, { ...body, revision: uid('confirm1'), mutationId: uid('confirm2') })).status).toBe(200);
    hashes.set(ITEMS_KEY, {});
    const history = await call('GET', { view: 'history', date: context.date });
    expect(history.body.records).toHaveLength(1); expect(history.body.records[0].items[0].name).toBe('白色上装');
    expect(Object.keys(hashes.get(WEAR_KEY)!)).toEqual([context.date]);
  });
  it('确认时衣物变为待洗或事务中更新都拒绝保存', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: { ...item, status: '待洗' } });
    const body = { action: 'confirm', context, items: [{ id: item.id, revision: item.revision }], revision: '', weather: null, mutationId: uid('confirm') };
    expect((await call('POST', {}, body)).status).toBe(409); expect(evalMock).not.toHaveBeenCalled();
    hashes.set(ITEMS_KEY, { [item.id]: item }); evalMock.mockResolvedValueOnce([-2, '']);
    expect((await call('POST', {}, body)).body.wardrobeChanged).toBe(true);
  });
  it('断网失败不伪造成功，重试可继续保存', async () => {
    evalMock.mockRejectedValueOnce(new Error('offline'));
    const body = { action: 'save-context', context, mutationId: uid('mutation') };
    expect((await call('POST', {}, body)).status).toBe(503);
    expect((await call('POST', {}, body)).status).toBe(200);
  });
  it('异常输入在存储之前拒绝', async () => {
    for (const body of ['{bad', { action: 'save-context', context: { ...context, date: '2026-02-30' }, mutationId: uid('mutation') },
      { action: 'save-context', context: { ...context, timezone: 'invalid' }, mutationId: uid('mutation') }]) expect((await call('POST', {}, body)).status).toBe(400);
    expect(evalMock).not.toHaveBeenCalled();
  });
});
describe('天气、Outlook 和设备时区', () => {
  it('天气缓存30分钟，过期失败保留旧快照，没有缓存返回空', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T01:00:00Z'));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ current: { temperature_2m: 24, apparent_temperature: 25 },
      daily: { time: [context.date], temperature_2m_min: [18], temperature_2m_max: [27], apparent_temperature_min: [18], precipitation_sum: [0], wind_speed_10m_max: [12] } })));
    vi.stubGlobal('fetch', fetchMock);
    const city = { name: '杭州', latitude: 30, longitude: 120, source: 'manual' as const };
    const first = await readWeather(city, context.date, context.timezone);
    expect(first.stale).toBe(false); await readWeather(city, context.date, context.timezone); expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-05T01:31:00Z')); fetchMock.mockRejectedValue(new Error('offline'));
    const stale = await readWeather(city, context.date, context.timezone); expect(stale.stale).toBe(true); expect(stale.weather).toEqual(first.weather);
    const missing = await readWeather({ ...city, latitude: 40 }, context.date, context.timezone); expect(missing.weather).toBeNull();
  });
  it('未连接日历返回独立状态，不覆盖手填条件', async () => {
    hashes.set(CONTEXTS_KEY, { [context.date]: context });
    expect((await readClothesCalendar(context.date, context.timezone)).connected).toBe(false);
    expect(hashes.get(CONTEXTS_KEY)![context.date]).toEqual(context);
  });
  it('地点可选读取，UTC跨日按设备时区；默认账本行为保持上海时区', () => {
    const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261005T010000Z\r\nDTEND:20261005T020000Z\r\nSUMMARY:电影\r\nLOCATION:杭州\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const options = { includeLocation: true, timezone: 'America/Los_Angeles' };
    expect(parseOutlookCalendar(text, 'play', '2026-10-04', '2026-10-05', false, true, options)[0].location).toBe('杭州');
    expect(parseOutlookCalendar(text, 'play', '2026-10-04', '2026-10-05', false, true)).toEqual([]);
    expect(parseOutlookCalendar(text, 'play', '2026-10-05', '2026-10-06', false, true)[0].location).toBeUndefined();
  });
  it('全天事件不转换日期；浮动时间按设备时区并处理DST', () => {
    const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20260308T033000\r\nDTEND:20260308T043000\r\nSUMMARY:课程\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART;VALUE=DATE:20260308\r\nDTEND;VALUE=DATE:20260309\r\nSUMMARY:徒步\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const events = parseOutlookCalendar(text, 'class', '2026-03-08', '2026-03-09', false, true, { timezone: 'America/New_York' });
    expect(events[0].startDate).toBe('2026-03-08T07:30:00.000Z'); expect(events[1].startDate).toBe('2026-03-08');
  });
});
