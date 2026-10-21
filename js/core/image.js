/** Image helpers: downscale an uploaded file before storing it. */

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
