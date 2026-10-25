import { kv } from './_accountKv.js';
import { routineOccurrenceKey, routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { syncTaskOutlook, type EventSpec } from './_outlookTaskEvents.js';

interface Cycle { projectId: string; repeatFlag?: string; completion?: string; target: string }
interface Cycles { connectionId: string; tasks: Record<string, Cycle> }
export interface RecurringTaskEventOptions {
  tasks: TickTickTask[]; history: TickTickTask[]; excludedTaskIds: ReadonlySet<string>;
  ticktickConnectionId: string; today: string; now?: Date;
}
const pending = (task: TickTickTask) => (task.status ?? 0) === 0 && !task.completedTime;

export async function syncRecurringTaskOutlook(api: TickTickApi, options: RecurringTaskEventOptions,
  spec: Omit<EventSpec, 'cycle'> & { cyclesKey: string }) {
  const byId = new Map(options.tasks.map(task => [task.id, task]));
  const tasks = options.tasks.filter(task => {
    if (!spec.plan(task)) return false;
    const seen = new Set<string>();
    let current: TickTickTask | undefined = task;
    while (current && !seen.has(current.id)) {
      if (options.excludedTaskIds.has(current.id) || (current.parentId && options.excludedTaskIds.has(current.parentId))) return false;
      seen.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  });
  if (!tasks.length) return { enabled: false, created: 0, updated: 0 };
  const saved = await kv.get<Cycles>(spec.cyclesKey);
  const cycles: Cycles = saved?.connectionId === options.ticktickConnectionId ? saved : { connectionId: options.ticktickConnectionId, tasks: {} };
  const now = options.now ?? new Date();
  for (const task of tasks) {
    const previous = cycles.tasks[task.id];
    const sameRule = previous?.projectId === task.projectId && previous.repeatFlag === task.repeatFlag;
    const family = routineOccurrenceKey(task);
    const unique = options.tasks.filter(candidate => pending(candidate) && routineOccurrenceKey(candidate) === family).length === 1;
    const completion = [...options.history.filter(record => record.projectId === task.projectId
      && (record.id === task.id || (unique && routineOccurrenceKey(record) === family))).map(record => record.completedTime),
      ...(sameRule ? [previous.completion] : [])]
      .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)) && Date.parse(value!) <= now.getTime())
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    cycles.tasks[task.id] = { projectId: task.projectId, repeatFlag: task.repeatFlag, completion,
      target: sameRule && completion === previous.completion ? previous.target : routineTaskDate(task)! };
  }
  await kv.set(spec.cyclesKey, cycles);
  return syncTaskOutlook(api, { ...options, tasks, managedTaskIds: new Set(tasks.map(task => task.id)),
    plannedDates: Object.fromEntries(tasks.map(task => [task.id, routineTaskDate(task)])),
  }, {
    ...spec,
    cycle: task => {
      const cycle = cycles.tasks[task.id];
      // Completion starts a new cycle; moving the pending date keeps its appointment.
      return cycle?.projectId === task.projectId && cycle.repeatFlag === task.repeatFlag && pending(task)
        ? cycle.completion ?? cycle.target : null;
    },
  });
}
