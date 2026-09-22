import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './outlook-calendar';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar';

const { data, authenticated, sameOrigin } = vi.hoisted(() => ({ data: new Map<string, unknown>(), authenticated: vi.fn(), sameOrigin: vi.fn() }));
vi.mock('./_auth.js', () => ({ authOk: authenticated, sameOrigin }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => data.get(key) ?? null,
  set: async (key: string, value: unknown) => { data.set(key, value); return 'OK'; },
  del: async (key: string) => data.delete(key),
} }));
const key = 'outlook:calendar-connection:v1';
const range = { startDate: '2026-09-01', endDate: '2026-10-01' };
const input = { ...range, playUrl: 'https://outlook.live.com/owa/calendar/private/published/calendar.ics', classUrl: '', policy: 'manual', rules: DEFAULT_OUTLOOK_RULES };
const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:trip\r\nDTSTART;VALUE=DATE:20260922\r\nDTEND;VALUE=DATE:20260924\r\nSUMMARY:出游\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
async function call(method: string, body?: unknown) {
  const result = { status: 200, body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const res = {
    setHeader: (name: string, value: string) => { result.headers[name] = value; },
    status: (status: number) => { result.status = status; return res; },
    json: (value: Record<string, unknown>) => { result.body = value; return res; },
  };
  await handler({ method, body, headers: {}, query: {} } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
beforeEach(() => {
  data.clear(); authenticated.mockResolvedValue(true); sameOrigin.mockReturnValue(true);
  vi.stubEnv('SYNC_SECRET', 'test-secret');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(ics)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Outlook 连接接口', () => {
  it.each(['GET', 'POST', 'PUT', 'DELETE'])('未授权 %s 不读取或修改连接', async (method) => {
    authenticated.mockResolvedValue(false);
    expect((await call(method, input)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled(); expect(data.size).toBe(0);
  });
  it('拒绝跨站和无效日期', async () => {
    sameOrigin.mockReturnValue(false);
    expect((await call('PUT', input)).status).toBe(403);
    sameOrigin.mockReturnValue(true);
    expect((await call('POST', { startDate: '2026-02-30', endDate: '2026-03-01' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('预览不保存；返回日程标题但不暴露订阅链接', async () => {
    const preview = await call('POST', { ...input, action: 'preview' });
    expect(preview.status).toBe(200); expect(data.size).toBe(0);
    expect(preview.body.snapshot).toEqual({ ...range, tags: { '2026-09-22': 'travel', '2026-09-23': 'travel' }, travelTitles: { '2026-09-22': '出游', '2026-09-23': '出游' } });
    const connected = await call('PUT', input);
    expect(connected.body.connected).toBe(true);
    expect(JSON.stringify(data.get(key))).not.toContain('https://');
    const status = await call('GET');
    expect(status.body.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain(input.playUrl);
    expect(status.headers['Cache-Control']).toContain('no-store');
    expect((await call('DELETE')).body.connected).toBe(false);
    expect(data.size).toBe(0);
  });
  it('读取失败保留已有连接，错误不包含私密订阅地址', async () => {
    await call('PUT', input);
    const existing = data.get(key);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(input.playUrl); }));
    const result = await call('PUT', input);
    expect(result.status).toBe(502); expect(data.get(key)).toEqual(existing);
    expect(JSON.stringify(result)).not.toContain(input.playUrl);
  });
  it('读取期间连接被断开，拒绝返回旧快照', async () => {
    await call('PUT', input);
    vi.stubGlobal('fetch', vi.fn(async () => { data.delete(key); return new Response(ics); }));
    const result = await call('POST', range);
    expect(result.status).toBe(409); expect(result.body.snapshot).toBeUndefined();
  });
});
