export const PHOTO_MAX_EDGE = 480;
export const PHOTO_MAX_BYTES = 40 * 1024;
// Include the data URL header and legacy JSON quotes when comparing Redis sizes.
export const PHOTO_MAX_STORED_BYTES = Math.ceil(PHOTO_MAX_BYTES / 3) * 4 + 32;

export async function compressPhoto(file: Blob): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPEG、PNG 或 WebP 照片');
  if (file.size > 20 * 1024 * 1024) throw new Error('原照片不能超过 20MB');
  const image = await createImageBitmap(file).catch(() => { throw new Error('无法读取照片，请换一张'); });
  try {
    if (!image.width || !image.height || image.width * image.height > 50000000) throw new Error('照片尺寸过大');
    let scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理照片');
    let format = 'image/webp';
    for (let attempt = 0; attempt < 10; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(.35, .6 - attempt * .05);
      let value = canvas.toDataURL(format, quality);
      if (format === 'image/webp' && !value.startsWith('data:image/webp;')) {
        // Older browsers may encode PNG instead of WebP. Use JPEG for opaque
        // photos, but keep PNG when doing so would discard transparency.
        format = 'image/jpeg';
        if (file.type !== 'image/jpeg') {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let alpha = 3; alpha < pixels.length; alpha += 4) {
            if (pixels[alpha] < 255) { format = 'image/png'; break; }
          }
        }
        value = canvas.toDataURL(format, quality);
      }
      if (/^data:image\/(webp|jpeg|png);base64,/.test(value)
        && atob(value.slice(value.indexOf(',') + 1)).length <= PHOTO_MAX_BYTES) return value;
      scale *= .85;
    }
    throw new Error('照片压缩失败，请换一张');
  } finally { image.close(); }
}
