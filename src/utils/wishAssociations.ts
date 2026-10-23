import type { WishItem } from '../models/types';
import type { TripSegment } from './trips';
import type { OutlookWishEvent } from './outlookCalendar';
export const uniqueStrings = (values: readonly (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim()))];
export function wishTripStarts(wish: WishItem): string[] { return uniqueStrings([wish.linkedTripStartDate, ...(wish.linkedTripStartDates ?? [])]); }
export function wishBillTags(wish: WishItem, tripTags: Record<string, string>, resolvedTags: readonly string[] = []): string[] {
  if (wish.billTags !== undefined) return uniqueStrings(wish.billTags);
  if (wish.billTag !== undefined) return wish.billTag === null ? [] : uniqueStrings([wish.billTag]);
  return uniqueStrings([...wishTripStarts(wish).map((start) => tripTags[start]), ...resolvedTags]);
}
export function wishAssociationStatus(wish: WishItem, trips: readonly TripSegment[], events: readonly OutlookWishEvent[], tripTags: Record<string, string>, resolvedTags: readonly string[] = []) {
  const starts = wishTripStarts(wish), tags = wishBillTags(wish, tripTags, resolvedTags);
  const eventKeys = uniqueStrings(wish.outlookEventKeys ?? []);
  const outlook = eventKeys.length > 0 && eventKeys.every((key) => events.some((event) => event.key === key && event.available !== false));
  const trip = starts.length > 0 && starts.every((start) => trips.some((item) => item.startDate === start));
  return { outlook, trip, tags: tags.length > 0, complete: outlook && trip && tags.length > 0 };
}
