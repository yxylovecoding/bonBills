import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './ticktick-trips';
import { LIFE_CONNECTION_KEY, periodsKey, readPeriodDays, syncRecentLifePeriods } from './_bonLife';
import { encryptOutlookConnection } from './_outlookCalendar';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar';

const { data, auth, write, lock } = vi.hoisted(() => ({ data: new Map<string, any>(), auth: vi.fn(), write: vi.fn(), lock: vi.fn() }));
vi.mock('./_auth.js', () => ({ authOk: auth }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: lock }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null), eval: write,
} }));
const url = 'https://outlook.live.com/owa/calendar/private/published/calendar.ics';
const event = (uid: string, title: string, start: string, end: string, extra = '') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nSUMMARY:${title}\r\n${extra}END:VEVENT`;
const calendar = (events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const feed = () => calendar([
  event('last-year', '例假', '20250102', '20250106'),
  event('cross-year', '经期', '20251230', '20260104'),
  event('current', '月经', '20260929', '20261003'),
  event('next-year', '🩸', '20261230', '20270104'),
  event('forecast', '预计月经', '20261029', '20261103'),
  event('other', '上课', '20261001', '20261002'),
]);

beforeEach(() => {
  data.clear(); vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T05:00:00+08:00'));
  vi.stubEnv('SYNC_SECRET', 'secret'); vi.stubEnv('CRON_SECRET', 'cron-secret'); auth.mockResolvedValue(false);
  data.set(LIFE_CONNECTION_KEY, { id: 'period-connection', encrypted: encryptOutlookConnection({ playUrl: url, classUrl: '',
    policy: 'manual', rules: DEFAULT_OUTLOOK_RULES }, 'secret') });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(feed())));
  write.mockImplementation(async (_script, keys, args) => {
    if (data.get(keys[0])?.id !== args[0]) return 0;
    const previous = data.get(keys[1]);
    if ((previous?.requestedAt ?? 0) !== args[3]) return -1;
    data.set(keys[1], JSON.parse(args[2])); return 1;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function request(method = 'GET', authorization?: string) {
  const result = { status: 200, body: {} as Record<string, any> };
  const res = { setHeader: vi.fn(), status: (code: number) => { result.status = code; return res; },
    json: (body: Record<string, unknown>) => { result.body = body; return res; } };
  await handler({ method, query: { action: 'life-periods' }, headers: { authorization } } as VercelRequest, res as unknown as VercelResponse);
  return result;
}

describe('独立经期定时归档', () => {
  it('无 TickTick 也能定时导入并保存相邻年份，只获取一次 Outlook', async () => {
    data.set('ticktick:trip-sync:lock', 'busy');
    data.set('calendar-tags', { untouched: true });
    const result = await request('GET', 'Bearer cron-secret');
    expect(result).toMatchObject({ status: 200, body: { ok: true, connected: true, syncedAt: '2026-10-04T21:00:00.000Z' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lock).not.toHaveBeenCalled();
    expect(data.get('calendar-tags')).toEqual({ untouched: true });
    expect([2025, 2026, 2027].every((year) => Boolean(data.get(periodsKey(year))?.syncedAt))).toBe(true);
    const days = await readPeriodDays(2026);
    expect(days).toEqual(expect.arrayContaining(['2025-01-02', '2025-12-30', '2026-01-03', '2026-09-29', '2026-10-02', '2027-01-03']));
    expect(days).not.toContain('2026-10-29'); expect(days).not.toContain('2026-10-03');
  });
  it('同一日程反复同步不重复，断开后仍能读取已保存的经期', async () => {
    await syncRecentLifePeriods();
    const days = await readPeriodDays(2026);
    await syncRecentLifePeriods();
    expect(await readPeriodDays(2026)).toEqual(days);
    data.delete(LIFE_CONNECTION_KEY); vi.mocked(fetch).mockClear();
    expect(await syncRecentLifePeriods()).toEqual({ connected: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(await readPeriodDays(2026)).toEqual(days);
  });
  it('跨年后订阅已移除旧日程，保存的历史仍能读取', async () => {
    await syncRecentLifePeriods();
    vi.setSystemTime(new Date('2027-02-01T05:00:00+08:00'));
    vi.mocked(fetch).mockImplementation(async () => new Response(calendar([])));
    await syncRecentLifePeriods();
    expect(await readPeriodDays(2026)).toEqual(expect.arrayContaining(['2026-01-03', '2026-09-29', '2026-10-02', '2027-01-03']));
    expect(data.get(periodsKey(2025)).events.some((value: { uid: string }) => value.uid === 'last-year')).toBe(true);
  });
  it('源中改期、取消和更名会更新全部活动快照，不恢复过时日期', async () => {
    await syncRecentLifePeriods();
    vi.mocked(fetch).mockImplementation(async () => new Response(calendar([
      event('current', '月经', '20260928', '20261002'),
      event('cross-year', '普通日程', '20251230', '20260104'),
      event('next-year', '月经', '20261230', '20270104', 'STATUS:CANCELLED\r\n'),
    ])));
    await syncRecentLifePeriods();
    const days = await readPeriodDays(2026);
    expect(days).toContain('2026-09-28'); expect(days).not.toContain('2026-10-02');
    expect(days).not.toContain('2026-01-01'); expect(days).not.toContain('2027-01-01');
    expect(days).toContain('2025-01-02');
  });
  it.each(['network', 'malformed'])('%s 失败不覆盖已有快照，响应不泄露订阅链接', async (failure) => {
    await syncRecentLifePeriods();
    const before = structuredClone([...data]); write.mockClear();
    vi.mocked(fetch).mockImplementation(async () => {
      if (failure === 'network') throw new Error(url);
      return new Response('BEGIN:VCALENDAR\r\ninvalid');
    });
    const result = await request('GET', 'Bearer cron-secret');
    expect(result.status).toBe(502); expect(result.body.error).toContain('已保留历史');
    expect(JSON.stringify(result)).not.toContain(url);
    expect([...data]).toEqual(before); expect(write).not.toHaveBeenCalled();
  });
  it('读取期间断开连接不能发布旧数据', async () => {
    vi.mocked(fetch).mockImplementation(async () => { data.delete(LIFE_CONNECTION_KEY); return new Response(feed()); });
    await expect(syncRecentLifePeriods()).rejects.toThrow('同步失败');
    expect([2025, 2026, 2027].every((year) => !data.has(periodsKey(year)))).toBe(true);
  });
  it('页面先保存的新快照不会被后台较旧读取覆盖', async () => {
    const newer = { requestedAt: Date.now() + 1, events: [{ uid: 'new', startDate: '2026-10-01', endDate: '2026-10-06' }] };
    vi.mocked(fetch).mockImplementation(async () => { data.set(periodsKey(2026), newer); return new Response(feed()); });
    await expect(syncRecentLifePeriods()).rejects.toThrow('同步失败');
    expect(data.get(periodsKey(2026))).toEqual(newer);
  });
  it('需要 cron 密钥或登录后的 POST，普通 GET 和未授权请求不导入', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) expect((await request(method, 'Bearer wrong')).status).toBe(401);
    auth.mockResolvedValue(true);
    expect((await request()).status).toBe(405);
    expect((await request('DELETE')).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
    expect((await request('POST')).status).toBe(200);
  });
});
