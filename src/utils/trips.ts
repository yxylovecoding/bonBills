import type { TagKind } from '../models/types';
import type { BillExpenseItem, BillExpenseMonth } from './importBill';

export const SYSTEM_BILL_TAGS = new Set([
  '周期生活', '波动生活', '消费', '吃好喝好', '红', '黑',
]);

// 出游 tag 形如「26.5.15 爬山」或「26.5.15爬山」：yy.m.d + 可选空白 + 描述
export const TRIP_TAG_PATTERN = /^\d{2}\.\d{1,2}\.\d{1,2}\s*\S/;

export function isTripTagFormat(tag: string): boolean {
  return TRIP_TAG_PATTERN.test(tag);
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

// 找出所有连续 travel 段；只返回与 yearMonth 相交的段（含跨月延伸）
export function detectTrips(tagMap: Record<string, TagKind>, yearMonth: string): TripSegment[] {
  const travelDates = Object.entries(tagMap)
    .filter(([, tag]) => tag === 'travel')
    .map(([date]) => date)
    .sort();
  if (travelDates.length === 0) return [];

  const segments: TripSegment[] = [];
  let cur: string[] = [];
  for (const d of travelDates) {
    if (cur.length === 0) { cur = [d]; continue; }
    if (addDays(cur[cur.length - 1], 1) === d) cur.push(d);
    else {
      segments.push({ startDate: cur[0], endDate: cur[cur.length - 1], dates: cur });
      cur = [d];
    }
  }
  if (cur.length > 0) segments.push({ startDate: cur[0], endDate: cur[cur.length - 1], dates: cur });

  return segments.filter((s) =>
    s.dates.some((d) => d.startsWith(yearMonth)),
  );
}

export interface TagCandidate { tag: string; hitInRange: number; totalHit: number; }

// 从全部账单里抽取候选 tag（剔除系统 tag），按落在 tripDates 内的命中次数降序
export function extractCandidateTags(
  allItems: BillExpenseItem[],
  tripDates: Set<string>,
): TagCandidate[] {
  const map = new Map<string, { hitInRange: number; totalHit: number }>();
  for (const it of allItems) {
    const tags = (it.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    for (const t of tags) {
      if (SYSTEM_BILL_TAGS.has(t)) continue;
      if (!isTripTagFormat(t)) continue;
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
