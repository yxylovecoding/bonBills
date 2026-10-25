import { createHash } from 'node:crypto';
import { kv } from './_accountKv.js';
import { calendarDateInTimeZone, routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { wallTimeInstant } from './_calendarTimezone.js';
import { OUTLOOK_WRITE_KEY, OutlookWriteError, outlookGraphClient, withOutlookWriteLock, type GraphClient, type WriteConnection } from './_outlookWrite.js';

interface Entry { eventId?: string; transactionId: string; deleted?: boolean; replacement?: number; adoptTaskUrl?: string; verifiedPlan?: string; verifiedOn?: string; duplicatesChecked?: boolean }
interface EventsState { entries: Record<string, Entry> }
export interface EventTime { dateTime: string; timeZone: string }
interface CalendarEvent {
  id: string; subject: string; start: EventTime; end: EventTime; isCancelled?: boolean; type?: string;
  attendees?: unknown[]; location?: { displayName?: string }; '@odata.etag'?: string; body?: { content?: string };
  singleValueExtendedProperties?: { id: string; value: string }[];
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const select = '$select=id,subject,start,end,type,isCancelled,attendees,location,body';

export const localEventTime = (time: number): EventTime => ({ dateTime: new Date(time + 8 * 3600_000).toISOString().slice(0, 19), timeZone: 'Asia/Shanghai' });
const propertyExpand = (id: string) => `$expand=singleValueExtendedProperties($filter=id eq '${id}')`;
export interface TaskEventOptions {
  tasks: TickTickTask[]; managedTaskIds: ReadonlySet<string>; ticktickConnectionId: string; today: string;
  plannedDates: Record<string, string | null | undefined>; now?: Date;
}
export interface EventSpec {
  subject: string; propertyId: string; statePrefix: string;
  cycle: (task: TickTickTask) => string | null;
  plan: (task: TickTickTask) => { subject: string; start: EventTime; end: EventTime; location?: { displayName: string } } | null;
}

function eventInstant(time: EventTime) {
  if (/(?:Z|[+-]\d\d:\d\d)$/.test(time.dateTime)) return Date.parse(time.dateTime);
  try { return Date.parse(wallTimeInstant(time.dateTime.replace(/\.\d+$/, ''), time.timeZone === 'China Standard Time' ? 'Asia/Shanghai' : time.timeZone)); }
  catch { return NaN; }
}
function owned(event: CalendarEvent, key: string, propertyId: string) {
  return event.singleValueExtendedProperties?.some(property => property.id === propertyId && property.value === key);
}
function linked(event: CalendarEvent, task: TickTickTask) {
  const links = [...(event.body?.content ?? '').matchAll(/https:\/\/ticktick\.com\/webapp\/#p\/([^\s/<>"'&]+)\/tasks\/([^\s/<>"'&]+)/g)];
  return links.length > 0 && links.every(([, projectId, taskId]) => {
    try { return decodeURIComponent(projectId) === task.projectId && decodeURIComponent(taskId) === task.id; }
    catch { return false; }
  });
}
function futureAppointment(event: CalendarEvent, since: number, spec: EventSpec) {
  return event.subject === spec.subject && event.type === 'singleInstance' && !event.isCancelled && !event.attendees?.length
    && eventInstant(event.start) >= since && eventInstant(event.end) > eventInstant(event.start);
}
async function taskAppointments(request: GraphClient, connection: WriteConnection, spec: EventSpec, keepLease: () => Promise<void>) {
  const expand = propertyExpand(spec.propertyId);
  const calendarId = connection.calendarId!;
  const calendarPath = `/me/calendars/${encodeURIComponent(calendarId)}/events`;
  const query = new URLSearchParams({ '$filter': `subject eq '${spec.subject.replace(/'/g, "''")}'`, '$top': '100' });
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
    } catch { throw new OutlookWriteError(`${spec.subject}日程分页地址无效`); }
    // The existing Make scenario only accepts slash paths. Use the equivalent
    // validated calendar path there, preserving Graph's entire opaque query.
    path = (connection.provider === 'make' ? calendarPath : next.pathname.slice('/v1.0'.length)) + next.search;
  }
  throw new OutlookWriteError(`${spec.subject}日程查重未完成，请稍后重试`);
}
async function syncEvents(request: GraphClient, connection: WriteConnection, api: TickTickApi, options: TaskEventOptions,
  spec: EventSpec, keepLease: () => Promise<void>) {
  const expand = propertyExpand(spec.propertyId);
  const calendarPath = `/me/calendars/${encodeURIComponent(connection.calendarId!)}/events`;
  const stateKey = `${spec.statePrefix}:${digest(connection.calendarId!)}`;
  const state = await kv.get<EventsState>(stateKey) ?? { entries: {} };
  const since = Math.max(Date.parse(`${options.today}T00:00:00+08:00`), options.now?.getTime() ?? Date.now());
  let created = 0, updated = 0, deleted = 0, verifiedCount = 0;
  for (const original of options.tasks.filter(task => options.managedTaskIds.has(task.id))) {
    const task = await api.getTask(original.projectId, original.id);
    if (routineTaskDate(task) !== options.plannedDates[task.id]) continue;
    const cycle = spec.cycle(task);
    if (!cycle) continue;
    const plan = spec.plan(task);
    if (!plan) continue;
    const key = digest(`${options.ticktickConnectionId}:${task.projectId}:${task.id}:${cycle}`);
    const entry = state.entries[key] ??= { transactionId: key };
    const fingerprint = digest(JSON.stringify(plan));
    // Hosted relay calls cost credits. Only skip after an actual successful Graph readback.
    if (connection.provider === 'make' && entry.eventId && !entry.deleted && !entry.adoptTaskUrl
      && entry.duplicatesChecked && entry.verifiedPlan === fingerprint && entry.verifiedOn === options.today) continue;
    if (entry.verifiedPlan) { delete entry.verifiedPlan; await kv.set(stateKey, state); }
    // Include linked appointments from older cycles and connector-created copies,
    // which cannot be found by the current cycle's extended property alone.
    const appointments = await taskAppointments(request, connection, spec, keepLease);
    const belongsToTask = (candidate: CalendarEvent) => owned(candidate, key, spec.propertyId) || (linked(candidate, task)
      && (candidate.singleValueExtendedProperties ?? []).filter(property => property.id === spec.propertyId)
        .every(property => state.entries[property.value]?.eventId === candidate.id));
    const candidates = appointments.filter(event => futureAppointment(event, since, spec) && belongsToTask(event));
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
      const found = appointments.filter(candidate => owned(candidate, key, spec.propertyId));
      event = found.find(candidate => eventInstant(candidate.start) === eventInstant(plan.start)) ?? found[0];
      // Reuse an explicitly linked future appointment before creating another.
      if (!event) event = candidates.find(candidate => eventInstant(candidate.start) === eventInstant(plan.start)) ?? candidates[0];
      if (!event && (entry.eventId || entry.deleted)) {
        entry.replacement = (entry.replacement ?? 0) + 1;
        entry.transactionId = digest(`${key}:replacement:${entry.replacement}`);
        delete entry.eventId; delete entry.deleted; delete entry.verifiedOn;
        await kv.set(stateKey, state);
      }
    }
    const adopt = Boolean(event && !owned(event, key, spec.propertyId) && ((entry.adoptTaskUrl && event.body?.content?.includes(entry.adoptTaskUrl))
      || (futureAppointment(event, since, spec) && belongsToTask(event))));
    if (event && ((!owned(event, key, spec.propertyId) && !adopt) || event.subject !== spec.subject || (event.type && event.type !== 'singleInstance') || event.attendees?.length))
      throw new OutlookWriteError(`${spec.subject}日程已被修改或添加参与人，请先核对`);
    if (event?.isCancelled) throw new OutlookWriteError(`${spec.subject}日程已取消，请先核对`);
    // Recheck task completion/date/content immediately before calendar writes.
    const fresh = await api.getTask(task.projectId, task.id);
    if (spec.cycle(fresh) !== cycle || JSON.stringify(spec.plan(fresh)) !== JSON.stringify(plan)) continue;
    // A same-day time change in Outlook takes precedence over the default task time.
    // Date changes still follow the pending task; the calendar duration stays fixed.
    const desired = event && eventInstant(event.end) > eventInstant(event.start)
      && calendarDateInTimeZone(new Date(eventInstant(event.start)).toISOString())
        === calendarDateInTimeZone(new Date(eventInstant(plan.start)).toISOString())
      ? { ...plan, start: event.start, end: localEventTime(eventInstant(event.start) + eventInstant(plan.end) - eventInstant(plan.start)) }
      : plan;
    await keepLease();
    if (!event) {
      await kv.set(stateKey, state); // Persist idempotency key before the external write.
      event = await request<CalendarEvent>(calendarPath, { method: 'POST', body: JSON.stringify({ ...plan,
        body: { contentType: 'Text', content: `https://ticktick.com/webapp/#p/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}` },
        attendees: [], isReminderOn: false, showAs: 'busy', transactionId: entry.transactionId,
        singleValueExtendedProperties: [{ id: spec.propertyId, value: key }] }) });
      if (!event.id) throw new OutlookWriteError('Outlook 未返回日程标识');
      created++;
    } else if (adopt || eventInstant(event.start) !== eventInstant(desired.start) || eventInstant(event.end) !== eventInstant(desired.end)
      || (plan.location && event.location?.displayName !== plan.location.displayName)) {
      if (!event['@odata.etag']) throw new OutlookWriteError('日程版本不可用，请稍后重试');
      event = await request<CalendarEvent>(`${calendarPath}/${encodeURIComponent(event.id)}`, {
        method: 'PATCH', headers: { 'If-Match': event['@odata.etag'] }, body: JSON.stringify({ start: desired.start, end: desired.end,
          ...('location' in plan ? { location: plan.location } : {}), ...(adopt ? { singleValueExtendedProperties: [{ id: spec.propertyId, value: key }] } : {}) }),
      });
      updated++;
    }
    entry.eventId = event.id; delete entry.adoptTaskUrl; delete entry.deleted; await kv.set(stateKey, state);
    const verified = await request<CalendarEvent>(`${calendarPath}/${encodeURIComponent(event.id)}?${expand}&${select}`);
    if (!owned(verified, key, spec.propertyId) || eventInstant(verified.start) !== eventInstant(desired.start) || eventInstant(verified.end) !== eventInstant(desired.end))
      throw new OutlookWriteError(`Outlook ${spec.subject}日程回读不一致，请稍后重试`);
    // Only remove obsolete future plans after the retained appointment is verified.
    // Historical activity, manual namesakes and events with guests stay untouched.
    for (const duplicate of candidates.filter(candidate => candidate.id !== verified.id)) {
      const path = `${calendarPath}/${encodeURIComponent(duplicate.id)}`;
      let current: CalendarEvent;
      try { current = await request<CalendarEvent>(`${path}?${expand}&${select}`); }
      catch (error) { if (error instanceof OutlookWriteError && error.status === 404) continue; throw error; }
      if (!futureAppointment(current, since, spec) || !belongsToTask(current)) continue;
      if (!current['@odata.etag']) throw new OutlookWriteError('日程版本不可用，请稍后重试');
      const latest = await api.getTask(task.projectId, task.id);
      if (spec.cycle(latest) !== cycle || JSON.stringify(spec.plan(latest)) !== JSON.stringify(plan))
        throw new OutlookWriteError(`${spec.subject}待办已变化，保留旧日程等待下次同步`);
      await keepLease();
      try { await request(path, { method: 'DELETE', headers: { 'If-Match': current['@odata.etag'] } }); }
      catch (error) { if (!(error instanceof OutlookWriteError) || error.status !== 404) throw error; }
      try { await request(`${path}?$select=id`); }
      catch (error) { if (error instanceof OutlookWriteError && error.status === 404) { deleted++; continue; } throw error; }
      throw new OutlookWriteError(`旧${spec.subject}日程删除未确认，请稍后重试`);
    }
    entry.duplicatesChecked = true; entry.verifiedPlan = fingerprint; entry.verifiedOn = options.today;
    await kv.set(stateKey, state); verifiedCount++;
  }
  return { created, updated, deleted, verifiedCount };
}
export async function syncTaskOutlook(api: TickTickApi, options: TaskEventOptions, spec: EventSpec) {
  if (!options.managedTaskIds.size) return { enabled: false, created: 0, updated: 0 };
  return withOutlookWriteLock(async keepLease => {
    const connection = await kv.get<WriteConnection>(OUTLOOK_WRITE_KEY);
    if (!connection?.calendarId) return { enabled: false, created: 0, updated: 0 };
    try {
      const result = await syncEvents(await outlookGraphClient(connection), connection, api, options, spec, keepLease);
      if (result.verifiedCount) connection.lastSyncAt = new Date().toISOString();
      if (connection.syncErrors) delete connection.syncErrors[spec.subject];
      connection.lastError = Object.values(connection.syncErrors ?? {})[0];
      await kv.set(OUTLOOK_WRITE_KEY, connection);
      return { enabled: true, ...result };
    } catch (error) {
      const message = error instanceof OutlookWriteError ? error.message : 'Outlook 日程同步暂不可用，请重试';
      (connection.syncErrors ??= {})[spec.subject] = message;
      connection.lastError = Object.values(connection.syncErrors)[0];
      await kv.set(OUTLOOK_WRITE_KEY, connection);
      return { enabled: true, error: message, created: 0, updated: 0 };
    }
  });
}
