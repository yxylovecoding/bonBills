import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressPhoto, PHOTO_MAX_BYTES } from './photoCompression';

function fixture({ width = 2000, height = 1500, transparent = false, webp = true, sizes = [1024] } = {}) {
  const close = vi.fn(), drawImage = vi.fn();
  const bitmap = { width, height, close };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, getImageData: () => ({ data: [255, 255, 255, transparent ? 0 : 255] }) }),
    toDataURL: vi.fn((type: string) => `data:${type === 'image/webp' && !webp ? 'image/png' : type};base64,${btoa('x'.repeat(sizes.length > 1 ? sizes.shift()! : sizes[0]))}`) };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  vi.stubGlobal('document', { createElement: () => canvas });
  return { bitmap, canvas, drawImage };
}
afterEach(() => vi.unstubAllGlobals());

describe('衣物照片小图压缩', () => {
  it('普通照片使用较低质量 WebP，最长边不超过 480px', async () => {
    const { canvas, bitmap } = fixture();
    expect(await compressPhoto(new Blob(['photo'], { type: 'image/jpeg' }))).toMatch(/^data:image\/webp;/);
    expect([canvas.width, canvas.height]).toEqual([480, 360]);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/webp', .6);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('不放大小图，过大的编码继续缩小直到不超过 40KB', async () => {
    const small = fixture({ width: 120, height: 180 });
    await compressPhoto(new Blob(['photo'], { type: 'image/png' }));
    expect([small.canvas.width, small.canvas.height]).toEqual([120, 180]);
    const large = fixture({ sizes: [PHOTO_MAX_BYTES + 1, PHOTO_MAX_BYTES] });
    const value = await compressPhoto(new Blob(['photo'], { type: 'image/jpeg' }));
    expect(atob(value.split(',')[1]).length).toBe(PHOTO_MAX_BYTES);
    expect(large.canvas.width).toBeLessThan(480);
  });
  it.each([false, true])('不支持 WebP 时保留透明度=%s，普通照片回退 JPEG', async (transparent) => {
    fixture({ transparent, webp: false });
    const value = await compressPhoto(new Blob(['photo'], { type: 'image/png' }));
    expect(value).toMatch(transparent ? /^data:image\/png;/ : /^data:image\/jpeg;/);
  });
  it('压缩失败仍释放位图，且不返回超出限制的内容', async () => {
    const { bitmap } = fixture({ sizes: [PHOTO_MAX_BYTES + 1] });
    await expect(compressPhoto(new Blob(['photo'], { type: 'image/jpeg' }))).rejects.toThrow('照片压缩失败');
    expect(bitmap.close).toHaveBeenCalledOnce();
    await expect(compressPhoto(new Blob(['photo'], { type: 'text/plain' }))).rejects.toThrow('请选择');
  });
});
