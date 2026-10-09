import type { DoneItem } from './bonLife';
import { isCalendarDate } from './outlookCalendar.js';

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

// 根据完成时间戳差值推算每个任务的耗时（分钟）：
// 把一天内所有任务按完成时间升序排列，相邻两次完成之间的时间差即为后一个任务的耗时；
// 第一项没有前驱，使用其余项的中位数作为兜底，若全天只有一项则兜底为 15 分钟。
// 结果用于「今日完成」三列视图按耗时比例渲染任务块高度。
export function computeDoneDurations(items: DoneItem[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const minutes = new Map<string, number>();
  const diffs: number[] = [];
  for (let index = 1; index < sorted.length; index++) {
    const delta = (Date.parse(sorted[index].completedAt) - Date.parse(sorted[index - 1].completedAt)) / 60_000;
    const safe = Number.isFinite(delta) && delta > 0 ? delta : 15;
    minutes.set(sorted[index].id, safe);
    diffs.push(safe);
  }
  if (sorted.length) {
    const fallback = diffs.length ? [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)] : 15;
    minutes.set(sorted[0].id, fallback);
  }
  return minutes;
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
