import ICAL from 'ical.js';
import { collectCompleted } from './_lifeDone.js';
import { calendarDateInTimeZone, getTickTickRoutineTargetDates, routineOccurrenceKey, routineRecurrence,
  routineScenes, routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';

export const DAILY_PLAN_KEY = 'ticktick:daily-plan:v1';
export const DAILY_PLAN_SETTINGS_KEY = 'ticktick:daily-plan-settings:v1';
const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const tags = (task: TickTickTask) => (task.tags ?? []).map((tag) => tag.normalize('NFKC').trim());
const pending = (task: TickTickTask) => (task.status ?? 0) === 0;
const ordinary = (task: TickTickTask) => !tags(task).some((tag) => tag === 'routine' || tag === '不关我事') && (task.priority ?? 0) < 5;
const identity = (task: TickTickTask) => JSON.stringify([task.projectId, task.id]);

export interface DailyPlanSummary {
  date: string;
  todayCount: number;
  plannedMinutes: number;
  availableMinutes: number;
  importantCount: number;
  deferredCount: number;
  cycleRiskCount: number;
  oversizedCount: number;
}
export interface DailyPlanState {
  connectionId: string;
  historyThrough?: string;
  history: TickTickTask[];
  // The original date is retained across deferrals; postponement is not completion.
  deadlines: Record<string, { date: string; completion?: string; repeatFlag?: string }>;
  summary?: DailyPlanSummary;
}
export const dailyBudget = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(10, Math.min(240, Math.round(value))) : 30;

export function estimateTaskMinutes(task: TickTickTask): number {
  const explicit = `${task.title} ${(task.tags ?? []).join(' ')}`.match(/(?:^|\s|[（(])([1-9]\d{0,2})\s*(?:分钟|min(?:utes)?|m)(?:\b|\s|[）)]|$)/i);
  if (explicit) return Math.min(480, Number(explicit[1]));
  if (task.isAllDay === false && task.startDate && task.dueDate) {
    const duration = (Date.parse(task.dueDate) - Date.parse(task.startDate)) / 60_000;
    if (duration > 0 && Number.isFinite(duration)) return Math.min(480, Math.ceil(duration));
  }
  if (/喷雾|浇水|倒垃圾|换枕套|剪指甲/.test(task.title)) return 5;
  if (/徒步|出去玩|音乐剧|讲座|电影|ktv/i.test(task.title)) return 90;
  return (task.priority ?? 0) >= 5 ? 45 : 15;
}

// The next interval starts at the last actual completion, never at a date we moved.
export function cycleEnd(task: TickTickTask, lastDay: string): string | null {
  if (routineRecurrence(task.repeatFlag) === 'unknown' || !task.repeatFlag) return null;
  try {
    const rule = ICAL.Recur.fromString(task.repeatFlag.replace(/^RRULE:/i, ''));
    const iterator = rule.iterator(ICAL.Time.fromDateString(lastDay));
    for (let i = 0; i < 370; i++) {
      const next = iterator.next();
      if (!next) return null;
      const day = next.toString().slice(0, 10);
      if (day > lastDay) return day;
    }
  } catch { /* Unsupported recurrence keeps its existing date. */ }
  return null;
}

export async function refreshDailyHistory(api: TickTickApi, tasks: TickTickTask[], state: DailyPlanState, now = new Date()) {
  const through = state.historyThrough ? Date.parse(state.historyThrough) : NaN;
  const start = Number.isFinite(through) ? Math.max(now.getTime() - 60 * DAY, through - DAY) : now.getTime() - 60 * DAY;
  const projectIds = [...new Set(tasks.map((task) => task.projectId))];
  const deadline = Date.now() + 55_000;
  const count = now.getTime() - start > 14 * DAY ? 4 : 1;
  const windows = Array.from({ length: count }, (_, i) => ({
    from: Math.floor(start + (now.getTime() - start + 1) * i / count),
    until: Math.floor(start + (now.getTime() - start + 1) * (i + 1) / count) - 1,
  }));
  const rows = (await Promise.all(windows.map(({ from, until }) => collectCompleted(api, projectIds, from, until, deadline)))).flat();
  const records = new Map<string, TickTickTask>();
  for (const task of [...state.history, ...rows]) {
    if ((task.status ?? 2) !== 2) continue;
    if (!task.id || !task.projectId || !task.title || !task.completedTime || !Number.isFinite(Date.parse(task.completedTime))) {
      throw new Error('TickTick 完成记录无效，未调整每日安排');
    }
    if (Date.parse(task.completedTime) > now.getTime()) continue;
    const { id, projectId, parentId, title, completedTime, priority, tags, isAllDay, startDate, dueDate } = task;
    records.set(JSON.stringify([projectId, id, completedTime]), { id, projectId, parentId, title, completedTime, priority, tags, isAllDay, startDate, dueDate, status: 2 });
  }
  // Retain every recent occurrence for capacity learning, and the last completion
  // of each task ID and recurring series even after it leaves the provider window.
  const latest = new Map<string, TickTickTask>();
  for (const task of [...records.values()].sort((a, b) => Date.parse(a.completedTime!) - Date.parse(b.completedTime!))) {
    latest.set(identity(task), task);
    latest.set(routineOccurrenceKey(task), task);
  }
  state.history = [...new Set([...latest.values(), ...[...records.values()].filter((task) => Date.parse(task.completedTime!) >= now.getTime() - 30 * DAY)])];
  state.historyThrough = now.toISOString();
}

interface Candidate {
  task: TickTickTask;
  members: TickTickTask[];
  minutes: number;
  last?: string;
  deadline: string;
  next: string | null;
  cycleDays: number;
}

export function planTickTickDay(options: {
  tasks: TickTickTask[];
  calendarState: unknown;
  today: string;
  state: DailyPlanState;
  budgetMinutes?: number;
  excludedTaskIds?: ReadonlySet<string>;
}): { dates: Map<string, string>; summary: DailyPlanSummary } {
  const { tasks, calendarState, today, state, excludedTaskIds = new Set<string>() } = options;
  const tomorrow = addDays(today, 1);
  const horizon = addDays(today, 30);
  const dates = new Map<string, string>();
  const open = tasks.filter(pending);
  const byId = new Map(open.map((task) => [task.id, task]));
  const familyCounts = new Map<string, number>();
  for (const task of open) familyCounts.set(routineOccurrenceKey(task), (familyCounts.get(routineOccurrenceKey(task)) ?? 0) + 1);
  const lastById = new Map<string, string>(), lastByFamily = new Map<string, string>();
  for (const task of state.history) {
    const completed = task.completedTime;
    if (!completed || !Number.isFinite(Date.parse(completed)) || (calendarDateInTimeZone(completed) ?? '') > today) continue;
    for (const [index, key] of [[lastById, identity(task)], [lastByFamily, routineOccurrenceKey(task)]] as const) {
      if (!index.has(key) || Date.parse(completed) > Date.parse(index.get(key)!)) index.set(key, completed);
    }
  }
  const lastCompletion = (task: TickTickTask) => {
    const exact = lastById.get(identity(task));
    const series = familyCounts.get(routineOccurrenceKey(task)) === 1 ? lastByFamily.get(routineOccurrenceKey(task)) : undefined;
    return [exact, series].filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  };
  const sceneDate = (task: TickTickTask, from: string) => {
    const scenes = routineScenes(task);
    if (!scenes.length) return from;
    const targets = getTickTickRoutineTargetDates(calendarState, from);
    return scenes.map((scene) => targets[scene]).filter((day): day is string => Boolean(day)).sort()[0] ?? null;
  };
  const excluded = (task: TickTickTask) => {
    const seen = new Set<string>();
    let current: TickTickTask | undefined = task;
    while (current && !seen.has(current.id)) {
      if (excludedTaskIds.has(current.id) || Boolean(current.parentId && excludedTaskIds.has(current.parentId))) return true;
      seen.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  const protectedTask = (task: TickTickTask) => excluded(task)
    || !ordinary(task) || task.isAllDay === false || routineRecurrence(task.repeatFlag) === 'unknown'
    || tags(task).includes('洗头') || task.title.normalize('NFKC').trim() === '洗头';
  const candidates: Candidate[] = [];
  for (const task of open) {
    const members = [task];
    if (members.some(protectedTask)) continue;
    const date = routineTaskDate(task);
    if (date && date > horizon) continue;
    const last = lastCompletion(task);
    const lastDay = calendarDateInTimeZone(last);
    const saved = state.deadlines[task.id];
    const end = lastDay ? cycleEnd(task, lastDay) : null;
    const deadline = end ?? (saved && saved.completion === last && saved.repeatFlag === task.repeatFlag
      ? saved.date : date ?? addDays(today, 7));
    const minutes = members.reduce((sum, member) => sum + estimateTaskMinutes(member), 0);
    const cycleDays = end && lastDay ? Math.max(1, daysBetween(lastDay, end)) : task.repeatFlag
      ? Math.max(1, daysBetween(today, cycleEnd(task, today) ?? addDays(today, 7))) : 14;
    const nextDates = members.map((member) => sceneDate(member, tomorrow));
    // Scene constraints apply to each task independently, as in the existing scheduler.
    let next: string | null = nextDates.some((day) => !day) ? null : nextDates.sort().at(-1)!;
    for (let i = 0; next && i < 740; i++) {
      const allowed = members.map((member) => sceneDate(member, next!));
      if (allowed.every((day) => day === next)) break;
      next = allowed.some((day) => !day) ? null : allowed.sort().at(-1)!;
      if (i === 739) next = null;
    }
    const allowedToday = members.every((member) => sceneDate(member, today) === today);
    if (!allowedToday) {
      // Scene rules win even for long-cycle, overdue or undated backlog items.
      if (next && (!date || date <= today)) for (const member of members) dates.set(member.id, next);
      continue;
    }
    // Do not pull future commitments forward. Tomorrow's flexible repeats can
    // enter today's pool to distribute work before the cycle ends.
    if (date && date > today && (date > tomorrow || (!task.repeatFlag && !saved))) continue;
    state.deadlines[task.id] = { date: deadline, completion: last, repeatFlag: task.repeatFlag };
    if (lastDay === today) {
      if (next && (!date || date <= today)) for (const member of members) dates.set(member.id, next);
      continue;
    }
    candidates.push({ task, members, minutes, last, deadline, next, cycleDays });
  }
  const candidateIds = new Set(candidates.flatMap((candidate) => candidate.members.map((task) => task.id)));
  const important = open.filter((task) => (task.priority ?? 0) >= 5 && !tags(task).includes('routine')
    && Boolean(routineTaskDate(task) && routineTaskDate(task)! <= today));
  const importantMinutes = important.reduce((sum, task) => sum + estimateTaskMinutes(task), 0);
  const fixed = open.filter((task) => ordinary(task) && !candidateIds.has(task.id) && !dates.has(task.id) && routineTaskDate(task) === today);
  const fixedMinutes = fixed.reduce((sum, task) => sum + estimateTaskMinutes(task), 0);
  const historyByDay = new Map<string, number>();
  const seenHistory = new Set<string>();
  for (const task of state.history) {
    const day = calendarDateInTimeZone(task.completedTime);
    if (!day || !ordinary(task) || day < addDays(today, -14) || day > today) continue;
    const key = JSON.stringify([identity(task), task.completedTime]);
    if (seenHistory.has(key)) continue;
    seenHistory.add(key);
    historyByDay.set(day, (historyByDay.get(day) ?? 0) + estimateTaskMinutes(task));
  }
  const base = dailyBudget(options.budgetMinutes);
  const completedDays = [...historyByDay].filter(([day]) => day < today).map(([, minutes]) => minutes).sort((a, b) => a - b);
  const typical = completedDays.length >= 4 ? completedDays[Math.floor((completedDays.length - 1) / 2)] : base;
  // The chosen budget is a ceiling; history may lower it, never inflate it.
  const learned = Math.min(base, Math.max(base / 2, typical));
  const capacity = Math.floor(learned / (1 + importantMinutes / 90));
  const alreadyDone = historyByDay.get(today) ?? 0;
  const available = Math.max(0, capacity - fixedMinutes - alreadyDone);
  const demand = candidates.reduce((sum, candidate) => {
    const remaining = Math.max(1, Math.min(candidate.cycleDays, daysBetween(today, candidate.deadline) + 1));
    // Count only usable scene dates remaining in the cycle.
    let usable = 0;
    for (let i = 0; i < Math.min(remaining, 30); i++) if (candidate.members.every((task) => sceneDate(task, addDays(today, i)) === addDays(today, i))) usable++;
    return sum + candidate.minutes / Math.max(1, usable);
  }, 0);
  const target = Math.min(available, Math.ceil(demand));
  candidates.sort((a, b) => {
    const urgent = (candidate: Candidate) => candidate.deadline <= today || !candidate.next || candidate.next > candidate.deadline;
    return Number(urgent(b)) - Number(urgent(a))
      || (a.last ? Date.parse(a.last) : Date.parse(a.task.createdTime ?? '') || 0) - (b.last ? Date.parse(b.last) : Date.parse(b.task.createdTime ?? '') || 0)
      || a.deadline.localeCompare(b.deadline) || a.task.id.localeCompare(b.task.id);
  });
  let used = 0, selected = 0, deferred = 0, cycleRiskCount = 0, oversizedCount = 0;
  for (const candidate of candidates) {
    // A task larger than the remaining budget is reported instead of silently overbooking.
    const choose = !candidate.next || (used < target && used + candidate.minutes <= available);
    if (choose) {
      used += candidate.minutes; selected += candidate.members.length;
      for (const member of candidate.members) dates.set(member.id, today);
    } else {
      if (candidate.next) {
        for (const member of candidate.members) dates.set(member.id, candidate.next);
        deferred += candidate.members.length;
      }
      if (candidate.task.repeatFlag && (!candidate.next || candidate.next > candidate.deadline)) cycleRiskCount++;
      if (candidate.minutes > capacity) oversizedCount++;
    }
  }
  for (const id of Object.keys(state.deadlines)) if (!byId.has(id)) delete state.deadlines[id];
  const summary: DailyPlanSummary = { date: today, todayCount: fixed.length + selected, plannedMinutes: fixedMinutes + used,
    availableMinutes: capacity, importantCount: important.length, deferredCount: deferred, cycleRiskCount, oversizedCount };
  state.summary = summary;
  return { dates, summary };
}
