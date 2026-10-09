import { SYMPTOM_STATES, type SymptomState } from './lifeSymptoms.js';

export const SKIN_STATES = { acne: '痤疮', damaged: '受损', healthy: '健康', allergic: '过敏' } as const;
export const SKIN_SEASONS = { spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天' } as const;
export const SKIN_TIMES = { morning: '早间', evening: '晚间' } as const;
export type SkinState = keyof typeof SKIN_STATES;
export type SkinSeason = keyof typeof SKIN_SEASONS;
export type SkinTime = keyof typeof SKIN_TIMES;
export const SKIN_FIELDS = { medication: '用药（未分早晚）', morningMedication: '早间用药', morningProducts: '早间护肤品', eveningMedication: '晚间用药', eveningProducts: '晚间护肤品', localMedication: '局部用药' } as const;
export type SkinField = keyof typeof SKIN_FIELDS;
export type SkinRecord = Partial<Record<SkinField, string>> & { status?: SkinState; planDay?: number; season?: SkinSeason; acneMarks?: boolean; acneProgress?: SymptomState };
export interface SkinProduct {
  id: string; name: string; kind: 'medication' | 'skincare'; active: boolean;
  states: SkinState[]; seasons: SkinSeason[]; times: SkinTime[]; tags: string[]; notes: string;
}
export interface SkinPlanDay { medication: string; morningMedication: string; eveningMedication: string; notes: string }
export interface SkinPlan { days: SkinPlanDay[]; careFrom?: 'damaged'; repeat?: boolean }
export interface SkinSettings { revision: string; products: SkinProduct[]; plans: Record<SkinState, SkinPlan>; acneMarksMedication?: string }
export const DEFAULT_ACNE_MARKS_MEDICATION = '积雪苷';
export const emptySkinDay = (): SkinPlanDay => ({ medication: '', morningMedication: '', eveningMedication: '', notes: '' });

const product = (id: string, name: string, kind: SkinProduct['kind'], states: SkinState[], seasons: SkinSeason[] = [], times: SkinTime[] = []): SkinProduct =>
  ({ id, name, kind, states, seasons, times, active: true, tags: [], notes: '' });
// Personal templates supplied by the user; unspecified names and times stay unspecified.
export const DEFAULT_SKIN_SETTINGS: SkinSettings = {
  revision: '',
  acneMarksMedication: DEFAULT_ACNE_MARKS_MEDICATION,
  products: [
    product('calamine', '炉甘石', 'medication', ['acne']),
    { ...product('peroxide', '过氧', 'medication', ['acne'], [], ['morning']), notes: '待补全具体名称' },
    product('adapalene', '阿达帕林', 'medication', ['acne'], [], ['evening']),
    { ...product('acid', '酸', 'medication', ['acne']), notes: '待补全具体名称' },
    product('growth-factor', '生长因子', 'medication', ['damaged']),
    product('curel-cream', '珂润霜', 'skincare', ['damaged'], ['autumn', 'winter']),
    product('curel-lotion', '珂润乳', 'skincare', ['damaged'], ['spring', 'summer']),
    product('olive-essence', '安修泽油橄榄精华', 'skincare', ['acne']),
  ],
  plans: {
    acne: { careFrom: 'damaged', repeat: true, days: [
      { ...emptySkinDay(), medication: '炉甘石' },
      { ...emptySkinDay(), morningMedication: '过氧', eveningMedication: '阿达帕林' },
      { ...emptySkinDay(), medication: '酸' },
    ] },
    damaged: { days: [{ ...emptySkinDay(), medication: '生长因子' }] },
    healthy: { days: [emptySkinDay()] },
    allergic: { days: [emptySkinDay()] },
  },
};

const has = (options: object, value: unknown): boolean => typeof value === 'string' && Object.prototype.hasOwnProperty.call(options, value);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('皮肤设置无效');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('皮肤内容过长或无效');
  return value;
}
function choices<T extends string>(value: unknown, options: Record<T, string>): T[] {
  if (!Array.isArray(value) || value.length > Object.keys(options).length || value.some((item) => !has(options, item))) throw new Error('皮肤标签无效');
  return [...new Set(value)] as T[];
}
export function parseSkinRecord(value: unknown): SkinRecord {
  const input = record(value);
  const result: SkinRecord = {};
  for (const [key, val] of Object.entries(input)) {
    if (has(SKIN_FIELDS, key)) result[key as SkinField] = text(val, 500);
    else if (key === 'status' && has(SKIN_STATES, val)) result.status = val as SkinState;
    else if (key === 'season' && has(SKIN_SEASONS, val)) result.season = val as SkinSeason;
    else if (key === 'acneMarks' && typeof val === 'boolean') result.acneMarks = val;
    else if (key === 'acneProgress' && has(SYMPTOM_STATES, val)) result.acneProgress = val as SymptomState;
    else if (key === 'planDay' && typeof val === 'number' && Number.isInteger(val) && val >= 1 && val <= 14) result.planDay = val;
    else throw new Error('护肤记录无效');
  }
  return result;
}
export function parseSkinSettings(value: unknown): SkinSettings {
  const input = record(value);
  const revision = text(input.revision, 80);
  if (!Array.isArray(input.products) || input.products.length > 100) throw new Error('最多保存 100 件用品');
  const ids = new Set<string>();
  const products = input.products.map((value): SkinProduct => {
    const item = record(value);
    const id = text(item.id, 80), name = text(item.name, 100).trim();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || ids.has(id) || !name
      || !['medication', 'skincare'].includes(String(item.kind)) || typeof item.active !== 'boolean') throw new Error('用品信息无效');
    ids.add(id);
    if (!Array.isArray(item.tags) || item.tags.length > 12) throw new Error('最多添加 12 个自定义标签');
    return { id, name, kind: item.kind as SkinProduct['kind'], active: item.active,
      states: choices(item.states, SKIN_STATES), seasons: choices(item.seasons, SKIN_SEASONS), times: choices(item.times, SKIN_TIMES),
      tags: [...new Set(item.tags.map((tag) => text(tag, 24).trim()).filter(Boolean))], notes: text(item.notes, 500) };
  });
  const rawPlans = record(input.plans);
  const plans = {} as Record<SkinState, SkinPlan>;
  for (const state of Object.keys(SKIN_STATES) as SkinState[]) {
    const plan = record(rawPlans[state]);
    if (!Array.isArray(plan.days) || !plan.days.length || plan.days.length > 14
      || (plan.repeat !== undefined && typeof plan.repeat !== 'boolean')
      || (plan.careFrom !== undefined && (state !== 'acne' || plan.careFrom !== 'damaged'))) throw new Error('护理方案无效');
    plans[state] = { ...(plan.repeat !== undefined ? { repeat: plan.repeat as boolean } : {}), ...(plan.careFrom ? { careFrom: 'damaged' as const } : {}), days: plan.days.map((value): SkinPlanDay => {
      const day = record(value);
      return { medication: text(day.medication, 500), morningMedication: text(day.morningMedication, 500),
        eveningMedication: text(day.eveningMedication, 500), notes: text(day.notes, 500) };
    }) };
  }
  return { revision, products, plans, ...(input.acneMarksMedication !== undefined ? { acneMarksMedication: text(input.acneMarksMedication, 500) } : {}) };
}

const ONE_OFF_SKIN_PRODUCT_NAMES = new Set(['修丽可五酸精华', '海蓝之谴水']);

// Products that must always exist with a canonical configuration, overriding
// any stale persisted states/kind so they appear in the right "可选加用" lists.
const ENSURED_SKIN_PRODUCTS: readonly SkinProduct[] = [
  { id: 'olive-essence', name: '安修泽油橄榄精华', kind: 'skincare', active: true,
    states: ['acne'], seasons: [], times: [], tags: [], notes: '' },
];

// Apply one-off corrections to persisted personal settings without rewriting
// historical entries, whose saved product names must remain unchanged.
export function currentSkinSettings(settings: SkinSettings): SkinSettings {
  const kept = settings.products.filter((item) => !ONE_OFF_SKIN_PRODUCT_NAMES.has(item.name));
  const normalized = kept.map((item) => {
    const canonical = ENSURED_SKIN_PRODUCTS.find((value) => value.name === item.name);
    return canonical ? { ...item, kind: canonical.kind, active: true,
      states: [...canonical.states], seasons: [...canonical.seasons], times: [...canonical.times] } : item;
  });
  const names = new Set(normalized.map((item) => item.name));
  const ensured = ENSURED_SKIN_PRODUCTS.filter((item) => !names.has(item.name))
    .map((item) => ({ ...item, states: [...item.states], seasons: [...item.seasons], times: [...item.times], tags: [...item.tags] }));
  return {
    ...settings,
    products: [...normalized, ...ensured],
    plans: { ...settings.plans, acne: { ...settings.plans.acne, repeat: true } },
  };
}

export function skinLocalPlanValues(settings: SkinSettings, skin: SkinRecord): Partial<Record<SkinField, string>> {
  return skin.acneMarks ? { localMedication: settings.acneMarksMedication ?? DEFAULT_ACNE_MARKS_MEDICATION } : {};
}
export function skinSeason(date: string): SkinSeason {
  const month = Number(date.slice(5, 7));
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
}
export function matchingSkinProducts(settings: SkinSettings, state: SkinState | undefined, season: SkinSeason, kind: SkinProduct['kind'], time?: SkinTime): SkinProduct[] {
  const careState = state && kind === 'skincare' ? settings.plans[state].careFrom ?? state : state;
  return settings.products.filter((item) => item.active && item.kind === kind
    && (!careState || !item.states.length || item.states.includes(careState))
    && (!item.seasons.length || item.seasons.includes(season)) && (!time || !item.times.length || item.times.includes(time)));
}
// Products marked as suitable for the current skin state directly (ignoring the
// state's careFrom chain) and not already in `matchingSkinProducts`, so they can
// be surfaced as "可选加用" extras next to the固定方案.
export function optionalSkinProducts(settings: SkinSettings, state: SkinState | undefined, season: SkinSeason, kind: SkinProduct['kind'], time?: SkinTime): SkinProduct[] {
  if (!state) return [];
  const primary = new Set(matchingSkinProducts(settings, state, season, kind, time).map((item) => item.id));
  return settings.products.filter((item) => item.active && item.kind === kind
    && !primary.has(item.id) && item.states.includes(state)
    && (!item.seasons.length || item.seasons.includes(season))
    && (!time || !item.times.length || item.times.includes(time)));
}
export function skinPlanValues(settings: SkinSettings, state: SkinState, day: number, season: SkinSeason): Partial<Record<SkinField, string>> {
  const plan = settings.plans[state].days[day - 1];
  return { medication: plan?.medication ?? '', morningMedication: plan?.morningMedication ?? '', eveningMedication: plan?.eveningMedication ?? '',
    morningProducts: matchingSkinProducts(settings, state, season, 'skincare', 'morning').map((item) => item.name).join('、'),
    eveningProducts: matchingSkinProducts(settings, state, season, 'skincare', 'evening').map((item) => item.name).join('、') };
}
