import type { TickTickApi, TickTickTask } from './_ticktickTrips.js';

const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase();
const isNightRoutine = (task: TickTickTask) => normalized(task.title).replace(/\s+/g, '') === '夜间routine';
const hasRoutine = (task: TickTickTask) => (task.tags ?? []).some(tag => normalized(tag) === 'routine');

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

export async function syncNightRoutineVisibility(api: TickTickApi, options: {
  tasks?: TickTickTask[];
  now?: Date;
  timeZone?: string;
} = {}) {
  let tasks = options.tasks;
  if (!tasks) {
    // The filter endpoint omits the built-in Inbox on some accounts.
    const [filtered, inbox] = await Promise.all([api.filterTasks(undefined, [0]), api.getProjectData('inbox')]);
    tasks = [...new Map([...filtered, ...inbox.tasks].map(task => [task.id, task])).values()];
  }
  const result = { matched: 0, updated: 0, hidden: 0, visible: 0, skipped: 0 };
  for (const candidate of tasks.filter(task => isNightRoutine(task) && (task.status ?? 0) === 0)) {
    // Re-read only matching tasks, preserving edits and repeat occurrences
    // created since the list was fetched.
    const task = await api.getTask(candidate.projectId, candidate.id);
    if (!task || task.id !== candidate.id) throw new Error('无法读取夜间 routine，未修改标签');
    const hidden = nightRoutineHidden(task, options.now ?? new Date(), options.timeZone);
    if (hidden === null) { result.skipped++; continue; }
    result.matched++;
    result[hidden ? 'hidden' : 'visible']++;
    // bon's "今天重要之事" filter also requires high priority.
    if (hasRoutine(task) === hidden && task.priority === 5) continue;
    const tags = (task.tags ?? []).filter(tag => normalized(tag) !== 'routine');
    if (hidden) tags.push('routine');
    // Keep all existing writable fields; status is deliberately omitted so
    // a concurrent completion cannot be reopened by a tag update.
    const payload: Record<string, unknown> = { id: task.id, projectId: task.projectId, title: task.title, tags, priority: 5 };
    for (const key of ['content', 'desc', 'isAllDay', 'startDate', 'dueDate', 'timeZone', 'reminders',
      'repeatFlag', 'repeatFrom', 'sortOrder', 'kind', 'parentId', 'items'] as const) {
      if (task[key] !== undefined) payload[key] = task[key];
    }
    await api.updateTask(task.id, payload);
    const saved = await api.getTask(task.projectId, task.id);
    const savedTags = [...(saved?.tags ?? [])].sort();
    if (saved?.id !== task.id || saved.priority !== 5 || JSON.stringify(savedTags) !== JSON.stringify([...tags].sort())) {
      throw new Error('TickTick 未保存夜间 routine 标签或优先级');
    }
    if ((saved.repeatFlag ?? '') !== (task.repeatFlag ?? '') || String(saved.repeatFrom ?? '') !== String(task.repeatFrom ?? '')
      || (['startDate', 'dueDate'] as const).some(key => task[key] !== saved[key] && Date.parse(task[key] ?? '') !== Date.parse(saved[key] ?? ''))) {
      throw new Error('TickTick 未保留夜间 routine 日期或重复规则');
    }
    result.updated++;
  }
  return result;
}
