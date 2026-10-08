import { createHash } from 'node:crypto';
import { kv } from './_accountKv.js';
import { OUTLOOK_WRITE_KEY, OutlookWriteError, outlookGraphClient, withOutlookWriteLock, type WriteConnection } from './_outlookWrite.js';
import { decryptTickTickToken, readAllTickTickTasks, TICKTICK_CONNECTION_KEY, TickTickOpenApiClient, type TickTickConnection } from './_ticktickTrips.js';

const STATE_KEY = 'electric-vehicle-charge:2026-10:v1';
const EVENT_PROPERTY = 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsElectricVehicle';
const ITEMS = [
  { key: 'charge', title: '电动车充电', date: '2026-10-09', start: '2026-10-09T20:00:00', end: '2026-10-09T21:00:00' },
  { key: 'collect', title: '接电动车', date: '2026-10-10', start: '2026-10-10T09:00:00', end: '2026-10-10T10:00:00' },
] as const;
interface State { taskIds?: Record<string, string>; eventIds?: Record<string, string> }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function scheduleElectricVehicleCharge() {
  const [ticktick, outlook, saved] = await Promise.all([
    kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY), kv.get<WriteConnection>(OUTLOOK_WRITE_KEY), kv.get<State>(STATE_KEY),
  ]);
  if (!ticktick) throw new Error('TickTick 未连接');
  if (!outlook?.calendarId) throw new OutlookWriteError('Outlook 日历未连接');
  const state: State = saved ?? { taskIds: {}, eventIds: {} };
  state.taskIds ??= {}; state.eventIds ??= {};
  const token = decryptTickTickToken(ticktick.encryptedToken, (process.env.SYNC_SECRET || '').trim());
  const tasks = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
  const openTasks = await readAllTickTickTasks(tasks, [0]);
  let tasksCreated = 0, eventsCreated = 0;
  for (const item of ITEMS) {
    const existing = openTasks.find(task => task.title === item.title && (task.dueDate || task.startDate)?.slice(0, 10) === item.date);
    if (existing) state.taskIds[item.key] = existing.id;
    else if (!state.taskIds[item.key]) {
      const created = await tasks.createTask({ projectId: ticktick.projectId || 'inbox', title: item.title, priority: 5, isAllDay: true,
        timeZone: ticktick.timeZone || 'Asia/Shanghai', startDate: `${item.date}T00:00:00+0800`, dueDate: `${item.date}T00:00:00+0800` });
      if (!created?.id) throw new Error('TickTick 创建任务后未返回任务 ID');
      state.taskIds[item.key] = created.id; tasksCreated++; await kv.set(STATE_KEY, state);
    }
  }
  await withOutlookWriteLock(async keepLease => {
    const request = await outlookGraphClient(outlook);
    const path = `/me/calendars/${encodeURIComponent(outlook.calendarId!)}/events`;
    for (const item of ITEMS) {
      if (state.eventIds![item.key]) continue;
      await keepLease();
      const transactionId = digest(`${STATE_KEY}:${item.key}`);
      const created = await request<{ id?: string }>(path, { method: 'POST', body: JSON.stringify({ subject: item.title,
        start: { dateTime: item.start, timeZone: 'Asia/Shanghai' }, end: { dateTime: item.end, timeZone: 'Asia/Shanghai' },
        attendees: [], isReminderOn: false, showAs: 'busy', transactionId,
        body: { contentType: 'Text', content: `https://ticktick.com/webapp/#p/${encodeURIComponent(ticktick.projectId || 'inbox')}/tasks/${encodeURIComponent(state.taskIds![item.key])}` },
        singleValueExtendedProperties: [{ id: EVENT_PROPERTY, value: transactionId }] }) });
      if (!created.id) throw new OutlookWriteError('Outlook 未返回日程标识');
      state.eventIds![item.key] = created.id; eventsCreated++; await kv.set(STATE_KEY, state);
    }
  });
  return { tasksCreated, eventsCreated, complete: ITEMS.every(item => state.taskIds![item.key] && state.eventIds![item.key]) };
}
