import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './_bonClothesRoute';
import dispatcher from './outlook-calendar';
import { ITEMS_KEY, CONTEXTS_KEY, WEAR_KEY, SAVE_CLOTHES, readClothesCalendar, readWeather, receiptKey, photoKey } from './_bonClothes';
import { photoInput } from './_clothesValidation';
import { readClothesTrips, readTripForecast, TRIP_PLANS_KEY } from './_clothesTrips';
import { encryptOutlookConnection } from './_outlookCalendar';
import { OUTLOOK_CONNECTION_KEY } from './_outlookSync';
import { parseOutlookCalendar } from './_outlookCalendar';
import { emptyContext } from '../src/clothes/rules';
import { CATEGORIES, type ClothesItem } from '../src/clothes/types';

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
const pngPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
function webpPhoto(width = 960, height = 800, kind = 'VP8X') {
  const chunk = (type: string, payload: Buffer) => {
    const result = Buffer.alloc(8 + payload.length + payload.length % 2);
    result.write(type); result.writeUInt32LE(payload.length, 4); payload.copy(result, 8); return result;
  };
  const vp8 = Buffer.alloc(10); Buffer.from([0x9d, 1, 0x2a]).copy(vp8, 3);
  vp8.writeUInt16LE(width, 6); vp8.writeUInt16LE(height, 8);
  const vp8l = Buffer.alloc(5); vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((width - 1) | ((height - 1) << 14) | (1 << 28)) >>> 0, 1);
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x10;
  vp8x.writeUIntLE(width - 1, 4, 3); vp8x.writeUIntLE(height - 1, 7, 3);
  const chunks = kind === 'VP8X' ? [chunk('VP8X', vp8x), chunk('ALPH', Buffer.from([0, 255])), chunk('VP8 ', vp8)]
    : [chunk(kind, kind === 'VP8L' ? vp8l : vp8)];
  const data = Buffer.concat([Buffer.from('RIFF0000WEBP'), ...chunks]); data.writeUInt32LE(data.length - 8, 4);
  return `data:image/webp;base64,${data.toString('base64')}`;
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
    expect(payload).toEqual({ items: [], context: null, records: [], outfits: [], wearCounts: {} });
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
  it('透明 PNG、WebP 和旧 JPEG 按实际格式保存并鉴权读取', async () => {
    for (const photo of [pngPhoto, webpPhoto(), webpPhoto(800, 960, 'VP8L'), webpPhoto(800, 960, 'VP8 '), jpeg()]) {
      expect(photoInput(photo)).toBe(photo);
      data.set(photoKey(item.photoId), photo);
      const result = await call('GET', { view: 'photo', id: item.photoId });
      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe(photo.slice(5, photo.indexOf(';')));
      expect(result.body).toEqual(Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64'));
    }
    const saved = await call('POST', {}, { action: 'save-item', item: { ...item, revision: '' }, photo: pngPhoto, mutationId: uid('transparent') });
    expect(saved.status).toBe(200); expect(saved.body.value.photoId).toBe(uid('transparent'));
    expect(evalMock.mock.calls[0][2][4]).toBe(pngPhoto);
  });
  it('拒绝伪造 MIME、超尺寸、截断及动画容器', () => {
    expect(() => photoInput(pngPhoto.replace('image/png', 'image/jpeg'))).toThrow();
    expect(() => photoInput(webpPhoto().replace('image/webp', 'image/png'))).toThrow();
    for (const kind of ['VP8X', 'VP8L', 'VP8 ']) expect(() => photoInput(webpPhoto(961, 800, kind))).toThrow('960');
    const png = Buffer.from(pngPhoto.split(',')[1], 'base64'); png.writeUInt32BE(961, 16);
    expect(() => photoInput(`data:image/png;base64,${png.toString('base64')}`)).toThrow('960');
    const webp = Buffer.from(webpPhoto().split(',')[1], 'base64');
    webp[20] |= 2;
    expect(() => photoInput(`data:image/webp;base64,${webp.toString('base64')}`)).toThrow();
    for (const photo of [pngPhoto, webpPhoto()]) {
      const [header, encoded] = photo.split(',');
      const data = Buffer.from(encoded, 'base64').subarray(0, -3);
      expect(() => photoInput(`${header},${data.toString('base64')}`)).toThrow();
      expect(() => photoInput(`${header},${Buffer.alloc(205000).toString('base64')}`)).toThrow('200KB');
    }
  });
  it('保存逐项使用 CAS 和同一事务照片，不触碰财务键', async () => {
    const result = await call('POST', {}, { action: 'save-item', item: { ...item, revision: '', name: '' }, photo: jpeg(), mutationId: uid('mutation') });
    expect(result.status).toBe(200); expect(result.body.value.name).toBe('白色上衣');
    expect(evalMock.mock.calls[0][0]).toBe(SAVE_CLOTHES);
    expect(evalMock.mock.calls[0][1].every((key: string) => !key || key.startsWith('bonclothes:'))).toBe(true);
    expect(evalMock.mock.calls[0][2][4]).toBe(jpeg());
  });
  it('各层分类可保存，文胸选项校验并兼容旧上装', async () => {
    for (const category of CATEGORIES) {
      const result = await call('POST', {}, { action: 'save-item', item: { ...item, id: uid(`layer${CATEGORIES.indexOf(category)}`), category, revision: '', braRequirement: 'optional' }, photo: jpeg(), mutationId: uid(`save${CATEGORIES.indexOf(category)}`) });
      expect(result.status).toBe(200);
      expect(result.body.value.category).toBe(category);
      expect(result.body.value.braRequirement).toBe(['上衣', '连衣裙'].includes(category) ? 'optional' : undefined);
    }
    const legacy = await call('POST', {}, { action: 'save-item', item: { ...item, revision: '' }, photo: jpeg(), mutationId: uid('legacy') });
    expect(legacy.body.value).toMatchObject({ category: '上衣', name: item.name, braRequirement: 'required' });
    const invalid = await call('POST', {}, { action: 'save-item', item: { ...item, braRequirement: 'wrong' }, mutationId: uid('invalid') });
    expect(invalid.status).toBe(400);
  });
  it('七件分层搭配可确认、保存计划，历史保留文胸要求快照', async () => {
    const layers = CATEGORIES.filter((category) => category !== '连衣裙').map((category, i) => ({ ...item, id: uid(`layer${i}`), category, braRequirement: 'optional' as const }));
    hashes.set(ITEMS_KEY, Object.fromEntries(layers.map((piece) => [piece.id, piece])));
    const body = { action: 'confirm', context, items: layers.map(({ id, revision }) => ({ id, revision })), revision: '', weather: null, mutationId: uid('layers-confirm') };
    const first = await call('POST', {}, body); expect(first.status).toBe(200); expect(first.body.value.items).toHaveLength(7);
    expect((await call('POST', {}, body)).body).toEqual(first.body);
    const plan = { tripId: 'trip:2026-10-05', revision: '', title: '出游', startDate: context.date, endDate: context.date, location: null,
      days: { [context.date]: { scene: context.scene, active: false, itemIds: layers.map((piece) => piece.id) } } };
    expect((await call('POST', {}, { action: 'save-trip-plan', plan, mutationId: uid('layers-plan') })).status).toBe(200);
    hashes.set(ITEMS_KEY, {});
    const history = await call('GET', { view: 'history', date: context.date });
    expect(history.body.records[0].items).toEqual(layers);
  });
  it('旧上装与新上衣不能重复穿，内衣可与连衣裙叠穿', async () => {
    const inner = { ...item, id: uid('inner'), category: '内衣' };
    const top = { ...item, id: uid('top'), category: '上衣' };
    const dress = { ...item, id: uid('dress'), category: '连衣裙' };
    hashes.set(ITEMS_KEY, { [item.id]: item, [inner.id]: inner, [top.id]: top, [dress.id]: dress });
    const confirm = (selected: typeof inner[], mutation: string) => call('POST', {}, { action: 'confirm', context, items: selected.map(({ id, revision }) => ({ id, revision })), revision: '', weather: null, mutationId: uid(mutation) });
    expect((await confirm([item, top], 'duplicate')).status).toBe(400);
    expect((await confirm([top, dress], 'dress-top')).status).toBe(400);
    expect((await confirm([inner, dress], 'inner-dress')).status).toBe(200);
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
  it('确认时衣物变为收起或事务中更新都拒绝保存', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: { ...item, status: '收起' } });
    const body = { action: 'confirm', context, items: [{ id: item.id, revision: item.revision }], revision: '', weather: null, mutationId: uid('confirm') };
    expect((await call('POST', {}, body)).status).toBe(409); expect(evalMock).not.toHaveBeenCalled();
    hashes.set(ITEMS_KEY, { [item.id]: item }); evalMock.mockResolvedValueOnce([-2, '']);
    expect((await call('POST', {}, body)).body.wardrobeChanged).toBe(true);
  });
  it('新记录同一天保留多套，用途和体感可独立修改，重试不会重复新增', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: item });
    const body = { action: 'confirm', recordId: uid('wear-one'), context: { ...context, scene: null, active: null },
      items: [{ id: item.id, revision: item.revision }], revision: '', weather: null, mutationId: uid('wear-save-one'),
      purpose: '休闲', indoor: '偏冷', outdoor: '舒适', time: '09:00' };
    const first = await call('POST', {}, body);
    expect(first.status).toBe(200);
    expect((await call('POST', {}, body)).body).toEqual(first.body);
    const second = await call('POST', {}, { ...body, recordId: uid('wear-two'), mutationId: uid('wear-save-two'), purpose: '运动', time: '18:00' });
    expect(second.status).toBe(200);
    const changed = await call('POST', {}, { ...body, revision: first.body.value.revision, mutationId: uid('wear-edit'), indoor: '舒适', outdoor: '偏热' });
    expect(changed.status).toBe(200);
    const history = await call('GET', { view: 'history', date: context.date });
    expect(history.body.records).toHaveLength(2);
    expect(history.body.records.find((record: any) => record.id === body.recordId)).toMatchObject({ indoor: '舒适', outdoor: '偏热', purpose: '休闲' });
    expect((await call('POST', {}, { ...body, mutationId: uid('wear-stale') })).status).toBe(409);
  });
  it('旧日期记录能补体感；衣物已删除仍保留原穿搭快照', async () => {
    hashes.set(WEAR_KEY, { [context.date]: { date: context.date, revision: uid('legacy'), items: [item], context, weather: null, confirmedAt: '2026-10-05T00:00:00Z' } });
    const body = { action: 'confirm', recordId: context.date, context, revision: uid('legacy'), mutationId: uid('legacy-edit'),
      items: [{ id: item.id, revision: item.revision }], weather: null, purpose: '见重要的人', time: '10:00', indoor: null, outdoor: '偏冷' };
    expect((await call('POST', {}, body)).status).toBe(200);
    expect(Object.keys(hashes.get(WEAR_KEY)!)).toEqual([context.date]);
    expect(evalMock.mock.calls[0][2][5]).toBe('[]');
    expect(hashes.get(WEAR_KEY)![context.date].items).toEqual([item]);
    expect(hashes.get(WEAR_KEY)![context.date].indoorCoat).toBeUndefined();
  });
  it('每套单独保存室内外套状态，编辑回填与旧客户端更新均保留明确选择', async () => {
    const coat = { ...item, id: uid('coat'), category: '外套' as const, warmth: 4 };
    hashes.set(ITEMS_KEY, { [item.id]: item, [coat.id]: coat });
    const body = { action: 'confirm', recordId: uid('coat-wear-one'), context, revision: '', mutationId: uid('coat-save-one'),
      items: [item, coat].map(({ id, revision }) => ({ id, revision })), weather: null, purpose: '休闲', time: '10:00', indoor: '舒适', outdoor: '偏冷' };
    const first = await call('POST', {}, { ...body, indoorCoat: false });
    expect(first.status).toBe(200);
    expect(first.body.value).toMatchObject({ indoorCoat: false, indoor: '舒适', outdoor: '偏冷', items: [item, coat] });
    expect((await call('POST', {}, { ...body, indoorCoat: false })).body).toEqual(first.body);
    await call('POST', {}, { ...body, recordId: uid('coat-wear-two'), mutationId: uid('coat-save-two'), indoorCoat: false });
    const changed = await call('POST', {}, { ...body, revision: first.body.value.revision, mutationId: uid('coat-edit'), indoorCoat: true });
    expect(changed.body.value.indoorCoat).toBe(true);
    const legacy = await call('POST', {}, { ...body, revision: changed.body.value.revision, mutationId: uid('coat-old-client') });
    expect(legacy.body.value.indoorCoat).toBe(true);
    const history = await call('GET', { view: 'history', date: context.date });
    expect(history.body.records.find((record: any) => record.id === uid('coat-wear-one')).indoorCoat).toBe(true);
    expect(history.body.records.find((record: any) => record.id === uid('coat-wear-two')).indoorCoat).toBe(false);
  });
  it('用途必须选择，体感及时间必须有效，不接受非法保暖值', async () => {
    const body = { action: 'confirm', recordId: uid('wear'), context, revision: '', mutationId: uid('wear-save'),
      items: [{ id: item.id, revision: item.revision }], weather: null, purpose: '休闲', time: '10:00', indoor: null, outdoor: null };
    for (const patch of [{ kind: 'unknown' }, { kind: null }, { purpose: undefined }, { purpose: '' }, { indoor: '错误' }, { outdoor: 26 }, { time: '24:00' }, { indoorCoat: 'false' }, { indoorCoat: null }, { indoorCoat: 1 }]) {
      expect((await call('POST', {}, { ...body, ...patch })).status).toBe(400);
    }
    for (const warmth of [-1, 41, '3']) expect((await call('POST', {}, { action: 'save-item', item: { ...item, warmth }, mutationId: uid('invalid-warmth') })).status).toBe(400);
    expect(evalMock).not.toHaveBeenCalled();
  });
  it('待洗旧数据按可穿读取及保存，保暖值可以为零或小数', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: { ...item, status: '待洗' } });
    expect((await call('GET', { date: context.date })).body.items[0].status).toBe('可穿');
    const result = await call('POST', {}, { action: 'save-item', item: { ...item, status: '待洗', warmth: .5 }, mutationId: uid('warmth-save') });
    expect(result.status).toBe(200);
    expect(result.body.value).toMatchObject({ warmth: .5, status: '可穿' });
  });
  it('历史按整天分页，同一天多于30套也不会漏掉', async () => {
    hashes.set(WEAR_KEY, Object.fromEntries(Array.from({ length: 35 }, (_, i) => [uid(`wear-${i}-`), { id: uid(`wear-${i}-`), date: context.date, confirmedAt: '2026-10-05T00:00:00Z', items: [item] }])));
    expect((await call('GET', { view: 'history', date: context.date })).body.records).toHaveLength(35);
  });
  it('搭了按套独立保存、重试幂等，穿这套新增记录而保留原搭配', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: item });
    const body = { action: 'confirm', recordId: uid('styled-one'), kind: 'styled', context, revision: '', mutationId: uid('styled-save'),
      items: [{ id: item.id, revision: item.revision }], weather: null, purpose: '见朋友', time: '10:00', indoor: '偏冷', outdoor: '舒适' };
    const first = await call('POST', {}, body);
    expect(first.status).toBe(200);
    expect(first.body.value).toMatchObject({ kind: 'styled', indoor: null, outdoor: null, items: [item] });
    expect((await call('POST', {}, body)).body).toEqual(first.body);
    expect(evalMock).toHaveBeenCalledTimes(1);
    const worn = await call('POST', {}, { ...body, kind: undefined, recordId: uid('actually-worn'), mutationId: uid('actually-worn-save') });
    expect(worn.body.value.kind).toBe('worn');
    const loaded = await call('GET', { date: context.date });
    expect(loaded.body.outfits).toEqual([first.body.value]);
    expect(loaded.body.records).toEqual([worn.body.value]);
    expect(loaded.body.wearCounts).toEqual({ [item.id]: 1 });
    expect((await call('GET', { view: 'history', date: context.date })).body.records).toEqual([worn.body.value]);
  });
  it('保存的搭配不受穿着历史分页限制，衣物删除仍保留整套快照', async () => {
    hashes.set(WEAR_KEY, Object.fromEntries(Array.from({ length: 35 }, (_, i) => {
      const date = new Date(Date.parse('2026-10-05') - i * 86400000).toISOString().slice(0, 10);
      return [uid(`wear-${i}-`), { id: uid(`wear-${i}-`), date, confirmedAt: `${date}T00:00:00Z`, items: [item] }];
    })));
    hashes.get(WEAR_KEY)![uid('old-styled')] = { id: uid('old-styled'), kind: 'styled', date: '2025-01-01', confirmedAt: '2025-01-01T00:00:00Z', items: [item] };
    const result = await call('GET', { date: context.date });
    expect(result.body.records).toHaveLength(30);
    expect(result.body.outfits).toMatchObject([{ id: uid('old-styled'), items: [item] }]);
    expect(result.body.items).toEqual([]);
    expect(result.body.wearCounts).toEqual({ [item.id]: 35 });
  });
  it('编辑可切换穿了和搭了，旧客户端编辑保留搭配状态并检查并发冲突', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: item });
    const body = { action: 'confirm', recordId: uid('switch-kind'), context, revision: '', mutationId: uid('switch-worn'),
      items: [{ id: item.id, revision: item.revision }], weather: null, purpose: '休闲', time: '10:00', indoor: null, outdoor: null };
    const first = await call('POST', {}, body);
    const styled = await call('POST', {}, { ...body, revision: first.body.value.revision, kind: 'styled', mutationId: uid('switch-styled') });
    expect(styled.body.value.kind).toBe('styled');
    const legacyEdit = await call('POST', {}, { ...body, revision: styled.body.value.revision, mutationId: uid('styled-old-client') });
    expect(legacyEdit.body.value.kind).toBe('styled');
    expect((await call('GET', { date: context.date })).body.records).toEqual([]);
    expect((await call('POST', {}, { ...body, revision: first.body.value.revision, kind: 'worn', mutationId: uid('stale-kind-edit') })).status).toBe(409);
    const worn = await call('POST', {}, { ...body, revision: legacyEdit.body.value.revision, kind: 'worn', mutationId: uid('back-to-worn') });
    expect(worn.status).toBe(200);
    expect((await call('GET', { date: context.date })).body.outfits).toEqual([]);
  });
  it('睡衣标签保存回读，睡觉穿搭可单独记录室内体感', async () => {
    const saved = await call('POST', {}, { action: 'save-item', item: { ...item, revision: '', sleepwear: true }, mutationId: uid('sleep-item') });
    expect(saved.status).toBe(200);
    expect((await call('GET', { date: context.date })).body.items[0].sleepwear).toBe(true);
    const record = await call('POST', {}, { action: 'confirm', recordId: uid('sleep-record'), context, revision: '', mutationId: uid('sleep-wear'),
      items: [{ id: item.id, revision: saved.body.value.revision }], weather: null, purpose: '睡觉', time: '23:00', indoor: '舒适', outdoor: null, indoorCoat: false });
    expect(record.status).toBe(200);
    expect(record.body.value).toMatchObject({ purpose: '睡觉', indoor: '舒适', outdoor: null, items: [{ sleepwear: true }] });
    expect((await call('POST', {}, { action: 'save-item', item: { ...item, sleepwear: 'true' }, mutationId: uid('invalid-sleep') })).status).toBe(400);
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
  it('推荐用途可保存回读，旧条件兼容且非法用途不落库', async () => {
    const result = await call('POST', {}, { action: 'save-context', context: { ...context, purpose: '休闲' }, mutationId: uid('casual-context') });
    expect(result.status).toBe(200);
    expect((await call('GET', { date: context.date })).body.context.purpose).toBe('休闲');
    for (const purpose of ['invalid', 1, '睡觉']) {
      expect((await call('POST', {}, { action: 'save-context', context: { ...context, purpose }, mutationId: uid('bad-purpose') })).status).toBe(400);
    }
  });
});
describe('天气、Outlook 和设备时区', () => {
  it('明日天气使用当天逐日预报，不把当前实况当成明天气温', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T01:00:00Z'));
    const fetchMock = vi.fn(async (_url: URL) => new Response(JSON.stringify({ current: { temperature_2m: 40 }, daily: {
      time: ['2026-10-06'], temperature_2m_min: [12], temperature_2m_max: [21], apparent_temperature_min: [10], apparent_temperature_max: [20], precipitation_sum: [2], wind_speed_10m_max: [15],
    } })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await call('GET', { view: 'weather', date: '2026-10-06', timezone: 'Asia/Shanghai', latitude: '30', longitude: '120' });
    expect(result.status).toBe(200);
    expect(result.body.weather).toMatchObject({ date: '2026-10-06', temperature: 21, min: 12, max: 21, apparentMin: 10, precipitation: 2 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('start_date=2026-10-06');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('current=');
  });
  it('明日条件和成套搭配独立保存，不覆盖今天记录', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: item });
    const nextContext = { ...context, date: '2026-10-06', scene: '有室外' };
    await call('POST', {}, { action: 'save-context', context, mutationId: uid('today-context') });
    await call('POST', {}, { action: 'save-context', context: nextContext, mutationId: uid('tomorrow-context') });
    const body = { action: 'confirm', recordId: uid('today-outfit'), context, revision: '', mutationId: uid('today-worn'),
      items: [{ id: item.id, revision: item.revision }], weather: null, purpose: '休闲', time: '10:00', indoor: null, outdoor: null };
    const todayRecord = await call('POST', {}, body);
    const tomorrowRecord = await call('POST', {}, { ...body, context: nextContext, kind: 'styled', recordId: uid('tomorrow-outfit'), mutationId: uid('tomorrow-styled') });
    expect(tomorrowRecord.status).toBe(200);
    const todayResult = await call('GET', { date: context.date });
    const tomorrowResult = await call('GET', { date: nextContext.date });
    expect(todayResult.body.context.scene).toBe('基本室内');
    expect(tomorrowResult.body.context.scene).toBe('有室外');
    expect(todayResult.body.records).toEqual([todayRecord.body.value]);
    expect(todayResult.body.outfits).toEqual([tomorrowRecord.body.value]);
    expect(tomorrowResult.body.outfits).toEqual(todayResult.body.outfits);
  });
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

describe('出行预报与计划接口', () => {
  const city = { name: '杭州', latitude: 30, longitude: 120, source: 'manual' as const, timezone: 'Asia/Shanghai' };
  const plan = { tripId: 'trip:2026-10-05', revision: '', title: '杭州', startDate: '2026-10-05', endDate: '2026-10-06', location: city,
    days: { '2026-10-05': { scene: '基本室内', active: false, itemIds: [item.id] } } };
  it('未来使用逐日预报，只查询16天范围，缓存与失败回退独立于今日天气', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T01:00:00Z'));
    const fetchMock = vi.fn(async (_url: URL) => new Response(JSON.stringify({ current: { temperature_2m: 40 }, daily: {
      time: ['2026-10-19', '2026-10-20'], temperature_2m_min: [10, 11], temperature_2m_max: [20, 21], apparent_temperature_min: [9, 10], apparent_temperature_max: [19, 20], precipitation_sum: [0, 3], wind_speed_10m_max: [12, 20],
    } })));
    vi.stubGlobal('fetch', fetchMock);
    const first = await readTripForecast(city, '2026-10-19', '2026-10-25', city.timezone);
    expect(Object.keys(first.days)).toEqual(['2026-10-19', '2026-10-20']); expect(first.days['2026-10-19'].temperature).toBe(20);
    const url = String(fetchMock.mock.calls[0][0]); expect(url).toContain('end_date=2026-10-20'); expect(url).not.toContain('current=');
    await readTripForecast(city, '2026-10-19', '2026-10-25', city.timezone); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await readTripForecast(city, '2026-11-01', '2026-11-03', city.timezone)).days).toEqual({}); expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-05T01:31:00Z')); fetchMock.mockRejectedValue(new Error('offline'));
    expect(await readTripForecast(city, '2026-10-19', '2026-10-25', city.timezone)).toMatchObject({ days: first.days, stale: true });
    expect((await readTripForecast({ ...city, latitude: 40 }, '2026-10-19', '2026-10-20', city.timezone)).days).toEqual({});
  });
  it('保存计划独立 CAS、幂等，并不确认实际穿搭或写入日历', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: item });
    const body = { action: 'save-trip-plan', plan, mutationId: uid('trip-save') };
    const saved = await call('POST', {}, body); expect(saved.status).toBe(200); expect(saved.body.value.location.timezone).toBe(city.timezone);
    expect((await call('POST', {}, body)).body).toEqual(saved.body); expect(evalMock).toHaveBeenCalledTimes(1);
    expect((await call('POST', {}, { ...body, mutationId: uid('trip-conflict') })).status).toBe(409);
    expect(hashes.has(TRIP_PLANS_KEY)).toBe(true); expect(hashes.has(WEAR_KEY)).toBe(false);
    expect(evalMock.mock.calls.every((call) => call[1].every((key: string) => !key || key.startsWith('bonclothes:')))).toBe(true);
  });
  it('不接受收起、不方便运动的单品或超出行程日期的计划', async () => {
    hashes.set(ITEMS_KEY, { [item.id]: { ...item, status: '收起' } });
    const body = { action: 'save-trip-plan', plan, mutationId: uid('trip-save') };
    expect((await call('POST', {}, body)).status).toBe(409);
    hashes.set(ITEMS_KEY, { [item.id]: { ...item, active: false } });
    expect((await call('POST', {}, { ...body, plan: { ...plan, days: { '2026-10-05': { ...plan.days['2026-10-05'], active: true } } } })).status).toBe(400);
    expect((await call('POST', {}, { ...body, plan: { ...plan, endDate: '2026-10-04' } })).status).toBe(400);
    expect(evalMock).not.toHaveBeenCalled();
  });
  it('行程消失保留计划，Outlook 失败仍能读取已有出游', async () => {
    data.set('calendar-tags', { tagMap: { '2026-10-06': 'travel' } }); data.set('trip-tags', { tripTags: { '2026-10-06': '杭州' } });
    hashes.set(TRIP_PLANS_KEY, { [plan.tripId]: plan });
    vi.stubEnv('SYNC_SECRET', 'test-only-secret');
    data.set(OUTLOOK_CONNECTION_KEY, { id: 'test', encrypted: encryptOutlookConnection({ playUrl: 'https://outlook.live.com/owa/calendar/example/test.ics', classUrl: '', policy: 'manual', rules: { homeTitles: [], ignoredPlayTitles: [] } }, 'test-only-secret') });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await readClothesTrips('2026-10-05', 'Asia/Shanghai');
    expect(result.calendarError).toBe('日历更新失败'); expect(result.trips.find((trip) => trip.id === plan.tripId)?.archived).toBe(true);
    expect(result.trips.some((trip) => trip.title === '杭州')).toBe(true); expect(evalMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

vi.mock('./_accountRoute.js', () => ({ withAccountScope: (handler: unknown) => handler }));
