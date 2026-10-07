import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './ticktick-trips';

const { auth, lock, release, sync, timed, hair, daily, exercise, data, outlook, archive } = vi.hoisted(() => ({ auth: vi.fn(), lock: vi.fn(), release: vi.fn(),
  sync: vi.fn(), timed: vi.fn(), hair: vi.fn(), daily: vi.fn(), exercise: vi.fn(), data: new Map<string, unknown>(), outlook: vi.fn(), archive: vi.fn() }));
vi.mock('./_auth.js', () => ({ authOk: auth }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: lock, releaseTickTickLock: release }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => data.get(key) } }));
vi.mock('./_ticktickNightRoutine.js', () => ({ syncNightRoutineVisibility: sync, syncTimedTaskVisibility: timed,
  syncHairWashVisibility: hair,
  syncReadingVisibility: vi.fn(async () => ({ matched: 1, updated: 1, visible: 1, hidden: 0, skipped: 0 })) }));
vi.mock('./_ticktickSleepTags.js', () => ({ syncSleepRoutineTags: daily }));
vi.mock('./_ticktickExercise.js', () => ({ syncExerciseSchedule: exercise }));
vi.mock('./_outlookSync.js', () => ({ syncOutlookCalendar: outlook }));
vi.mock('./_lifeDone.js', () => ({ syncRecentLifeDone: archive }));
vi.mock('./_ticktickTrips.js', async (original) => ({ ...await original<typeof import('./_ticktickTrips')>(),
  decryptTickTickToken: () => 'token', TickTickOpenApiClient: class {} }));

async function request(method = 'GET', authorization?: string, action = 'night-routine') {
  const result = { status: 200, body: {} as Record<string, any> };
  const res = { setHeader: vi.fn(), status: (code: number) => { result.status = code; return res; },
    json: (body: Record<string, unknown>) => { result.body = body; return res; } };
  await handler({ method, query: { action }, headers: { authorization } } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks(); data.clear(); vi.stubEnv('CRON_SECRET', 'cron-secret'); auth.mockResolvedValue(false);
  lock.mockResolvedValue('lock'); sync.mockResolvedValue({ matched: 1, updated: 1, visible: 1, hidden: 0, skipped: 0 });
  timed.mockResolvedValue({ matched: 2, updated: 1, visible: 1, hidden: 1, skipped: 0 });
  exercise.mockResolvedValue({ updated: 1, minimumDates: new Map() });
  daily.mockResolvedValue({ mode: 'restore', updated: 1, remaining: 0, complete: true });
  hair.mockResolvedValue({ matched: 1, updated: 1, visible: 1, hidden: 0, skipped: 0 });
  data.set('ticktick:connection:v1', { projectId: 'life', encryptedToken: {}, timeZone: 'Asia/Shanghai' });
});
afterEach(() => vi.unstubAllEnvs());

describe('夜间显隐轻量入口', () => {
  it('有效 cron 鉴权切换标签和跳过运动，不读取 Outlook 或归档', async () => {
    const result = await request('GET', 'Bearer cron-secret');
    expect(result).toMatchObject({ status: 200, body: { ok: true, connected: true, nightRoutine: { updated: 1 }, exercise: { updated: 1 } } });
    expect(exercise).toHaveBeenCalledOnce();
    expect(daily).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith(expect.anything(), { timeZone: 'Asia/Shanghai', projectId: 'life' });
    expect(outlook).not.toHaveBeenCalled(); expect(archive).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('lock');
  });
  it.each(['night-routine', 'daily-routine', 'routine-visibility', 'hair-wash', 'reading-visibility', 'timed-visibility'])('%s 普通 GET 无副作用，仅认证 POST 能手动执行', async (action) => {
    expect((await request('GET', undefined, action)).status).toBe(401);
    expect((await request('POST', 'Bearer wrong', action)).status).toBe(401);
    auth.mockResolvedValue(true);
    expect((await request('GET', undefined, action)).status).toBe(405);
    expect(sync).not.toHaveBeenCalled();
    expect(daily).not.toHaveBeenCalled();
    expect((await request('POST', undefined, action)).status).toBe(200);
  });
  it('20 点入口处理洗头和阅读标签，共用锁且不触发其他排程', async () => {
    expect(await request('GET', 'Bearer cron-secret', 'hair-wash')).toMatchObject({ status: 200,
      body: { hairWash: { updated: 1 }, reading: { updated: 1 } } });
    expect(hair).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    expect(daily).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled(); expect(exercise).not.toHaveBeenCalled();
    expect(outlook).not.toHaveBeenCalled(); expect(archive).not.toHaveBeenCalled();
  });
  it('定时任务入口只同步具体时间的任务', async () => {
    expect(await request('GET', 'Bearer cron-secret', 'timed-visibility')).toMatchObject({ status: 200,
      body: { timedTasks: { matched: 2, updated: 1 } } });
    expect(timed).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    expect(daily).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled(); expect(exercise).not.toHaveBeenCalled();
  });
  it('零点入口只切换日常任务；五点入口在同一把锁内处理两种 routine 和运动', async () => {
    expect(await request('GET', 'Bearer cron-secret', 'daily-routine')).toMatchObject({ status: 200, body: { sleepTags: { updated: 1, complete: true } } });
    expect(sync).not.toHaveBeenCalled(); expect(exercise).not.toHaveBeenCalled();
    expect(outlook).not.toHaveBeenCalled(); expect(archive).not.toHaveBeenCalled();
    expect(await request('GET', 'Bearer cron-secret', 'routine-visibility')).toMatchObject({ status: 200,
      body: { sleepTags: { updated: 1, complete: true }, nightRoutine: { updated: 1 }, exercise: { updated: 1 } } });
    expect(daily).toHaveBeenCalledTimes(2); expect(sync).toHaveBeenCalledOnce(); expect(exercise).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledTimes(2); expect(release).toHaveBeenCalledTimes(2);
  });
  it('五点分批恢复完成后才继续夜间显隐和运动收尾', async () => {
    daily.mockResolvedValueOnce({ mode: 'restore', updated: 20, remaining: 30, complete: false });
    expect(await request('GET', 'Bearer cron-secret', 'routine-visibility')).toMatchObject({ status: 200,
      body: { sleepTags: { remaining: 30, complete: false } } });
    expect(sync).not.toHaveBeenCalled(); expect(exercise).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect((await request('GET', 'Bearer cron-secret', 'routine-visibility')).status).toBe(200);
    expect(sync).toHaveBeenCalledOnce(); expect(exercise).toHaveBeenCalledOnce();
  });
  it('共用写锁，失败仍释放，断开连接不继续访问 TickTick', async () => {
    lock.mockResolvedValueOnce(null);
    expect(await request('GET', 'Bearer cron-secret')).toMatchObject({ status: 202, body: { busy: true } });
    expect(sync).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    sync.mockRejectedValueOnce(new Error('read failed'));
    expect((await request('GET', 'Bearer cron-secret')).status).toBe(502);
    expect(release).toHaveBeenCalledOnce();
    data.clear();
    expect(await request('GET', 'Bearer cron-secret')).toMatchObject({ status: 200, body: { connected: false } });
    expect(sync).toHaveBeenCalledOnce();
  });
});

vi.mock('./_accountRoute.js', () => ({ withAccountScope: (handler: unknown) => handler }));
