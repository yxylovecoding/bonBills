import { estimateTaskMinutes } from './_ticktickDailyPlan.js';
import { isHairWashTask } from './_ticktickNightRoutine.js';
import { routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { localEventTime } from './_outlookTaskEvents.js';
import { syncRecurringTaskOutlook, type RecurringTaskEventOptions } from './_outlookRecurringTaskEvents.js';

export const HAIR_WASH_EVENT_PROPERTY = 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsHairWash';

export function hairWashEventPlan(task: TickTickTask, today: string) {
  const day = routineTaskDate(task);
  if (!isHairWashTask(task) || (task.status ?? 0) !== 0 || task.completedTime || !day || day < today
    || (task.tags ?? []).some(tag => tag.normalize('NFKC').trim() === '不关我事')) return null;
  const start = task.isAllDay === false ? Date.parse(task.startDate ?? task.dueDate ?? '') : Date.parse(`${day}T20:00:00+08:00`);
  if (!Number.isFinite(start)) return null;
  return { subject: '洗头', start: localEventTime(start), end: localEventTime(start + estimateTaskMinutes(task) * 60_000) };
}

export function syncHairWashOutlook(api: TickTickApi, options: RecurringTaskEventOptions) {
  return syncRecurringTaskOutlook(api, options, {
    subject: '洗头', propertyId: HAIR_WASH_EVENT_PROPERTY, statePrefix: 'outlook:hair-wash-events:v1',
    cyclesKey: 'ticktick:hair-wash-cycles:v1', plan: task => hairWashEventPlan(task, options.today),
  });
}
