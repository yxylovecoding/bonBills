import type { TagKind } from '../models/types';
import { detectAllTrips } from './trips';

const TRIP_TAG_PREFIX = /^\d{2}\.\d{1,2}(?:\.\d{1,2})?\s*/;

export interface TickTickTripSource {
  key: string;
  startDate: string;
  endDate: string;
  dates: string[];
  name: string;
  note: string;
}

function formatShortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function getTickTickTripName(tag: string | undefined, startDate: string, endDate: string): string {
  const normalized = tag?.trim().replace(TRIP_TAG_PREFIX, '').trim();
  if (normalized) return normalized;
  if (startDate === endDate) return formatShortDate(startDate);
  return `${formatShortDate(startDate)}–${formatShortDate(endDate)}`;
}

export function buildTickTickTripSources(
  tagMap: Record<string, TagKind>,
  tripTags: Record<string, string>,
  tripNotes: Record<string, string>,
  tripSplits: Record<string, true>,
): TickTickTripSource[] {
  return detectAllTrips(tagMap, tripSplits).map((trip) => ({
    key: trip.startDate,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dates: trip.dates,
    name: getTickTickTripName(tripTags[trip.startDate], trip.startDate, trip.endDate),
    note: tripNotes[trip.startDate]?.trim() ?? '',
  }));
}
