import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './boncv-profile';
import { authOk } from './_auth';
vi.mock('./_auth', () => ({ authOk: vi.fn() }));

beforeEach(() => {
  vi.mocked(authOk).mockResolvedValue(true);
  vi.stubEnv('BONCV_API_BASE_URL', 'https://cv.example.test/');
  vi.stubEnv('BONCV_API_KEY', 'test-only-token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"schemaVersion":1,"internships":[]}', { headers: { etag: '"internships-1"', 'content-type': 'application/json' } })));
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function call(view?: unknown, method = 'GET') {
  const result = { code: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { result.code = code; return res; },
    json(body: unknown) { result.body = body; return res; },
    send(body: unknown) { result.body = body; return res; },
    setHeader(key: string, value: string) { result.headers[key] = value; return res; },
    end() { return res; },
  };
  await handler({ method, query: view === undefined ? {} : { view }, headers: { 'if-none-match': '"cached"' } } as unknown as VercelRequest, res as unknown as VercelResponse);
  return result;
}
it('实习请求复用私有代理及服务端密钥，只转发固定视图', async () => {
  const result = await call('internships');
  expect(authOk).toHaveBeenCalledWith(expect.anything(), { ownerOnly: true });
  expect(fetch).toHaveBeenCalledWith('https://cv.example.test/api/v1/fire-profile?view=internships', expect.objectContaining({ headers: { Authorization: 'Bearer test-only-token', 'If-None-Match': '"cached"' } }));
  expect(result.code).toBe(200);
  expect(result.headers.ETag).toBe('"internships-1"');
  expect(result.body).not.toContain('test-only-token');
});
it('原 FIRE 路径和条件请求保持兼容', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 304 }));
  expect((await call()).code).toBe(304);
  expect(fetch).toHaveBeenCalledWith('https://cv.example.test/api/v1/fire-profile', expect.anything());
});
it('未认证和非原账号不得读取或触发上游', async () => {
  vi.mocked(authOk).mockResolvedValue(false);
  expect((await call('internships')).code).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it('拒绝未知视图和非 GET 请求', async () => {
  expect((await call('anything')).code).toBe(400);
  expect((await call(['internships'])).code).toBe(400);
  expect((await call('internships', 'POST')).code).toBe(405);
  expect(fetch).not.toHaveBeenCalled();
});
it('缺少连接、超时和撤销密钥返回错误且不暴露凭据', async () => {
  vi.stubEnv('BONCV_API_KEY', '');
  expect((await call('internships')).code).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv('BONCV_API_KEY', 'test-only-token');
  vi.mocked(fetch).mockRejectedValue(new Error('timeout test-only-token'));
  const failed = await call('internships');
  expect(failed.code).toBe(502);
  expect(JSON.stringify(failed.body)).not.toContain('test-only-token');
  vi.mocked(fetch).mockResolvedValue(new Response('{"error":"forbidden"}', { status: 403 }));
  expect((await call('internships')).code).toBe(403);
});
