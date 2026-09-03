import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  buildTripSourcesFromSyncState,
  decryptTickTickToken,
  discoverTickTickTemplate,
  encryptTickTickToken,
  readConnectedTickTickTemplate,
  reconcileTickTickTrips,
  TickTickOpenApiClient,
  TICKTICK_CONNECTION_KEY,
  TICKTICK_SYNC_LOCK_KEY,
  TICKTICK_SYNC_STATE_KEY,
  type TickTickConnection,
  type TickTickTripSyncState,
} from './_ticktickTrips.js';

function getSyncSecret() {
  return (process.env.SYNC_SECRET || '').trim();
}

function syncAuthOk(req: VercelRequest) {
  const secret = getSyncSecret();
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
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

async function acquireLock() {
  const lockId = randomUUID();
  const acquired = await kv.set(TICKTICK_SYNC_LOCK_KEY, lockId, { nx: true, ex: 90 });
  return acquired ? lockId : null;
}

async function releaseLock(lockId: string) {
  const current = await kv.get<string>(TICKTICK_SYNC_LOCK_KEY);
  if (current === lockId) await kv.del(TICKTICK_SYNC_LOCK_KEY);
}

async function runSync() {
  const lockId = await acquireLock();
  if (!lockId) return { busy: true as const };
  try {
    const secret = getSyncSecret();
    const connection = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
    if (!connection) throw new Error('TickTick 未连接');
    const token = decryptTickTickToken(connection.encryptedToken, secret);
    const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    const [calendarState, tripState, savedState] = await Promise.all([
      kv.get('calendar-tags'),
      kv.get('trip-tags'),
      kv.get<TickTickTripSyncState>(TICKTICK_SYNC_STATE_KEY),
    ]);
    const state: TickTickTripSyncState = savedState && typeof savedState === 'object'
      ? { ...savedState, instances: savedState.instances ?? {} }
      : { instances: {} };
    try {
      const template = await readConnectedTickTickTemplate(api, connection);
      const trips = buildTripSourcesFromSyncState(calendarState, tripState);
      const result = await reconcileTickTickTrips({
        api,
        template,
        trips,
        state,
        today: shanghaiDate(),
        saveState: (nextState) => kv.set(TICKTICK_SYNC_STATE_KEY, nextState).then(() => undefined),
      });
      return { busy: false as const, ...result, lastSyncAt: state.lastSyncAt };
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      await kv.set(TICKTICK_SYNC_STATE_KEY, state);
      throw error;
    }
  } finally {
    await releaseLock(lockId);
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
  const token = parseToken(req);
  const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
  const [template, preference] = await Promise.all([
    discoverTickTickTemplate(api),
    api.getPreference().catch(() => ({ timeZone: 'Asia/Shanghai' })),
  ]);
  const secret = getSyncSecret();
  const previousConnection = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
  const sameTemplate = previousConnection?.projectId === template.projectId
    && previousConnection.templateRootId === template.rootTask.id;
  const connection: TickTickConnection = {
    encryptedToken: encryptTickTickToken(token, secret),
    projectId: template.projectId,
    templateRootId: template.rootTask.id,
    timeZone: preference.timeZone || 'Asia/Shanghai',
    connectedAt: new Date().toISOString(),
  };
  await kv.set(TICKTICK_CONNECTION_KEY, connection);
  if (!sameTemplate) await kv.set<TickTickTripSyncState>(TICKTICK_SYNC_STATE_KEY, { instances: {} });
  try {
    return await runSync();
  } catch (error) {
    return {
      busy: false as const,
      syncError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function status() {
  const [connection, state] = await Promise.all([
    kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY),
    kv.get<TickTickTripSyncState>(TICKTICK_SYNC_STATE_KEY),
  ]);
  return {
    connected: Boolean(connection),
    projectName: connection ? '玩' : undefined,
    templateTitle: connection ? '出门todo' : undefined,
    lastSyncAt: state?.lastSyncAt,
    error: state?.lastError,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const isCron = req.method === 'GET' && cronAuthOk(req);
  if (!isCron && !syncAuthOk(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    if (isCron) {
      const connection = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
      if (!connection) return res.status(200).json({ ok: true, connected: false });
      const result = await runSync();
      return res.status(result.busy ? 202 : 200).json({ ok: true, ...result });
    }
    if (req.method === 'GET') return res.status(200).json(await status());
    if (req.method === 'PUT') {
      const result = await connect(req);
      return res.status(result.busy ? 202 : 200).json({
        ok: true,
        connected: true,
        ...result,
        ...('syncError' in result ? { error: result.syncError } : {}),
      });
    }
    if (req.method === 'POST') {
      const result = await runSync();
      return res.status(result.busy ? 202 : 200).json({ ok: true, connected: true, ...result });
    }
    if (req.method === 'DELETE') {
      await kv.del(TICKTICK_CONNECTION_KEY);
      return res.status(200).json({ ok: true, connected: false });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = req.method === 'PUT' && !/^TickTick 5\d\d/.test(message) ? 400 : 502;
    return res.status(statusCode).json({ error: message });
  }
}
