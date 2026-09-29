interface RequestOptions {
  signal?: AbortSignal | null;
  retry?: boolean;
  timeoutMessage: string;
  networkMessage: string;
}

// Keep the deadline active through response-body reads, and only replay reads.
export async function requestWithRetry<T>(
  request: (signal: AbortSignal) => Promise<T>,
  { signal, retry = false, timeoutMessage, networkMessage }: RequestOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), 30_000);
    try {
      return await request(controller.signal);
    } catch (error) {
      // Explicit cancellation must never turn into another request.
      if (signal?.aborted) throw signal.reason;
      const timedOut = controller.signal.aborted || (error instanceof Error && error.name === 'TimeoutError');
      const networkFailed = error instanceof TypeError;
      if (retry && attempt === 0 && (timedOut || networkFailed)) continue;
      if (timedOut) throw new Error(timeoutMessage);
      if (networkFailed) throw new Error(networkMessage);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
