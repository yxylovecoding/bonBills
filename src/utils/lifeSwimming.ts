import ICAL from 'ical.js';
import type { CycleSettings } from './bonLife.js';
import { cycleDay } from './lifeCycle.js';
import { isCalendarDate } from './outlookCalendar.js';

export interface HairWashSchedule {
  scheduledDate?: string;
  repeatFlag?: string;
  repeatFrom?: string | number;
  completedDates?: string[];
}

export const isHairWashTitle = (title: string) => title.normalize('NFKC').trim() === '洗头';

// TickTick's current pending occurrence is authoritative, including when a
// completion-based recurrence or a manual edit has moved its starting date.
export function hairWashDates(schedule: HairWashSchedule | null | undefined, from: string, through: string) {
  const dates = new Set<string>();
  const add = (date: string) => { if (isCalendarDate(date) && date >= from && date <= through) dates.add(date); };
  schedule?.completedDates?.forEach(add);
  if (schedule?.scheduledDate && isCalendarDate(schedule.scheduledDate)) {
    add(schedule.scheduledDate);
    if (schedule.repeatFlag) {
      const rule = ICAL.Recur.fromString(schedule.repeatFlag.replace(/^RRULE:/i, ''));
      const iterator = rule.iterator(ICAL.Time.fromDateString(schedule.scheduledDate));
      for (let count = 0; count < 150_000; count++) {
        const next = iterator.next();
        if (!next) break;
        const date = next.toString().slice(0, 10);
        if (date > through) break;
        add(date);
      }
    }
  }
  return [...dates].sort();
}

export function swimmingHairWashDates(schedule: HairWashSchedule | null | undefined, from: string, through: string,
  cycle: CycleSettings, periods: string[], duration = 0) {
  return hairWashDates(schedule, from, through).filter(date => {
    for (let offset = 0; offset <= duration; offset++) {
      const day = new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
      if (cycleDay(day, cycle, periods)?.phase === 'menstrual') return false;
    }
    return true;
  });
}
