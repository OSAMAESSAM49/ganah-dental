/**
 * Repositories: the async, backend-neutral API that the rest of the app uses for data.
 * UI and services never touch the adapter (or IndexedDB) directly.
 *
 * Every record gets: id (UUID), createdAt, updatedAt, createdBy, updatedBy.
 * Soft-deletable stores also get deletedAt / deletedBy.
 */
import { emit } from '../core/bus.js';

/** Hooks wired by the app (phase 2: current user + audit log). */
export const repoHooks = {
  /** @type {() => (string|null)} id of the signed-in user */
  actor: () => null,
  /**
   * Called after every successful write. Use it for the audit log.
   * @type {(evt: { store: string, action: string, id: string, before: any, after: any }) => (void|Promise<void>)}
   */
  afterWrite: () => {},
};

export class NotFoundError extends Error {
  constructor(store, id) {
    super(`${store}/${id} not found`);
    this.name = 'NotFoundError';
    this.store = store;
    this.id = id;
  }
}

export const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export class Repository {
  /**
   * @param {object} adapter storage adapter (see adapter-indexeddb.js)
   * @param {string} store object store / table name
   * @param {{ softDelete?: boolean }} [options]
   */
  constructor(adapter, store, { softDelete = false } = {}) {
    this.adapter = adapter;
    this.store = store;
    this.softDelete = softDelete;
  }

  /** @returns {Promise<object|null>} */
  async get(id, { includeDeleted = false } = {}) {
    const rec = await this.adapter.get(this.store, id);
    if (!rec || (!includeDeleted && rec.deletedAt)) return null;
    return rec;
  }

  /** Like get() but throws NotFoundError. */
  async require(id) {
    const rec = await this.get(id);
    if (!rec) throw new NotFoundError(this.store, id);
    return rec;
  }

  /**
   * @param {{ index?: string, range?: object, direction?: 'next'|'prev', limit?: number, offset?: number,
   *           filter?: (r: any) => boolean, includeDeleted?: boolean }} [opts]
   *   filter/includeDeleted are applied after fetching, so limit applies before them;
   *   omit limit when filtering.
   */
  async list({ filter, includeDeleted = false, ...query } = {}) {
    let rows = await this.adapter.list(this.store, query);
    if (this.softDelete && !includeDeleted) rows = rows.filter((r) => !r.deletedAt);
    return filter ? rows.filter(filter) : rows;
  }

  /** All records whose index equals value. */
  findBy(index, value, opts = {}) {
    return this.list({ ...opts, index, range: { eq: value } });
  }

  async count(opts) {
    if (!this.softDelete) return this.adapter.count(this.store, opts);
    return (await this.list(opts)).length;
  }

  /** Inserts a new record. @returns {Promise<object>} the stored record */
  async create(data) {
    const actor = repoHooks.actor();
    const t = now();
    const record = { ...data, id: data.id ?? newId(), createdAt: t, updatedAt: t, createdBy: actor, updatedBy: actor };
    await this.adapter.put(this.store, record);
    await this.#after('create', record.id, null, record);
    return record;
  }

  /** Merges patch into an existing record. @returns {Promise<object>} */
  async update(id, patch) {
    const before = await this.require(id);
    const after = {
      ...before, ...patch,
      id, createdAt: before.createdAt, createdBy: before.createdBy,
      updatedAt: now(), updatedBy: repoHooks.actor(),
    };
    await this.adapter.put(this.store, after);
    await this.#after('update', id, before, after);
    return after;
  }

  /** Soft-deletes when the store supports it, otherwise removes permanently. */
  async remove(id) {
    const before = await this.adapter.get(this.store, id);
    if (!before) return;
    if (this.softDelete) {
      const after = { ...before, deletedAt: now(), deletedBy: repoHooks.actor() };
      await this.adapter.put(this.store, after);
      await this.#after('delete', id, before, after);
    } else {
      await this.adapter.delete(this.store, id);
      await this.#after('delete', id, before, null);
    }
  }

  /** Brings back a soft-deleted record. */
  async restore(id) {
    const before = await this.adapter.get(this.store, id);
    if (!before?.deletedAt) return before;
    const { deletedAt, deletedBy, ...rest } = before;
    const after = { ...rest, updatedAt: now(), updatedBy: repoHooks.actor() };
    await this.adapter.put(this.store, after);
    await this.#after('restore', id, before, after);
    return after;
  }

  async #after(action, id, before, after) {
    try { await repoHooks.afterWrite({ store: this.store, action, id, before, after }); }
    catch (err) { console.error('[repo] afterWrite hook failed', err); }
    emit('data:changed', { store: this.store, action, id });
  }
}

/** Simple key → value store (meta, settings). Values are stored as { key, value, updatedAt }. */
export class KeyValueRepository {
  constructor(adapter, store) {
    this.adapter = adapter;
    this.store = store;
  }

  async get(key, fallback = null) {
    const row = await this.adapter.get(this.store, key);
    return row ? row.value : fallback;
  }

  async set(key, value) {
    const before = await this.get(key, null);
    await this.adapter.put(this.store, { key, value, updatedAt: now() });
    try { await repoHooks.afterWrite({ store: this.store, action: 'update', id: key, before, after: value }); }
    catch (err) { console.error('[repo] afterWrite hook failed', err); }
    emit('data:changed', { store: this.store, action: 'update', id: key });
    return value;
  }

  /** Shallow-merges an object value. */
  async merge(key, patch) {
    const current = (await this.get(key, {})) ?? {};
    return this.set(key, { ...current, ...patch });
  }

  async all() {
    const rows = await this.adapter.list(this.store);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  remove(key) { return this.adapter.delete(this.store, key); }
}
