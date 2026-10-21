/**
 * Data layer entry point. The app calls initData() once at boot, then uses `repos`.
 * To move to Supabase/Firebase later, create an adapter with the same interface and
 * pass it here — nothing above this layer changes.
 */
import { createIndexedDBAdapter } from './adapter-indexeddb.js';
import { MIGRATIONS } from './migrations.js';
import { KeyValueRepository, Repository } from './repository.js';

export const DB_NAME = 'ganah-dental';

/** @type {Awaited<ReturnType<typeof createIndexedDBAdapter>> | null} */
let adapter = null;

/**
 * Registry of repositories. Feature phases add entries here.
 * @type {{ meta: KeyValueRepository, settings: KeyValueRepository,
 *          users: Repository, roles: Repository, audit: Repository, patients: Repository,
 *          media: Repository, procedureCategories: Repository, procedures: Repository }}
 */
export const repos = /** @type {any} */ ({});

/**
 * Opens storage, runs migrations and builds repositories.
 * @param {{ name?: string, onVersionChange?: () => void, onBlocked?: () => void }} [opts]
 */
export async function initData({ name = DB_NAME, ...handlers } = {}) {
  adapter = await createIndexedDBAdapter(name, MIGRATIONS, handlers);
  repos.meta = new KeyValueRepository(adapter, 'meta');
  repos.settings = new KeyValueRepository(adapter, 'settings');
  repos.users = new Repository(adapter, 'users', { softDelete: true });
  repos.roles = new Repository(adapter, 'roles');
  repos.audit = new Repository(adapter, 'auditLog');
  repos.patients = new Repository(adapter, 'patients', { softDelete: true });
  repos.media = new Repository(adapter, 'media');
  repos.procedureCategories = new Repository(adapter, 'procedureCategories');
  repos.procedures = new Repository(adapter, 'procedures');
  return adapter;
}

/**
 * Atomically increments a named counter in meta and returns the new value
 * (file numbers, invoice numbers, receipt numbers…).
 * @param {string} name e.g. 'patientFileNo'
 */
export async function nextCounter(name) {
  const key = `counter.${name}`;
  return getAdapter().transaction(['meta'], 'readwrite', async (t) => {
    const row = await t.get('meta', key);
    const value = (row?.value ?? 0) + 1;
    await t.put('meta', { key, value, updatedAt: new Date().toISOString() });
    return value;
  });
}

/** The active adapter (for backup/restore and multi-store transactions). */
export function getAdapter() {
  if (!adapter) throw new Error('Data layer not initialised: call initData() first');
  return adapter;
}

/**
 * Asks the browser not to evict our data under storage pressure.
 * Installed PWAs are usually granted this automatically.
 * @returns {Promise<{ persisted: boolean, usage?: number, quota?: number }>}
 */
export async function requestPersistentStorage() {
  const s = navigator.storage;
  if (!s?.persist) return { persisted: false };
  const persisted = (await s.persisted()) || (await s.persist());
  const { usage, quota } = (await s.estimate?.()) ?? {};
  return { persisted, usage, quota };
}
