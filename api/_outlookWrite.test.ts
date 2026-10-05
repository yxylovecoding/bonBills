import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { accessToken, disconnectOutlookWrite, graphRequest, outlookWriteStatus, OUTLOOK_WRITE_KEY, pollOutlookWrite,
  sealOutlookWrite, selectOutlookWriteCalendar, startOutlookWrite, unsealOutlookWrite, withOutlookWriteLock } from './_outlookWrite';
const { data } = vi.hoisted(() => ({ data: new Map<string, any>() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: any, options?: { nx?: boolean }) => { if (options?.nx && data.has(key)) return null; data.set(key, structuredClone(value)); return 'OK'; },
  del: async (...keys: string[]) => { keys.forEach(key => data.delete(key)); },
  eval: async (script: string, keys: string[], args: string[]) => { if (data.get(keys[0]) !== args[0]) return 0; if (script.includes("'del'")) data.delete(keys[0]); return 1; },
} }));
const clientId = '11111111-2222-3333-4444-555555555555';
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { data.clear(); vi.stubEnv('SYNC_SECRET', 'test-secret'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T08:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function device() {
  const fetch = vi.fn(async () => json({ device_code: 'PRIVATE-DEVICE-CODE', user_code: 'ABCDEFGH', expires_in: 900, interval: 5 }));
  vi.stubGlobal('fetch', fetch); return fetch;
}
it('授权码及刷新凭据加密保存，状态响应不泄露令牌', async () => {
  const fetch = device(), flow = await withOutlookWriteLock(() => startOutlookWrite(clientId));
  expect(JSON.stringify([...data.values()])).not.toContain('PRIVATE-DEVICE-CODE');
  expect(flow).not.toHaveProperty('device_code');
  expect(new URLSearchParams(String(fetch.mock.calls[0]?.[1]?.body)).get('scope')).toBe('offline_access https://graph.microsoft.com/Calendars.ReadWrite');
  vi.advanceTimersByTime(5000);
  fetch.mockResolvedValueOnce(json({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600, scope: 'Calendars.ReadWrite' }));
  expect(await pollOutlookWrite(flow.flowId)).toEqual({ pending: false });
  const saved = data.get(OUTLOOK_WRITE_KEY);
  expect(saved.calendarId).toBeUndefined();
  expect(unsealOutlookWrite(saved.encrypted)).toMatchObject({ access_token: 'ACCESS', refresh_token: 'REFRESH' });
  const status = await outlookWriteStatus();
  expect(status).toMatchObject({ connected: true, enabled: false });
  expect(JSON.stringify(status)).not.toMatch(/ACCESS|REFRESH|encrypted/);
});
it('只接受当前未过期流程并遵守轮询间隔，拒绝过期、取消和未获写入权限', async () => {
  const fetch = device(), old = await startOutlookWrite(clientId), flow = await startOutlookWrite(clientId);
  await expect(pollOutlookWrite(old.flowId)).rejects.toThrow('过期');
  expect(await pollOutlookWrite(flow.flowId)).toMatchObject({ pending: true }); expect(fetch).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5000); fetch.mockResolvedValueOnce(json({ error: 'slow_down' }, 400));
  expect(await pollOutlookWrite(flow.flowId)).toMatchObject({ pending: true, interval: 10 });
  vi.advanceTimersByTime(10000); fetch.mockResolvedValueOnce(json({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600, scope: 'Calendars.Read' }));
  await expect(pollOutlookWrite(flow.flowId)).rejects.toThrow('写入授权'); expect(data.has(OUTLOOK_WRITE_KEY)).toBe(false);
  vi.advanceTimersByTime(900000); await expect(pollOutlookWrite(flow.flowId)).rejects.toThrow('过期');
});
it('刷新时保存新的 refresh token，失效错误不暴露提供方响应', async () => {
  const connection = { id: 'c', clientId, encrypted: sealOutlookWrite({ access_token: 'old', refresh_token: 'refresh-old', expiresAt: 0 }) };
  const fetch = vi.fn(async () => json({ access_token: 'new', refresh_token: 'refresh-new', expires_in: 3600, scope: 'Calendars.ReadWrite' }));
  vi.stubGlobal('fetch', fetch);
  expect(await accessToken(connection)).toBe('new');
  expect(unsealOutlookWrite(data.get(OUTLOOK_WRITE_KEY).encrypted)).toMatchObject({ refresh_token: 'refresh-new' });
  await accessToken(connection); expect(fetch).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(3600000); fetch.mockResolvedValueOnce(json({ error: 'invalid_grant', error_description: 'PRIVATE' }, 400));
  await expect(accessToken(connection)).rejects.toThrow('授权已失效');
});
it('日历选择只接受服务端验证可写的 ID；断开不会删除 Outlook 日程', async () => {
  data.set(OUTLOOK_WRITE_KEY, { id: 'c', clientId, encrypted: sealOutlookWrite({ access_token: 'token', refresh_token: 'refresh', expiresAt: Date.now() + 3600000 }) });
  const fetch = vi.fn(async () => json({ value: [{ id: 'primary', name: '日历', canEdit: true, isDefaultCalendar: true }, { id: 'holiday', name: '节假日', canEdit: false }] }));
  vi.stubGlobal('fetch', fetch);
  await expect(selectOutlookWriteCalendar('holiday')).rejects.toThrow('可编辑');
  await selectOutlookWriteCalendar('primary'); expect((await outlookWriteStatus()).calendarName).toBe('日历');
  await expect(selectOutlookWriteCalendar('another')).rejects.toThrow('断开');
  const calls = fetch.mock.calls.length; await disconnectOutlookWrite();
  expect((await outlookWriteStatus()).connected).toBe(false); expect(fetch.mock.calls.length).toBe(calls);
});
it('拒绝竞争写入，租约丢失后不继续写，固定 Graph 主机', async () => {
  await withOutlookWriteLock(async keepLease => {
    await expect(withOutlookWriteLock(async () => 1)).rejects.toThrow('正在同步');
    data.set('outlook:laundry-write:lock:v1', 'another');
    await expect(keepLease()).rejects.toThrow('锁已失效');
  });
  expect(data.get('outlook:laundry-write:lock:v1')).toBe('another');
  await expect(graphRequest('token', 'https://other.invalid')).rejects.toThrow('无效');
  const fetch = vi.fn(async () => json({ error: { message: 'PRIVATE TOKEN' } }, 403)); vi.stubGlobal('fetch', fetch);
  await expect(graphRequest('token', '/me/calendars')).rejects.toThrow('写入权限');
});
it('错误密钥或篡改密文不能解密', () => {
  const sealed = sealOutlookWrite('secret'); vi.stubEnv('SYNC_SECRET', 'different');
  expect(() => unsealOutlookWrite(sealed)).toThrow();
});
