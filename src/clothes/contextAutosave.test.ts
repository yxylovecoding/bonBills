import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextAutosave, type ContextPending } from './contextAutosave';
import { ClothesError } from './client';
import { emptyContext } from './rules';
import type { ClothesDayContext } from './types';

const initial = emptyContext('2026-10-05', 'Asia/Shanghai');
afterEach(() => vi.useRealTimers());
describe('当天条件自动保存', () => {
  it('连续修改合并保存，切换界面也不会取消队列', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async ({ context, mutationId }) => ({ ...context, revision: mutationId }));
    const queue = new ContextAutosave(initial, null, send, vi.fn());
    const unsubscribe = queue.subscribe(vi.fn());
    queue.change({ scene: '有室外' }); queue.change({ active: true }); unsubscribe();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].context).toMatchObject({ scene: '有室外', active: true });
    expect(queue.snapshot()).toMatchObject({ dirty: false, saving: false, error: null });
    queue.accept(initial);
    expect(queue.snapshot().context.scene).toBe('有室外');
  });
  it('慢请求期间继续编辑，新修改使用返回的新版本且不会被覆盖', async () => {
    let resolve!: (value: ClothesDayContext) => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<ClothesDayContext>((done) => { resolve = done; }))
      .mockImplementation(async ({ context, mutationId }) => ({ ...context, revision: mutationId }));
    const queue = new ContextAutosave(initial, null, send, vi.fn());
    queue.change({ scene: '有室外' }); const first = queue.flush();
    queue.change({ scene: '长时间室外', active: true });
    await queue.flush(); expect(send).toHaveBeenCalledTimes(1);
    resolve({ ...send.mock.calls[0][0].context, revision: 'first-saved-revision' }); await first;
    expect(send.mock.calls[1][0].context).toMatchObject({ scene: '长时间室外', active: true, revision: 'first-saved-revision' });
    expect(queue.snapshot().context.scene).toBe('长时间室外');
  });
  it('响应丢失后刷新，先原样重试原请求，再保存后续修改', async () => {
    let pending: ContextPending | null = null;
    const failed = vi.fn().mockRejectedValue(new Error('连接中断'));
    const first = new ContextAutosave(initial, null, failed, (value) => { pending = value; });
    first.change({ active: true }); await first.flush();
    const send = vi.fn(async ({ context, mutationId }) => ({ ...context, revision: mutationId }));
    const restored = new ContextAutosave(initial, pending, send, vi.fn());
    restored.change({ scene: '有室外' }); await restored.flush();
    expect(send.mock.calls[0][0]).toEqual(failed.mock.calls[0][0]);
    expect(send.mock.calls[1][0].context).toMatchObject({ active: true, scene: '有室外', revision: send.mock.calls[0][0].mutationId });
  });
  it('跨页面版本冲突保留草稿，确认后使用最新版本保存', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ClothesError('已在其他页面更新', 409, { revision: 'server-revision' }))
      .mockImplementation(async ({ context, mutationId }) => ({ ...context, revision: mutationId }));
    const queue = new ContextAutosave(initial, null, send, vi.fn());
    queue.change({ active: true }); await queue.flush();
    queue.change({ scene: '有室外' }); await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    queue.resolveConflict(); await queue.flush();
    expect(send.mock.calls[1][0].context).toMatchObject({ revision: 'server-revision', active: true, scene: '有室外' });
    expect(queue.snapshot().dirty).toBe(false);
  });
});
