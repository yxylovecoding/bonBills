import { createHash } from 'node:crypto';
import { kv } from '@vercel/kv';
import { estimateTaskMinutes } from './_ticktickDailyPlan.js';
import { isLaundryTask, laundryLocation, LAUNDRY_STATE_KEY, type LaundryState } from './_ticktickLaundry.js';
import { routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { wallTimeInstant } from './_calendarTimezone.js';
import { OUTLOOK_WRITE_KEY, OutlookWriteError, outlookGraphClient, withOutlookWriteLock, type GraphClient, type WriteConnection } from './_outlookWrite.js';

export const LAUNDRY_EVENT_PROPERTY = 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsLaundry';
interface Entry { eventId?: string; transactionId: string; deleted?: boolean; adoptTaskUrl?: string; verifiedPlan?: string }
interface EventsState { entries: Record<string, Entry> }
interface EventTime { dateTime: string; timeZone: string }
interface CalendarEvent {
  id: string; subject: string; start: EventTime; end: EventTime; isCancelled?: boolean; type?: string;
  attendees?: unknown[]; location?: { displayName?: string }; '@odata.etag'?: string; body?: { content?: string };
  singleValueExtendedProperties?: { id: string; value: string }[];
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const expand = `$expand=singleValueExtendedProperties($filter=id eq '${LAUNDRY_EVENT_PROPERTY}')`;
const select = '$select=id,subject,start,end,type,isCancelled,attendees,location,body';

export function laundryEventPlan(task: TickTickTask, today: string, location?: string) {
  const day = routineTaskDate(task);
  if (!isLaundryTask(task) || (task.status ?? 0) !== 0 || task.completedTime || !day || day < today) return null;
  const start = task.isAllDay === false ? Date.parse(task.startDate ?? task.dueDate ?? '') : Date.parse(`${day}T08:00:00+08:00`);
  if (!Number.isFinite(start)) return null;
  // Match the daily plan: explicit duration first, otherwise laundry defaults to 50 minutes.
  const end = start + estimateTaskMinutes(task) * 60_000;
  const local = (time: number): EventTime => ({ dateTime: new Date(time + 8 * 3600_000).toISOString().slice(0, 19), timeZone: 'Asia/Shanghai' });
  return { subject: '洗衣服', start: local(start), end: local(end), ...(location ? { location: { displayName: location } } : {}) };
}
function instant(time: EventTime) {
  if (/(?:Z|[+-]\d\d:\d\d)$/.test(time.dateTime)) return Date.parse(time.dateTime);
  try { return Date.parse(wallTimeInstant(time.dateTime.replace(/\.\d+$/, ''), time.timeZone === 'China Standard Time' ? 'Asia/Shanghai' : time.timeZone)); }
  catch { return NaN; }
}
function owned(event: CalendarEvent, key: string) {
  return event.singleValueExtendedProperties?.some(property => property.id === LAUNDRY_EVENT_PROPERTY && property.value === key);
}
async function syncEvents(request: GraphClient, connection: WriteConnection, api: TickTickApi, options: {
  tasks: TickTickTask[]; managedTaskIds: ReadonlySet<string>; ticktickConnectionId: string; configState: unknown; today: string;
  plannedDates: Record<string, string | null | undefined>;
}, keepLease: () => Promise<void>) {
  const calendarPath = `/me/calendars/${encodeURIComponent(connection.calendarId!)}/events`;
  const stateKey = `outlook:laundry-events:v1:${digest(connection.calendarId!)}`;
  const [saved, laundry] = await Promise.all([kv.get<EventsState>(stateKey), kv.get<LaundryState>(LAUNDRY_STATE_KEY)]);
  const state: EventsState = saved ?? { entries: {} };
  if (laundry?.connectionId !== options.ticktickConnectionId) return { created: 0, updated: 0 };
  let created = 0, updated = 0, verifiedCount = 0;
  for (const original of options.tasks.filter(task => options.managedTaskIds.has(task.id))) {
    const task = await api.getTask(original.projectId, original.id);
    if (routineTaskDate(task) !== options.plannedDates[task.id]) continue;
    const anchor = laundry.anchors[task.id];
    if (!anchor || anchor.projectId !== task.projectId || anchor.repeatFlag !== task.repeatFlag) continue;
    const plan = laundryEventPlan(task, options.today, laundryLocation(options.configState)?.name);
    if (!plan) continue;
    const key = digest(`${options.ticktickConnectionId}:${task.projectId}:${task.id}:${anchor.completion ?? anchor.target}`);
    const entry = state.entries[key] ??= { transactionId: key };
    if (entry.deleted) continue;
    const fingerprint = digest(JSON.stringify(plan));
    // Hosted relay calls cost credits. Only skip after an actual successful Graph readback.
    if (connection.provider === 'make' && entry.eventId && !entry.adoptTaskUrl && entry.verifiedPlan === fingerprint) continue;
    if (entry.verifiedPlan) { delete entry.verifiedPlan; await kv.set(stateKey, state); }
    let event: CalendarEvent | undefined;
    if (entry.eventId) {
      try { event = await request<CalendarEvent>(`${calendarPath}/${encodeURIComponent(entry.eventId)}?${expand}&${select}`); }
      catch (error) {
        if (!(error instanceof OutlookWriteError) || error.status !== 404) throw error;
        entry.deleted = true; await kv.set(stateKey, state); continue; // Respect a user's deletion of this cycle.
      }
    } else {
      // Recover a successful POST even if its response or the local save was lost.
      const query = new URLSearchParams({ '$filter': `singleValueExtendedProperties/Any(ep: ep/id eq '${LAUNDRY_EVENT_PROPERTY}' and ep/value eq '${key}')`, '$top': '2' });
      const found = await request<{ value: CalendarEvent[]; '@odata.nextLink'?: string }>(`${calendarPath}?${query}&${expand}&${select}`);
      if (found.value.length > 1 || found['@odata.nextLink']) throw new OutlookWriteError('发现重复洗衣日程，请先核对');
      event = found.value[0];
    }
    const adopt = Boolean(event && entry.adoptTaskUrl && event.body?.content?.includes(entry.adoptTaskUrl));
    if (event && ((!owned(event, key) && !adopt) || event.subject !== '洗衣服' || (event.type && event.type !== 'singleInstance') || event.attendees?.length))
      throw new OutlookWriteError('洗衣日程已被修改或添加参与人，请先核对');
    if (event?.isCancelled) { entry.deleted = true; await kv.set(stateKey, state); continue; }
    // Recheck task completion/date/content immediately before calendar writes.
    const fresh = await api.getTask(task.projectId, task.id);
    if (JSON.stringify(laundryEventPlan(fresh, options.today, laundryLocation(options.configState)?.name)) !== JSON.stringify(plan)) continue;
    await keepLease();
    if (!event) {
      await kv.set(stateKey, state); // Persist idempotency key before the external write.
      event = await request<CalendarEvent>(calendarPath, { method: 'POST', body: JSON.stringify({ ...plan,
        body: { contentType: 'Text', content: `https://ticktick.com/webapp/#p/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}` },
        attendees: [], isReminderOn: false, showAs: 'busy', transactionId: entry.transactionId,
        singleValueExtendedProperties: [{ id: LAUNDRY_EVENT_PROPERTY, value: key }] }) });
      if (!event.id) throw new OutlookWriteError('Outlook 未返回日程标识');
      created++;
    } else if (adopt || instant(event.start) !== instant(plan.start) || instant(event.end) !== instant(plan.end)
      || (plan.location && event.location?.displayName !== plan.location.displayName)) {
      if (!event['@odata.etag']) throw new OutlookWriteError('日程版本不可用，请稍后重试');
      event = await request<CalendarEvent>(`${calendarPath}/${encodeURIComponent(event.id)}`, {
        method: 'PATCH', headers: { 'If-Match': event['@odata.etag'] }, body: JSON.stringify({ start: plan.start, end: plan.end,
          ...('location' in plan ? { location: plan.location } : {}), ...(adopt ? { singleValueExtendedProperties: [{ id: LAUNDRY_EVENT_PROPERTY, value: key }] } : {}) }),
      });
      updated++;
    }
    entry.eventId = event.id; delete entry.adoptTaskUrl; await kv.set(stateKey, state);
    const verified = await request<CalendarEvent>(`${calendarPath}/${encodeURIComponent(event.id)}?${expand}&${select}`);
    if (!owned(verified, key) || instant(verified.start) !== instant(plan.start) || instant(verified.end) !== instant(plan.end))
      throw new OutlookWriteError('Outlook 洗衣日程回读不一致，请稍后重试');
    entry.verifiedPlan = fingerprint; await kv.set(stateKey, state); verifiedCount++;
  }
  return { created, updated, verifiedCount };
}
export async function syncLaundryOutlook(api: TickTickApi, options: Parameters<typeof syncEvents>[3]) {
  if (!options.managedTaskIds.size) return { enabled: false, created: 0, updated: 0 };
  return withOutlookWriteLock(async keepLease => {
    const connection = await kv.get<WriteConnection>(OUTLOOK_WRITE_KEY);
    if (!connection?.calendarId) return { enabled: false, created: 0, updated: 0 };
    try {
      const result = await syncEvents(await outlookGraphClient(connection), connection, api, options, keepLease);
      if (result.verifiedCount) connection.lastSyncAt = new Date().toISOString();
      delete connection.lastError;
      await kv.set(OUTLOOK_WRITE_KEY, connection);
      return { enabled: true, ...result };
    } catch (error) {
      connection.lastError = error instanceof OutlookWriteError ? error.message : 'Outlook 日程同步暂不可用，请重试';
      await kv.set(OUTLOOK_WRITE_KEY, connection);
      return { enabled: true, error: connection.lastError, created: 0, updated: 0 };
    }
  });
}
