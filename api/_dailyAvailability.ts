import type { OutlookAvailability } from '../src/utils/outlookCalendar.js';
import type { TickTickTask } from './_ticktickTrips.js';

export type AvailabilityProfile = 'day' | 'evening' | 'calendar';
export const availabilityProfile = (value: unknown): AvailabilityProfile => value === 'evening' || value === 'calendar' ? value : 'day';
export type TimeSlot = [number, number];
const minute = 60_000;
const titleKey = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const localDay = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(Date.parse(value) + 8 * 60 * minute).toISOString().slice(0, 10) : undefined;
const taskDay = (task: TickTickTask) => localDay(task.dueDate ?? task.startDate);
const taskInterval = (task: TickTickTask, estimate: (task: TickTickTask) => number): TimeSlot | null => {
  if (task.isAllDay !== false) return null;
  const start = Date.parse(task.startDate ?? task.dueDate ?? '');
  if (!Number.isFinite(start)) return null;
  const end = Date.parse(task.dueDate ?? '');
  return [start, end > start ? end : start + estimate(task) * minute];
};
export const slotMinutes = (slots: TimeSlot[]) => slots.reduce((sum, [start, end]) => sum + (end - start) / minute, 0);
export function freeSlots(windows: TimeSlot[], busy: TimeSlot[]): TimeSlot[] {
  let slots = windows.map(([start, end]) => [start, end] as TimeSlot);
  for (const [start, end] of busy) slots = slots.flatMap(([from, to]): TimeSlot[] => {
    if (end <= from || start >= to) return [[from, to]];
    return [...(from < start ? [[from, start] as TimeSlot] : []), ...(end < to ? [[end, to] as TimeSlot] : [])];
  });
  return slots;
}
export function occupySlots(slots: TimeSlot[], minutes: number, contiguous = true): boolean {
  if (contiguous) {
    const slot = slots.find(([start, end]) => end - start >= minutes * minute);
    if (!slot) return false;
    slot[0] += minutes * minute;
  } else {
    let remaining = minutes * minute;
    for (const slot of slots) {
      const used = Math.min(remaining, slot[1] - slot[0]);
      slot[0] += used; remaining -= used;
    }
  }
  return true;
}

export function dayAvailability(options: {
  calendar: OutlookAvailability;
  day: string;
  today: string;
  now?: Date;
  profile?: AvailabilityProfile;
  scene?: string;
  tasks: TickTickTask[];
  fixed: TickTickTask[];
  completed: TickTickTask[];
  estimate: (task: TickTickTask) => number;
}) {
  const { calendar, day, today, tasks, fixed, completed, estimate } = options;
  if (day < calendar.startDate || day >= calendar.endDate) throw new Error('Outlook 日程范围不足，未调整每日安排');
  const profile = options.profile ?? 'day';
  const at = (hour: number) => Date.parse(`${day}T00:00:00+08:00`) + hour * 60 * minute;
  const windows: TimeSlot[] = (profile === 'calendar' ? [[0, 24]] : profile === 'evening' ? [[19, 22]] : [[9, 12], [13, 18], [19, 22]])
    .map(([start, end]) => [at(start), at(end)]);
  const events = calendar.events.filter((event) => Date.parse(event.start) < at(24) && Date.parse(event.end) > at(0));
  const busy: TimeSlot[] = events.map((event) => [Date.parse(event.start), Date.parse(event.end)]);
  // All-day scene markers have no hours. Reserve daytime for work/travel,
  // while leaving the evening available to tasks allowed in that scene.
  if (profile !== 'calendar' && ['intern', 'travel'].includes(options.scene ?? '')) busy.push([at(9), at(18)]);
  const relevant = tasks.filter((task) => !(task.tags ?? []).includes('不关我事'));
  const important = relevant.filter((task) => (task.priority ?? 0) >= 5 && !(task.tags ?? []).includes('routine')
    && Boolean(taskDay(task) && (day === today ? taskDay(task)! <= day : taskDay(task) === day)));
  const commitments = [...new Map([...important, ...fixed].map((task) => [task.id, task])).values()];
  const titleCounts = new Map<string, number>();
  for (const task of [...commitments, ...completed]) titleCounts.set(titleKey(task.title), (titleCounts.get(titleKey(task.title)) ?? 0) + 1);
  const matchingEvent = (task: TickTickTask) => {
    if (titleCounts.get(titleKey(task.title)) !== 1) return undefined;
    const matching = events.filter((event) => titleKey(event.title) === titleKey(task.title));
    // Identical copies across calendars count as the same reservation; ambiguous occurrences do not.
    const unique = [...new Map(matching.map((event) => [`${event.start}/${event.end}`, event])).values()];
    return unique.length === 1 ? unique[0] : undefined;
  };
  for (const task of relevant) {
    const interval = taskInterval(task, estimate);
    if (interval && !matchingEvent(task)) busy.push(interval);
  }
  for (const task of completed) {
    const interval = taskInterval(task, estimate);
    if (interval && !matchingEvent(task)) busy.push(interval);
  }
  const uncovered = (task: TickTickTask) => {
    if (matchingEvent(task)) return 0;
    const interval = taskInterval(task, estimate);
    // A past overdue appointment still needs time today unless today's Outlook already contains it.
    if (interval && interval[0] < at(24) && interval[1] > at(0)) return 0;
    return estimate(task);
  };
  const reserved = commitments.reduce((sum, task) => sum + uncovered(task), 0);
  const completedMinutes = completed.reduce((sum, task) => sum + uncovered(task), 0);
  const full = freeSlots(windows, busy);
  const now = day === today ? (options.now?.getTime() ?? Date.now()) : at(0);
  const slots = full.map(([start, end]): TimeSlot => [Math.max(start, now), end]).filter(([start, end]) => end > start);
  // Important/fixed tasks consume time once, before leaving room for rest and unrecorded transitions.
  occupySlots(slots, reserved, false);
  const share = profile === 'calendar' ? 1 : 0.5;
  const totalMinutes = Math.floor(Math.max(0, slotMinutes(full) - reserved) * share);
  const remainingMinutes = Math.floor(slotMinutes(slots) * share);
  return { totalMinutes, remainingMinutes, completedMinutes, slots };
}
