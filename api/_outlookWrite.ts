import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { kv } from './_accountKv.js';

export const OUTLOOK_WRITE_KEY = 'outlook:laundry-write:v1';
const SETTINGS_KEY = 'outlook:laundry-write:settings:v1';
const FLOW_KEY = 'outlook:laundry-write:flow:v1';
const LOCK_KEY = 'outlook:laundry-write:lock:v1';
const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const SCOPE = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite';
export interface WriteConnection {
  id: string; clientId: string; encrypted: string;
  provider?: 'microsoft' | 'make';
  calendarId?: string; calendarName?: string; lastSyncAt?: string; lastError?: string;
}
interface Tokens { access_token: string; refresh_token: string; expiresAt: number }
interface Flow { id: string; clientId: string; encrypted: string; expiresAt: number; interval: number; nextPoll: number }
export interface WritableCalendar { id: string; name: string; canEdit: boolean; isDefaultCalendar?: boolean }
export class OutlookWriteError extends Error { constructor(message: string, public status = 502) { super(message); } }

export function sealOutlookWrite(value: unknown): string {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret) throw new OutlookWriteError('服务端连接配置缺失', 503);
  const key = new Uint8Array(createHash('sha256').update(`outlook:write:v1:${secret}`).digest()), iv = new Uint8Array(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = new Uint8Array([...cipher.update(JSON.stringify(value), 'utf8'), ...cipher.final()]);
  return [iv, new Uint8Array(cipher.getAuthTag()), encrypted].map(part => Buffer.from(part).toString('base64')).join('.');
}
export function unsealOutlookWrite<T>(value: string): T {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret) throw new OutlookWriteError('服务端连接配置缺失', 503);
  const key = new Uint8Array(createHash('sha256').update(`outlook:write:v1:${secret}`).digest());
  const [iv, tag, data] = value.split('.').map(part => new Uint8Array(Buffer.from(part, 'base64')));
  const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.from(new Uint8Array([...decipher.update(data), ...decipher.final()])).toString('utf8')) as T;
}
export async function withOutlookWriteLock<T>(run: (keepLease: () => Promise<void>) => Promise<T>): Promise<T> {
  const id = randomUUID();
  if (!await kv.set(LOCK_KEY, id, { nx: true, ex: 180 })) throw new OutlookWriteError('日程正在同步，请稍后重试', 409);
  const keepLease = async () => {
    if (!await kv.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], 180) end return 0", [LOCK_KEY], [id]))
      throw new OutlookWriteError('同步锁已失效，请稍后重试', 409);
  };
  try { return await run(keepLease); }
  finally { await kv.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", [LOCK_KEY], [id]); }
}
async function microsoftToken(body: Record<string, string>, endpoint = 'token') {
  const response = await fetch(`${AUTH}/${endpoint}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const data = await response.json() as Record<string, any>;
  return { ok: response.ok, data };
}
function tokensFrom(data: Record<string, any>, refreshToken?: string): Tokens {
  if (typeof data.access_token !== 'string' || !(typeof data.refresh_token === 'string' || refreshToken)
    || !Number.isFinite(data.expires_in) || data.expires_in <= 0
    || !String(data.scope ?? '').split(' ').some(scope => /(?:^|\/)Calendars.ReadWrite$/i.test(scope))) {
    throw new OutlookWriteError('未取得日历写入授权，请重新连接', 401);
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token || refreshToken!, expiresAt: Date.now() + data.expires_in * 1000 };
}
export async function startOutlookWrite(clientId: unknown) {
  if (typeof clientId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId))
    throw new OutlookWriteError('请输入微软应用 ID', 400);
  const { ok, data } = await microsoftToken({ client_id: clientId, scope: SCOPE }, 'devicecode');
  if (!ok || typeof data.device_code !== 'string' || typeof data.user_code !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0)
    throw new OutlookWriteError('无法开始授权，请检查应用 ID 和公共客户端设置', 400);
  const id = randomUUID(), interval = Math.max(5, Number(data.interval) || 5);
  const flow: Flow = { id, clientId, encrypted: sealOutlookWrite(data.device_code), expiresAt: Date.now() + Math.min(data.expires_in, 900) * 1000,
    interval, nextPoll: Date.now() + interval * 1000 };
  // Only the most recently initiated flow can replace this account's connection.
  await kv.set(FLOW_KEY, flow, { ex: 900 });
  await kv.set(SETTINGS_KEY, { clientId });
  return { flowId: id, userCode: data.user_code, verificationUrl: 'https://microsoft.com/devicelogin', interval, expiresAt: flow.expiresAt };
}
export async function pollOutlookWrite(flowId: unknown) {
  const flow = await kv.get<Flow>(FLOW_KEY);
  if (!flow || flow.id !== flowId || flow.expiresAt <= Date.now()) throw new OutlookWriteError('授权已过期，请重新连接', 410);
  if (flow.nextPoll > Date.now()) return { pending: true, interval: flow.interval };
  flow.nextPoll = Date.now() + flow.interval * 1000;
  await kv.set(FLOW_KEY, flow, { ex: Math.max(1, Math.ceil((flow.expiresAt - Date.now()) / 1000)) });
  const { ok, data } = await microsoftToken({ client_id: flow.clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: unsealOutlookWrite<string>(flow.encrypted) });
  if (!ok && ['authorization_pending', 'slow_down'].includes(data.error)) {
    if (data.error === 'slow_down') { flow.interval += 5; flow.nextPoll = Date.now() + flow.interval * 1000; await kv.set(FLOW_KEY, flow, { ex: Math.max(1, Math.ceil((flow.expiresAt - Date.now()) / 1000)) }); }
    return { pending: true, interval: flow.interval };
  }
  if (!ok) { await kv.del(FLOW_KEY); throw new OutlookWriteError('微软授权未完成，请重新连接', 401); }
  const tokens = tokensFrom(data);
  const connection: WriteConnection = { id: randomUUID(), clientId: flow.clientId, encrypted: sealOutlookWrite(tokens) };
  await kv.set(OUTLOOK_WRITE_KEY, connection); // Persist the refresh token before any further network call.
  await kv.del(FLOW_KEY);
  return { pending: false };
}
export async function accessToken(connection: WriteConnection): Promise<string> {
  const tokens = unsealOutlookWrite<Tokens>(connection.encrypted);
  if (tokens.expiresAt > Date.now() + 120_000) return tokens.access_token;
  const { ok, data } = await microsoftToken({ client_id: connection.clientId, grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token, scope: SCOPE });
  if (!ok) throw new OutlookWriteError('微软授权已失效，请重新连接', 401);
  const renewed = tokensFrom(data, tokens.refresh_token);
  connection.encrypted = sealOutlookWrite(renewed);
  await kv.set(OUTLOOK_WRITE_KEY, connection);
  return renewed.access_token;
}
export async function graphRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/me/')) throw new OutlookWriteError('日历请求无效', 400);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'IdType="ImmutableId", outlook.timezone="Asia/Shanghai"', ...init.headers } });
  if (!response.ok) throw new OutlookWriteError(response.status === 401 ? '微软授权已失效，请重新连接'
    : response.status === 403 ? '没有所选日历的写入权限' : `Outlook 日程同步失败（${response.status}）`, response.status);
  return response.status === 204 ? undefined as T : await response.json() as T;
}
export type GraphClient = <T>(path: string, init?: RequestInit) => Promise<T>;
export function validateMakeWebhook(value: unknown): string {
  if (typeof value !== 'string') throw new OutlookWriteError('请输入 Make Webhook 地址', 400);
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:' && /^hook(?:\.(?:eu|us)\d+)?\.make\.com$/.test(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/[a-z0-9]{32}$/.test(url.pathname)) return url.href;
  } catch { /* Never echo a credential URL in errors. */ }
  throw new OutlookWriteError('Make Webhook 地址无效', 400);
}
async function reserveMakeCall() {
  // A rolling window also covers calendar-month/billing-cycle boundaries. Do not reset on reconnect.
  const accepted = await kv.eval(`local cutoff = tonumber(ARGV[1]) - 2764800000
redis.call('zremrangebyscore', KEYS[1], '-inf', cutoff)
if redis.call('zcard', KEYS[1]) >= 200 then return 0 end
redis.call('zadd', KEYS[1], ARGV[1], ARGV[2])
redis.call('expire', KEYS[1], 2764800)
return 1`, ['outlook:make-calls:v1'], [String(Date.now()), randomUUID()]);
  if (!accepted) throw new OutlookWriteError('免费调用额度已暂停，请稍后再试', 429);
}
export async function outlookGraphClient(connection: WriteConnection): Promise<GraphClient> {
  if (connection.provider !== 'make') {
    const token = await accessToken(connection);
    return <T>(path: string, init?: RequestInit) => graphRequest<T>(token, path, init);
  }
  const { webhookUrl } = unsealOutlookWrite<{ webhookUrl: string }>(connection.encrypted);
  const endpoint = validateMakeWebhook(webhookUrl);
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const method = init.method ?? 'GET';
    const allowedPath = /^\/me\/calendars(?:\?|$)/.test(path)
      ? method === 'GET'
      : /^\/me\/calendars\/[^/?#]+\/events(?:\/[^/?#]+)?(?:\?|$)/.test(path) && ['GET', 'POST', 'PATCH'].includes(method);
    if (!allowedPath || path.includes('#') || path.includes('..')) throw new OutlookWriteError('日历请求无效', 400);
    const headers = new Headers(init.headers);
    for (const name of headers.keys()) if (name !== 'if-match') throw new OutlookWriteError('日历请求头无效', 400);
    await reserveMakeCall();
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `/v1.0${path}`, method,
        body: typeof init.body === 'string' ? init.body : '',
        headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Prefer', value: 'IdType="ImmutableId", outlook.timezone="Asia/Shanghai"' },
          ...(headers.has('if-match') ? [{ key: 'If-Match', value: headers.get('if-match')! }] : [])] }) });
    // Make's default 200 "Accepted" only acknowledges receipt; it does not prove Graph succeeded.
    let data: { protocol?: string; status?: number; body?: T };
    try { data = await response.json(); } catch { throw new OutlookWriteError('Make 未返回日历执行结果，请检查场景'); }
    if (!response.ok || data?.protocol !== 'bonbills-outlook-v1' || !Number.isInteger(data.status) || data.status! < 200 || data.status! > 599)
      throw new OutlookWriteError('Make 未返回有效日历执行结果');
    if (data.status! >= 300) throw new OutlookWriteError(data.status === 401 ? '微软授权已失效，请重新连接'
      : data.status === 403 ? '没有所选日历的写入权限' : `Outlook 日程同步失败（${data.status}）`, data.status);
    if (data.status !== 204 && (!data.body || typeof data.body !== 'object')) throw new OutlookWriteError('Make 日历执行结果不完整');
    return data.body as T;
  };
}
export async function connectOutlookMake(webhookUrl: unknown) {
  if (await kv.get(OUTLOOK_WRITE_KEY)) throw new OutlookWriteError('更换连接前请先断开连接', 409);
  const connection: WriteConnection = { id: randomUUID(), clientId: '', provider: 'make',
    encrypted: sealOutlookWrite({ webhookUrl: validateMakeWebhook(webhookUrl) }) };
  const calendars = await writableCalendars(await outlookGraphClient(connection));
  if (!calendars.length) throw new OutlookWriteError('未找到可编辑日历', 400);
  await kv.set(OUTLOOK_WRITE_KEY, connection);
  return { ...await outlookWriteStatus(), calendars };
}
export async function writableCalendars(client: string | GraphClient): Promise<WritableCalendar[]> {
  const request: GraphClient = typeof client === 'string' ? (path, init) => graphRequest(client, path, init) : client;
  let path = '/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100';
  const calendars: WritableCalendar[] = [];
  for (let page = 0; page < 5; page++) {
    const data = await request<{ value: WritableCalendar[]; '@odata.nextLink'?: string }>(path);
    calendars.push(...data.value.filter(calendar => calendar.canEdit && calendar.id && calendar.name));
    if (!data['@odata.nextLink']) return calendars;
    const next = new URL(data['@odata.nextLink']);
    if (next.origin !== 'https://graph.microsoft.com' || !next.pathname.startsWith('/v1.0/me/calendars')) throw new OutlookWriteError('日历分页地址无效');
    path = next.pathname.slice('/v1.0'.length) + next.search;
  }
  throw new OutlookWriteError('日历数量超出范围');
}
export async function outlookWriteStatus(listCalendars = false) {
  const [connection, settings] = await Promise.all([kv.get<WriteConnection>(OUTLOOK_WRITE_KEY), kv.get<{ clientId: string }>(SETTINGS_KEY)]);
  const calendars = connection && listCalendars ? await writableCalendars(await outlookGraphClient(connection)) : undefined;
  return { connected: Boolean(connection), enabled: Boolean(connection?.calendarId), clientId: settings?.clientId ?? process.env.OUTLOOK_CLIENT_ID ?? '',
    provider: connection?.provider ?? 'microsoft', calendarId: connection?.calendarId, calendarName: connection?.calendarName, lastSyncAt: connection?.lastSyncAt, error: connection?.lastError, calendars };
}
export async function selectOutlookWriteCalendar(calendarId: unknown) {
  const connection = await kv.get<WriteConnection>(OUTLOOK_WRITE_KEY);
  if (!connection) throw new OutlookWriteError('请先连接 Outlook', 400);
  // Reconnecting/switching calendars requires an explicit new selection; never silently use the primary calendar.
  if (connection.calendarId && connection.calendarId !== calendarId) throw new OutlookWriteError('更换日历前请先断开连接', 409);
  const calendar = (await writableCalendars(await outlookGraphClient(connection))).find(calendar => calendar.id === calendarId);
  if (!calendar) throw new OutlookWriteError('请选择可编辑的日历', 400);
  await kv.set(OUTLOOK_WRITE_KEY, { ...connection, calendarId: calendar.id, calendarName: calendar.name, lastError: undefined });
}
export async function disconnectOutlookWrite() { await kv.del(OUTLOOK_WRITE_KEY, FLOW_KEY); }
