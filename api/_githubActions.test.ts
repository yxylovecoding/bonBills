import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchFullReplan } from './_githubActions';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GitHub Actions 手动重排', () => {
  it('使用服务端 Token 触发完整每日排期工作流', async () => {
    vi.stubEnv('GITHUB_ACTIONS_TOKEN', 'test-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(dispatchFullReplan()).resolves.toEqual({ workflow: 'ticktick-daily-plan.yml', ref: 'main' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/yxylovecoding/monthlyBills/actions/workflows/ticktick-daily-plan.yml/dispatches',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({ ref: 'main', inputs: { periods_only: false, send_email: false } }),
      }),
    );
  });

  it('缺少 Token 时拒绝触发，且不会发请求', async () => {
    vi.stubEnv('GITHUB_ACTIONS_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(dispatchFullReplan()).rejects.toThrow('GitHub Actions Token 未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('权限不足时返回可操作的安全错误', async () => {
    vi.stubEnv('GITHUB_ACTIONS_TOKEN', 'bad-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(dispatchFullReplan()).rejects.toThrow('缺少 Actions 写权限');
  });
});
