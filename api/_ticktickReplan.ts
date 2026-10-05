import { createHash } from 'node:crypto';
import { kv } from './_accountKv.js';
import { applyOutlookSnapshotToState } from '../src/utils/outlookCalendar.js';
import { availabilityProfile } from './_dailyAvailability.js';
import { decryptOutlookConnection, readOutlookSnapshot } from './_outlookCalendar.js';
import { OUTLOOK_CONNECTION_KEY, type OutlookConnection } from './_outlookSync.js';
import { DAILY_PLAN_KEY, DAILY_PLAN_SETTINGS_KEY, planTickTickDay, refreshDailyHistory, type DailyPlanState } from './_ticktickDailyPlan.js';
import { isExerciseTask } from './_ticktickExercise.js';
import { isLaundryTask } from './_ticktickLaundry.js';
import { acquireTickTickLock, releaseTickTickLock } from './_ticktickLock.js';
import { calendarDateInTimeZone, decryptTickTickToken, getTickTickRoutineExcludedTaskIds, readAllTickTickTasks,
  readConnectedTickTickTemplate, routineRecurrence, routineTaskDate, shiftTickTickDate, TickTickOpenApiClient,
  type TickTickTask, type TickTickConnection, type TickTickTripSyncState } from './_ticktickTrips.js';

const CONNECTION_KEY = 'ticktick:connection:v1';
const pending = (task: TickTickTask) => (task.status ?? 0) === 0 && !task.completedTime;
const fields = ['title', 'content', 'desc', 'isAllDay', 'timeZone', 'reminders', 'tags', 'repeatFlag', 'repeatFrom',
  'priority', 'sortOrder', 'kind', 'parentId', 'items', 'startDate', 'dueDate'] as const;
const fingerprint = (task: TickTickTask) => JSON.stringify([task.id, task.projectId, task.status ?? 0,
  task.completedTime ?? null, ...fields.map(key => task[key] ?? null)]);

function eligible(task: TickTickTask, horizon: string) {
  const date = routineTaskDate(task);
  const tags = (task.tags ?? []).map(tag => tag.normalize('NFKC').trim());
  return pending(task) && (!date || date <= horizon) && (task.priority ?? 0) < 5 && task.isAllDay !== false
    && !tags.some(tag => ['routine', '不关我事', '洗头'].includes(tag))
    && task.title.normalize('NFKC').trim() !== '洗头' && routineRecurrence(task.repeatFlag) !== 'unknown'
    && !isExerciseTask(task) && !isLaundryTask(task);
}

// Deliberately separate from runSync: this operation can only change dates of
// today's open ordinary tasks and selected tasks from the 明日事 smart filter.
// Outlook is read through existing subscriptions;
// no tags, trips, training, laundry, or calendar events are synchronized here.
export async function replanRemainingToday() {
  const lock = await acquireTickTickLock();
  if (!lock) return { busy: true as const };
  try {
    const secret = (process.env.SYNC_SECRET || '').trim();
    const connection = await kv.get<TickTickConnection>(CONNECTION_KEY);
    if (!connection) throw new Error('TickTick 未连接');
    const token = decryptTickTickToken(connection.encryptedToken, secret);
    const connectionId = createHash('sha256').update(token).digest('hex');
    const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    const [tasks, saved, settings, calendar, outlook, trips, template] = await Promise.all([
      readAllTickTickTasks(api, [0]), kv.get<DailyPlanState>(DAILY_PLAN_KEY),
      kv.get<{ budgetMinutes?: number | null; availabilityProfile?: string }>(DAILY_PLAN_SETTINGS_KEY),
      kv.get<Record<string, unknown>>('calendar-tags'), kv.get<OutlookConnection>(OUTLOOK_CONNECTION_KEY),
      kv.get<TickTickTripSyncState>('ticktick:trip-sync:v1'), readConnectedTickTickTemplate(api, connection),
    ]);
    const state: DailyPlanState = saved?.connectionId === connectionId
      ? structuredClone(saved) : { connectionId, history: [], deadlines: {} };
    const today = calendarDateInTimeZone(new Date().toISOString())!;
    const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.parse(`${today}T00:00:00Z`) + 31 * 86_400_000).toISOString().slice(0, 10);
    const input = outlook ? decryptOutlookConnection(outlook.encrypted, secret) : null;
    const [snapshot] = await Promise.all([
      input ? readOutlookSnapshot(input, today, end, { startDate: today, endDate: end }) : undefined,
      refreshDailyHistory(api, tasks, state),
    ]);
    const now = new Date();
    if (calendarDateInTimeZone(now.toISOString()) !== today) throw new Error('日期已变化，请重新重排');
    const calendarState = snapshot && input ? applyOutlookSnapshotToState(calendar ?? {}, snapshot, input.policy, today) : calendar;
    const excluded = getTickTickRoutineExcludedTaskIds(template, { ...trips, instances: trips?.instances ?? {} });
    // Preserve protected ancestors as well as individually managed tasks.
    const byId = new Map(tasks.map(task => [task.id, task]));
    const allowed = new Map(tasks.filter(task => {
      const seen = new Set<string>();
      let current: TickTickTask | undefined = task;
      while (current && !seen.has(current.id)) {
        if (excluded.has(current.id) || (current.parentId && excluded.has(current.parentId))) return false;
        seen.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return eligible(task, horizon);
    }).map(task => [task.id, task]));
    const plan = planTickTickDay({ tasks: tasks.filter(pending), calendarState, today, state, now,
      availability: snapshot?.availability, budgetMinutes: settings?.budgetMinutes,
      availabilityProfile: availabilityProfile(settings?.availabilityProfile), excludedTaskIds: excluded,
      movableTaskIds: new Set(allowed.keys()) });
    const changes: { task: TickTickTask; date: string }[] = [];
    for (const [id, date] of plan.dates) {
      const original = allowed.get(id);
      const originalDate = original ? routineTaskDate(original) : null;
      if (!original || date < today || ((!originalDate || originalDate > today) && date !== today && date !== originalDate)) {
        throw new Error('重排范围校验失败，未继续调整');
      }
      if (routineTaskDate(original) === date) continue;
      const fresh = await api.getTask(original.projectId, id);
      if (!fresh || !pending(fresh) || fingerprint(fresh) !== fingerprint(original)) {
        throw new Error('待办已变化，请重新重排');
      }
      changes.push({ task: fresh, date });
    }
    const latest = await kv.get<TickTickConnection>(CONNECTION_KEY);
    if (JSON.stringify(latest) !== JSON.stringify(connection)) throw new Error('TickTick 连接已变化，请重试');
    // Keep original cycle anchors if an upstream write fails partway through.
    await kv.set(DAILY_PLAN_KEY, { ...state, summary: saved?.connectionId === connectionId ? saved.summary : undefined,
      briefing: saved?.connectionId === connectionId ? saved.briefing : undefined });
    for (const { task, date } of changes) {
      const fresh = await api.getTask(task.projectId, task.id);
      if (!fresh || !pending(fresh) || fingerprint(fresh) !== fingerprint(task)) throw new Error('待办已变化，请重新重排');
      const payload: Record<string, unknown> = { id: task.id, projectId: task.projectId };
      for (const key of fields) if (task[key] !== undefined) payload[key] = task[key];
      for (const key of ['startDate', 'dueDate'] as const) {
        if (task[key]) payload[key] = shiftTickTickDate(task[key], routineTaskDate(task)!, date);
      }
      if (!task.startDate && !task.dueDate) payload.dueDate = `${date}T00:00:00+0800`;
      await api.updateTask(task.id, payload);
      const updated = await api.getTask(task.projectId, task.id);
      const sameDate = (a: unknown, b: unknown) => a === b || typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b);
      if (!updated || !pending(updated) || updated.id !== task.id || updated.projectId !== task.projectId
        || fields.some(key => key === 'startDate' || key === 'dueDate' ? !sameDate(updated[key], payload[key])
          : JSON.stringify(updated[key] ?? null) !== JSON.stringify(task[key] ?? null))) {
        throw new Error('部分任务的重排结果未确认，请刷新后重试');
      }
    }
    await kv.set(DAILY_PLAN_KEY, state);
    return { busy: false as const, dailyPlan: plan.summary, details: state.briefing, updated: changes.length };
  } finally {
    await releaseTickTickLock(lock);
  }
}
