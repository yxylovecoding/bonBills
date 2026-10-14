import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const owner = 'a'.repeat(32);
const member = 'b'.repeat(32);
let client: typeof import('./authClient');
let fetchMock: ReturnType<typeof vi.fn>;
const version = () => client.accountRequestHeaders()['X-BonBills-Cache'];
const json = (value: unknown) => new Response(JSON.stringify(value));

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  fetchMock = vi.fn().mockResolvedValue(json({ authenticated: true, accountId: owner }));
  vi.stubGlobal('fetch', fetchMock);
  client = await import('./authClient');
  await client.requestSession();
  fetchMock.mockReset().mockImplementation(async () => json({ ok: true }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('各应用共用的私有读取缓存', () => {
  it('普通读取允许浏览器缓存，并保留账号与自定义请求头', async () => {
    await client.accountFetch('/api/bonlife?year=2026', { headers: { 'X-Test': 'keep' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.cache).toBe('default');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers.get('X-BonBills-Account')).toBe(owner);
    expect(init.headers.get('X-BonBills-Cache')).toBe('0');
    expect(init.headers.get('X-Test')).toBe('keep');
    await client.apiFetch('/api/sync', { cache: 'reload' });
    expect(fetchMock.mock.calls[1][1].cache).toBe('reload');
  });

  it('保存前、保存后都失效，读取不会复用保存期间的旧版本', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const before = version();
    const saving = client.accountFetch('/api/bonclothes', { method: 'POST', body: '{}' });
    const during = version();
    expect(during).not.toBe(before);
    await client.accountFetch('/api/bonlife?year=2026');
    expect(fetchMock.mock.calls[1][1].headers.get('X-BonBills-Cache')).toBe(during);
    finish(json({ ok: true }));
    await saving;
    expect(version()).not.toBe(during);
    await client.accountFetch('/api/bonclothes?date=2026-10-14');
    expect(fetchMock.mock.calls[2][1].headers.get('X-BonBills-Cache')).toBe(version());
  });

  it('网络失败也失效，覆盖服务端已保存但客户端未收到响应的情况', async () => {
    let during = '';
    fetchMock.mockImplementationOnce(async () => { during = version(); throw new TypeError('offline'); });
    await expect(client.accountFetch('/api/bonlife', { method: 'POST' })).rejects.toThrow('offline');
    expect(version()).not.toBe(during);
    expect(version()).not.toBe('0');
  });

  it('其他标签页及重新加载能看到失效版本，新账号使用独立版本', async () => {
    client.invalidateAccountRequests();
    const first = version();
    vi.resetModules();
    const cache = await import('./requestCache');
    expect(cache.requestCacheVersion(owner)).toBe(first);
    cache.invalidateRequestCache(owner);
    expect(version()).toBe(cache.requestCacheVersion(owner));
    expect(version()).not.toBe(first);
    expect(cache.requestCacheVersion(member)).toBe('0');
    cache.invalidateRequestCache(member);
    expect(cache.requestCacheVersion(member)).not.toBe(version());
  });

  it('存储空间不足时不复用仍可读取的旧版本', () => {
    client.invalidateAccountRequests();
    const saved = version();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    client.invalidateAccountRequests();
    expect(version()).not.toBe(saved);
    expect(localStorage.getItem(`bonbills-http-cache:v1:${owner}`)).toBe(saved);
  });

  it('登录检查仍实时读取，旧页面不会因其他标签页切换账号而更改身份', async () => {
    fetchMock.mockResolvedValueOnce(json({ authenticated: true, accountId: member }));
    await client.requestSession();
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    expect(client.accountRequestHeaders()['X-BonBills-Account']).toBe(owner);
  });

  it('图片地址绑定账号和照片 ID，不随普通数据保存而更换', async () => {
    const { photoUrl } = await import('../clothes/client');
    const before = photoUrl('photo-original');
    client.invalidateAccountRequests();
    expect(photoUrl('photo-original')).toBe(before);
    expect(new URL(before, 'https://clothes.bonbills.cn').searchParams.get('account')).toBe(owner);
    expect(photoUrl('photo-replaced')).not.toBe(before);
  });
});
