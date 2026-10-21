/**
 * Backup & restore: the whole database as one JSON file.
 *   - Blobs (photos, X-rays) are embedded as base64 { __blob: mime, data }.
 *   - Restore validates the file, shows a preview, then REPLACES all data in one transaction.
 *   - Backups from an older schema are accepted (missing stores start empty; transforms in
 *     BACKUP_UPGRADES run first). Backups from a newer app version are refused.
 * Merge-import from another device comes in phase 10.
 */
import { getAdapter, repos } from '../data/index.js';
import { SCHEMA_VERSION } from '../data/migrations.js';
import { currentUser } from '../core/session.js';
import { getSettings } from '../data/settings.js';
import { logEvent } from './audit.js';

export const BACKUP_APP = 'ganah-dental';
export const BACKUP_FORMAT = 1;

/** Key path per store, for validation. */
const KEY_PATHS = { meta: 'key', settings: 'key' };
const keyPathOf = (store) => KEY_PATHS[store] ?? 'id';

/**
 * Per-schema-version transforms applied to an older backup before restoring.
 * BACKUP_UPGRADES[n] upgrades a backup's `stores` object from version n to n+1.
 * @type {Record<number, (stores: Record<string, any[]>) => void>}
 */
export const BACKUP_UPGRADES = {};

/* ---------- Blob (de)serialization ---------- */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(data, mime) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Deep-copies a record replacing Blobs with { __blob, data }. Exported for tests. */
export async function encodeValue(v) {
  if (v instanceof Blob) return { __blob: v.type || 'application/octet-stream', data: await blobToBase64(v) };
  if (Array.isArray(v)) return Promise.all(v.map(encodeValue));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = await encodeValue(x);
    return out;
  }
  return v;
}

/** Inverse of encodeValue. Exported for tests. */
export function decodeValue(v) {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === 'object') {
    if (typeof v.__blob === 'string' && typeof v.data === 'string') return base64ToBlob(v.data, v.__blob);
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x);
    return out;
  }
  return v;
}

/* ---------- Export ---------- */

/**
 * Builds the backup object for every store.
 * @param {(store: string) => void} [onStore] progress callback
 */
export async function buildBackup(onStore) {
  const adapter = getAdapter();
  const stores = {};
  const counts = {};
  for (const name of adapter.storeNames()) {
    onStore?.(name);
    const rows = await adapter.list(name);
    stores[name] = await Promise.all(rows.map(encodeValue));
    counts[name] = rows.length;
  }
  const me = currentUser();
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: me ? { id: me.id, name: me.displayName } : null,
    clinic: getSettings('clinic').name,
    counts,
    stores,
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** Exports, downloads the file and records the backup time. */
export async function exportBackup(onStore) {
  const backup = await buildBackup(onStore);
  const json = JSON.stringify(backup);
  const d = new Date();
  const filename = `ganah-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, filename);
  await repos.meta.set('lastBackupAt', backup.exportedAt);
  await logEvent({ action: 'backup_export', entity: 'backup', summary: `${filename} (${Math.round(blob.size / 1024)} ك.ب)` });
  return { filename, size: blob.size, counts: backup.counts };
}

/** Triggers a browser download (works on static hosting; no server needed). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ---------- Validate & restore ---------- */

export class BackupError extends Error {
  constructor(message) { super(message); this.name = 'BackupError'; }
}

/**
 * Parses and validates a backup file's text. Returns the parsed backup plus a preview.
 * Exported (pure) for tests.
 * @param {string} text
 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new BackupError('الملف ليس نسخة احتياطية صالحة (تنسيق غير مقروء).'); }
  if (!data || data.app !== BACKUP_APP) throw new BackupError('هذا الملف ليس نسخة احتياطية من برنامج عيادة جنة.');
  if (data.format !== BACKUP_FORMAT) throw new BackupError('إصدار ملف النسخة غير مدعوم.');
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) throw new BackupError('الملف تالف: رقم الإصدار مفقود.');
  if (data.schemaVersion > SCHEMA_VERSION) throw new BackupError('هذه النسخة من إصدار أحدث من البرنامج. حدّث البرنامج أولًا ثم أعد المحاولة.');
  if (!data.stores || typeof data.stores !== 'object') throw new BackupError('الملف تالف: لا توجد بيانات.');

  for (const [store, rows] of Object.entries(data.stores)) {
    if (!Array.isArray(rows)) throw new BackupError(`الملف تالف: بيانات «${store}» غير صحيحة.`);
    const key = keyPathOf(store);
    if (rows.some((r) => !r || typeof r !== 'object' || r[key] == null)) throw new BackupError(`الملف تالف: سجلات بدون معرّف في «${store}».`);
  }
  if (!data.stores.users?.length) throw new BackupError('النسخة لا تحتوي على أي مستخدمين، ولن يمكن الدخول بعد الاسترجاع.');

  const count = (s) => data.stores[s]?.length ?? 0;
  return {
    backup: data,
    preview: {
      clinic: data.clinic ?? '',
      exportedAt: data.exportedAt,
      exportedBy: data.exportedBy?.name ?? '',
      schemaVersion: data.schemaVersion,
      older: data.schemaVersion < SCHEMA_VERSION,
      counts: {
        patients: count('patients'),
        users: count('users'),
        procedures: count('procedures'),
        media: count('media'),
        auditLog: count('auditLog'),
      },
    },
  };
}

/** Reads a File chosen by the user. */
export async function readBackupFile(file) {
  if (!file) throw new BackupError('اختر ملف النسخة الاحتياطية');
  if (file.size > 1024 * 1024 * 1024) throw new BackupError('الملف كبير جدًا');
  return parseBackup(await file.text());
}

/**
 * Replaces ALL local data with the backup's contents (one atomic transaction).
 * Unknown stores in the file are ignored; stores missing from the file are emptied.
 * The caller should sign out and reload afterwards.
 */
export async function restoreBackup(backup) {
  const stores = structuredClone(backup.stores);
  for (let v = backup.schemaVersion; v < SCHEMA_VERSION; v++) BACKUP_UPGRADES[v]?.(stores);

  const adapter = getAdapter();
  const names = adapter.storeNames();
  // Decode blobs before opening the transaction (it must not wait on other async work).
  const decoded = {};
  for (const name of names) decoded[name] = (stores[name] ?? []).map(decodeValue);

  const me = currentUser();
  await adapter.transaction(names, 'readwrite', async (t) => {
    for (const name of names) {
      await t.clear(name);
      for (const rec of decoded[name]) await t.put(name, rec);
    }
  });
  await logEvent({
    action: 'backup_restore', entity: 'backup',
    userId: me?.id ?? null, userName: me?.displayName ?? null,
    summary: `نسخة بتاريخ ${backup.exportedAt?.slice(0, 10) ?? '؟'} · ${decoded.patients?.length ?? 0} مريض`,
  });
}

/* ---------- Reminder ---------- */

/** { lastAt, days, due } — due when never backed up (and there is data) or older than the setting. */
export async function backupStatus() {
  const lastAt = await repos.meta.get('lastBackupAt', null);
  const days = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000) : null;
  const limit = getSettings('app').backupReminderDays || 7;
  const hasData = (await getAdapter().count('patients')) > 0;
  return { lastAt, days, due: hasData && (days === null || days >= limit), limit };
}
