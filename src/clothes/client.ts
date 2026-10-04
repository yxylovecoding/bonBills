import { requestWithRetry } from '../utils/requestWithRetry';

export class ClothesError extends Error {
  constructor(message: string, public status: number, public current?: unknown, public wardrobeChanged = false) { super(message); }
}
export async function clothesRequest<T>(method: 'GET' | 'POST', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]));
  return requestWithRetry(async (requestSignal) => {
    const response = await fetch(`/api/bonclothes${method === 'GET' ? `?${query}` : ''}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal: requestSignal,
      headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new ClothesError(result.error || '请求失败，请重试', response.status, result.current, result.wardrobeChanged);
    return result;
  }, { signal, retry: method === 'GET', timeoutMessage: '连接超时，请重试', networkMessage: '网络连接失败，请重试' });
}
export function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
export function writeLocal(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep live edits if storage is unavailable. */ }
}
export function photoUrl(id: string) { return `/api/bonclothes?view=photo&id=${encodeURIComponent(id)}`; }
export async function compressPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPEG、PNG 或 WebP 照片');
  if (file.size > 20 * 1024 * 1024) throw new Error('原照片不能超过 20MB');
  const image = await createImageBitmap(file).catch(() => { throw new Error('无法读取照片，请换一张'); });
  try {
    if (image.width * image.height > 50000000) throw new Error('照片尺寸过大');
    let scale = Math.min(1, 960 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理照片');
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL('image/jpeg', Math.max(.5, .86 - attempt * .06));
      if (atob(value.slice(23)).length <= 200 * 1024) return value;
      scale *= .85;
    }
    throw new Error('照片压缩失败，请换一张');
  } finally { image.close(); }
}
