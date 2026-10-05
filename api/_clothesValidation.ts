import { CATEGORIES, COLORS, SCENES, categoryLabel, hasBraRequirement, type ClothesDayContext, type ClothesItem, type ClothesLocation } from '../src/clothes/types.js';
import { isCalendarDate } from '../src/utils/outlookCalendar.js';

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
    && (v.braRequirement === undefined || ['required', 'optional'].includes(v.braRequirement)), '衣物信息无效');
  return { id: id(v.id), revision: id(v.revision, true), name: v.name.trim() || `${v.color === '多色' ? v.color : `${v.color}色`}${categoryLabel(v.category)}`,
    category: categoryLabel(v.category), color: v.color, thickness: v.thickness, active: v.active, windproof: v.windproof,
    ...(hasBraRequirement(v.category) ? { braRequirement: v.braRequirement ?? 'required' } : {}),
    waterproof: v.waterproof, status: v.status, photoId: id(v.photoId, true) };
}
export function validLayers(items: ClothesItem[]) {
  const categories = items.map((item) => categoryLabel(item.category));
  return new Set(categories).size === categories.length
    && !(categories.includes('连衣裙') && (categories.includes('上衣') || categories.includes('下装')));
}
export function contextInput(value: unknown): ClothesDayContext {
  const v = value as ClothesDayContext;
  requireInput(v && (v.scene === null || SCENES.includes(v.scene)) && (v.active === null || typeof v.active === 'boolean'), '当天条件无效');
  let manualWeather: ClothesDayContext['manualWeather'] = null;
  if (v.manualWeather !== null) {
    requireInput(v.manualWeather && typeof v.manualWeather.rain === 'boolean', '天气无效');
    manualWeather = { temperature: numberInput(v.manualWeather.temperature, -60, 60), rain: v.manualWeather.rain };
  }
  return { date: dateInput(v.date), timezone: timezoneInput(v.timezone), revision: id(v.revision, true),
    location: locationInput(v.location), scene: v.scene, active: v.active, manualWeather };
}
// Browser uploads are re-encoded JPEGs. Validate the actual SOF dimensions, not user supplied metadata.
export function photoInput(value: unknown): string {
  requireInput(typeof value === 'string' && value.length <= 273100 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value), '照片须为 JPEG 图片');
  const data = Buffer.from(value.slice(23), 'base64');
  requireInput(data.length <= 200 * 1024 && data.length > 4, '照片不能超过 200KB');
  requireInput(data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9, '照片内容无效');
  let valid = false;
  for (let offset = 2; offset + 8 < data.length;) {
    requireInput(data[offset] === 0xff, '照片内容无效');
    const marker = data[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = data.readUInt16BE(offset + 2);
    requireInput(length >= 2 && offset + 2 + length <= data.length, '照片内容无效');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = data.readUInt16BE(offset + 5), width = data.readUInt16BE(offset + 7);
      requireInput(height > 0 && width > 0 && height <= 960 && width <= 960, '照片最长边不能超过 960px');
      valid = true;
    }
    offset += 2 + length;
  }
  requireInput(valid, '照片内容无效');
  return value;
}
