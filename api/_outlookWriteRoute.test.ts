import { beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './_outlookWriteRoute';
import { OutlookWriteError } from './_outlookWrite';
const mocks = vi.hoisted(() => ({ origin: vi.fn(), auth: vi.fn(), start: vi.fn(), status: vi.fn(), lock: vi.fn() }));
vi.mock('./_auth.js', () => ({ sameOrigin: mocks.origin, authOk: mocks.auth }));
vi.mock('./_outlookWrite.js', async importOriginal => ({
  ...await importOriginal<typeof import('./_outlookWrite')>(), startOutlookWrite: mocks.start, outlookWriteStatus: mocks.status,
  withOutlookWriteLock: mocks.lock,
}));
beforeEach(() => {
  vi.clearAllMocks(); mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue(true);
  mocks.lock.mockImplementation(async run => run()); mocks.status.mockResolvedValue({ connected: false, enabled: false });
});
async function request(method = 'POST', body: unknown = { action: 'start', clientId: 'app' }) {
  const result = { status: 200, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; },
    status: (code: number) => { result.status = code; return res; }, json: (value: unknown) => { result.body = value; return res; } };
  await handler({ method, body, query: {} } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
it('跨站和未登录请求不能开始授权、读取状态或断开连接', async () => {
  mocks.origin.mockReturnValue(false);
  for (const method of ['POST', 'GET', 'DELETE']) expect((await request(method)).status).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.lock).not.toHaveBeenCalled();
  mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue(false);
  for (const method of ['POST', 'GET', 'DELETE']) expect((await request(method)).status).toBe(401);
  expect(mocks.lock).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
});
it('微软授权失效不会注销 BonBills，未知上游错误不会暴露凭据', async () => {
  mocks.start.mockRejectedValueOnce(new OutlookWriteError('微软授权已失效，请重新连接', 401));
  expect((await request()).status).toBe(424);
  mocks.start.mockRejectedValueOnce(new Error('PRIVATE-TOKEN'));
  const result = await request(); expect(result.status).toBe(502); expect(JSON.stringify(result.body)).not.toContain('PRIVATE-TOKEN');
  expect(result.headers['Cache-Control']).toBe('private, no-store');
});
