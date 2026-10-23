import { useEffect, useRef, useState } from 'react';
import { accountFetch } from '../utils/authClient';
import { requestWithRetry } from '../utils/requestWithRetry';
import { ClothesError, clothesRequest, photoUrl } from './client';
import { compressPhoto } from './photoCompression';

export default function PhotoOptimizer({ onExpired }: { onExpired: () => void }) {
  const running = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => () => running.current?.abort(), []);
  async function optimize() {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller; setBusy(true); setMessage('');
    let saved = 0, compressed = 0, failed = 0;
    try {
      const { photos } = await clothesRequest<{ photos: { id: string; bytes: number }[] }>('GET', { view: 'photo-sizes' }, controller.signal);
      for (const [index, { id }] of photos.entries()) {
        controller.signal.throwIfAborted();
        setMessage(`${index + 1} / ${photos.length}`);
        try {
          const { source, validator } = await requestWithRetry(async (signal) => {
            const response = await accountFetch(photoUrl(id), { signal, cache: 'no-store' });
            if (!response.ok) throw new ClothesError('照片读取失败', response.status);
            const validator = response.headers.get('ETag')?.replace(/^W\//, '').replace(/^"|"$/g, '');
            if (!validator) throw new Error('照片版本缺失');
            return { source: await response.blob(), validator };
          }, { signal: controller.signal, retry: true, timeoutMessage: '照片读取超时', networkMessage: '照片读取失败' });
          const photo = await compressPhoto(source);
          controller.signal.throwIfAborted();
          const result = await clothesRequest<{ savedBytes: number }>('POST', { action: 'compress-photo', id, validator, photo }, controller.signal);
          saved += result.savedBytes;
          if (result.savedBytes > 0) compressed++;
        } catch (cause) {
          if (controller.signal.aborted || (cause instanceof ClothesError && cause.status === 401)) throw cause;
          failed++;
        }
      }
      const size = saved < 1024 * 1024 ? `${(saved / 1024).toFixed(1)} KB` : `${(saved / 1024 / 1024).toFixed(2)} MB`;
      setMessage(`${compressed ? `已压缩 ${compressed} 张 · 节省 ${size}` : failed ? '压缩未完成' : '没有需要压缩的照片'}${failed ? ` · ${failed} 张失败，可重试` : ''}`);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ClothesError && cause.status === 401) onExpired();
      setMessage(cause instanceof Error ? cause.message : '压缩失败，请重试');
    } finally {
      running.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <div className="clothes-photo-optimizer"><button type="button" disabled={busy} onClick={() => void optimize()}>{busy ? '压缩中…' : '压缩旧照片'}</button>{message && <span role="status">{message}</span>}</div>;
}
