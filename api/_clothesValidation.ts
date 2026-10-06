import { BODY_REGIONS, CATEGORIES, COLORS, SCENES, PURPOSES, DAY_PERIODS, SENSATIONS, type WearFeelings, categoryLabel, hasBraRequirement, type ClothesDayContext, type ClothesItem, type ClothesLocation } from '../src/clothes/types.js';
import { isCalendarDate } from '../src/utils/outlookCalendar.js';

import { itemCategories } from '../src/clothes/pairing.js';
import { accessoriesOverlap, normalizeItem } from '../src/clothes/warmth.js';

export class ClothesInputError extends Error {}
export function requireInput(ok: unknown, message = '内容无效'): asserts ok { if (!ok) throw new ClothesInputError(message); }
export function id(value: unknown, empty = false): string {
  requireInput(typeof value === 'string' && ((empty && value === '') || /^[a-zA-Z0-9-]{16,80}$/.test(value)), '记录标识无效');
  return value;
}
export function dateInput(value: unknown): string {
  requireInput(typeof value === 'string' && isCalendarDate(value) && value >= '2000-01-01' && value <= '2100-12-31', '日期无效');
  return value;
}
export function timezoneInput(value: unknown): string {
  requireInput(typeof value === 'string' && value.length < 100, '时区无效');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { throw new ClothesInputError('时区无效'); }
  return value;
}
export function numberInput(value: unknown, min: number, max: number): number {
  requireInput(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, '数值无效');
  return value;
}
export function locationInput(value: unknown): ClothesLocation | null {
  if (value === null) return null;
  const v = value as ClothesLocation;
  requireInput(v && typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 180
    && ['manual', 'geo', 'calendar'].includes(v.source), '地点无效');
  return { name: v.name.trim(), latitude: numberInput(v.latitude, -90, 90), longitude: numberInput(v.longitude, -180, 180), source: v.source,
    ...(v.timezone ? { timezone: timezoneInput(v.timezone) } : {}) };
}
export function itemInput(value: unknown): ClothesItem {
  const v = value as ClothesItem;
  requireInput(v && CATEGORIES.includes(categoryLabel(v.category)) && COLORS.includes(v.color) && [1, 2, 3].includes(v.thickness)
    && ['可穿', '待洗', '收起'].includes(v.status) && typeof v.active === 'boolean' && typeof v.windproof === 'boolean'
    && typeof v.waterproof === 'boolean' && typeof v.name === 'string' && v.name.trim().length <= 60
    && (v.sleepwear === undefined || typeof v.sleepwear === 'boolean')
    && (v.braRequirement === undefined || ['required', 'optional'].includes(v.braRequirement)), '衣物信息无效');
  requireInput(v.wearAs === undefined || (Array.isArray(v.wearAs) && v.wearAs.length <= 2 && v.wearAs.every((role) =>
    categoryLabel(role) === categoryLabel(v.category) || (['上衣', '外套'].includes(categoryLabel(v.category)) && ['上衣', '外套'].includes(categoryLabel(role))))), '穿着位置无效');
  requireInput(v.warmthRegions === undefined || (Array.isArray(v.warmthRegions) && v.warmthRegions.length <= BODY_REGIONS.length
    && new Set(v.warmthRegions).size === v.warmthRegions.length && v.warmthRegions.every((region) => BODY_REGIONS.includes(region))), '保暖部位无效');
  return { id: id(v.id), revision: id(v.revision, true), name: v.name.trim() || `${v.color === '多色' ? v.color : `${v.color}色`}${categoryLabel(v.category)}`,
    category: categoryLabel(v.category), ...(v.wearAs ? { wearAs: itemCategories(v) } : {}), color: v.color, thickness: v.thickness, active: v.active, windproof: v.windproof,
    ...(itemCategories(v).some(hasBraRequirement) ? { braRequirement: v.braRequirement ?? 'required' } : {}),
    ...(v.warmth !== undefined ? { warmth: numberInput(v.warmth, 0, 40) } : {}),
    ...(v.warmthRegions !== undefined ? { warmthRegions: v.warmthRegions } : {}),
    sleepwear: v.sleepwear ?? false,
    waterproof: v.waterproof, status: normalizeItem(v).status, photoId: id(v.photoId, true) };
}
export function validLayers(items: ClothesItem[]) {
  const categories = items.map((item) => categoryLabel(item.category)).filter((category) => category !== '配饰');
  return new Set(categories).size === categories.length
    && !items.some((item, index) => items.slice(index + 1).some((other) => accessoriesOverlap(item, other)))
    && !(categories.includes('连衣裙') && (categories.includes('上衣') || categories.includes('下装')));
}
export function contextInput(value: unknown): ClothesDayContext {
  const v = value as ClothesDayContext;
  requireInput(v && (v.scene === null || SCENES.includes(v.scene)) && (v.active === null || typeof v.active === 'boolean'), '当天条件无效');
  requireInput(v.purpose === undefined || v.purpose === null || (PURPOSES.includes(v.purpose) && v.purpose !== '睡觉'), '推荐用途无效');
  let manualWeather: ClothesDayContext['manualWeather'] = null;
  if (v.manualWeather !== null) {
    requireInput(v.manualWeather && typeof v.manualWeather.rain === 'boolean', '天气无效');
    manualWeather = { temperature: numberInput(v.manualWeather.temperature, -60, 60), rain: v.manualWeather.rain };
  }
  return { ...(v.indoorTemperature !== undefined ? { indoorTemperature: v.indoorTemperature === null ? null : numberInput(v.indoorTemperature, -60, 60) } : {}), date: dateInput(v.date), timezone: timezoneInput(v.timezone), revision: id(v.revision, true), ...(v.purpose !== undefined ? { purpose: v.purpose } : {}),
    location: locationInput(v.location), scene: v.scene, active: v.active, manualWeather };
}
export function feelingsInput(value: unknown): WearFeelings {
  requireInput(value && typeof value === 'object' && !Array.isArray(value), '体感记录无效');
  const result: WearFeelings = {};
  for (const [key, entry] of Object.entries(value)) {
    requireInput(DAY_PERIODS.includes(key as typeof DAY_PERIODS[number]) && entry && typeof entry === 'object', '体感时段无效');
    requireInput([entry.indoor, entry.outdoor].every((feeling) => feeling === null || SENSATIONS.includes(feeling)), '体感记录无效');
    requireInput(entry.cycling === undefined || entry.cycling === null || SENSATIONS.includes(entry.cycling), '骑车体感无效');
    result[key as typeof DAY_PERIODS[number]] = { ...(entry.cycling !== undefined ? { cycling: entry.cycling } : {}), indoor: entry.indoor, outdoor: entry.outdoor,
      indoorTemperature: entry.indoorTemperature === null ? null : numberInput(entry.indoorTemperature, -60, 60),
      outdoorTemperature: entry.outdoorTemperature === null ? null : numberInput(entry.outdoorTemperature, -60, 60) };
  }
  return result;
}
// Display images are re-encoded in the browser. Inspect their actual headers,
// dimensions and container boundaries; do not trust MIME or client metadata.
export function photoData(value: unknown) {
  requireInput(typeof value === 'string' && value.length <= 273100, '照片不能超过 200KB');
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  requireInput(match, '照片须为 JPEG、PNG 或 WebP 图片');
  const data = Buffer.from(match[2], 'base64');
  requireInput(data.length <= 200 * 1024 && data.length > 4, '照片不能超过 200KB');
  return { mime: match[1], data };
}
function photoDimensions(width: number, height: number) {
  requireInput(width > 0 && height > 0 && width <= 960 && height <= 960, '照片最长边不能超过 960px');
}
function validatePng(data: Buffer) {
  requireInput(data.length >= 45 && data.subarray(0, 8).equals(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), '照片内容无效');
  let imageData = false, ended = false;
  for (let offset = 8; offset < data.length;) {
    requireInput(offset + 12 <= data.length, '照片内容无效');
    const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    requireInput(end <= data.length && type !== 'acTL', '照片内容无效');
    if (offset === 8) {
      requireInput(type === 'IHDR' && length === 13, '照片内容无效');
      photoDimensions(data.readUInt32BE(offset + 8), data.readUInt32BE(offset + 12));
    } else requireInput(type !== 'IHDR', '照片内容无效');
    if (type === 'IDAT' && length > 0) imageData = true;
    if (type === 'IEND') { requireInput(length === 0 && end === data.length, '照片内容无效'); ended = true; }
    offset = end;
  }
  requireInput(imageData && ended, '照片内容无效');
}
function validateWebp(data: Buffer) {
  requireInput(data.length >= 20 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    && data.readUInt32LE(4) + 8 === data.length, '照片内容无效');
  let canvas: [number, number] | undefined, frame: [number, number] | undefined;
  for (let offset = 12; offset < data.length;) {
    requireInput(offset + 8 <= data.length, '照片内容无效');
    const type = data.toString('ascii', offset, offset + 4), length = data.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length + (length % 2);
    requireInput(end <= data.length && type !== 'ANIM' && type !== 'ANMF', '照片内容无效');
    if (type === 'VP8X') {
      requireInput(offset === 12 && length === 10 && !(data[start] & 2), '照片内容无效');
      canvas = [data.readUIntLE(start + 4, 3) + 1, data.readUIntLE(start + 7, 3) + 1];
      photoDimensions(...canvas);
    } else if (type === 'VP8 ') {
      requireInput(!frame && length >= 10 && !(data[start] & 1)
        && data.subarray(start + 3, start + 6).equals(Uint8Array.from([0x9d, 0x01, 0x2a])), '照片内容无效');
      frame = [data.readUInt16LE(start + 6) & 0x3fff, data.readUInt16LE(start + 8) & 0x3fff];
    } else if (type === 'VP8L') {
      requireInput(!frame && length >= 5 && data[start] === 0x2f, '照片内容无效');
      const bits = data.readUInt32LE(start + 1);
      frame = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    offset = end;
  }
  requireInput(frame, '照片内容无效');
  photoDimensions(...frame);
  requireInput(!canvas || (canvas[0] === frame[0] && canvas[1] === frame[1]), '照片内容无效');
}
export function photoInput(value: unknown): string {
  const { mime, data } = photoData(value);
  if (mime === 'image/png') validatePng(data);
  else if (mime === 'image/webp') validateWebp(data);
  else {
    requireInput(data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9, '照片内容无效');
    let valid = false;
    for (let offset = 2; offset + 8 < data.length;) {
      requireInput(data[offset] === 0xff, '照片内容无效');
      const marker = data[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = data.readUInt16BE(offset + 2);
      requireInput(length >= 2 && offset + 2 + length <= data.length, '照片内容无效');
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        photoDimensions(data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5));
        valid = true;
      }
      offset += 2 + length;
    }
    requireInput(valid, '照片内容无效');
  }
  return value as string;
}
