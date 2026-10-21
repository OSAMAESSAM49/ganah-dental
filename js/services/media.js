/**
 * Patient photos and X-rays, stored as Blobs in IndexedDB (a full image ≤ 2000px plus a
 * small thumbnail for galleries). Use objectUrl() to display and revokeAll() on view exit.
 */
import { repos } from '../data/index.js';
import { resizeImage } from '../core/image.js';
import { todayISO } from '../core/format.js';

export const MEDIA_KINDS = { photo: 'صورة', xray: 'أشعة' };
export const MEDIA_TAGS = { before: 'قبل', after: 'بعد' };

/** Newest first. */
export async function listPatientMedia(patientId) {
  const rows = await repos.media.findBy('patientId', patientId);
  return rows.sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '') || b.createdAt.localeCompare(a.createdAt));
}

export const countPatientMedia = async (patientId) => (await repos.media.findBy('patientId', patientId)).length;

/**
 * Stores uploaded image files for a patient.
 * @param {string} patientId @param {FileList|File[]} files
 * @param {{ kind?: 'photo'|'xray', tag?: ''|'before'|'after', takenAt?: string, caption?: string }} [meta]
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function addPatientImages(patientId, files, meta = {}, onProgress) {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  const saved = [];
  for (const [i, file] of list.entries()) {
    const [full, thumb] = await Promise.all([
      resizeImage(file, { maxSize: 2000, quality: 0.86 }),
      resizeImage(file, { maxSize: 360, quality: 0.78 }),
    ]);
    saved.push(await repos.media.create({
      patientId,
      kind: meta.kind === 'xray' ? 'xray' : 'photo',
      tag: meta.tag || '',
      caption: meta.caption || file.name.replace(/\.[^.]+$/, ''),
      takenAt: meta.takenAt || todayISO(),
      teeth: [],
      blob: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
      size: full.blob.size,
      mime: full.blob.type,
    }));
    onProgress?.(i + 1, list.length);
  }
  return saved;
}

/** @param {string} id @param {{ caption?: string, tag?: string, kind?: string, takenAt?: string }} patch */
export function updateMedia(id, patch) {
  const allowed = ['caption', 'tag', 'kind', 'takenAt', 'teeth'];
  return repos.media.update(id, Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))));
}

export const deleteMedia = (id) => repos.media.remove(id);

/** Tracks object URLs so a view can release them all at once. */
export function urlPool() {
  const urls = new Set();
  return {
    /** @param {Blob} blob */
    url(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; },
    revokeAll() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}
