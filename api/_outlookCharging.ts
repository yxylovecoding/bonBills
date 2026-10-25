import { routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { localEventTime } from './_outlookTaskEvents.js';
import { syncRecurringTaskOutlook, type RecurringTaskEventOptions } from './_outlookRecurringTaskEvents.js';

export const CHARGING_EVENT_PROPERTY = 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsCharging';
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

export function syncChargingOutlook(api: TickTickApi, options: RecurringTaskEventOptions) {
  return syncRecurringTaskOutlook(api, options, {
    subject: '电动车充电', propertyId: CHARGING_EVENT_PROPERTY, statePrefix: 'outlook:charging-events:v1',
    cyclesKey: 'ticktick:charging-cycles:v1', plan: task => chargingEventPlan(task, options.today),
  });
}
