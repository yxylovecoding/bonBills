import type { DoneItem } from './bonLife';
import { isCalendarDate } from './outlookCalendar.js';
import { markedTaskMinutes, withoutDurationAnnotations } from './taskDuration.js';

export const DONE_CATEGORIES = ['课', '活', '玩'] as const;
export type DoneCategory = typeof DONE_CATEGORIES[number] | '未分类';
const categoryName = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');

export function classifyDoneCategory(taskTags: string[] = [], projectName = ''): DoneCategory {
  const tags = new Set(taskTags.map(categoryName).filter((tag) => (DONE_CATEGORIES as readonly string[]).includes(tag)));
  const project = categoryName(projectName);
  if (tags.size === 1) return [...tags][0] as DoneCategory;
  if ((DONE_CATEGORIES as readonly string[]).includes(project) && (!tags.size || tags.has(project))) return project as DoneCategory;
  return '未分类';
}

export function doneCategory(item: DoneItem): DoneCategory {
  return item.category ?? classifyDoneCategory([], item.projectName);
}

export function groupDoneCategories(items: DoneItem[]) {
  const groups = new Map<DoneCategory, DoneItem[]>(DONE_CATEGORIES.map((category) => [category, []]));
  for (const item of [...items].sort((a, b) => b.completedAt.localeCompare(a.completedAt))) {
    const category = doneCategory(item);
    const group = groups.get(category) ?? [];
    group.push(item); groups.set(category, group);
  }
  return [...groups].map(([category, entries]) => ({ category, items: entries }));
}

// 未标注任务用固定默认值，绝不把两次勾选之间的空档当作任务耗时。
export function computeDoneDurations(items: DoneItem[]): Map<string, number> {
  return new Map(items.map(item => [item.id, Number.isFinite(item.durationMinutes) && item.durationMinutes! > 0
    ? item.durationMinutes! : markedTaskMinutes(item) ?? 15]));
}

function doneTitle(title: string): string {
  return withoutDurationAnnotations(title).toLowerCase()
    .replace(/\d+(?:\.\d+)?\s*(?:小时|hours?|hrs?|h|分钟|minutes?|mins?|m)(?![a-z0-9])/gi, '')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

/** Exact task links take precedence; otherwise match equal titles on the same day, one occurrence at a time. */
export function mergeDoneItems(tasks: DoneItem[], events: DoneItem[]): DoneItem[] {
  const used = new Set<string>();
  const matchedEvents = new Set<DoneItem>();
  const seenEvents = new Set<string>();
  const unique = [...events].sort((a, b) => Number(Boolean(b.linkedTaskId)) - Number(Boolean(a.linkedTaskId)) || a.completedAt.localeCompare(b.completedAt)).filter(event => {
    const key = JSON.stringify([event.date, doneTitle(event.title), event.startedAt, event.completedAt]);
    if (seenEvents.has(key)) return false;
    seenEvents.add(key); return true;
  });
  const candidates = unique.flatMap(event => {
    const title = doneTitle(event.title);
    return tasks.filter(task => task.date === event.date
      && (event.linkedTaskId ? task.taskId === event.linkedTaskId && (!event.linkedProjectId || task.projectId === event.linkedProjectId)
        : Boolean(title) && doneTitle(task.title) === title))
      .map(task => ({ event, task, distance: Math.abs(Date.parse(task.completedAt) - Date.parse(event.completedAt)) }));
  }).sort((a, b) => Number(Boolean(b.event.linkedTaskId)) - Number(Boolean(a.event.linkedTaskId)) || a.distance - b.distance);
  for (const { event, task } of candidates) {
    if (used.has(task.id) || matchedEvents.has(event)) continue;
    used.add(task.id); matchedEvents.add(event);
  }
  return [...tasks, ...unique.filter(event => !matchedEvents.has(event))].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function splitDoneDays(items: DoneItem[], month: string, today: string) {
  const current: DoneItem[] = [];
  const history = new Map<string, DoneItem[]>();
  for (const item of items) {
    if (!item.date.startsWith(`${month}-`) || item.date > today) continue;
    if (item.date === today) current.push(item);
    else { const group = history.get(item.date) ?? []; group.push(item); history.set(item.date, group); }
  }
  return { current, history: [...history].sort(([a], [b]) => b.localeCompare(a)) };
}

export function doneWeekDates(date: string): string[] {
  if (!isCalendarDate(date)) return [];
  const anchor = new Date(`${date}T00:00:00Z`);
  const monday = anchor.getTime() - ((anchor.getUTCDay() + 6) % 7) * 86_400_000;
  return Array.from({ length: 7 }, (_, index) => new Date(monday + index * 86_400_000).toISOString().slice(0, 10));
}

export function doneWeekMonths(date: string, today: string): string[] {
  return [...new Set(doneWeekDates(date).filter((day) => day >= '1900-01-01' && day <= today).map((day) => day.slice(0, 7)))];
}

export function groupDoneWeek(items: DoneItem[], date: string, today: string) {
  const days = new Map(doneWeekDates(date).map((day) => [day, new Map<string, DoneItem>()]));
  for (const item of items) {
    const routine = item.tags?.some((tag) => tag.normalize('NFKC').trim().replace(/^#/, '').trim().toLowerCase() === 'routine');
    if (item.date <= today && !routine) days.get(item.date)?.set(item.id, item);
  }
  return [...days].map(([day, entries]) => ({ date: day, items: [...entries.values()] }));
}

export function shiftDoneDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function earlierDoneWeeks(before: string, count = 4): string[] {
  return Array.from({ length: count }, (_, index) => shiftDoneDate(before, -7 * (count - index))).filter((date) => date >= '1900-01-01');
}

export function doneWeekNumber(date: string): number {
  const thursday = new Date(`${doneWeekDates(date)[3]}T00:00:00Z`);
  return Math.ceil(((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}
