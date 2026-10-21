import { kv } from './_accountKv.js';
import { isLaundryTask, laundryLocation, LAUNDRY_CALENDAR_MINUTES, LAUNDRY_STATE_KEY, type LaundryState } from './_ticktickLaundry.js';
import { routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { syncTaskOutlook, type EventTime, type TaskEventOptions } from './_outlookTaskEvents.js';

export const LAUNDRY_EVENT_PROPERTY = 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsLaundry';
export function laundryEventPlan(task: TickTickTask, today: string, location?: string) {
  const day = routineTaskDate(task);
  if (!isLaundryTask(task) || (task.status ?? 0) !== 0 || task.completedTime || !day || day < today) return null;
  const start = task.isAllDay === false ? Date.parse(task.startDate ?? task.dueDate ?? '') : Date.parse(`${day}T08:00:00+08:00`);
  if (!Number.isFinite(start)) return null;
  // Calendar occupancy includes the full wash, independently of the task's effort estimate.
  const end = start + LAUNDRY_CALENDAR_MINUTES * 60_000;
  const local = (time: number): EventTime => ({ dateTime: new Date(time + 8 * 3600_000).toISOString().slice(0, 19), timeZone: 'Asia/Shanghai' });
  return { subject: '洗衣服', start: local(start), end: local(end), ...(location ? { location: { displayName: location } } : {}) };
}

export async function syncLaundryOutlook(api: TickTickApi, options: TaskEventOptions & { configState: unknown }) {
  if (!options.managedTaskIds.size) return { enabled: false, created: 0, updated: 0 };
  const laundry = await kv.get<LaundryState>(LAUNDRY_STATE_KEY);
  return syncTaskOutlook(api, options, {
    subject: '洗衣服', propertyId: LAUNDRY_EVENT_PROPERTY, statePrefix: 'outlook:laundry-events:v1',
    plan: task => laundryEventPlan(task, options.today, laundryLocation(options.configState)?.name),
    cycle: task => {
      const anchor = laundry?.connectionId === options.ticktickConnectionId ? laundry.anchors[task.id] : undefined;
      return anchor?.projectId === task.projectId && anchor.repeatFlag === task.repeatFlag ? anchor.completion ?? anchor.target : null;
    },
  });
}
