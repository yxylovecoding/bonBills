import type { TagKind } from '../models/types';
import type { BillExpenseItem, BillExpenseMonth } from './importBill';

export const SYSTEM_BILL_TAGS = new Set([
  '周期生活', '波动生活', '消费', '吃好喝好', '红', '黑',
]);

// 出游 tag 形如「26.5.15 爬山」「26.5.15爬山」「26.5 春节」「26.5春节」：
// yy.m 或 yy.m.d，后跟可选空白 + 描述
export const TRIP_TAG_PATTERN = /^(\d{2})\.(\d{1,2})(?:\.(\d{1,2}))?\s*\S/;

export function isTripTagFormat(tag: string): boolean {
  return TRIP_TAG_PATTERN.test(tag);
}

// 解析 tag 前缀 → "yy.m"（月份无前导 0），不匹配返回 null
export function tagYearMonthPrefix(tag: string): string | null {
  const m = tag.match(TRIP_TAG_PATTERN);
  if (!m) return null;
  return `${m[1]}.${Number(m[2])}`;
}

export interface TripSegment {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  dates: string[];   // 连续日期数组
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function addDays(date: string, delta: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function buildSegments(
  dates: string[],
  splitOnDates: Set<string>,
): TripSegment[] {
  const segments: TripSegment[] = [];
  let cur: string[] = [];
  for (const d of dates) {
    if (cur.length === 0) { cur = [d]; continue; }
    const contiguous = addDays(cur[cur.length - 1], 1) === d;
    const splitHere = splitOnDates.has(d);
    if (contiguous && !splitHere) cur.push(d);
    else {
      segments.push({ startDate: cur[0], endDate: cur[cur.length - 1], dates: cur });
      cur = [d];
    }
  }
  if (cur.length > 0) segments.push({ startDate: cur[0], endDate: cur[cur.length - 1], dates: cur });
  return segments;
}

// 找出所有连续 travel 段；只返回与 yearMonth 相交的段（含跨月延伸）
// tripSplits 中的日期会被视为「这一天开启新的一次出游」，即使前一天也是 travel。
export function detectTrips(
  tagMap: Record<string, TagKind>,
  yearMonth: string,
  tripSplits: Record<string, true> = {},
): TripSegment[] {
  const travelDates = Object.entries(tagMap)
    .filter(([, tag]) => tag === 'travel')
    .map(([date]) => date)
    .sort();
  if (travelDates.length === 0) return [];

  const splitSet = new Set(Object.keys(tripSplits));
  const segments = buildSegments(travelDates, splitSet);
  return segments.filter((s) =>
    s.dates.some((d) => d.startsWith(yearMonth)),
  );
}

// 返回原始连续段（忽略 splits），并对每段附上 splits 切出来的子 trip 数组。
// 用于卡片 UI 显示「切分点」控件。
export interface TripGroup {
  rawDates: string[];     // 该连续段的全部日期（未切分）
  trips: TripSegment[];   // splits 切分后的子 trip
}
export function detectTripGroups(
  tagMap: Record<string, TagKind>,
  yearMonth: string,
  tripSplits: Record<string, true> = {},
): TripGroup[] {
  const travelDates = Object.entries(tagMap)
    .filter(([, tag]) => tag === 'travel')
    .map(([date]) => date)
    .sort();
  if (travelDates.length === 0) return [];

  // 原始段（不切分）
  const rawSegs = buildSegments(travelDates, new Set());
  const splitSet = new Set(Object.keys(tripSplits));
  const groups: TripGroup[] = [];
  for (const seg of rawSegs) {
    if (!seg.dates.some((d) => d.startsWith(yearMonth))) continue;
    const subs = buildSegments(seg.dates, splitSet);
    groups.push({ rawDates: seg.dates, trips: subs });
  }
  return groups;
}

export interface TagCandidate { tag: string; hitInRange: number; totalHit: number; }

// 从全部账单里抽取候选 tag：
// - 必须命中 TRIP_TAG_PATTERN（yy.m.d 描述）
// - 剔除系统 tag
// - tag 的「yy.m」前缀必须匹配 trip 跨越的某个年月（如 26 年 2 月的 trip 只看 26.2.x）
// - 排除 excludeTags（已被其它 trip 选过的）
// 排序：在 tripDates 范围内的命中次数降序
export function extractCandidateTags(
  allItems: BillExpenseItem[],
  tripDates: Set<string>,
  excludeTags: Set<string> = new Set(),
): TagCandidate[] {
  // 计算 trip 跨越的 yy.m 集合
  const tripYearMonths = new Set<string>();
  for (const d of tripDates) {
    const [y, m] = d.split('-');
    tripYearMonths.add(`${y.slice(-2)}.${Number(m)}`);
  }

  const map = new Map<string, { hitInRange: number; totalHit: number }>();
  for (const it of allItems) {
    const tags = (it.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    for (const t of tags) {
      if (SYSTEM_BILL_TAGS.has(t)) continue;
      const prefix = tagYearMonthPrefix(t);
      if (!prefix) continue;
      if (!tripYearMonths.has(prefix)) continue;
      if (excludeTags.has(t)) continue;
      const cur = map.get(t) ?? { hitInRange: 0, totalHit: 0 };
      cur.totalHit += 1;
      if (tripDates.has(it.date)) cur.hitInRange += 1;
      map.set(t, cur);
    }
  }
  return [...map.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .filter((c) => c.hitInRange > 0 || c.totalHit > 0)
    .sort((a, b) => (b.hitInRange - a.hitInRange) || (b.totalHit - a.totalHit) || a.tag.localeCompare(b.tag));
}

export function sumBillsByTag(allItems: BillExpenseItem[], tag: string) {
  let totalAmount = 0;
  const items: BillExpenseItem[] = [];
  for (const it of allItems) {
    const tags = (it.tags || '').split(',').map((t) => t.trim());
    if (tags.includes(tag)) {
      totalAmount += it.amount;
      items.push(it);
    }
  }
  return { totalAmount: Math.round(totalAmount * 100) / 100, count: items.length, items };
}

export function flattenExpenseItems(
  byMonth: Record<string, BillExpenseMonth>,
): BillExpenseItem[] {
  const out: BillExpenseItem[] = [];
  for (const arr of Object.values(byMonth)) out.push(...arr);
  return out;
}
