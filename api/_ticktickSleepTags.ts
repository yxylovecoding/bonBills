import { createHash } from 'node:crypto';
import { kv } from './_accountKv.js';
import { calendarDateInTimeZone, readAllTickTickTasks, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { hairWashHidden, isHairWashTask, isReadingTask, nightRoutineHidden, readingHidden,
  sleepTagStateKey, syncHairWashVisibility, syncReadingVisibility, timedTaskHidden, writeRoutineTag,
  type RoutineTagEntry as SleepTagEntry, type RoutineTagJournal as SleepTagJournal } from './_ticktickNightRoutine.js';

export { sleepTagStateKey, type SleepTagEntry, type SleepTagJournal };

const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase();
const hasRoutine = (task: TickTickTask) => (task.tags ?? []).some(tag => normalize(tag) === 'routine');
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

export function sleepWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hidden: Number(parts.hour) < 5 };
}

// Union of bon's four saved smart filters, read from TickTick on 2026-10-05.
// Keep the important-today filter's intentional lack of 不关我事 exclusion.
export function inSleepFilterScope(task: TickTickTask, today: string) {
  if ((task.status ?? 0) !== 0 || hasRoutine(task) || isReadingTask(task)) return false;
  const tags = (task.tags ?? []).map(normalize);
  const date = calendarDateInTimeZone(task.dueDate, task.timeZone);
  const priority = task.priority ?? 0;
  if (priority === 5) {
    if (date && date <= today) return true;
    return !tags.includes('不关我事') && !tags.includes('当天')
      && (!date || (date > today && date <= addDays(today, 21)));
  }
  return [0, 1, 3].includes(priority) && !tags.includes('不关我事') && (!date || date <= addDays(today, 30));
}

// Caller holds the shared TickTick write lock. No TTL: an interrupted morning
// must retain ownership until every temporary tag has actually been restored.
export async function syncSleepRoutineTags(api: TickTickApi, options: {
  projectId: string;
  now?: Date;
  restoreOnly?: boolean;
  maxTasks?: number;
  timeBudgetMs?: number;
}) {
  const started = Date.now();
  const window = sleepWindow(options.now);
  const mode = window.hidden ? 'hide' : 'restore';
  const result = { mode, updated: 0, remaining: 0, complete: true };
  if (options.restoreOnly && window.hidden) return result;
  if (!options.projectId) throw new Error('无法确认 TickTick 连接，未修改临时标签');
  const key = sleepTagStateKey(options.projectId);
  const journal = await kv.get<SleepTagJournal>(key) ?? {};
  const save = () => kv.set(key, journal);
  const limit = options.maxTasks ?? 20;
  const timeBudget = options.timeBudgetMs ?? 80_000;

  if (mode === 'hide') {
    const tasks = await readAllTickTickTasks(api, [0]);
    // Reading stays visible across midnight and owns its routine tag until 05:00.
    await syncReadingVisibility(api, { tasks, now: options.now, projectId: options.projectId });
    // Reuse midnight to hide washing until 20:00, including future occurrences
    // outside the four smart filters. It owns this tag until the evening.
    await syncHairWashVisibility(api, { tasks: tasks.filter(task => !hasRoutine(task)), now: options.now, projectId: options.projectId });
    const candidates = tasks.filter(task => !isHairWashTask(task) && inSleepFilterScope(task, window.day));
    let processed = 0;
    for (const candidate of candidates) {
      if (processed >= limit || Date.now() - started >= timeBudget || !sleepWindow(options.now).hidden) break;
      const task = await api.getTask(candidate.projectId, candidate.id);
      if (task?.id !== candidate.id || task.projectId !== candidate.projectId) throw new Error('临时标签任务读取失败');
      processed++;
      // A task that already had routine is never enrolled in the restore journal.
      if (!inSleepFilterScope(task, window.day)) continue;
      journal[task.id] = { projectId: task.projectId, addedOn: window.day, phase: 'adding' };
      await save(); // Write-ahead ownership survives a timeout after the API saved the tag.
      await writeRoutineTag(api, task, true);
      journal[task.id].phase = 'added';
      await save();
      result.updated++;
    }
    result.remaining = candidates.length - processed;
  } else {
    // Run even with an empty journal: recurring reading tasks need the daytime
    // tag every morning, independently of whether midnight masked other tasks.
    await syncReadingVisibility(api, { now: options.now, projectId: options.projectId });
    const entries = Object.entries(journal);
    if (!entries.length) return result;
    // Resolve moved tasks by ID; completed tasks can still be fetched from their
    // recorded project. Restoration never depends on today's filter membership.
    const tasks = await readAllTickTickTasks(api, [0]);
    const projectsByTask = new Map(tasks.map(task => [task.id, task.projectId]));
    let processed = 0;
    for (const [id, entry] of entries) {
      if (processed >= limit || Date.now() - started >= timeBudget || sleepWindow(options.now).hidden) break;
      let task: TickTickTask;
      try { task = await api.getTask(projectsByTask.get(id) ?? entry.projectId, id); }
      catch (error) {
        if (!(error instanceof Error) || !/^TickTick 404\b/.test(error.message)) throw error;
        delete journal[id]; await save(); processed++; continue;
      }
      if (task?.id !== id) throw new Error('临时标签任务读取失败');
      // Specific evening visibility rules take ownership again in the morning.
      if (hasRoutine(task) && nightRoutineHidden(task, options.now) !== true && hairWashHidden(task, options.now) !== true
        && readingHidden(task, options.now) !== true && timedTaskHidden(task, options.now) !== true) {
        entry.phase = 'restoring';
        await save();
        // Merge with current tags, preserving tags added by the user overnight.
        await writeRoutineTag(api, task, false);
        result.updated++;
      }
      delete journal[id];
      await save();
      processed++;
    }
    result.remaining = Object.keys(journal).length;
  }
  result.complete = result.remaining === 0;
  return result;
}
