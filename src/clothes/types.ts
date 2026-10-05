export const CATEGORIES = ['文胸', '内衣', '上衣', '下装', '连衣裙', '外套', '鞋', '配饰'] as const;
// Keep legacy records and unsaved drafts readable without a data migration.
export type Category = typeof CATEGORIES[number] | '上装';
export function categoryLabel(category: Category): typeof CATEGORIES[number] { return category === '上装' ? '上衣' : category; }
export function hasBraRequirement(category: Category) { return ['上衣', '连衣裙'].includes(categoryLabel(category)); }
export const COLORS = ['黑', '白', '灰', '米', '棕', '蓝', '绿', '红', '粉', '紫', '黄', '橙', '多色'] as const;
export const SCENES = ['基本室内', '有室外', '长时间室外'] as const;
export type Scene = typeof SCENES[number];
export interface ClothesItem {
  id: string; revision: string; name: string; category: Category; color: typeof COLORS[number];
  thickness: 1 | 2 | 3; active: boolean; windproof: boolean; waterproof: boolean;
  warmth?: number;
  learnedWarmth?: number;
  wearAs?: Category[];
  sleepwear?: boolean;
  braRequirement?: 'required' | 'optional';
  status: '可穿' | '待洗' | '收起'; photoId: string; deleted?: boolean;
}
export interface ClothesLocation { name: string; latitude: number; longitude: number; source: 'manual' | 'geo' | 'calendar'; timezone?: string }
export interface ClothesDayContext {
  indoorTemperature?: number | null;
  purpose?: Purpose | null;
  date: string; timezone: string; revision: string; location: ClothesLocation | null;
  scene: Scene | null; active: boolean | null;
  manualWeather: { temperature: number; rain: boolean } | null;
}
export interface WeatherSnapshot {
  date: string; timezone: string; latitude: number; longitude: number; fetchedAt: string;
  temperature: number; apparent: number; min: number; max: number; apparentMin: number;
  precipitation: number; wind: number;
}
export interface ClothesEvent { title: string; location?: string; startDate: string; endDate: string; allDay: boolean }
export interface ClothesCalendar { connected: boolean; events: ClothesEvent[]; fetchedAt: string }
export const PURPOSES = ['休闲', '运动', '见朋友', '见重要的人', '睡觉'] as const;
export const SENSATIONS = ['很冷', '偏冷', '舒适', '偏热', '很热'] as const;
export type Purpose = typeof PURPOSES[number];
export type Sensation = typeof SENSATIONS[number];
export const DAY_PERIODS = ['早晨', '上午', '中午', '下午', '晚上'] as const;
export type DayPeriod = typeof DAY_PERIODS[number];
export interface PeriodFeeling { indoor: Sensation | null; outdoor: Sensation | null; indoorTemperature: number | null; outdoorTemperature: number | null }
export type WearFeelings = Partial<Record<DayPeriod, PeriodFeeling>>;
export type WearKind = 'worn' | 'styled';
export const wearId = (record: WearRecord) => record.id ?? record.date;
export interface WearRecord {
  feelings?: WearFeelings;
  kind?: WearKind;
  id?: string; purpose?: Purpose; indoor?: Sensation | null; outdoor?: Sensation | null; time?: string;
  indoorCoat?: boolean;
  date: string; revision: string; confirmedAt: string; items: ClothesItem[];
  context: ClothesDayContext; weather: WeatherSnapshot | null;
}
export interface Outfit { items: ClothesItem[]; missing: string[]; key: string }
export type PairCounts = Record<string, Record<string, number>>;
export interface ClothesData { items: ClothesItem[]; context: ClothesDayContext | null; records: WearRecord[]; outfits?: WearRecord[]; wearCounts?: Record<string, number>; pairCounts?: PairCounts }
export interface ClothesTrip {
  id: string; title: string; startDate: string; endDate: string; dates: string[];
  destinations: string[]; events: ClothesEvent[]; archived?: boolean;
}
export interface TripDayPlan { purpose?: Purpose | null; scene: Scene | null; active: boolean | null; itemIds: string[] | null; itemCategories?: Record<string, Category> }
export interface ClothesTripPlan {
  tripId: string; revision: string; title: string; startDate: string; endDate: string;
  location: ClothesLocation | null; days: Record<string, TripDayPlan>;
}
export interface ClothesTripsData { trips: ClothesTrip[]; plans: ClothesTripPlan[]; connected: boolean; calendarError?: string }
export interface TripForecast { days: Record<string, WeatherSnapshot>; stale: boolean; error?: string; fetchedAt?: string }
