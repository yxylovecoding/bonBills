import { useEffect, useRef, useState } from 'react';
import { accountFetch } from '../utils/authClient';
import { requestWithRetry } from '../utils/requestWithRetry';
import { ClothesError, clothesRequest, photoUrl } from './client';
import { compressPhoto } from './photoCompression';

export default function PhotoOptimizer({ onExpired, storage }: { onExpired: () => void; storage?: 'redis' | 'r2' }) {
  const migrating = storage === 'r2';
  const running = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => () => running.current?.abort(), []);
  async function optimize() {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller; setBusy(true); setMessage('');
    let saved = 0, compressed = 0, failed = 0;
    try {
      const { photos } = await clothesRequest<{ photos: { id: string; bytes: number }[] }>('GET', { view: migrating ? 'photo-migration' : 'photo-sizes' }, controller.signal);
      for (const [index, { id }] of photos.entries()) {
        controller.signal.throwIfAborted();
        setMessage(`${index + 1} / ${photos.length}`);
        try {
          if (migrating) {
            const result = await clothesRequest<{ migrated: boolean; savedBytes: number }>('POST', { action: 'migrate-photo', id }, controller.signal);
            saved += result.savedBytes;
            if (result.migrated) compressed++;
            continue;
          }
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
      const action = migrating ? '转存' : '压缩';
      setMessage(`${compressed ? `已${action} ${compressed} 张 · 节省 ${size}` : failed ? `${action}未完成` : `没有需要${action}的照片`}${failed ? ` · ${failed} 张失败，可重试` : ''}`);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ClothesError && cause.status === 401) onExpired();
      setMessage(cause instanceof Error ? cause.message : '处理失败，请重试');
    } finally {
      running.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <div className="clothes-photo-optimizer"><button type="button" disabled={busy} onClick={() => void optimize()}>{busy ? (migrating ? '转存中…' : '压缩中…') : migrating ? '转存旧照片' : '压缩旧照片'}</button>{message && <span role="status">{message}</span>}</div>;
}
