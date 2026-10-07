import { createHash } from 'node:crypto';
import { wallTimeInstant } from './_calendarTimezone.js';
import { kv } from './_accountKv.js';
import type { TickTickApi, TickTickTask } from './_ticktickTrips.js';

const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase();
const isNightRoutine = (task: TickTickTask) => normalized(task.title).replace(/\s+/g, '') === '夜间routine';
export const isHairWashTask = (task: TickTickTask) => normalized(task.title) === '洗头';
export const isReadingTask = (task: TickTickTask) => ['阅读', '而阅读📖是另一个🪝'].includes(normalized(task.title));
export const TICKTICK_HIDDEN_TAG = 'bon-hidden';
export const hasHiddenTag = (task: TickTickTask) => (task.tags ?? []).some(tag => normalized(tag) === TICKTICK_HIDDEN_TAG);
const hasUserRoutine = (task: TickTickTask) => (task.tags ?? []).some(tag => normalized(tag) === 'routine');

export const sleepTagStateKey = (projectId: string) => `ticktick:sleep-tags:v1:${createHash('sha256').update(projectId).digest('hex')}`;

export interface RoutineTagEntry {
  projectId: string;
  addedOn: string;
  phase: 'adding' | 'added' | 'restoring';
}
export type RoutineTagJournal = Record<string, RoutineTagEntry>;

function localTime(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

export function nightRoutineHidden(task: TickTickTask, now = new Date(), fallbackTimeZone = 'Asia/Shanghai'): boolean | null {
  if (!isNightRoutine(task) || (task.status ?? 0) !== 0 || task.isAllDay !== false) return null;
  const start = Date.parse(task.startDate ?? '');
  if (!Number.isFinite(start)) return null;
  try {
    const timeZone = task.timeZone || fallbackTimeZone;
    const scheduled = localTime(new Date(start), timeZone);
    const current = localTime(now, timeZone);
    // Future occurrences stay hidden. An unfinished previous occurrence is
    // hidden again after midnight until its configured start time tonight.
    return scheduled.day > current.day || current.time < scheduled.time;
  } catch {
    return null; // Do not guess a start time if the task's timezone is invalid.
  }
}

interface VisibilityOptions {
  tasks?: TickTickTask[];
  now?: Date;
  timeZone?: string;
  projectId?: string;
}

export function hairWashHidden(task: TickTickTask, now = new Date()): boolean | null {
  if (!isHairWashTask(task) || (task.status ?? 0) !== 0) return null;
  return localTime(now, 'Asia/Shanghai').time < '20:00:00';
}

export function syncHairWashVisibility(api: TickTickApi, options: VisibilityOptions = {}) {
  return syncRoutineVisibility(api, options, isHairWashTask,
    task => hairWashHidden(task, options.now ?? new Date()));
}

export function readingHidden(task: TickTickTask, now = new Date()): boolean | null {
  if (!isReadingTask(task) || (task.status ?? 0) !== 0) return null;
  const time = localTime(now, 'Asia/Shanghai').time;
  return time >= '05:00:00' && time < '20:00:00';
}

export function syncReadingVisibility(api: TickTickApi, options: VisibilityOptions = {}) {
  return syncRoutineVisibility(api, options, isReadingTask,
    task => readingHidden(task, options.now ?? new Date()));
}

export function syncNightRoutineVisibility(api: TickTickApi, options: VisibilityOptions = {}) {
  return syncRoutineVisibility(api, options, isNightRoutine,
    task => nightRoutineHidden(task, options.now ?? new Date(), options.timeZone), 5);
}

export function timedTaskHidden(task: TickTickTask, now = new Date(), fallbackTimeZone = 'Asia/Shanghai'): boolean | null {
  if ((task.status ?? 0) !== 0 || task.isAllDay !== false) return null;
  const value = task.startDate ?? task.dueDate ?? '';
  if (!value) return null;
  let scheduled: number;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    scheduled = Date.parse(value);
  } else {
    try {
      scheduled = Date.parse(wallTimeInstant(value, task.timeZone || fallbackTimeZone));
    } catch {
      return null;
    }
  }
  if (!Number.isFinite(scheduled)) return null;
  return now.getTime() < scheduled;
}

export function syncTimedTaskVisibility(api: TickTickApi, options: VisibilityOptions = {}) {
  return syncRoutineVisibility(api, options,
    task => task.isAllDay === false && Boolean(task.startDate || task.dueDate),
    task => timedTaskHidden(task, options.now ?? new Date(), options.timeZone));
}

async function syncRoutineVisibility(api: TickTickApi, options: VisibilityOptions,
  matches: (task: TickTickTask) => boolean, hiddenFor: (task: TickTickTask) => boolean | null, priorityOverride?: number) {
  let tasks = options.tasks;
  if (!tasks) {
    // The filter endpoint omits the built-in Inbox on some accounts.
    const [filtered, inbox] = await Promise.all([api.filterTasks(undefined, [0]), api.getProjectData('inbox')]);
    tasks = [...new Map([...filtered, ...inbox.tasks].map(task => [task.id, task])).values()];
  }
  const journalKey = options.projectId ? sleepTagStateKey(options.projectId) : null;
  const journal = journalKey ? await kv.get<RoutineTagJournal>(journalKey) ?? {} : null;
  const today = options.now ? localTime(options.now, 'Asia/Shanghai').day : localTime(new Date(), 'Asia/Shanghai').day;
  const save = () => journalKey ? kv.set(journalKey, journal) : Promise.resolve('OK');

  const result = { matched: 0, updated: 0, hidden: 0, visible: 0, skipped: 0 };
  for (const candidate of tasks.filter(task => matches(task) && (task.status ?? 0) === 0)) {
    // Re-read only matching tasks, preserving edits and repeat occurrences
    // created since the list was fetched.
    const task = await api.getTask(candidate.projectId, candidate.id);
    if (!task || task.id !== candidate.id || task.projectId !== candidate.projectId) throw new Error('无法读取 routine 任务，未修改标签');
    const hidden = hiddenFor(task);
    if (hidden === null) { result.skipped++; continue; }
    result.matched++;
    result[hidden ? 'hidden' : 'visible']++;
    // Only the night routine needs high priority for "今天重要之事".
    const priority = priorityOverride ?? task.priority;
    const hasTag = hasHiddenTag(task);
    const owned = journal && journal[task.id];
    if (!hidden && owned && !hasTag) {
      // Legacy journals may claim a user-owned routine tag. Never remove it:
      // absence of bon-hidden means there is nothing left for the system to restore.
      delete journal![task.id];
      await save();
    }
    if (hidden) {
      if (hasTag) {
        if ((owned || priorityOverride !== undefined) && task.priority !== priority) {
          await writeHiddenTag(api, task, true, priority);
          result.updated++;
        }
      } else {
        if (journal && journalKey) {
          journal[task.id] = { projectId: task.projectId, addedOn: today, phase: 'adding' };
          await save();
        }
        await writeHiddenTag(api, task, true, priority);
        if (journal && journalKey) {
          journal[task.id].phase = 'added';
          await save();
        }
        result.updated++;
      }
    } else {
      if (hasTag) {
        if (journal && journalKey && owned) {
          journal[task.id].phase = 'restoring';
          await save();
        }
        await writeHiddenTag(api, task, false, priority);
        if (journal && journalKey && owned) {
          delete journal[task.id];
          await save();
        }
        result.updated++;
      } else if (priorityOverride !== undefined && task.priority !== priority) {
        await writeHiddenTag(api, task, false, priority);
        result.updated++;
      }
    }
  }
  return result;
}

export async function restoreUserRoutineTags(api: TickTickApi, tasks: TickTickTask[]) {
  const titles = new Set(['晨间routine', '🏫吃午饭了', '🏠吃午饭了'].map(normalized));
  let updated = 0;
  for (const candidate of tasks.filter(task => (task.status ?? 0) === 0 && titles.has(normalized(task.title)))) {
    const task = await api.getTask(candidate.projectId, candidate.id);
    if (!task || hasUserRoutine(task)) { if (task) candidate.tags = task.tags; continue; }
    const tags = [...(task.tags ?? []), 'routine'];
    const payload: Record<string, unknown> = { id: task.id, projectId: task.projectId, title: task.title, tags };
    if (task.priority !== undefined) payload.priority = task.priority;
    for (const key of ['content', 'desc', 'isAllDay', 'startDate', 'dueDate', 'timeZone', 'reminders',
      'repeatFlag', 'repeatFrom', 'sortOrder', 'kind', 'parentId', 'items'] as const) {
      if (task[key] !== undefined) payload[key] = task[key];
    }
    await api.updateTask(task.id, payload);
    const saved = await api.getTask(task.projectId, task.id);
    if (!saved || !hasUserRoutine(saved)) throw new Error(`TickTick 未恢复 ${task.title} 的 routine 标签`);
    candidate.tags = saved.tags;
    updated++;
  }
  return { matched: tasks.filter(task => titles.has(normalized(task.title))).length, updated };
}

export async function writeHiddenTag(api: TickTickApi, task: TickTickTask, hidden: boolean, priority = task.priority) {
  const tags = (task.tags ?? []).filter(tag => normalized(tag) !== TICKTICK_HIDDEN_TAG);
  if (hidden) tags.push(TICKTICK_HIDDEN_TAG);
  // Keep all existing writable fields; status is deliberately omitted so
  // a concurrent completion cannot be reopened by a tag update.
  const payload: Record<string, unknown> = { id: task.id, projectId: task.projectId, title: task.title, tags };
  if (priority !== undefined) payload.priority = priority;
  for (const key of ['content', 'desc', 'isAllDay', 'startDate', 'dueDate', 'timeZone', 'reminders',
    'repeatFlag', 'repeatFrom', 'sortOrder', 'kind', 'parentId', 'items'] as const) {
    if (task[key] !== undefined) payload[key] = task[key];
  }
  await api.updateTask(task.id, payload);
  const saved = await api.getTask(task.projectId, task.id);
  const savedTags = [...(saved?.tags ?? [])].sort();
  if (saved?.id !== task.id || (priority !== undefined && saved.priority !== priority)
    || JSON.stringify(savedTags) !== JSON.stringify([...tags].sort())) {
    throw new Error('TickTick 未保存 bon-hidden 标签或优先级');
  }
  if ((saved.repeatFlag ?? '') !== (task.repeatFlag ?? '') || String(saved.repeatFrom ?? '') !== String(task.repeatFrom ?? '')
    || (['startDate', 'dueDate'] as const).some(key => task[key] !== saved[key] && Date.parse(task[key] ?? '') !== Date.parse(saved[key] ?? ''))) {
    throw new Error('TickTick 未保留 routine 日期或重复规则');
  }
  return saved;
}
