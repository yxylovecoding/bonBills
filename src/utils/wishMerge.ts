import type { WishItem, WishMergeRecord } from '../models/types';
import { uniqueStrings, wishBillTags, wishTripStarts } from './wishAssociations';
import type { TripSegment } from './trips';

export function isWishExpiredForMerge(wish: WishItem, trips: readonly TripSegment[], today: string): boolean {
  const starts = wishTripStarts(wish);
  const linkedTrips = trips.filter((trip) => starts.includes(trip.startDate));
  // 出行心愿的筹款截止日通常在出发前，行程结束才算过期；无行程时沿用截止日。
  const endDate = linkedTrips.length > 0
    ? linkedTrips.reduce((latest, trip) => trip.endDate > latest ? trip.endDate : latest, '')
    : wish.deadline;
  return Boolean(endDate && endDate < today);
}

export type WishMergeChoices = { primary: string; target: string; saved: string; deadline: string; details: string };
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().filter((key) => item[key] !== undefined).map((key) => [key, item[key]])) : item);
}
export function sameWish(a: WishItem | undefined, b: WishItem): boolean { return canonical(a) === canonical(b); }
export function previewWishMerge(sources: WishItem[], choices: WishMergeChoices, tripTags: Record<string, string>, billTagsById: Record<string, string[]>): WishItem {
  if (sources.length < 2 || new Set(sources.map((wish) => wish.id)).size !== sources.length) throw new Error('请选择至少两个不同心愿');
  const chosen = (id: string) => { const found = sources.find((wish) => wish.id === id); if (!found) throw new Error('请选择每项保留值'); return found; };
  const primary = chosen(choices.primary), details = chosen(choices.details);
  const starts = uniqueStrings(sources.flatMap(wishTripStarts));
  return { ...details, id: primary.id, name: primary.name, targetAmount: chosen(choices.target).targetAmount,
    savedAmount: chosen(choices.saved).savedAmount, deadline: chosen(choices.deadline).deadline ?? null, deadlineMode: 'manual',
    linkedTripStartDate: starts.includes(primary.linkedTripStartDate ?? '') ? primary.linkedTripStartDate : starts[0] ?? null,
    linkedTripStartDates: starts, billTag: undefined,
    billTags: uniqueStrings(sources.flatMap((wish) => wishBillTags(wish, tripTags, billTagsById[wish.id]))),
    outlookEventKeys: uniqueStrings(sources.flatMap((wish) => wish.outlookEventKeys ?? [])),
    mergedWishIds: uniqueStrings(sources.flatMap((wish) => [wish.id, ...(wish.mergedWishIds ?? [])])).filter((id) => id !== primary.id),
    spentItems: structuredClone(details.spentItems ?? []),
  };
}
export function applyWishMerge(current: WishItem[], sources: WishItem[], result: WishItem, id: string, createdAt: string): { wishes: WishItem[]; record: WishMergeRecord } {
  if (sources.length < 2 || sources.some((wish) => !sameWish(current.find((item) => item.id === wish.id), wish))) throw new Error('心愿已变更，请重新预览');
  const ids = new Set(sources.map((wish) => wish.id));
  if (!ids.has(result.id)) throw new Error('保留心愿无效');
  return { wishes: current.filter((wish) => !ids.has(wish.id) || wish.id === result.id).map((wish) => wish.id === result.id ? result : wish),
    record: { id, createdAt, sources: structuredClone(sources), result: structuredClone(result) } };
}
export function undoWishMerge(current: WishItem[], record: WishMergeRecord): WishItem[] {
  if (record.undoneAt || !sameWish(current.find((wish) => wish.id === record.result.id), record.result)
    || record.sources.some((source) => source.id !== record.result.id && current.some((wish) => wish.id === source.id))) {
    throw new Error('合并后的心愿已有更改，无法直接撤销；原记录仍保留');
  }
  return current.flatMap((wish) => wish.id === record.result.id ? structuredClone(record.sources) : [wish]);
}
