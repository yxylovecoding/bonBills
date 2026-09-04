import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './auth';
import sync from './sync';
import backup from './sync-monthly-backup';
import mail from './latest-bill-attachment';
import boncv from './boncv-profile';
import ticktick from './ticktick-trips';
import { authOk, readAccount, readSession } from './_auth';

const { data, storage } = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && data.has(key)) return null;
      data.set(key, value);
      return 'OK';
    }),
    incr: vi.fn(async (key: string) => {
      const value = Number(data.get(key) ?? 0) + 1;
      data.set(key, value);
      return value;
    }),
    del: vi.fn(async (key: string) => Number(data.delete(key))),
  };
  return { data, storage };
});

vi.mock('@vercel/kv', () => ({ kv: storage }));

function request(method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return {
    method, body, query: {},
    headers: { host: 'bills.test', origin: 'https://bills.test', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as VercelRequest;
}

function response() {
  const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { result.status = code; return res; },
    json(body: unknown) { result.body = body; return res; },
    setHeader(name: string, value: string) { result.headers[name] = value; return res; },
    end() { return res; },
  };
  return { res: res as unknown as VercelResponse, result };
}

async function call(req: VercelRequest, endpoint = handler) {
  const { res, result } = response();
  await endpoint(req, res);
  return result;
}

const credentials = { username: 'my-account', password: 'my-password' };
const keyCredentials = { key: 'test-original-key' };
async function login(body: unknown = keyCredentials) {
  const result = await call(request('POST', body));
  expect(result.status).toBe(200);
  return { result, cookie: result.headers['Set-Cookie'].split(';')[0] };
}

async function register(overrides: Record<string, unknown> = {}) {
  return call(request('POST', { action: 'register', ...credentials, ...keyCredentials, ...overrides }));
}

beforeEach(() => {
  vi.stubEnv('SYNC_SECRET', 'test-original-key');
  vi.stubEnv('LOGIN_USERNAME', '');
  vi.stubEnv('LOGIN_PASSWORD', undefined);
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  data.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('账号密码与 Key 登录', () => {
  it('未登录时不返回账号或账单', async () => {
    const result = await call(request());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ authenticated: false });
    expect(result.headers['Cache-Control']).toContain('no-store');
  });

  it('注册后使用自己的账号密码登录，返回安全会话', async () => {
    expect((await register()).status).toBe(200);
    const { cookie, result } = await login(credentials);
    expect(result.body).toEqual({ authenticated: true, username: credentials.username });
    expect(result.headers['Set-Cookie']).toMatch(/HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/);
    expect(JSON.stringify(result)).not.toContain(credentials.password);
    const status = await call(request('GET', undefined, { cookie }));
    expect(status.body).toEqual({ authenticated: true, username: credentials.username });
  });

  it('独立账号密码与原 Key 均读取同一份既有账单', async () => {
    const bills = { 'calendar-tags': { tagMap: { '2026-09-01': 'intern' } } };
    data.set('calendar-tags', bills['calendar-tags']);
    const registration = await register();
    expect(registration.status).toBe(200);
    const passwordSession = await login(credentials);
    const keySession = await login({ key: 'test-original-key' });
    for (const cookie of [registration.headers['Set-Cookie'].split(';')[0], passwordSession.cookie, keySession.cookie]) {
      const result = await call(request('GET', undefined, { cookie }), sync);
      expect(result.status).toBe(200);
      expect(result.body).toEqual(bills);
    }
    expect(data.get('calendar-tags')).toEqual(bills['calendar-tags']);
    expect(storage.set.mock.calls.every(([key]) => key.startsWith('auth:'))).toBe(true);
    expect((await call(request('POST', { username: 'bon', password: 'test-original-key' }))).status).toBe(401);
  });

  it.each([{ key: 'arbitrary-key' }, { username: 'other', password: 'test-original-key' }, { username: 'bon', password: 'wrong' }])(
    '错误凭据不能登录，也不会修改账单：%j', async (body) => {
      data.set('monthly-records', { records: [{ yearMonth: '2026-09', income: 1234 }] });
      const before = data.get('monthly-records');
      const result = await call(request('POST', body));
      expect(result.status).toBe(401);
      expect(result.headers['Set-Cookie']).toBeUndefined();
      expect(data.get('monthly-records')).toEqual(before);
      expect([...data.keys()].filter((key) => key.startsWith('auth:session:'))).toEqual([]);
    },
  );

  it('已有有效 Cookie 时，错误 Key 仍明确返回登录失败', async () => {
    const { cookie } = await login();
    const result = await call(request('POST', { key: 'wrong-key' }, { cookie }));
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'Key 错误' });
  });

  it('限制重复尝试，超过窗口后恢复', async () => {
    const start = 1_800_000_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    for (let index = 0; index < 10; index += 1) {
      expect((await call(request('POST', { key: 'wrong' }))).status).toBe(401);
    }
    const blocked = await call(request('POST', keyCredentials));
    expect(blocked.status).toBe(429);
    expect(blocked.headers['Retry-After']).toBe('900');
    now.mockReturnValue(start + 15 * 60 * 1000);
    expect((await call(request('POST', keyCredentials))).status).toBe(200);
  });

  it.each(['{', null, [], { username: 'bon' }, { key: '' }, { key: 'a'.repeat(1025) }])(
    '拒绝无效输入且不创建会话：%j', async (body) => {
      expect((await call(request('POST', body))).status).toBe(400);
      expect(storage.set).not.toHaveBeenCalled();
    },
  );

  it('拒绝跨站登录和表单提交', async () => {
    expect((await call(request('POST', credentials, { origin: 'https://other.test' }))).status).toBe(403);
    expect((await call(request('POST', credentials, { 'content-type': 'application/x-www-form-urlencoded' }))).status).toBe(415);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('服务端配置缺失或存储故障时不放行', async () => {
    vi.stubEnv('SYNC_SECRET', '');
    expect((await call(request('POST', credentials))).status).toBe(503);
    vi.stubEnv('SYNC_SECRET', 'test-original-key');
    storage.set.mockRejectedValueOnce(new Error('storage unavailable'));
    const result = await call(request('POST', credentials));
    expect(result.status).toBe(503);
    expect(result.headers['Set-Cookie']).toBeUndefined();
  });

  it('未注册时不接受默认账号密码或旧环境变量账号', async () => {
    vi.stubEnv('LOGIN_USERNAME', 'configured');
    vi.stubEnv('LOGIN_PASSWORD', 'configured-password');
    expect((await call(request('POST', { username: 'bon', password: 'test-original-key' }))).status).toBe(401);
    expect((await call(request('POST', { username: 'configured', password: 'configured-password' }))).status).toBe(401);
    expect(await readAccount()).toBeNull();
  });

  it('注册必须验证原 Key，不允许错误 Key 建立账号或读取账单', async () => {
    data.set('calendar-tags', { tagMap: { '2026-09-01': 'home' } });
    expect((await register({ key: 'wrong-key' })).status).toBe(401);
    expect(await readAccount()).toBeNull();
    expect(data.get('calendar-tags')).toEqual({ tagMap: { '2026-09-01': 'home' } });
    expect((await call(request('POST', credentials))).status).toBe(401);
  });

  it('绑定只保存账号和加盐密码哈希，不保存原密码或 Key', async () => {
    expect((await register()).status).toBe(200);
    const account = await readAccount();
    expect(account?.username).toBe(credentials.username);
    expect(account?.passwordHash).toMatch(/^[a-f0-9]{128}$/);
    expect(account?.passwordSalt).toMatch(/^[a-f0-9]{32}$/);
    expect(account?.passwordAlgorithm).toBe('scrypt-v1');
    const stored = JSON.stringify([...data]);
    expect(stored).not.toContain(credentials.password);
    expect(stored).not.toContain(keyCredentials.key);
  });

  it('重复注册不能替换原账号密码', async () => {
    expect((await register()).status).toBe(200);
    const original = await readAccount();
    expect((await register({ username: 'replacement', password: 'other-password' })).status).toBe(409);
    expect(await readAccount()).toEqual(original);
    expect((await call(request('POST', credentials))).status).toBe(200);
    expect((await call(request('POST', { username: 'replacement', password: 'other-password' }))).status).toBe(401);
  });

  it('并发注册只能成功一次，绑定的密码与最终账号一致', async () => {
    const results = await Promise.all([
      register({ username: 'first', password: 'first-password' }),
      register({ username: 'second', password: 'second-password' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? 'first' : 'second';
    expect((await readAccount())?.username).toBe(winner);
    expect((await call(request('POST', { username: winner, password: `${winner}-password` }))).status).toBe(200);
  });

  it.each([{ key: '' }, { key: undefined }, { username: '' }, { password: 'short' }, { password: '' }])(
    '无效注册信息不能建立绑定：%j', async (overrides) => {
      expect((await register(overrides)).status).toBe(400);
      expect(await readAccount()).toBeNull();
    },
  );

  it('Key 登录不依赖账号注册，注册后既有 Key 会话仍有效', async () => {
    const { cookie } = await login();
    expect((await register()).status).toBe(200);
    expect(await authOk(request('GET', undefined, { cookie }))).toBe(true);
  });

  it('绑定和会话与当前 Key 对应，其他 Key 配置不能使用该账号', async () => {
    const registration = await register();
    expect(registration.status).toBe(200);
    const cookie = registration.headers['Set-Cookie'].split(';')[0];
    vi.stubEnv('SYNC_SECRET', 'another-key');
    expect(await readAccount()).toBeNull();
    expect((await call(request('POST', credentials))).status).toBe(401);
    expect(await authOk(request('GET', undefined, { cookie }))).toBe(false);
  });
});

describe('会话与受保护接口', () => {
  it('退出立即撤销旧会话且保留账单', async () => {
    const { cookie } = await login();
    data.set('calendar-tags', { tagMap: { '2026-09-01': 'home' } });
    const result = await call(request('DELETE', undefined, { cookie }));
    expect(result.status).toBe(200);
    expect(result.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(await authOk(request('GET', undefined, { cookie }))).toBe(false);
    expect(data.get('calendar-tags')).toEqual({ tagMap: { '2026-09-01': 'home' } });
  });

  it('过期、伪造、绑定已变化的会话均不能读取账单', async () => {
    expect((await register()).status).toBe(200);
    const { cookie } = await login(credentials);
    const now = Date.now();
    const time = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
    expect(await readSession(request('GET', undefined, { cookie }))).toBeNull();
    time.mockReturnValue(now);
    const accountKey = [...data.keys()].find((key) => key.startsWith('auth:account:'))!;
    data.set(accountKey, { ...await readAccount(), passwordHash: '0'.repeat(128) });
    expect(await readSession(request('GET', undefined, { cookie }))).toBeNull();
    expect(await authOk(request('GET', undefined, { cookie: `bonbills-session=${'a'.repeat(64)}` }))).toBe(false);
  });

  it.each([sync, backup, mail, boncv, ticktick])('所有账单相关接口拒绝未认证访问', async (endpoint) => {
    const method = endpoint === backup ? 'POST' : 'GET';
    const result = await call(request(method, undefined, { authorization: 'Bearer arbitrary-key' }), endpoint);
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'unauthorized' });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('Cookie 不能用于跨站读取或写入', async () => {
    const { cookie } = await login();
    expect(await authOk(request('PUT', {}, { cookie, origin: 'https://other.test' }))).toBe(false);
    expect(await authOk(request('GET', undefined, { cookie, 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });

  it('保留原 Bearer Key；登录 Cookie 不授权定时备份', async () => {
    expect(await authOk(request('GET', undefined, { authorization: 'Bearer test-original-key' }))).toBe(true);
    const { cookie } = await login();
    expect((await call(request('GET', undefined, { cookie }), backup)).status).toBe(401);
  });
});
