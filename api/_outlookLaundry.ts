import { createHash } from 'node:crypto';
import { kv } from './_accountKv.js';
import { isLaundryTask, laundryLocation, LAUNDRY_CALENDAR_MINUTES, LAUNDRY_STATE_KEY, type LaundryState } from './_ticktickLaundry.js';
import { routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { wallTimeInstant } from './_calendarTimezone.js';
import { OUTLOOK_WRITE_KEY, OutlookWriteError, outlookGraphClient, withOutlookWriteLock, type GraphClient, type WriteConnection } from './_outlookWrite.js';

export const LAUNDRY_EVENT_PROPERTY = 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsLaundry';
interface Entry { eventId?: string; transactionId: string; deleted?: boolean; replacement?: number; adoptTaskUrl?: string; verifiedPlan?: string; verifiedOn?: string; duplicatesChecked?: boolean }
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
  // Calendar occupancy includes the full wash, independently of the task's effort estimate.
  const end = start + LAUNDRY_CALENDAR_MINUTES * 60_000;
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
function linked(event: CalendarEvent, task: TickTickTask) {
  const links = [...(event.body?.content ?? '').matchAll(/https:\/\/ticktick\.com\/webapp\/#p\/([^\s/<>"'&]+)\/tasks\/([^\s/<>"'&]+)/g)];
  return links.length > 0 && links.every(([, projectId, taskId]) => {
    try { return decodeURIComponent(projectId) === task.projectId && decodeURIComponent(taskId) === task.id; }
    catch { return false; }
  });
}
function futureAppointment(event: CalendarEvent, since: number) {
  return event.subject === '洗衣服' && event.type === 'singleInstance' && !event.isCancelled && !event.attendees?.length
    && instant(event.start) >= since && instant(event.end) > instant(event.start);
}
async function laundryAppointments(request: GraphClient, connection: WriteConnection, keepLease: () => Promise<void>) {
  const calendarId = connection.calendarId!;
  const calendarPath = `/me/calendars/${encodeURIComponent(calendarId)}/events`;
  const query = new URLSearchParams({ '$filter': "subject eq '洗衣服'", '$top': '100' });
  let path = `${calendarPath}?${query}&${expand}&${select}`;
  const events = new Map<string, CalendarEvent>();
  for (let page = 0; page < 5; page++) {
    await keepLease();
    const data = await request<{ value: CalendarEvent[]; '@odata.nextLink'?: string }>(path);
    for (const event of data.value) events.set(event.id, event);
    if (!data['@odata.nextLink']) return [...events.values()];
    let next: URL;
    try {
      next = new URL(data['@odata.nextLink']);
      // Graph can return the same calendar using OData key syntax on page two.
      // Compare decoded IDs before following either spelling of the same resource.
      const pathname = decodeURIComponent(next.pathname);
      const sameCalendar = pathname === `/v1.0/me/calendars/${calendarId}/events`
        || pathname === `/v1.0/me/calendars('${calendarId.replace(/'/g, "''")}')/events`;
      if (next.origin !== 'https://graph.microsoft.com' || next.username || next.password || next.hash || !sameCalendar) throw new Error();
    } catch { throw new OutlookWriteError('洗衣日程分页地址无效'); }
    // The existing Make scenario only accepts slash paths. Use the equivalent
    // validated calendar path there, preserving Graph's entire opaque query.
    path = (connection.provider === 'make' ? calendarPath : next.pathname.slice('/v1.0'.length)) + next.search;
  }
  throw new OutlookWriteError('洗衣日程查重未完成，请稍后重试');
}
async function syncEvents(request: GraphClient, connection: WriteConnection, api: TickTickApi, options: {
  tasks: TickTickTask[]; managedTaskIds: ReadonlySet<string>; ticktickConnectionId: string; configState: unknown; today: string;
  plannedDates: Record<string, string | null | undefined>; now?: Date;
}, keepLease: () => Promise<void>) {
  const calendarPath = `/me/calendars/${encodeURIComponent(connection.calendarId!)}/events`;
  const stateKey = `outlook:laundry-events:v1:${digest(connection.calendarId!)}`;
  const [saved, laundry] = await Promise.all([kv.get<EventsState>(stateKey), kv.get<LaundryState>(LAUNDRY_STATE_KEY)]);
  const state: EventsState = saved ?? { entries: {} };
  if (laundry?.connectionId !== options.ticktickConnectionId) return { created: 0, updated: 0 };
  const since = Math.max(Date.parse(`${options.today}T00:00:00+08:00`), options.now?.getTime() ?? Date.now());
  let created = 0, updated = 0, deleted = 0, verifiedCount = 0;
  for (const original of options.tasks.filter(task => options.managedTaskIds.has(task.id))) {
    const task = await api.getTask(original.projectId, original.id);
    if (routineTaskDate(task) !== options.plannedDates[task.id]) continue;
    const anchor = laundry.anchors[task.id];
    if (!anchor || anchor.projectId !== task.projectId || anchor.repeatFlag !== task.repeatFlag) continue;
    const plan = laundryEventPlan(task, options.today, laundryLocation(options.configState)?.name);
    if (!plan) continue;
    const key = digest(`${options.ticktickConnectionId}:${task.projectId}:${task.id}:${anchor.completion ?? anchor.target}`);
    const entry = state.entries[key] ??= { transactionId: key };
    const fingerprint = digest(JSON.stringify(plan));
    // Hosted relay calls cost credits. Only skip after an actual successful Graph readback.
    if (connection.provider === 'make' && entry.eventId && !entry.deleted && !entry.adoptTaskUrl
      && entry.duplicatesChecked && entry.verifiedPlan === fingerprint && entry.verifiedOn === options.today) continue;
    if (entry.verifiedPlan) { delete entry.verifiedPlan; await kv.set(stateKey, state); }
    // Include linked appointments from older cycles and connector-created copies,
    // which cannot be found by the current cycle's extended property alone.
    const appointments = await laundryAppointments(request, connection, keepLease);
    const belongsToTask = (candidate: CalendarEvent) => owned(candidate, key) || (linked(candidate, task)
      && (candidate.singleValueExtendedProperties ?? []).filter(property => property.id === LAUNDRY_EVENT_PROPERTY)
        .every(property => state.entries[property.value]?.eventId === candidate.id));
    const candidates = appointments.filter(event => futureAppointment(event, since) && belongsToTask(event));
    let event: CalendarEvent | undefined;
    if (entry.eventId) {
      try { event = await request<CalendarEvent>(`${calendarPath}/${encodeURIComponent(entry.eventId)}?${expand}&${select}`); }
      catch (error) {
        if (!(error instanceof OutlookWriteError) || error.status !== 404) throw error;
        // A stale/missing ID is not a permanent opt-out. Recover by ownership
        // first, then recreate the pending appointment if it is truly absent.
      }
    }
    if (!event) {
      // Recover a successful POST even if its response or the local save was lost.
      const found = appointments.filter(candidate => owned(candidate, key));
      event = found.find(candidate => instant(candidate.start) === instant(plan.start)) ?? found[0];
      // Reuse an explicitly linked future appointment before creating another.
      if (!event) event = candidates.find(candidate => instant(candidate.start) === instant(plan.start)) ?? candidates[0];
      if (!event && (entry.eventId || entry.deleted)) {
        entry.replacement = (entry.replacement ?? 0) + 1;
        entry.transactionId = digest(`${key}:replacement:${entry.replacement}`);
        delete entry.eventId; delete entry.deleted; delete entry.verifiedOn;
        await kv.set(stateKey, state);
      }
    }
    const adopt = Boolean(event && !owned(event, key) && ((entry.adoptTaskUrl && event.body?.content?.includes(entry.adoptTaskUrl))
      || (futureAppointment(event, since) && belongsToTask(event))));
    if (event && ((!owned(event, key) && !adopt) || event.subject !== '洗衣服' || (event.type && event.type !== 'singleInstance') || event.attendees?.length))
      throw new OutlookWriteError('洗衣日程已被修改或添加参与人，请先核对');
    if (event?.isCancelled) throw new OutlookWriteError('洗衣日程已取消，请先核对');
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
    entry.eventId = event.id; delete entry.adoptTaskUrl; delete entry.deleted; await kv.set(stateKey, state);
    const verified = await request<CalendarEvent>(`${calendarPath}/${encodeURIComponent(event.id)}?${expand}&${select}`);
    if (!owned(verified, key) || instant(verified.start) !== instant(plan.start) || instant(verified.end) !== instant(plan.end))
      throw new OutlookWriteError('Outlook 洗衣日程回读不一致，请稍后重试');
    // Only remove obsolete future plans after the retained appointment is verified.
    // Historical activity, manual namesakes and events with guests stay untouched.
    for (const duplicate of candidates.filter(candidate => candidate.id !== verified.id)) {
      const path = `${calendarPath}/${encodeURIComponent(duplicate.id)}`;
      let current: CalendarEvent;
      try { current = await request<CalendarEvent>(`${path}?${expand}&${select}`); }
      catch (error) { if (error instanceof OutlookWriteError && error.status === 404) continue; throw error; }
      if (!futureAppointment(current, since) || !belongsToTask(current)) continue;
      if (!current['@odata.etag']) throw new OutlookWriteError('日程版本不可用，请稍后重试');
      const latest = await api.getTask(task.projectId, task.id);
      if (JSON.stringify(laundryEventPlan(latest, options.today, laundryLocation(options.configState)?.name)) !== JSON.stringify(plan))
        throw new OutlookWriteError('洗衣待办已变化，保留旧日程等待下次同步');
      await keepLease();
      try { await request(path, { method: 'DELETE', headers: { 'If-Match': current['@odata.etag'] } }); }
      catch (error) { if (!(error instanceof OutlookWriteError) || error.status !== 404) throw error; }
      try { await request(`${path}?$select=id`); }
      catch (error) { if (error instanceof OutlookWriteError && error.status === 404) { deleted++; continue; } throw error; }
      throw new OutlookWriteError('旧洗衣日程删除未确认，请稍后重试');
    }
    entry.duplicatesChecked = true; entry.verifiedPlan = fingerprint; entry.verifiedOn = options.today;
    await kv.set(stateKey, state); verifiedCount++;
  }
  return { created, updated, deleted, verifiedCount };
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
