/** Image helpers: downscale an uploaded file before storing it. */

/**
 * Resizes an image to fit maxSize and returns it as a Blob (for IndexedDB storage).
 * @param {File|Blob} file
 * @param {{ maxSize?: number, type?: string, quality?: number }} [opts]
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function resizeImage(file, { maxSize = 2000, type = 'image/jpeg', quality = 0.86 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('الملف ليس صورة');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('تعذّرت معالجة الصورة'))), type, quality));
  return { blob, width, height };
}

/**
 * Reads an image file, fits it inside maxSize×maxSize, and returns a data URL.
 * PNG keeps transparency (logos); JPEG/WebP is smaller for photos.
 * @param {File|Blob} file
 * @param {{ maxSize?: number, type?: 'image/png'|'image/jpeg'|'image/webp', quality?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function imageFileToDataURL(file, { maxSize = 512, type = 'image/png', quality = 0.9 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('الملف ليس صورة');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL(type, quality);
}
