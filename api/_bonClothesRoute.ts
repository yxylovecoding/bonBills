import { withAccountScope } from './_accountRoute.js';
import { kv } from './_accountKv.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authOk, sameOrigin } from './_auth.js';
import { CONTEXTS_KEY, ITEMS_KEY, WEAR_KEY, SAVE_CLOTHES, photoKey, receiptKey, signature, readClothesCalendar, readWeather, searchCities } from './_bonClothes.js';
import { ClothesInputError, contextInput, dateInput, id, itemInput, locationInput, photoData, photoInput, requireInput, timezoneInput, validLayers } from './_clothesValidation.js';
import { CATEGORIES, PURPOSES, SENSATIONS, type ClothesDayContext, type ClothesItem, type WearRecord, type WeatherSnapshot } from '../src/clothes/types.js';
import { normalizeItem, wearable } from '../src/clothes/warmth.js';
import { TRIP_PLANS_KEY, readClothesTrips, readTripForecast, tripPlanInput } from './_clothesTrips.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效' });
  try {
    if (!await authOk(req)) return res.status(401).json({ error: '请先登录' });
    if (req.method === 'GET') {
      if (req.query.view === 'photo') {
        const photo = await kv.get<string>(photoKey(id(req.query.id)));
        if (!photo) return res.status(404).json({ error: '照片不存在' });
        const { mime, data } = photoData(photo);
        res.setHeader('Content-Type', mime);
        return res.status(200).send(data);
      }
      if (req.query.view === 'cities') {
        requireInput(typeof req.query.q === 'string' && req.query.q.trim().length >= 2 && req.query.q.length <= 120, '请输入城市名');
        return res.status(200).json({ cities: await searchCities(req.query.q.trim()) });
      }
      const date = dateInput(req.query.date);
      if (req.query.view === 'trips') return res.status(200).json(await readClothesTrips(date, timezoneInput(req.query.timezone)));
      if (req.query.view === 'forecast') {
        const location = locationInput({ name: '行程目的地', latitude: Number(req.query.latitude), longitude: Number(req.query.longitude), source: 'manual' });
        return res.status(200).json(await readTripForecast(location!, date, dateInput(req.query.endDate), timezoneInput(req.query.timezone)));
      }
      if (req.query.view === 'calendar') return res.status(200).json(await readClothesCalendar(date, timezoneInput(req.query.timezone)));
      if (req.query.view === 'weather') {
        const location = locationInput({ name: '天气地点', latitude: Number(req.query.latitude), longitude: Number(req.query.longitude), source: 'manual' });
        return res.status(200).json(await readWeather(location!, date, timezoneInput(req.query.timezone)));
      }
      const allRecords = Object.values(await kv.hgetall<Record<string, WearRecord>>(WEAR_KEY) ?? {})
        .filter((record) => record.date <= date).sort((a, b) => b.date.localeCompare(a.date) || b.confirmedAt.localeCompare(a.confirmedAt));
      // Paginate whole dates so a busy day is never split or silently skipped.
      const dates = [...new Set(allRecords.map((record) => record.date))].slice(0, 30);
      const records = allRecords.filter((record) => dates.includes(record.date));
      if (req.query.view === 'history') return res.status(200).json({ records });
      const [items, context] = await Promise.all([kv.hgetall<Record<string, ClothesItem>>(ITEMS_KEY), kv.hget<ClothesDayContext>(CONTEXTS_KEY, date)]);
      return res.status(200).json({ items: Object.values(items ?? {}).filter((item) => !item.deleted).map(normalizeItem), context, records });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: '请求方式无效' });
    let body: Record<string, any>;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw new ClothesInputError('请求内容无效'); }
    requireInput(body && typeof body === 'object' && !Array.isArray(body), '请求内容无效');
    requireInput(JSON.stringify(body).length <= 300000, '请求过大');
    const mutationId = id(body.mutationId), sig = signature(body);
    const receipt = await kv.get<{ signature: string; value: unknown }>(receiptKey(mutationId));
    if (receipt) {
      requireInput(receipt.signature === sig, '请重新提交本次修改');
      return res.status(200).json({ value: receipt.value });
    }
    let key: string, field: string, expected: string, value: unknown, photo = '', photoStorage = '';
    let checks: { id: string; revision: string }[] = [];
    if (body.action === 'save-item') {
      const item = itemInput(body.item);
      key = ITEMS_KEY; field = item.id; expected = item.revision;
      if (body.photo) { photo = photoInput(body.photo); item.photoId = mutationId; }
      requireInput(item.photoId, '请添加照片');
      photoStorage = photoKey(item.photoId);
      value = { ...item, revision: mutationId };
    } else if (body.action === 'delete-item') {
      key = ITEMS_KEY; field = id(body.id); expected = id(body.revision);
      value = { id: field, revision: mutationId, deleted: true };
    } else if (body.action === 'save-context') {
      const context = contextInput(body.context);
      key = CONTEXTS_KEY; field = context.date; expected = context.revision;
      value = { ...context, revision: mutationId };
    } else if (body.action === 'save-trip-plan') {
      const plan = tripPlanInput(body.plan);
      key = TRIP_PLANS_KEY; field = plan.tripId; expected = plan.revision;
      const selected = [...new Set(Object.values(plan.days).flatMap((day) => day.itemIds ?? []))];
      const items = await Promise.all(selected.map((id) => kv.hget<ClothesItem>(ITEMS_KEY, id)));
      if (items.some((item) => !item || !wearable(item))) return res.status(409).json({ error: '衣柜已更新，请刷新后重新选择', wardrobeChanged: true });
      for (const day of Object.values(plan.days)) {
        const pieces = items.filter((item) => day.itemIds?.includes(item!.id));
        requireInput(validLayers(pieces as ClothesItem[])
          && (!day.active || pieces.every((item) => item!.active)), '搭配不符合行程条件');
      }
      checks = items.map((item) => ({ id: item!.id, revision: item!.revision }));
      value = { ...plan, revision: mutationId };
    } else if (body.action === 'confirm') {
      const context = contextInput(body.context);
      key = WEAR_KEY; expected = id(body.revision, true);
      const manual = body.recordId !== undefined;
      // Date keys keep old records and older clients editable during rollout.
      field = manual ? (body.recordId === context.date ? context.date : id(body.recordId)) : context.date;
      const previous = await kv.hget<WearRecord>(WEAR_KEY, field);
      requireInput(!previous || previous.date === context.date, '穿搭日期不一致');
      if (manual) {
        requireInput(PURPOSES.includes(body.purpose), '请选择用途');
        requireInput([body.indoor, body.outdoor].every((value) => value === null || SENSATIONS.includes(value)), '请选择室内外体感');
        requireInput(typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time), '穿着时间无效');
        requireInput(body.indoorCoat === undefined || typeof body.indoorCoat === 'boolean', '室内外套状态无效');
      }
      requireInput(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= (manual ? 24 : CATEGORIES.length), '请选择穿搭');
      checks = body.items.map((item: { id: unknown; revision: unknown }) => ({ id: id(item.id), revision: id(item.revision) }));
      requireInput(new Set(checks.map((item) => item.id)).size === checks.length, '衣物重复');
      const currentItems = await Promise.all(checks.map((check) => kv.hget<ClothesItem>(ITEMS_KEY, check.id)));
      const retained = new Set<string>();
      const items = currentItems.map((item, i) => {
        const check = checks[i];
        const snapshot = manual && previous?.items.find((piece) => piece.id === check.id && piece.revision === check.revision);
        if (snapshot) { retained.add(check.id); return snapshot; }
        return item && wearable(item) && item.revision === check.revision ? normalizeItem(item) : null;
      });
      if (items.some((item) => !item)) return res.status(409).json({ error: '衣柜已更新，请刷新后重新选择', wardrobeChanged: true });
      checks = checks.filter((check) => !retained.has(check.id));
      // Actual outfits may contain multiple layers or differ from recommendations.
      if (!manual) requireInput(validLayers(items as ClothesItem[])
        && (!context.active || items.every((item) => item!.active)), '搭配不符合当天条件');
      let weather: WeatherSnapshot | null = null;
      if (body.weather !== null) {
        const w = body.weather as WeatherSnapshot;
        requireInput(w && w.date === context.date && w.timezone === context.timezone
          && ['temperature', 'apparent', 'min', 'max', 'apparentMin', 'precipitation', 'wind', 'latitude', 'longitude']
            .every((key) => typeof w[key as keyof WeatherSnapshot] === 'number' && Number.isFinite(w[key as keyof WeatherSnapshot]))
          && typeof w.fetchedAt === 'string' && w.fetchedAt.length <= 40, '天气快照无效');
        weather = Object.fromEntries(['date', 'timezone', 'latitude', 'longitude', 'fetchedAt', 'temperature', 'apparent', 'min', 'max', 'apparentMin', 'precipitation', 'wind'].map((key) => [key, w[key as keyof WeatherSnapshot]])) as unknown as WeatherSnapshot;
      }
      value = { ...(manual ? { id: field, purpose: body.purpose, indoor: body.indoor, outdoor: body.outdoor, time: body.time,
        ...(body.indoorCoat !== undefined || previous?.indoorCoat !== undefined ? { indoorCoat: body.indoorCoat ?? previous?.indoorCoat } : {}) } : {}), date: context.date, revision: mutationId, confirmedAt: previous?.confirmedAt ?? new Date().toISOString(), items, context, weather };
    } else throw new ClothesInputError('操作无效');
    const [ok, raw] = await kv.eval<string[], [number, string | unknown]>(SAVE_CLOTHES,
      [key, receiptKey(mutationId), ITEMS_KEY, photoStorage],
      [field, expected, mutationId, JSON.stringify(value), photo, JSON.stringify(checks), sig]);
    const stored = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw;
    if (ok === -3) throw new ClothesInputError('请重新提交本次修改');
    if (ok === -1) throw new ClothesInputError('照片不存在，请重新上传');
    if (ok === -2) return res.status(409).json({ error: '衣柜已更新，请刷新后重新选择', wardrobeChanged: true });
    if (!ok) return res.status(409).json({ error: '已在其他页面更新，当前编辑已保留', current: stored });
    return res.status(200).json({ value: stored });
  } catch (error) {
    if (error instanceof ClothesInputError) return res.status(400).json({ error: error.message });
    const message = error instanceof Error ? error.message : '';
    if (message === '日历更新失败') return res.status(502).json({ error: message });
    return res.status(503).json({ error: '暂时无法读取或保存，请重试' });
  }
}

export default withAccountScope(handler);
