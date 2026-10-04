import type { DoneItem } from './bonLife';

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
