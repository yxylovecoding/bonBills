import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectOutlookMake, outlookGraphClient, outlookWriteStatus, OUTLOOK_WRITE_KEY, sealOutlookWrite, unsealOutlookWrite, validateMakeWebhook } from './_outlookWrite';
const { data, reserve } = vi.hoisted(() => ({ data: new Map<string, any>(), reserve: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => data.get(key), set: async (key: string, value: unknown) => data.set(key, value), eval: reserve } }));
const url = 'https://hook.eu1.make.com/0123456789abcdef0123456789abcdef';
const connection = () => ({ id: 'make', clientId: '', provider: 'make' as const, encrypted: sealOutlookWrite({ webhookUrl: url }) });
const result = (body: unknown, status = 200) => new Response(JSON.stringify({ protocol: 'bonbills-outlook-v1', status, body }));
beforeEach(() => { data.clear(); reserve.mockReset().mockResolvedValue(1); vi.stubEnv('SYNC_SECRET', 'secret'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('仅接受官方 HTTPS Webhook 地址；拒绝地址注入与凭据回显', () => {
  expect(validateMakeWebhook(url)).toBe(url);
  for (const bad of ['http://hook.eu1.make.com/0123456789abcdef0123456789abcdef', url + '?token=x', url + '#x', url.replace('make.com', 'make.com.evil.test'), 'https://localhost/path', url.replace('https://', 'https://user:pass@')])
    expect(() => validateMakeWebhook(bad)).toThrow('地址无效');
});
it('正确封装请求、版本头与 Graph 响应，不向 Make 发送微软令牌', async () => {
  const fetch = vi.fn().mockResolvedValue(result({ id: 'event' })); vi.stubGlobal('fetch', fetch);
  const client = await outlookGraphClient(connection());
  expect(await client('/me/calendars/calendar/events/event', { method: 'PATCH', headers: { 'If-Match': 'version' }, body: '{"start":{}}' })).toEqual({ id: 'event' });
  const [endpoint, init] = fetch.mock.calls[0];
  expect(endpoint).toBe(url); expect(init.redirect).toBe('error');
  expect(JSON.parse(init.body)).toEqual({ path: '/v1.0/me/calendars/calendar/events/event', method: 'PATCH', body: '{"start":{}}', headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Prefer', value: 'IdType="ImmutableId", outlook.timezone="Asia/Shanghai"' }, { key: 'If-Match', value: 'version' }] });
  expect(init.headers).not.toHaveProperty('Authorization');
});
it('默认 Accepted、错误信封和错误 Graph 状态都不能误报成功', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const client = await outlookGraphClient(connection());
  for (const response of [new Response('Accepted'), new Response('{}'), result('Accepted'), new Response(JSON.stringify({ protocol: 'bonbills-outlook-v1', status: '200', body: {} }))]) {
    fetch.mockResolvedValueOnce(response); await expect(client('/me/calendars')).rejects.toThrow('Make');
  }
  fetch.mockResolvedValueOnce(result({ error: { message: url } }, 404));
  await expect(client('/me/calendars/c/events/e')).rejects.toMatchObject({ status: 404 });
  fetch.mockResolvedValueOnce(result({}, 412));
  await expect(client('/me/calendars/c/events/e')).rejects.toMatchObject({ status: 412 });
});
it('仅能访问必要的日历接口，额度用完在请求发出前停止', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const client = await outlookGraphClient(connection());
  for (const path of ['/me/messages', '/users/other/calendars', '/me/calendars/c/events/../messages', 'https://evil.test']) await expect(client(path)).rejects.toThrow('无效');
  await expect(client('/me/calendars/c/events/e', { method: 'DELETE' })).rejects.toThrow('无效');
  await expect(client('/me/calendars', { headers: { Authorization: 'token' } })).rejects.toThrow('无效');
  expect(reserve).not.toHaveBeenCalled();
  reserve.mockResolvedValueOnce(0); await expect(client('/me/calendars')).rejects.toMatchObject({ status: 429 });
  expect(fetch).not.toHaveBeenCalled(); expect(reserve.mock.calls[0][0]).toContain('zcard');
});
it('只读验证成功后才存加密地址，状态不泄露，连接本身不启用写入', async () => {
  const fetch = vi.fn().mockResolvedValue(result({ value: [{ id: 'c', name: '日历', canEdit: true }] })); vi.stubGlobal('fetch', fetch);
  expect(await connectOutlookMake(url)).toMatchObject({ connected: true, enabled: false, provider: 'make' });
  expect(JSON.stringify(data.get(OUTLOOK_WRITE_KEY))).not.toContain(url);
  expect(unsealOutlookWrite(data.get(OUTLOOK_WRITE_KEY).encrypted)).toEqual({ webhookUrl: url });
  expect(JSON.stringify(await outlookWriteStatus())).not.toContain(url);
  await expect(connectOutlookMake(url)).rejects.toThrow('先断开');
});
