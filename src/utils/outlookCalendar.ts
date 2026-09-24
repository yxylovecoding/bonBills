import type { TagKind } from '../models/types';

export type OutlookCalendarKind = 'play' | 'class';
export type OutlookTag = Extract<TagKind, 'travel' | 'intern' | 'home'>;
export type OutlookConflictPolicy = 'manual' | 'outlook';

export interface OutlookDayEvent {
  calendar: OutlookCalendarKind;
  title: string;
  startDate: string;
  endDate: string; // Exclusive, preserving the calendar's all-day date (never UTC-converted).
  allDay: boolean;
  cancelled?: boolean;
}

export interface OutlookRules {
  homeTitles: string[];
  ignoredPlayTitles: string[];
}

export const DEFAULT_OUTLOOK_RULES: OutlookRules = { homeTitles: ['🏠'], ignoredPlayTitles: ['新卡池', '新卡池&新月卡'] };

// Match reminder titles, not arbitrary event titles ending in “节” (e.g. 平遥电影节).
const HOLIDAY_REMINDER_TITLES = new Set([
  '元旦', '元旦节', '春节', '除夕', '元宵节', '清明节', '劳动节', '端午节', '中秋节', '国庆节',
  '七夕', '七夕节', '重阳节', '妇女节', '植树节', '青年节', '儿童节', '建党节', '建军节', '教师节',
  '情人节', '母亲节', '父亲节', '感恩节', '平安夜', '圣诞', '圣诞节',
]);

export interface OutlookSnapshot {
  startDate: string;
  endDate: string;
  tags: Record<string, OutlookTag>;
  travelTitles?: Record<string, string>;
}

export interface OutlookAppliedDay {
  tag: OutlookTag;
  previousTag: TagKind | null;
}

export type OutlookAppliedDays = Record<string, OutlookAppliedDay>;

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function nextCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function buildOutlookSnapshot(
  events: OutlookDayEvent[], startDate: string, endDate: string, rules: OutlookRules,
): OutlookSnapshot {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate >= endDate
    || Date.parse(endDate) - Date.parse(startDate) > 740 * 86_400_000) {
    throw new Error('日历同步日期无效');
  }
  const tags: Record<string, OutlookTag> = {};
  const titlesByDay: Record<string, Set<string>> = {};
  const homeTitles = new Set(rules.homeTitles.map((title) => title.trim()));
  const ignoredTitles = new Set(rules.ignoredPlayTitles.map((title) => title.trim()));
  const priority = { intern: 1, home: 2, travel: 3 };
  for (const event of events) {
    if (!event.allDay || event.cancelled) continue;
    const title = event.title.trim();
    if (HOLIDAY_REMINDER_TITLES.has(title)) continue;
    const tag: OutlookTag | null = event.calendar === 'class'
      ? (title === '实习' ? 'intern' : 'travel')
      : ignoredTitles.has(title) ? null : homeTitles.has(title) ? 'home' : 'travel';
    if (!tag) continue;
    if (!isCalendarDate(event.startDate) || !isCalendarDate(event.endDate) || event.startDate >= event.endDate) {
      throw new Error('Outlook 全天日程日期无效');
    }
    const start = event.startDate > startDate ? event.startDate : startDate;
    const end = event.endDate < endDate ? event.endDate : endDate;
    for (let day = start; day < end; day = nextCalendarDate(day)) {
      if (!tags[day] || priority[tag] > priority[tags[day]]) tags[day] = tag;
      if (tag === 'travel' && title) (titlesByDay[day] ??= new Set()).add(title);
    }
  }
  const travelTitles = Object.fromEntries(Object.entries(titlesByDay).map(([day, titles]) => [day, [...titles].sort().join('、')]));
  return { startDate, endDate, tags, travelTitles };
}

export function normalizeOutlookTravelTitles(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(Object.entries(input).filter(([day, title]) => isCalendarDate(day) && typeof title === 'string' && title.trim()).map(([day, title]) => [day, (title as string).trim()]));
}

export function getTripDisplayTitle(billTag: string | undefined, dates: string[], travelTitles: Record<string, string>): string {
  return billTag?.trim() || [...new Set(dates.map((day) => travelTitles[day]).filter(Boolean))].join('、');
}

export function reconcileOutlookSnapshot(
  current: Record<string, TagKind>, applied: OutlookAppliedDays, manualDates: Record<string, true>,
  snapshot: OutlookSnapshot, policy: OutlookConflictPolicy,
): { tagMap: Record<string, TagKind>; outlookApplied: OutlookAppliedDays; manualTagDates: Record<string, true> } {
  const tagMap = { ...current };
  const outlookApplied = { ...applied };
  const manualTagDates = { ...manualDates };
  const days = new Set([...Object.keys(applied), ...Object.keys(snapshot.tags)]);
  for (const day of days) {
    if (day < snapshot.startDate || day >= snapshot.endDate) continue;
    const previous = applied[day];
    const next = snapshot.tags[day];
    const manuallyChanged = Boolean(manualDates[day]) || (previous && current[day] !== previous.tag);
    if (!next) {
      if (previous && !manuallyChanged && current[day] === previous.tag) {
        if (previous.previousTag) tagMap[day] = previous.previousTag;
        else delete tagMap[day];
      }
      delete outlookApplied[day];
      continue;
    }
    // Older calendars do not distinguish hand-entered school days from automatic school defaults.
    const legacyManual = !previous && current[day] && current[day] !== 'school';
    if (policy === 'manual' && (manuallyChanged || legacyManual)) continue;
    const previousTag = previous && !manuallyChanged ? previous.previousTag : current[day] ?? null;
    tagMap[day] = next;
    outlookApplied[day] = { tag: next, previousTag };
    delete manualTagDates[day];
  }
  return { tagMap, outlookApplied, manualTagDates };
}

export function normalizeOutlookCalendarState(state: Record<string, unknown>) {
  const manualTagDates: Record<string, true> = {};
  const outlookApplied: OutlookAppliedDays = {};
  const validTag = (value: unknown): value is TagKind => ['intern', 'school', 'home', 'travel'].includes(String(value));
  if (state.manualTagDates && typeof state.manualTagDates === 'object') {
    for (const [day, value] of Object.entries(state.manualTagDates)) if (isCalendarDate(day) && value === true) manualTagDates[day] = true;
  }
  if (state.outlookApplied && typeof state.outlookApplied === 'object') {
    for (const [day, raw] of Object.entries(state.outlookApplied)) {
      const value = raw as Partial<OutlookAppliedDay> | null;
      if (isCalendarDate(day) && value && ['intern', 'home', 'travel'].includes(String(value.tag))
        && (value.previousTag === null || validTag(value.previousTag))) outlookApplied[day] = value as OutlookAppliedDay;
    }
  }
  return { manualTagDates, outlookApplied };
}

// Shared by the browser and background sync so cancellations and manual overrides agree.
export function applyOutlookSnapshotToState(state: Record<string, unknown>, snapshot: OutlookSnapshot, policy: OutlookConflictPolicy) {
  const source = normalizeOutlookCalendarState(state);
  const tagMap = state.tagMap && typeof state.tagMap === 'object' ? state.tagMap as Record<string, TagKind> : {};
  const next = reconcileOutlookSnapshot(tagMap, source.outlookApplied, source.manualTagDates, snapshot, policy);
  const outlookTravelTitles = normalizeOutlookTravelTitles(state.outlookTravelTitles);
  for (const day of Object.keys(outlookTravelTitles)) {
    if (day >= snapshot.startDate && day < snapshot.endDate) delete outlookTravelTitles[day];
  }
  for (const [day, title] of Object.entries(normalizeOutlookTravelTitles(snapshot.travelTitles))) {
    if (day >= snapshot.startDate && day < snapshot.endDate && snapshot.tags[day] === 'travel') outlookTravelTitles[day] = title;
  }
  return { ...state, ...next, outlookTravelTitles };
}
