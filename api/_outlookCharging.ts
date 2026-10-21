import { kv } from './_accountKv.js';
import { routineOccurrenceKey, routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { localEventTime, syncTaskOutlook } from './_outlookTaskEvents.js';

export const CHARGING_EVENT_PROPERTY = 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsCharging';
const CYCLES_KEY = 'ticktick:charging-cycles:v1';
interface Cycle { projectId: string; repeatFlag?: string; completion?: string; target: string }
interface Cycles { connectionId: string; tasks: Record<string, Cycle> }
const pending = (task: TickTickTask) => (task.status ?? 0) === 0 && !task.completedTime;
const isCharging = (task: TickTickTask) => task.title.normalize('NFKC').trim() === '电动车充电'
  && !(task.tags ?? []).some(tag => tag.normalize('NFKC').trim() === '不关我事');

export function chargingEventPlan(task: TickTickTask, today: string) {
  const day = routineTaskDate(task);
  if (!isCharging(task) || !pending(task) || !day || day < today) return null;
  // Keep the previous charging appointment default, without replaying its old fixed date.
  const start = task.isAllDay === false ? Date.parse(task.startDate ?? task.dueDate ?? '') : Date.parse(`${day}T20:00:00+08:00`);
  if (!Number.isFinite(start)) return null;
  return { subject: '电动车充电', start: localEventTime(start), end: localEventTime(start + 60 * 60_000) };
}

export async function syncChargingOutlook(api: TickTickApi, options: {
  tasks: TickTickTask[]; history: TickTickTask[]; excludedTaskIds: ReadonlySet<string>;
  ticktickConnectionId: string; today: string; now?: Date;
}) {
  const byId = new Map(options.tasks.map(task => [task.id, task]));
  const tasks = options.tasks.filter(task => {
    if (!chargingEventPlan(task, options.today)) return false;
    const seen = new Set<string>();
    let current: TickTickTask | undefined = task;
    while (current && !seen.has(current.id)) {
      if (options.excludedTaskIds.has(current.id) || (current.parentId && options.excludedTaskIds.has(current.parentId))) return false;
      seen.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  });
  if (!tasks.length) return { enabled: false, created: 0, updated: 0 };
  const saved = await kv.get<Cycles>(CYCLES_KEY);
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
  await kv.set(CYCLES_KEY, cycles);
  return syncTaskOutlook(api, { ...options, tasks, managedTaskIds: new Set(tasks.map(task => task.id)),
    plannedDates: Object.fromEntries(tasks.map(task => [task.id, routineTaskDate(task)])),
  }, {
    subject: '电动车充电', propertyId: CHARGING_EVENT_PROPERTY, statePrefix: 'outlook:charging-events:v1',
    plan: task => chargingEventPlan(task, options.today),
    cycle: task => {
      const cycle = cycles.tasks[task.id];
      // A completed occurrence creates a new calendar cycle; a date edit does not.
      return cycle?.projectId === task.projectId && cycle.repeatFlag === task.repeatFlag && pending(task)
        ? cycle.completion ?? cycle.target : null;
    },
  });
}
