import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectOutlookFallback, disconnectOutlookFallback, disconnectOutlookWrite, outlookGraphClient, outlookWriteStatus,
  OUTLOOK_WRITE_KEY, sealOutlookWrite, unsealOutlookWrite, validateActivepiecesWebhook, type WriteConnection } from './_outlookWrite';

const { data, reserve } = vi.hoisted(() => ({ data: new Map<string, any>(), reserve: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown) => data.set(key, structuredClone(value)),
  del: async (...keys: string[]) => { keys.forEach(key => data.delete(key)); },
  eval: reserve,
} }));
const makeUrl = 'https://hook.eu1.make.com/0123456789abcdef0123456789abcdef';
const backupUrl = 'https://cloud.activepieces.com/api/v1/webhooks/1234567890Abcdefghijk/sync';
const secret = 'private-backup-key-0123456789abcdef';
const stateKey = 'outlook:write-relay-state:v1';
const eventPath = '/me/calendars/calendar/events/event';
const result = (body: unknown, status = 200) => new Response(JSON.stringify({ protocol: 'bonbills-outlook-v1', status, body }));
function connection(backup = true): WriteConnection {
  const value: WriteConnection = { id: 'connection', clientId: '', provider: 'make', calendarId: 'calendar', calendarName: '日历',
    encrypted: sealOutlookWrite({ webhookUrl: makeUrl }),
    ...(backup ? { fallback: { provider: 'activepieces' as const, encrypted: sealOutlookWrite({ webhookUrl: backupUrl, secret }), calendarId: 'calendar' } } : {}) };
  data.set(OUTLOOK_WRITE_KEY, structuredClone(value)); return value;
}
beforeEach(() => { data.clear(); reserve.mockReset().mockResolvedValue(1); vi.stubEnv('SYNC_SECRET', 'test-secret'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T02:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('备用地址只允许官方云端正式 Webhook，自动补齐同步后缀', () => {
  expect(validateActivepiecesWebhook(backupUrl)).toBe(backupUrl);
  expect(validateActivepiecesWebhook(backupUrl.slice(0, -5))).toBe(backupUrl);
  for (const url of [backupUrl.replace('https:', 'http:'), backupUrl + '?token=private', backupUrl + '#private', backupUrl + '/test',
    backupUrl.replace('cloud.activepieces.com', 'cloud.activepieces.com.evil.test'), backupUrl.replace('https://', 'https://user:pass@'),
    'https://127.0.0.1/api/v1/webhooks/1234567890Abcdefghijk/sync']) expect(() => validateActivepiecesWebhook(url)).toThrow('地址无效');
});
it('备用只读验证同一日历后保存密文，保留主连接和事件状态且不泄露凭据', async () => {
  const original = connection(false); data.set('outlook:events', { eventId: 'existing' });
  const fetch = vi.fn().mockResolvedValue(result({ value: [{ id: 'calendar', name: '日历', canEdit: true }] })); vi.stubGlobal('fetch', fetch);
  expect(await connectOutlookFallback(backupUrl, secret)).toMatchObject({ connected: true, enabled: true, fallbackConnected: true, activeProvider: 'make' });
  const stored = data.get(OUTLOOK_WRITE_KEY);
  expect(stored).toMatchObject(original);
  expect(unsealOutlookWrite(stored.fallback.encrypted)).toEqual({ webhookUrl: backupUrl, secret });
  expect(JSON.stringify(stored)).not.toContain(secret);
  expect(JSON.stringify(await outlookWriteStatus())).not.toMatch(/private-backup|webhooks|encrypted/);
  expect(data.get('outlook:events')).toEqual({ eventId: 'existing' });
  expect(fetch.mock.calls).toHaveLength(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body).method).toBe('GET');
});
it('同名不同日历、无写权限、短密钥及尚未启用的主连接均不能保存备用', async () => {
  connection(false);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const calendar of [{ id: 'other', name: '日历', canEdit: true }, { id: 'calendar', name: '日历', canEdit: false }]) {
    fetch.mockResolvedValueOnce(result({ value: [calendar] }));
    await expect(connectOutlookFallback(backupUrl, secret)).rejects.toThrow('同一个 Outlook 日历');
    expect(data.get(OUTLOOK_WRITE_KEY).fallback).toBeUndefined();
  }
  await expect(connectOutlookFallback(backupUrl, 'short')).rejects.toThrow('密钥');
  data.set(OUTLOOK_WRITE_KEY, { ...connection(false), calendarId: undefined });
  await expect(connectOutlookFallback(backupUrl, secret)).rejects.toThrow('先连接');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('平时优先使用 Make，不额外探测或消耗备用额度', async () => {
  const fetch = vi.fn().mockResolvedValue(result({ id: 'event' })); vi.stubGlobal('fetch', fetch);
  expect(await (await outlookGraphClient(connection()))(eventPath)).toEqual({ id: 'event' });
  expect(fetch.mock.calls.map(call => call[0])).toEqual([makeUrl]);
  expect(reserve.mock.calls.map(call => call[1])).toEqual([['outlook:make-calls:v1']]);
});
it.each(['GET', 'POST', 'PATCH', 'DELETE'])('Make 本地额度用完时 %s 在发出前切换，保留事务标识和版本头', async method => {
  reserve.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  const fetch = vi.fn().mockResolvedValue(result(method === 'DELETE' ? undefined : { id: 'existing' }, method === 'DELETE' ? 204 : 200)); vi.stubGlobal('fetch', fetch);
  const init: RequestInit = { method, ...(method === 'POST' ? { body: '{"transactionId":"existing-transaction"}' } : {}),
    ...(['PATCH', 'DELETE'].includes(method) ? { headers: { 'If-Match': 'original-version' } } : {}) };
  await (await outlookGraphClient(connection()))(method === 'POST' ? '/me/calendars/calendar/events' : eventPath, init);
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe(backupUrl);
  expect(fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-BonBills-Key': secret });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ method, body: init.body ?? '' });
  if (method === 'PATCH' || method === 'DELETE') expect(JSON.parse(fetch.mock.calls[0][1].body).headers).toContainEqual({ key: 'If-Match', value: 'original-version' });
  expect(await outlookWriteStatus()).toMatchObject({ provider: 'make', activeProvider: 'activepieces' });
});
it('本地额度恢复后下一次请求自动回到 Make，保留同一事件路径', async () => {
  const connected = connection(); reserve.mockResolvedValueOnce(0);
  const fetch = vi.fn().mockImplementation(async () => result({ id: 'existing' })); vi.stubGlobal('fetch', fetch);
  await (await outlookGraphClient(connected))(eventPath);
  await (await outlookGraphClient(connected))(eventPath);
  expect(fetch.mock.calls.map(call => call[0])).toEqual([backupUrl, makeUrl]);
  expect(fetch.mock.calls.map(call => JSON.parse(call[1].body).path)).toEqual([`/v1.0${eventPath}`, `/v1.0${eventPath}`]);
  expect(await outlookWriteStatus()).toMatchObject({ activeProvider: 'make' });
});
it('Make 未执行的只读请求切到备用，跨同步保持冷却，六小时后成功即切回', async () => {
  const connected = connection();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('Accepted')).mockImplementation(async () => result({ id: 'event' })); vi.stubGlobal('fetch', fetch);
  await (await outlookGraphClient(connected))(eventPath);
  await (await outlookGraphClient(connected))(eventPath);
  expect(fetch.mock.calls.map(call => call[0])).toEqual([makeUrl, backupUrl, backupUrl]);
  vi.advanceTimersByTime(6 * 3600_000);
  await (await outlookGraphClient(connected))(eventPath);
  expect(fetch.mock.calls.at(-1)![0]).toBe(makeUrl);
  expect(await outlookWriteStatus()).toMatchObject({ activeProvider: 'make' });
});
it.each([401, 403, 404, 412, 429, 500])('Graph 明确返回 %s 时保留原错误，不当作 Make 额度用完重试', async status => {
  const fetch = vi.fn().mockResolvedValue(result({}, status)); vi.stubGlobal('fetch', fetch);
  await expect((await outlookGraphClient(connection()))(eventPath)).rejects.toMatchObject({ status });
  expect(fetch.mock.calls.map(call => call[0])).toEqual([makeUrl]);
  expect(data.has(stateKey)).toBe(false);
});
it.each(['POST', 'PATCH', 'DELETE'])('Make 的 %s 写入响应丢失后不向备用重发；下一轮先查已有日程', async method => {
  const connected = connection();
  const fetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(result({ id: 'already-created' })); vi.stubGlobal('fetch', fetch);
  await expect((await outlookGraphClient(connected))(eventPath, { method, headers: { 'If-Match': 'version' } })).rejects.toThrow('Make');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await (await outlookGraphClient(connected))(eventPath)).toEqual({ id: 'already-created' });
  expect(JSON.parse(fetch.mock.calls[1][1].body).method).toBe('GET');
  expect(fetch.mock.calls[1][0]).toBe(backupUrl);
});
it('冷却结束后的首个写入先只读确认 Make 恢复', async () => {
  const connected = connection();
  data.set(stateKey, { connectionId: connected.id, activeProvider: 'activepieces', makeRetryAt: Date.now() - 1 });
  const fetch = vi.fn().mockImplementation(async () => result({ id: 'event' })); vi.stubGlobal('fetch', fetch);
  await (await outlookGraphClient(connected))(eventPath, { method: 'PATCH', headers: { 'If-Match': 'v1' }, body: '{}' });
  expect(fetch.mock.calls.map(call => [call[0], JSON.parse(call[1].body).method])).toEqual([[makeUrl, 'GET'], [makeUrl, 'PATCH']]);
});
it('两边都达到保护上限时明确失败，不发送请求或清零额度', async () => {
  reserve.mockResolvedValue(0); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect((await outlookGraphClient(connection()))(eventPath)).rejects.toThrow('Activepieces 免费调用额度');
  expect(fetch).not.toHaveBeenCalled();
  expect(reserve.mock.calls.map(call => call[1])).toEqual([['outlook:make-calls:v1'], ['outlook:activepieces-calls:v1']]);
});
it('备用运行期间也拒绝跨日历及无版本删除，旧连接冷却不影响新连接', async () => {
  const connected = connection();
  data.set(stateKey, { connectionId: connected.id, activeProvider: 'activepieces', makeRetryAt: Date.now() + 3600_000 });
  const fetch = vi.fn().mockResolvedValue(result({ id: 'event' })); vi.stubGlobal('fetch', fetch);
  const client = await outlookGraphClient(connected);
  await expect(client('/me/calendars/other/events/event')).rejects.toThrow('无效');
  await expect(client(eventPath, { method: 'DELETE' })).rejects.toThrow('无效');
  expect(fetch).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  await (await outlookGraphClient({ ...connected, id: 'new-connection' }))(eventPath);
  expect(fetch.mock.calls[0][0]).toBe(makeUrl);
});
it('移除备用保留 Make、日程和额度记录；断开全部时清理通道状态', async () => {
  const connected = connection();
  data.set('outlook:activepieces-calls:v1', ['used']); data.set('outlook:events', { id: 'existing' });
  data.set(stateKey, { connectionId: connected.id, activeProvider: 'activepieces' });
  expect(await disconnectOutlookFallback()).toMatchObject({ connected: true, fallbackConnected: false, activeProvider: 'make' });
  expect(data.get(OUTLOOK_WRITE_KEY).encrypted).toBe(connected.encrypted);
  expect(data.has(stateKey)).toBe(false);
  await disconnectOutlookWrite();
  expect(data.get('outlook:activepieces-calls:v1')).toEqual(['used']);
  expect(data.get('outlook:events')).toEqual({ id: 'existing' });
  expect(await outlookWriteStatus()).toMatchObject({ connected: false, fallbackConnected: false });
});
it('备用成功时展示 Make 恢复时间而不误报同步暂停，统计仅计实际备用请求', async () => {
  const oldest = Date.parse('2026-10-10T00:00:00Z');
  reserve.mockImplementation(async (script: string, keys: string[]) => script.includes('WITHSCORES') ? [200, oldest]
    : keys[0] === 'outlook:make-calls:v1' ? 0 : 1);
  const count = vi.fn(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result({ id: 'event' })));
  const connected = connection();
  data.set(OUTLOOK_WRITE_KEY, { ...connected, lastError: 'Make 免费调用额度已暂停，请稍后再试' });
  await (await outlookGraphClient(connected, count))(eventPath);
  expect(count.mock.calls).toEqual([['GET']]);
  expect(await outlookWriteStatus()).toMatchObject({ activeProvider: 'activepieces', error: undefined, retryAt: undefined,
    makeRetryAt: '2026-11-11T00:00:00.000Z' });
  expect(data.get(OUTLOOK_WRITE_KEY).lastError).toBe('Make 免费调用额度已暂停，请稍后再试');
  data.set(OUTLOOK_WRITE_KEY, { ...connected, lastError: 'Activepieces 免费调用额度已暂停，请稍后再试' });
  expect((await outlookWriteStatus()).error).toBe('Activepieces 免费调用额度已暂停，请稍后再试');
});
it('没有备用时保留新旧 Make 额度错误的恢复提示', async () => {
  const connected = connection(false);
  data.set(OUTLOOK_WRITE_KEY, { ...connected, lastError: 'Make 免费调用额度已暂停，请稍后再试' });
  reserve.mockResolvedValue([199, 0]);
  expect(await outlookWriteStatus()).toMatchObject({ error: '免费额度已释放，等待下次同步', retryAt: undefined });
});
