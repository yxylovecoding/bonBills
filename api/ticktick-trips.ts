import { createHash } from 'node:crypto';
import { DAILY_PLAN_KEY, DAILY_PLAN_SETTINGS_KEY, dailyBudget, planTickTickDay, refreshDailyHistory, type DailyPlanState } from './_ticktickDailyPlan.js';
import { authOk } from './_auth.js';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { TickTickConnection, TickTickTripSyncState } from './_ticktickTrips.js';
import { syncOutlookCalendar } from './_outlookSync.js';
import { availabilityProfile } from './_dailyAvailability.js';
import type { OutlookAvailability } from '../src/utils/outlookCalendar.js';
import { acquireTickTickLock, releaseTickTickLock } from './_ticktickLock.js';
import { syncSwimmingSchedule } from './_lifeSwimming.js';
import { syncNightRoutineVisibility } from './_ticktickNightRoutine.js';
import { syncSleepRoutineTags } from './_ticktickSleepTags.js';
import { syncExerciseSchedule } from './_ticktickExercise.js';

const CONNECTION_KEY = 'ticktick:connection:v1';
const SYNC_STATE_KEY = 'ticktick:trip-sync:v1';

function getSyncSecret() {
  return (process.env.SYNC_SECRET || '').trim();
}

function cronAuthOk(req: VercelRequest) {
  const secret = (process.env.CRON_SECRET || '').trim();
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function runSync(allowDisconnected = false) {
  const lockId = await acquireTickTickLock();
  if (!lockId) return { busy: true as const };
  let scheduleStarted = false;
  try {
    const today = shanghaiDate();
    const secret = getSyncSecret();
    const { decryptTickTickToken, TickTickOpenApiClient } = await import('./_ticktickTrips.js');
    const connection = await kv.get<TickTickConnection>(CONNECTION_KEY);
    const token = connection ? decryptTickTickToken(connection.encryptedToken, secret) : null;
    const api = token === null ? null : new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    // Whichever 05:00 workflow runs first must restore temporary tags before
    // calculating availability; otherwise every masked task looks like routine.
    if (connection && api) {
      const sleepTags = await syncSleepRoutineTags(api, { projectId: connection.projectId, restoreOnly: true });
      if (!sleepTags.complete) return { busy: true as const, sleepTags };
    }
    scheduleStarted = true;
    // Manual and scheduled runs must use the same fresh calendar window, including future trips.
    let availability: OutlookAvailability | undefined;
    try { availability = (await syncOutlookCalendar(today, secret))?.availability; }
    catch (error) {
      const state = await kv.get<TickTickTripSyncState>(SYNC_STATE_KEY);
      await kv.set(SYNC_STATE_KEY, { ...state, instances: state?.instances ?? {}, lastError: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    // Outlook and period snapshots remain independent of the TickTick connection.
    if (!connection && allowDisconnected) return { busy: false as const, connected: false as const };
    if (!connection || !api || token === null) throw new Error('TickTick 未连接');
    const {
      buildTripSourcesFromSyncState,
      getTickTickRoutineExcludedTaskIds,
      readConnectedTickTickTemplate,
      readAllTickTickTasks,
      reconcileTickTickTrips,
      reconcileTickTickWishPreparations,
      syncTickTickRoutines,
    } = await import('./_ticktickTrips.js');
    const [calendarState, tripState, configState, savedState] = await Promise.all([
      kv.get('calendar-tags'),
      kv.get('trip-tags'),
      kv.get('app-config'),
      kv.get<TickTickTripSyncState>(SYNC_STATE_KEY),
    ]);
    const state: TickTickTripSyncState = savedState && typeof savedState === 'object'
      ? { ...savedState, instances: savedState.instances ?? {} }
      : { instances: {} };
    try {
      const connectionId = createHash('sha256').update(token).digest('hex');
      const [savedPlan, settings, sourceTasks] = await Promise.all([
        kv.get<DailyPlanState>(DAILY_PLAN_KEY),
        kv.get<{ budgetMinutes?: number | null; availabilityProfile?: string }>(DAILY_PLAN_SETTINGS_KEY),
        readAllTickTickTasks(api, [0]),
      ]);
      const dailyPlan: DailyPlanState = savedPlan?.connectionId === connectionId
        ? { ...savedPlan, history: [...savedPlan.history], deadlines: { ...savedPlan.deadlines } }
        : { connectionId, history: [], deadlines: {} };
      // Read history before any scene/date writes; a failed read is never "never done".
      await refreshDailyHistory(api, sourceTasks, dailyPlan);
      await kv.set(DAILY_PLAN_KEY, dailyPlan);
      if (!availability && dailyBudget(settings?.budgetMinutes) === null) dailyPlan.summary = undefined;
      const template = await readConnectedTickTickTemplate(api, connection);
      const trips = buildTripSourcesFromSyncState(calendarState, tripState);
      const result = await reconcileTickTickTrips({
        api,
        template,
        trips,
        state,
        today,
        legacyProjectId: connection.projectId,
        saveState: (nextState) => kv.set(SYNC_STATE_KEY, nextState).then(() => undefined),
      });
      const wishResult = await reconcileTickTickWishPreparations({
        api,
        template,
        configState,
        state,
        today,
        legacyProjectId: connection.projectId,
        saveState: (nextState) => kv.set(SYNC_STATE_KEY, nextState).then(() => undefined),
      });
      // Follow explicit task dates after generated trips/wishes have their final
      // dates, including tasks first created during this sync.
      const excludedTaskIds = getTickTickRoutineExcludedTaskIds(template, state);
      const exercise = await syncExerciseSchedule(api, { connectionId, calendarState, excludedTaskIds });
      const routineResult = await syncTickTickRoutines({
        api, calendarState, today,
        excludedTaskIds, minimumTaskDates: exercise.minimumDates,
        planDay: !availability && dailyBudget(settings?.budgetMinutes) === null ? undefined : async (tasks) => {
          const plan = planTickTickDay({ tasks, calendarState, today, state: dailyPlan,
            budgetMinutes: settings?.budgetMinutes, availability, availabilityProfile: availabilityProfile(settings?.availabilityProfile),
            excludedTaskIds: getTickTickRoutineExcludedTaskIds(template, state) });
          // Save cycle anchors before writes so a partially failed run can be retried.
          await kv.set(DAILY_PLAN_KEY, { ...dailyPlan, summary: savedPlan?.summary });
          return plan.dates;
        },
      });
      await kv.set(DAILY_PLAN_KEY, dailyPlan);
      console.info('[ticktick-routine-sync]', JSON.stringify(routineResult));
      console.info('[ticktick-trip-sync]', JSON.stringify({ ...result, ...wishResult }));
      return { busy: false as const, ...result, ...wishResult, ...routineResult, exercise: { updated: exercise.updated }, dailyPlan: dailyPlan.summary, budgetMinutes: dailyBudget(settings?.budgetMinutes),
        availabilityProfile: availabilityProfile(settings?.availabilityProfile), lastSyncAt: state.lastSyncAt };
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      await kv.set(SYNC_STATE_KEY, state);
      throw error;
    }
  } finally {
    // Apply the period rule last, even if unrelated calendar/template sync failed.
    // Share the write lock so routines cannot put swimming back into a period.
    try { if (scheduleStarted) await syncSwimmingSchedule({ lockHeld: true, refreshPeriods: true }); }
    finally { await releaseTickTickLock(lockId); }
  }
}

async function runRoutineVisibilitySync(kind: 'night' | 'daily' | 'all') {
  const lockId = await acquireTickTickLock();
  if (!lockId) return { busy: true as const };
  try {
    const connection = await kv.get<TickTickConnection>(CONNECTION_KEY);
    if (!connection) return { busy: false as const, connected: false as const };
    const { decryptTickTickToken, TickTickOpenApiClient } = await import('./_ticktickTrips.js');
    const token = decryptTickTickToken(connection.encryptedToken, getSyncSecret());
    const api = new TickTickOpenApiClient(token,
      (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    const sleepTags = kind !== 'night' ? await syncSleepRoutineTags(api, { projectId: connection.projectId }) : undefined;
    if (kind === 'daily' || sleepTags?.complete === false) return { busy: false as const, connected: true as const, sleepTags };
    const nightRoutine = await syncNightRoutineVisibility(api, { timeZone: connection.timeZone });
    const exercise = await syncExerciseSchedule(api, { connectionId: createHash('sha256').update(token).digest('hex'),
      templateRootId: connection.templateRootId });
    return { busy: false as const, connected: true as const, nightRoutine, exercise: { updated: exercise.updated },
      ...(sleepTags ? { sleepTags } : {}) };
  } finally {
    await releaseTickTickLock(lockId);
  }
}

function parseToken(req: VercelRequest): string {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > 4096) throw new Error('请输入有效的 API Token');
    return token;
  } catch (error) {
    if (error instanceof Error && error.message === '请输入有效的 API Token') throw error;
    throw new Error('请输入有效的 API Token');
  }
}

async function connect(req: VercelRequest) {
  const {
    discoverTickTickTemplate,
    decryptTickTickToken,
    encryptTickTickToken,
    TickTickOpenApiClient,
  } = await import('./_ticktickTrips.js');
  const token = parseToken(req);
  const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
  const [template, preference] = await Promise.all([
    discoverTickTickTemplate(api),
    api.getPreference().catch(() => ({ timeZone: 'Asia/Shanghai' })),
  ]);
  const secret = getSyncSecret();
  const previousConnection = await kv.get<TickTickConnection>(CONNECTION_KEY);
  let sameToken = false;
  if (previousConnection) {
    try { sameToken = decryptTickTickToken(previousConnection.encryptedToken, secret) === token; }
    catch { /* A new valid connection can replace credentials encrypted with an old server key. */ }
  }
  const sameConnection = previousConnection && (
    previousConnection.templateRootId === template.rootTask.id
    || sameToken
  );
  if (sameConnection) {
    const state = await kv.get<TickTickTripSyncState>(SYNC_STATE_KEY);
    if (state) {
      for (const instance of [...Object.values(state.instances ?? {}), ...Object.values(state.wishInstances ?? {})]) {
        instance.projectId ??= previousConnection.projectId;
      }
      await kv.set(SYNC_STATE_KEY, state);
    }
  }
  const connection: TickTickConnection = {
    encryptedToken: encryptTickTickToken(token, secret),
    projectId: template.projectId,
    templateRootId: template.rootTask.id,
    timeZone: preference.timeZone || 'Asia/Shanghai',
    connectedAt: new Date().toISOString(),
  };
  await kv.set(CONNECTION_KEY, connection);
  if (!sameConnection) {
    await kv.set<TickTickTripSyncState>(SYNC_STATE_KEY, { instances: {} });
    await kv.set(DAILY_PLAN_KEY, null);
  }
  return { busy: false as const };
}

async function status() {
  const [connection, state, plan, settings] = await Promise.all([
    kv.get<TickTickConnection>(CONNECTION_KEY),
    kv.get<TickTickTripSyncState>(SYNC_STATE_KEY),
    kv.get<DailyPlanState>(DAILY_PLAN_KEY),
    kv.get<{ budgetMinutes?: number | null; availabilityProfile?: string }>(DAILY_PLAN_SETTINGS_KEY),
  ]);
  return {
    connected: Boolean(connection),
    dailyPlan: connection ? plan?.summary : undefined,
    budgetMinutes: dailyBudget(settings?.budgetMinutes),
    availabilityProfile: availabilityProfile(settings?.availabilityProfile),
    templateTitle: connection ? '出门todo模版' : undefined,
    lastSyncAt: state?.lastSyncAt,
    error: state?.lastError,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const isCron = req.method === 'GET' && cronAuthOk(req);
  if (!isCron && !await authOk(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    if (req.query?.action === 'life-periods') {
      if (!isCron && req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
      const { syncRecentLifePeriods } = await import('./_bonLife.js');
      return res.status(200).json({ ok: true, ...await syncRecentLifePeriods() });
    }
    if (req.query?.action === 'night-routine' || req.query?.action === 'daily-routine' || req.query?.action === 'routine-visibility') {
      if (!isCron && req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
      const result = await runRoutineVisibilitySync(req.query.action === 'daily-routine' ? 'daily'
        : req.query.action === 'night-routine' ? 'night' : 'all');
      return res.status(result.busy ? 202 : 200).json({ ok: true, ...result });
    }
    if (isCron) {
      const { syncRecentLifeDone } = await import('./_lifeDone.js');
      // Archive completions even when Outlook or trip scheduling is unavailable.
      let doneError = false;
      try { await syncRecentLifeDone(); } catch { doneError = true; }
      const result = await runSync(true);
      if (doneError) return res.status(502).json({ ...result, error: 'TickTick 完成记录同步失败，已保留历史' });
      return res.status(result.busy ? 202 : 200).json({ ok: true, ...result });
    }
    if (req.method === 'GET') return res.status(200).json(await status());
    if (req.method === 'PATCH') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { return res.status(400).json({ error: '日常用时格式无效' }); }
      if (body?.budgetMinutes !== null && (!Number.isInteger(body?.budgetMinutes) || body.budgetMinutes < 10 || body.budgetMinutes > 240)) {
        return res.status(400).json({ error: '每日上限须为自动或 10 至 240 分钟' });
      }
      if (body.availabilityProfile !== undefined && !['day', 'evening', 'calendar'].includes(body.availabilityProfile)) {
        return res.status(400).json({ error: '可用时段无效' });
      }
      const previous = await kv.get<Record<string, unknown>>(DAILY_PLAN_SETTINGS_KEY);
      await kv.set(DAILY_PLAN_SETTINGS_KEY, { ...previous, budgetMinutes: body.budgetMinutes,
        ...(body.availabilityProfile !== undefined ? { availabilityProfile: body.availabilityProfile } : {}) });
      return res.status(200).json({ ok: true, ...await status() });
    }
    if (req.method === 'PUT') {
      const result = await connect(req);
      return res.status(result.busy ? 202 : 200).json({
        ok: true,
        connected: true,
        ...result,
      });
    }
    if (req.method === 'POST') {
      const result = await runSync();
      return res.status(result.busy ? 202 : 200).json({ ok: true, connected: true, ...result });
    }
    if (req.method === 'DELETE') {
      await kv.del(CONNECTION_KEY);
      return res.status(200).json({ ok: true, connected: false });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = req.method === 'PUT' && !/^TickTick 5\d\d/.test(message) ? 400 : 502;
    return res.status(statusCode).json({ error: message });
  }
}
