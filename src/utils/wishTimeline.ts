import { tagMeta } from '../data/mockData';
import type { TagKind, WishItem } from '../models/types';
import type { TripSegment } from './trips';

export interface WishTimelineEntry {
  date: string;
  tag: TagKind;
  itinerary: string;
  amount: number;
  color: string;
}

export interface WishTimelineOptions {
  startDate: string;
  endDate: string;
  tagMap: Record<string, TagKind>;
  stateDailyAvg: Record<TagKind, number>;
  recommendedInternDates: string[];
  wishes: WishItem[];
  trips: TripSegment[];
  tripTags: Record<string, string>;
}

interface TripDayDetail {
  label: string;
  dailyWishBudget: number;
}

const MAX_TIMELINE_DAYS = 3660;
const ITINERARY_LABELS: Record<TagKind, string> = {
  school: '在学校',
  intern: '实习',
  home: '在家',
  travel: '出去玩',
};

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function enumerateDateKeys(startDate: string, endDate: string): string[] {
  const start = parseDateKey(startDate);
  const requestedEnd = parseDateKey(endDate);
  if (!start) return [];
  const end = requestedEnd && requestedEnd >= start ? requestedEnd : start;
  const result: string[] = [];
  for (const cursor = new Date(start); cursor <= end && result.length < MAX_TIMELINE_DAYS; cursor.setDate(cursor.getDate() + 1)) {
    result.push(formatDateKey(cursor));
  }
  return result;
}

function normalizedAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

export function buildWishTimelineEntries(options: WishTimelineOptions): WishTimelineEntry[] {
  const recommendedInternDates = new Set(options.recommendedInternDates);
  const tripByDate = new Map<string, TripDayDetail>();
  const wishesByTrip = new Map<string, WishItem[]>();

  for (const wish of options.wishes) {
    if (!wish.isActive || !wish.linkedTripStartDate) continue;
    const linked = wishesByTrip.get(wish.linkedTripStartDate) ?? [];
    linked.push(wish);
    wishesByTrip.set(wish.linkedTripStartDate, linked);
  }

  for (const trip of options.trips) {
    if (trip.dates.length === 0) continue;
    const linkedWishes = wishesByTrip.get(trip.startDate) ?? [];
    const targetAmount = linkedWishes.reduce(
      (sum, wish) => sum + normalizedAmount(wish.targetAmount),
      0,
    );
    const dailyWishBudget = targetAmount / trip.dates.length;
    const tripName = options.tripTags[trip.startDate]?.trim() || '出游';
    const wishNames = linkedWishes.map((wish) => wish.name.trim()).filter(Boolean);
    const label = wishNames.length > 0 ? `${tripName} · ${wishNames.join('、')}` : tripName;
    for (const date of trip.dates) tripByDate.set(date, { label, dailyWishBudget });
  }

  return enumerateDateKeys(options.startDate, options.endDate).map((date) => {
    const existingTag = options.tagMap[date];
    const trip = tripByDate.get(date);
    const tag: TagKind = trip || existingTag === 'travel'
      ? 'travel'
      : existingTag === 'home'
        ? 'home'
        : recommendedInternDates.has(date)
          ? 'intern'
          : 'school';
    const lifeAmount = normalizedAmount(options.stateDailyAvg[tag]);
    return {
      date,
      tag,
      itinerary: trip?.label ?? ITINERARY_LABELS[tag],
      amount: Math.max(lifeAmount, trip?.dailyWishBudget ?? 0),
      color: tagMeta[tag].color,
    };
  });
}
