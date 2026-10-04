import { kv } from '@vercel/kv';
import { DEFAULT_CYCLE, type CycleSettings } from '../src/utils/bonLife.js';
import { afterMenstrualPeriod, cycleDay } from '../src/utils/lifeCycle.js';
import { isCalendarDate } from '../src/utils/outlookCalendar.js';
import { LIFE_CONNECTION_KEY, LIFE_SETTINGS_KEY, readPeriodDays, syncLifePeriods, type LifeConnection } from './_bonLife.js';
import { acquireTickTickLock, releaseTickTickLock } from './_ticktickLock.js';
import { decryptTickTickToken, readAllTickTickTasks, shiftTickTickDate, TICKTICK_CONNECTION_KEY,
  TickTickOpenApiClient, type TickTickApi, type TickTickConnection, type TickTickTask } from './_ticktickTrips.js';

const DAY = 86_400_000;
const shanghaiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export function swimmingTaskDate(value: string | undefined, timeZone = 'Asia/Shanghai'): string | null {
  if (!value) return null;
  const date = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(value)) : value.slice(0, 10);
  if (!isCalendarDate(date)) throw new Error('游泳待办日期无效');
  return date;
}

export async function readSwimmingCycle(years: number[]) {
  const [settings, periods] = await Promise.all([
    kv.hgetall<{ cycle: CycleSettings }>(LIFE_SETTINGS_KEY),
    Promise.all([...new Set(years)].map(readPeriodDays)),
  ]);
  return { cycle: settings?.cycle ?? DEFAULT_CYCLE, periods: [...new Set(periods.flat())].sort() };
}

function pendingSwim(task: TickTickTask) {
  return task.title.includes('游泳') && (task.status ?? 0) === 0 && !task.completedTime;
}

export function swimmingTarget(task: TickTickTask, today: string, cycle: CycleSettings, periods: string[]) {
  if (!pendingSwim(task)) return null;
  const start = swimmingTaskDate(task.startDate || task.dueDate, task.timeZone);
  if (!start) return null;
  const due = swimmingTaskDate(task.dueDate, task.timeZone) || start;
  const duration = Math.max(0, Math.round((Date.parse(due) - Date.parse(start)) / DAY));
  // Overdue tasks are still pending today; never move an old task to another past date.
  let target = start < today ? today : start;
  if (duration > 90) throw new Error('游泳待办跨度过长，请检查日期');
  for (let attempt = 0; attempt < 90; attempt++) {
    let conflict: string | null = null;
    for (let offset = 0; offset <= duration; offset++) {
      const date = addDays(target, offset);
      if (cycleDay(date, cycle, periods)?.phase === 'menstrual') { conflict = date; break; }
    }
    if (!conflict) return target === start || (start < today && target === today) ? null : target;
    target = afterMenstrualPeriod(conflict, cycle, periods);
  }
  throw new Error('游泳待办无法避开经期，请检查日期');
}

export async function postponeSwimmingTasks(api: TickTickApi, tasks: TickTickTask[], today: string, cycle: CycleSettings, periods: string[]) {
  let updated = 0;
  for (const candidate of tasks) {
    if (!swimmingTarget(candidate, today, cycle, periods)) continue;
    // Re-read immediately before writing so a just-completed or edited task is respected.
    const task = await api.getTask(candidate.projectId, candidate.id);
    if (!task || task.id !== candidate.id || task.projectId !== candidate.projectId) throw new Error('游泳待办读取失败');
    const target = swimmingTarget(task, today, cycle, periods);
    if (!target) continue;
    const anchor = swimmingTaskDate(task.startDate || task.dueDate, task.timeZone)!;
    const shift = (date: string | undefined) => shiftTickTickDate(date, anchor, target);
    const payload = {
      id: task.id, projectId: task.projectId, title: task.title,
      content: task.content, desc: task.desc, isAllDay: task.isAllDay,
      startDate: shift(task.startDate), dueDate: shift(task.dueDate), timeZone: task.timeZone,
      reminders: task.reminders, tags: task.tags, repeatFlag: task.repeatFlag,
      priority: task.priority, sortOrder: task.sortOrder, kind: task.kind, parentId: task.parentId,
      items: task.items?.map((item) => item.completedTime || Number(item.status ?? 0) !== 0
        ? item : { ...item, startDate: shift(item.startDate) }),
    };
    await api.updateTask(task.id, payload);
    const saved = await api.getTask(task.projectId, task.id);
    const sameDate = (a?: string, b?: string) => a === b || Boolean(a && b && Date.parse(a) === Date.parse(b));
    if (!saved || saved.id !== task.id || saved.projectId !== task.projectId
      || !sameDate(saved.startDate, payload.startDate) || !sameDate(saved.dueDate, payload.dueDate)
      || (saved.repeatFlag || '') !== (task.repeatFlag || '')
      || payload.items?.some((item) => item.id && item.startDate && !sameDate(saved.items?.find((value) => value.id === item.id)?.startDate, item.startDate))) {
      throw new Error('游泳待办顺延未确认，请重新同步');
    }
    updated++;
  }
  return updated;
}

export async function syncSwimmingSchedule(options: { lockHeld?: boolean; refreshPeriods?: boolean } = {}) {
  const connection = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
  if (!connection) return { updated: 0 };
  const lock = options.lockHeld ? null : await acquireTickTickLock();
  if (!options.lockHeld && !lock) throw new Error('TickTick 正在同步，游泳待办稍后重试');
  try {
    const today = shanghaiToday();
    if (options.refreshPeriods) {
      const calendar = await kv.get<LifeConnection>(LIFE_CONNECTION_KEY);
      if (calendar) await syncLifePeriods(calendar, Number(today.slice(0, 4)));
    }
    const api = new TickTickOpenApiClient(decryptTickTickToken(connection.encryptedToken, (process.env.SYNC_SECRET || '').trim()),
      (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    const tasks = (await readAllTickTickTasks(api, [0])).filter(pendingSwim);
    const years = [Number(today.slice(0, 4)), ...tasks.flatMap((task) => [task.startDate, task.dueDate]
      .filter((date): date is string => Boolean(date)).map((date) => Number(date.slice(0, 4))))];
    const { cycle, periods } = await readSwimmingCycle(years);
    const current = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
    if (current?.encryptedToken.data !== connection.encryptedToken.data) throw new Error('连接已更新');
    return { updated: await postponeSwimmingTasks(api, tasks, today, cycle, periods) };
  } catch { throw new Error('TickTick 游泳待办顺延失败，请重新同步'); }
  finally { if (lock) await releaseTickTickLock(lock); }
}

// Saving the cycle must remain successful even if the independent TickTick write fails.
export async function swimmingSyncWarning() {
  try { await syncSwimmingSchedule(); return ''; }
  catch (error) { return error instanceof Error ? error.message : 'TickTick 游泳待办顺延失败，请重新同步'; }
}
