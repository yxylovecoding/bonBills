export const CATEGORIES = ['上装', '下装', '连衣裙', '外套', '鞋', '配饰'] as const;
export type Category = typeof CATEGORIES[number];
export const COLORS = ['黑', '白', '灰', '米', '棕', '蓝', '绿', '红', '粉', '紫', '黄', '橙', '多色'] as const;
export const SCENES = ['基本室内', '有室外', '长时间室外'] as const;
export type Scene = typeof SCENES[number];
export interface ClothesItem {
  id: string; revision: string; name: string; category: Category; color: typeof COLORS[number];
  thickness: 1 | 2 | 3; active: boolean; windproof: boolean; waterproof: boolean;
  status: '可穿' | '待洗' | '收起'; photoId: string; deleted?: boolean;
}
export interface ClothesLocation { name: string; latitude: number; longitude: number; source: 'manual' | 'geo' | 'calendar'; timezone?: string }
export interface ClothesDayContext {
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
export interface WearRecord {
  date: string; revision: string; confirmedAt: string; items: ClothesItem[];
  context: ClothesDayContext; weather: WeatherSnapshot | null;
}
export interface Outfit { items: ClothesItem[]; missing: string[]; key: string }
export interface ClothesData { items: ClothesItem[]; context: ClothesDayContext | null; records: WearRecord[] }
export interface ClothesTrip {
  id: string; title: string; startDate: string; endDate: string; dates: string[];
  destinations: string[]; events: ClothesEvent[]; archived?: boolean;
}
export interface TripDayPlan { scene: Scene | null; active: boolean | null; itemIds: string[] | null }
export interface ClothesTripPlan {
  tripId: string; revision: string; title: string; startDate: string; endDate: string;
  location: ClothesLocation | null; days: Record<string, TripDayPlan>;
}
export interface ClothesTripsData { trips: ClothesTrip[]; plans: ClothesTripPlan[]; connected: boolean; calendarError?: string }
export interface TripForecast { days: Record<string, WeatherSnapshot>; stale: boolean; error?: string; fetchedAt?: string }
