import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const CONNECTION_KEY = 'ticktick:connection:v1';
const SYNC_STATE_KEY = 'ticktick:trip-sync:v1';
const SYNC_LOCK_KEY = 'ticktick:trip-sync:lock';

interface TickTickConnection {
  encryptedToken: { iv: string; tag: string; data: string };
  projectId: string;
  templateRootId: string;
  timeZone: string;
  connectedAt: string;
}

interface TickTickTripSyncState {
  instances: Record<string, {
    tripKey: string;
    startDate: string;
    endDate: string;
    dates: string[];
    name: string;
    rootTaskId?: string;
    taskIdsByTemplateId: Record<string, string>;
    itemIdsByTemplateTaskId: Record<string, Record<string, string>>;
  }>;
  wishInstances?: TickTickTripSyncState['instances'];
  lastSyncAt?: string;
  lastError?: string;
}

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
  const acquired = await kv.set(SYNC_LOCK_KEY, lockId, { nx: true, ex: 90 });
  return acquired ? lockId : null;
}

async function releaseLock(lockId: string) {
  const current = await kv.get<string>(SYNC_LOCK_KEY);
  if (current === lockId) await kv.del(SYNC_LOCK_KEY);
}

async function runSync() {
  const lockId = await acquireLock();
  if (!lockId) return { busy: true as const };
  try {
    const {
      buildTripSourcesFromSyncState,
      decryptTickTickToken,
      readConnectedTickTickTemplate,
      reconcileTickTickTrips,
      reconcileTickTickWishPreparations,
      syncTickTickRoutines,
      TickTickOpenApiClient,
    } = await import('./_ticktickTrips.js');
    const secret = getSyncSecret();
    const connection = await kv.get<TickTickConnection>(CONNECTION_KEY);
    if (!connection) throw new Error('TickTick 未连接');
    const token = decryptTickTickToken(connection.encryptedToken, secret);
    const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
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
      const today = shanghaiDate();
      const routineResult = await syncTickTickRoutines({ api, calendarState, today });
      console.info('[ticktick-routine-sync]', JSON.stringify(routineResult));
      const template = await readConnectedTickTickTemplate(api, connection);
      const trips = buildTripSourcesFromSyncState(calendarState, tripState);
      const result = await reconcileTickTickTrips({
        api,
        template,
        trips,
        state,
        today,
        saveState: (nextState) => kv.set(SYNC_STATE_KEY, nextState).then(() => undefined),
      });
      const wishResult = await reconcileTickTickWishPreparations({
        api,
        template,
        configState,
        state,
        today,
        saveState: (nextState) => kv.set(SYNC_STATE_KEY, nextState).then(() => undefined),
      });
      return { busy: false as const, ...result, ...wishResult, ...routineResult, lastSyncAt: state.lastSyncAt };
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      await kv.set(SYNC_STATE_KEY, state);
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
  const {
    discoverTickTickTemplate,
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
  const sameTemplate = previousConnection?.projectId === template.projectId
    && previousConnection.templateRootId === template.rootTask.id;
  const connection: TickTickConnection = {
    encryptedToken: encryptTickTickToken(token, secret),
    projectId: template.projectId,
    templateRootId: template.rootTask.id,
    timeZone: preference.timeZone || 'Asia/Shanghai',
    connectedAt: new Date().toISOString(),
  };
  await kv.set(CONNECTION_KEY, connection);
  if (!sameTemplate) await kv.set<TickTickTripSyncState>(SYNC_STATE_KEY, { instances: {} });
  return { busy: false as const };
}

async function status() {
  const [connection, state] = await Promise.all([
    kv.get<TickTickConnection>(CONNECTION_KEY),
    kv.get<TickTickTripSyncState>(SYNC_STATE_KEY),
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
      const connection = await kv.get<TickTickConnection>(CONNECTION_KEY);
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
