/**
 * Audit log: who did what and when. Repository writes on audited stores are recorded
 * automatically (via repoHooks.afterWrite); auth events are recorded explicitly with logEvent().
 * Only Admin can read it (permission module 'audit' is admin-only).
 */
import { repos } from '../data/index.js';
import { repoHooks } from '../data/repository.js';
import { currentUser } from '../core/session.js';
import { META_FIELDS, SECRET_FIELDS } from '../core/labels.js';

/** Stores whose changes are audited. Later phases add patients, payments, inventory… */
export const AUDITED_STORES = new Set([
  'users', 'roles', 'settings',
  'patients', 'payments', 'invoices', 'installments', 'inventoryItems', 'stockMovements', 'stockBatches',
  'appointments', 'treatmentItems', 'treatmentPlans', 'expenses', 'procedures', 'procedureCategories', 'media', 'labCases',
]);

const isSecret = (key) => SECRET_FIELDS.has(key) || /hash|salt/i.test(key);

/** Makes a value safe and compact for storing in the log. */
function sanitize(value) {
  if (typeof value === 'string') return value.startsWith('data:') ? '[صورة]' : value;
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Blob) return '[ملف]';
  if (Array.isArray(value)) return value.map(sanitize);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isSecret(k)) out[k] = sanitize(v);
  }
  return out;
}

/**
 * Top-level field differences between two versions of a record (secrets and bookkeeping
 * fields excluded). Exported for tests.
 * @returns {{ field: string, from: any, to: any }[]}
 */
export function diffRecords(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes = [];
  for (const k of keys) {
    if (META_FIELDS.has(k) || isSecret(k)) continue;
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changes.push({ field: k, from: sanitize(a) ?? null, to: sanitize(b) ?? null });
  }
  return changes;
}

/** Best human label for a record (shown in the log list). */
function recordLabel(rec) {
  if (!rec || typeof rec !== 'object') return '';
  return rec.displayName ?? rec.name ?? rec.title ?? rec.fileNo ?? rec.username ?? '';
}

/**
 * Appends an entry.
 * @param {{ action: string, entity: string, entityId?: string|null, summary?: string,
 *           changes?: any[], userId?: string|null, userName?: string|null }} entry
 */
export async function logEvent(entry) {
  const user = currentUser();
  return repos.audit.create({
    at: new Date().toISOString(),
    userId: entry.userId ?? user?.id ?? null,
    userName: entry.userName ?? user?.displayName ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    summary: entry.summary ?? '',
    changes: entry.changes ?? [],
  });
}

/** Connects the audit log to repository writes. Call once at boot. */
export function installAuditHook() {
  repoHooks.actor = () => currentUser()?.id ?? null;
  repoHooks.afterWrite = async ({ store, action, id, before, after }) => {
    if (store === 'auditLog' || !AUDITED_STORES.has(store)) return;
    const changes = action === 'update' ? diffRecords(before, after) : [];
    if (action === 'update' && changes.length === 0) return;
    await logEvent({
      action,
      entity: store,
      entityId: id,
      summary: recordLabel(after ?? before) || (store === 'settings' ? id : ''),
      changes: action === 'create' ? diffRecords(null, after) : changes,
    });
  };
}

/**
 * Reads the log, newest first, within an optional ISO time range.
 * @param {{ from?: string, to?: string, limit?: number, offset?: number }} [opts]
 */
export function listAudit({ from, to, limit, offset } = {}) {
  const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
  return repos.audit.list({ index: 'at', range, direction: 'prev', limit, offset });
}
