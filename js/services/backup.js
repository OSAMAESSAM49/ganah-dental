/**
 * Backup, restore and merge-import.
 *
 * File formats
 *   - format 2 (current): a .zip with `backup.json` + the original image files under files/.
 *     In the JSON, each Blob is { __file: 'files/…', __blob: mime }.
 *   - format 1 (older): a single .json with Blobs embedded as base64 { __blob: mime, data }.
 *   Both are read. Backups from an older schema are accepted (missing stores start empty;
 *   transforms in BACKUP_UPGRADES run first). Backups from a newer app version are refused.
 *
 * Restore REPLACES all data in one transaction. Merge-import ADDS another device's records:
 * records are matched by id and the newest updatedAt wins; clashing file / invoice / receipt
 * / prescription numbers on new records are renumbered; derived caches are rebuilt after.
 */
import { getAdapter, repos } from '../data/index.js';
import { SCHEMA_VERSION } from '../data/migrations.js';
import { currentUser } from '../core/session.js';
import { getSettings } from '../data/settings.js';
import { logEvent } from './audit.js';
import { buildSearchText } from './patients.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from '../../vendor/fflate/fflate.js';

export const BACKUP_APP = 'ganah-dental';
export const BACKUP_FORMAT = 2;
const READABLE_FORMATS = [1, 2];

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

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/**
 * Deep-copies a record replacing Blobs. With `files` (a Map path → Blob) Blobs become
 * { __file, __blob } references (zip format); without it they are embedded as base64.
 * Exported for tests.
 */
export async function encodeValue(v, files) {
  if (v instanceof Blob) {
    const mime = v.type || 'application/octet-stream';
    if (!files) return { __blob: mime, data: await blobToBase64(v) };
    const path = `files/${String(files.size + 1).padStart(6, '0')}.${EXT[mime] ?? 'bin'}`;
    files.set(path, v);
    return { __file: path, __blob: mime };
  }
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await encodeValue(x, files)); return out; }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = await encodeValue(x, files);
    return out;
  }
  return v;
}

/** Inverse of encodeValue. `files`: Map path → Uint8Array (zip contents). Exported for tests. */
export function decodeValue(v, files) {
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, files));
  if (v && typeof v === 'object') {
    if (typeof v.__blob === 'string' && typeof v.data === 'string') return base64ToBlob(v.data, v.__blob);
    if (typeof v.__blob === 'string' && typeof v.__file === 'string') {
      const bytes = files?.get(v.__file);
      if (!bytes) throw new BackupError(`الملف تالف: الصورة ${v.__file} غير موجودة داخل النسخة.`);
      return new Blob([bytes], { type: v.__blob });
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x, files);
    return out;
  }
  return v;
}

/* ---------- Export ---------- */

/**
 * Builds the backup header + stores. Blobs go to `files` when given (zip), else base64.
 * @param {{ onStore?: (store: string) => void, files?: Map<string, Blob> }} [o]
 */
export async function buildBackup({ onStore, files } = {}) {
  const adapter = getAdapter();
  const stores = {};
  const counts = {};
  for (const name of adapter.storeNames()) {
    onStore?.(name);
    const rows = await adapter.list(name);
    stores[name] = [];
    for (const r of rows) stores[name].push(await encodeValue(r, files));
    counts[name] = rows.length;
  }
  const me = currentUser();
  return {
    app: BACKUP_APP,
    format: files ? 2 : 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: me ? { id: me.id, name: me.displayName } : null,
    clinic: getSettings('clinic').name,
    counts,
    stores,
  };
}

/** The whole database as a .zip Blob (backup.json + image files). */
export async function buildBackupZip(onStore) {
  const files = new Map();
  const backup = await buildBackup({ onStore, files });
  /** @type {Record<string, [Uint8Array, { level: number }]>} */
  const entries = { 'backup.json': [strToU8(JSON.stringify(backup)), { level: 6 }] };
  // Images are already compressed: store them as they are.
  for (const [path, blob] of files) entries[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  const zip = zipSync(entries, { mtime: new Date() });
  return { blob: new Blob([zip], { type: 'application/zip' }), backup };
}

const pad = (n) => String(n).padStart(2, '0');

/** Exports, downloads the .zip and records the backup time. */
export async function exportBackup(onStore) {
  const { blob, backup } = await buildBackupZip(onStore);
  const d = new Date();
  const filename = `ganah-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
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

/* ---------- Read & validate ---------- */

export class BackupError extends Error {
  constructor(message) { super(message); this.name = 'BackupError'; }
}

/** Validates a parsed backup object and builds its preview. */
function validate(data) {
  if (!data || data.app !== BACKUP_APP) throw new BackupError('هذا الملف ليس نسخة احتياطية من برنامج عيادة جنة.');
  if (!READABLE_FORMATS.includes(data.format)) throw new BackupError('إصدار ملف النسخة غير مدعوم.');
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
    clinic: data.clinic ?? '',
    exportedAt: data.exportedAt,
    exportedBy: data.exportedBy?.name ?? '',
    schemaVersion: data.schemaVersion,
    older: data.schemaVersion < SCHEMA_VERSION,
    counts: {
      patients: count('patients'),
      appointments: count('appointments'),
      invoices: count('invoices'),
      users: count('users'),
      procedures: count('procedures'),
      media: count('media'),
      auditLog: count('auditLog'),
    },
  };
}

/**
 * Parses a format-1 JSON backup's text. Exported (pure) for tests.
 * @param {string} text
 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new BackupError('الملف ليس نسخة احتياطية صالحة (تنسيق غير مقروء).'); }
  return { backup: data, files: null, preview: validate(data) };
}

/**
 * Parses a backup .zip (bytes). Exported for tests.
 * @param {Uint8Array} bytes
 */
export function parseBackupZip(bytes) {
  let entries;
  try { entries = unzipSync(bytes); } catch { throw new BackupError('ملف الضغط تالف أو غير مكتمل.'); }
  if (!entries['backup.json']) throw new BackupError('هذا الملف المضغوط ليس نسخة احتياطية من برنامج عيادة جنة.');
  let data;
  try { data = JSON.parse(strFromU8(entries['backup.json'])); } catch { throw new BackupError('الملف تالف: بيانات النسخة غير مقروءة.'); }
  const files = new Map(Object.entries(entries).filter(([k]) => k.startsWith('files/')));
  return { backup: data, files, preview: validate(data) };
}

/** Reads a File chosen by the user (.zip or older .json). */
export async function readBackupFile(file) {
  if (!file) throw new BackupError('اختر ملف النسخة الاحتياطية');
  if (file.size > 2 * 1024 * 1024 * 1024) throw new BackupError('الملف كبير جدًا');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  return isZip ? parseBackupZip(bytes) : parseBackup(new TextDecoder().decode(bytes));
}

/** Upgrades and decodes every store of a parsed backup (Blobs restored). */
function decodedStores({ backup, files }, names) {
  const stores = structuredClone(backup.stores);
  for (let v = backup.schemaVersion; v < SCHEMA_VERSION; v++) BACKUP_UPGRADES[v]?.(stores);
  const out = {};
  for (const name of names) out[name] = (stores[name] ?? []).map((r) => decodeValue(r, files));
  return out;
}

/* ---------- Restore (replace everything) ---------- */

/**
 * Replaces ALL local data with the backup's contents (one atomic transaction).
 * Unknown stores in the file are ignored; stores missing from the file are emptied.
 * The caller should sign out and reload afterwards.
 * @param {{ backup: object, files?: Map<string, Uint8Array>|null }} parsed
 */
export async function restoreBackup(parsed) {
  const adapter = getAdapter();
  const names = adapter.storeNames();
  // Decode before opening the transaction (it must not wait on other async work).
  const decoded = decodedStores(parsed, names);

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
    summary: `نسخة بتاريخ ${parsed.backup.exportedAt?.slice(0, 10) ?? '؟'} · ${decoded.patients?.length ?? 0} مريض`,
  });
}

/* ---------- Merge import (add another device's data) ---------- */

/** Stores never merged: this device's settings, counters and sign-in state stay as they are. */
const MERGE_SKIP = new Set(['meta', 'settings']);
/** Numbered records: field, counter name, and how a number is read back. */
const NUMBERED = {
  patients: { field: 'fileNo', counter: 'patientFileNo', read: (v) => Number(String(v).replace(/\D/g, '')) || 0, make: (n) => `G-${String(n).padStart(5, '0')}` },
  invoices: { field: 'number', counter: 'invoiceNo', read: Number, make: (n) => n },
  payments: { field: 'receiptNo', counter: 'receiptNo', read: Number, make: (n) => n },
  prescriptions: { field: 'number', counter: 'rxNo', read: Number, make: (n) => n },
};
const stamp = (r) => r.updatedAt ?? r.createdAt ?? r.at ?? '';

/**
 * Works out what a merge would do, without writing. Pure given the two data sets.
 * Exported for tests.
 * @param {Record<string, object[]>} local  current records per store
 * @param {Record<string, object[]>} incoming  decoded records per store
 * @param {Record<string, number>} counters  current meta counters (by counter name)
 * @returns {{ writes: Record<string, object[]>, summary: Record<string, { added: number, updated: number, kept: number, renumbered: number }>, counters: Record<string, number> }}
 */
export function planMerge(local, incoming, counters = {}) {
  const writes = {}, summary = {};
  const nextCounters = { ...counters };
  for (const [store, rows] of Object.entries(incoming)) {
    if (MERGE_SKIP.has(store) || !local[store]) continue;
    const byId = new Map(local[store].map((r) => [r.id, r]));
    const s = { added: 0, updated: 0, kept: 0, renumbered: 0 };
    const out = [];
    const num = NUMBERED[store];
    const taken = num ? new Map(local[store].map((r) => [String(r[num.field]), r.id])) : null;
    if (num) {
      const maxSeen = Math.max(0, ...local[store].map((r) => num.read(r[num.field])), ...rows.map((r) => num.read(r[num.field])));
      nextCounters[num.counter] = Math.max(nextCounters[num.counter] ?? 0, maxSeen);
    }
    for (const rec of rows) {
      const mine = byId.get(rec.id);
      if (store === 'users' || store === 'roles') {
        // Accounts are only added, never overwritten (passwords/permissions stay as set here).
        const clash = store === 'users' && local.users.some((u) => u.username === rec.username && u.id !== rec.id);
        if (!mine && !clash) { out.push(rec); s.added++; } else s.kept++;
        continue;
      }
      if (mine) {
        if (stamp(rec) > stamp(mine)) { out.push(num ? { ...rec, [num.field]: mine[num.field] } : rec); s.updated++; } else s.kept++;
        continue;
      }
      let r = rec;
      if (num && taken.has(String(rec[num.field])) && taken.get(String(rec[num.field])) !== rec.id) {
        nextCounters[num.counter] += 1;
        r = { ...rec, [num.field]: num.make(nextCounters[num.counter]) };
        if (store === 'patients') r.searchText = buildSearchText(r);
        s.renumbered++;
      }
      if (num) taken.set(String(r[num.field]), r.id);
      out.push(r);
      s.added++;
    }
    if (out.length) writes[store] = out;
    if (rows.length) summary[store] = s;
  }
  return { writes, summary, counters: nextCounters };
}

/**
 * Prepares a merge of a parsed backup into this device (reads only).
 * @returns {Promise<{ plan: ReturnType<typeof planMerge>, preview: object }>}
 */
export async function prepareMerge(parsed) {
  const adapter = getAdapter();
  const names = adapter.storeNames().filter((n) => !MERGE_SKIP.has(n));
  const incoming = decodedStores(parsed, names);
  const local = {};
  for (const n of names) local[n] = await adapter.list(n);
  const counters = {};
  for (const { counter } of Object.values(NUMBERED)) counters[counter] = (await repos.meta.get(`counter.${counter}`, 0)) ?? 0;
  return { plan: planMerge(local, incoming, counters), preview: parsed.preview };
}

/** Applies a prepared merge in one transaction, then rebuilds derived caches. */
export async function applyMerge({ plan, preview }) {
  const adapter = getAdapter();
  const stores = Object.keys(plan.writes);
  const t0 = new Date().toISOString();
  await adapter.transaction([...stores, 'meta'], 'readwrite', async (t) => {
    for (const s of stores) for (const rec of plan.writes[s]) await t.put(s, rec);
    for (const [counter, value] of Object.entries(plan.counters)) await t.put('meta', { key: `counter.${counter}`, value, updatedAt: t0 });
  });
  await rebuildDerived(new Set(stores));
  const added = Object.values(plan.summary).reduce((n, s) => n + s.added, 0);
  const updated = Object.values(plan.summary).reduce((n, s) => n + s.updated, 0);
  await logEvent({ action: 'backup_merge', entity: 'backup', summary: `دمج نسخة ${preview.clinic || ''} بتاريخ ${preview.exportedAt?.slice(0, 10) ?? '؟'}: ${added} جديد، ${updated} محدّث` });
}

/** Stock batch quantities, item caches and invoice statuses after records changed underneath. */
async function rebuildDerived(touched) {
  if (touched.has('stockMovements') || touched.has('stockBatches') || touched.has('inventoryItems')) {
    const { recomputeItem, round3 } = await import('./inventory.js');
    const moves = await repos.stockMovements.list();
    const perBatch = new Map();
    for (const m of moves) if (m.batchId) perBatch.set(m.batchId, (perBatch.get(m.batchId) ?? 0) + m.qty);
    for (const b of await repos.stockBatches.list()) {
      const q = round3(Math.max(0, perBatch.get(b.id) ?? 0));
      if (q !== b.qty) await repos.stockBatches.update(b.id, { qty: q });
    }
    for (const item of await repos.inventoryItems.list({ includeDeleted: true })) await recomputeItem(item.id);
  }
  if (touched.has('invoices') || touched.has('payments')) {
    const { refreshInvoiceStatus } = await import('./billing.js');
    for (const inv of await repos.invoices.list()) await refreshInvoiceStatus(inv.id);
  }
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
