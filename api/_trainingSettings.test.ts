import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './_bonLifeRoute';
import { LIFE_SETTINGS_KEY } from './_bonLife';
import { DEFAULT_TRAINING_SETTINGS } from '../src/utils/lifeTraining';

const { auth, origin, evalMock, data } = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), evalMock: vi.fn(), data: new Map<string, unknown>() }));
vi.mock('./_auth.js', () => ({ authOk: auth, sameOrigin: origin }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => data.get(key) ?? null,
  hgetall: async (key: string) => data.get(key) ?? null, eval: evalMock } }));
const settings = { revision: '', projects: [{ key: '爬坡', name: '爬坡', notes: '30 分钟', rotation: true }] };
const input = { year: 2026, action: 'save-training-settings', settings, mutationId: 'training-123456789' };
async function call(method = 'POST', body: unknown = input) {
  const result = { status: 200, body: {} as Record<string, any> };
  const res = { setHeader: vi.fn(), status: (status: number) => { result.status = status; return res; },
    json: (body: Record<string, unknown>) => { result.body = body; return res; } };
  await handler({ method, body, query: { year: '2026', view: 'training' }, headers: {} } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
beforeEach(() => { data.clear(); vi.clearAllMocks(); auth.mockResolvedValue(true); origin.mockReturnValue(true);
  evalMock.mockImplementation(async (_script, keys, args) => {
    const current = (data.get(keys[0]) as Record<string, any> | undefined)?.[args[0]];
    if (current?.revision === args[2]) return [1, current];
    if ((current?.revision ?? '') !== args[1]) return [0, current];
    const next = JSON.parse(args[3]); data.set(keys[0], { ...(data.get(keys[0]) as object), [args[0]]: next }); return [1, next];
  });
});

describe('训练项目保存与复用接口', () => {
  it('未连接 TickTick 也能保存并重新读取，其他设置保留', async () => {
    data.set(LIFE_SETTINGS_KEY, { skin: { revision: 'skin' } });
    expect((await call()).body.settings).toEqual({ ...settings, revision: input.mutationId });
    expect(evalMock.mock.calls[0][1]).toEqual([LIFE_SETTINGS_KEY]);
    expect(evalMock.mock.calls[0][2][0]).toBe('trainingProjects');
    expect((await call('GET')).body).toMatchObject({ connected: false, settings: { ...settings, revision: input.mutationId } });
    expect(data.get(LIFE_SETTINGS_KEY)).toHaveProperty('skin.revision', 'skin');
  });
  it('首次读取提供空自定义库，重复提交幂等，旧版本不能覆盖新项目', async () => {
    expect((await call('GET')).body.settings).toEqual(DEFAULT_TRAINING_SETTINGS);
    await call(); expect((await call()).status).toBe(200);
    expect((await call('POST', { ...input, mutationId: 'training-987654321' })).status).toBe(409);
  });
  it('拒绝无效设置、未登录和跨来源写入', async () => {
    expect((await call('POST', { ...input, settings: { ...settings, projects: [{}] } })).status).toBe(400);
    expect(evalMock).not.toHaveBeenCalled();
    auth.mockResolvedValue(false); expect((await call()).status).toBe(401);
    auth.mockResolvedValue(true); origin.mockReturnValue(false); expect((await call()).status).toBe(403);
    expect(evalMock).not.toHaveBeenCalled();
  });
});
