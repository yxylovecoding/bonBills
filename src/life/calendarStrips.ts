import { SKIN_STATES } from '../utils/lifeSkin';
import { SYMPTOM_AREAS, SYMPTOM_STATES, symptomObservations } from '../utils/lifeSymptoms';
import type { LifeEntry, LifeKind, TrainingRecord } from '../utils/bonLife';

export interface CalendarStripItem { key: string; label: string }
export interface CalendarStripSegment extends CalendarStripItem {
  lane: number;
  starts: boolean;
  ends: boolean;
}

export function lifeCalendarStripItems(kind: LifeKind, entry?: LifeEntry, training?: TrainingRecord, trainingNames = new Map<string, string>()): CalendarStripItem[] {
  if (kind === 'skin') return [
    ...(entry?.skin?.status ? [{ key: `skin:${entry.skin.status}`, label: SKIN_STATES[entry.skin.status] }] : []),
    ...(entry?.skin?.acneMarks ? [{ key: 'skin:acneMarks', label: '痘印' }] : []),
  ];
  if (kind === 'eyes' || kind === 'discomfort') return Object.entries(symptomObservations(kind, entry?.[kind])).map(([key, item]) => ({
    key, label: `${kind === 'discomfort' ? `${SYMPTOM_AREAS[item.area]} · ` : ''}${item.name} · ${SYMPTOM_STATES[item.status]}`,
  }));
  if (kind === 'training') return (training?.projects ?? []).map((key) => ({ key: `training:${key}`, label: trainingNames.get(key) ?? key }));
  return [];
}

/**
 * Lays strips out one calendar week at a time. Runs that overlap use separate
 * lanes, while every segment in a run keeps the same lane. Week boundaries
 * deliberately close and reopen a run so wrapped rows have natural caps.
 */
export function calendarStripSegments(cells: (string | null)[], itemsByDate: Map<string, CalendarStripItem[]>) {
  const result = new Map<string, CalendarStripSegment[]>();
  for (let weekStart = 0; weekStart < cells.length; weekStart += 7) {
    const week = cells.slice(weekStart, weekStart + 7);
    const byKey = new Map<string, { item: CalendarStripItem; days: number[] }>();
    week.forEach((date, day) => {
      if (!date) return;
      for (const item of itemsByDate.get(date) ?? []) {
        const run = byKey.get(item.key) ?? { item, days: [] };
        if (!run.days.includes(day)) run.days.push(day);
        byKey.set(item.key, run);
      }
    });

    const runs = [...byKey.values()].flatMap(({ item, days }) => {
      const sorted = [...days].sort((a, b) => a - b);
      const groups: number[][] = [];
      for (const day of sorted) {
        const group = groups.at(-1);
        if (group && group.at(-1)! + 1 === day) group.push(day);
        else groups.push([day]);
      }
      return groups.map((group) => ({ item, days: group, start: group[0], end: group.at(-1)! }));
    }).sort((a, b) => a.start - b.start || a.item.key.localeCompare(b.item.key));

    const laneEnds: number[] = [];
    for (const run of runs) {
      let lane = laneEnds.findIndex((end) => end < run.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = run.end;
      run.days.forEach((day, index) => {
        const date = week[day]!;
        const segments = result.get(date) ?? [];
        segments.push({ ...run.item, lane, starts: index === 0, ends: index === run.days.length - 1 });
        result.set(date, segments);
      });
    }
  }
  for (const segments of result.values()) segments.sort((a, b) => a.lane - b.lane || a.key.localeCompare(b.key));
  return result;
}
