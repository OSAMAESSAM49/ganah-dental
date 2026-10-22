/**
 * Change tracking for sync. Wraps a storage adapter so that every write — through a
 * repository, a service transaction or a direct adapter call — is reported once it has
 * committed, and every stored record carries `_rev`, a per-write timestamp used to decide
 * which version is newest when devices sync.
 *
 * `raw` on the wrapped adapter writes without tracking (used when applying pulled changes).
 */

/** Stores that never sync (per-device counters, setup flag, last-backup time). */
export const LOCAL_ONLY = new Set(['meta']);
export const keyPathOf = (store) => (store === 'meta' || store === 'settings' ? 'key' : 'id');

let lastRev = '';
/** Strictly increasing ISO timestamp for this device. */
export function newRev() {
  let r = new Date().toISOString();
  if (r <= lastRev) r = new Date(Date.parse(lastRev) + 1).toISOString();
  lastRev = r;
  return r;
}

/** @typedef {{ store: string, id?: string, deleted?: boolean, cleared?: boolean }} WriteEvent */
/** @type {Set<(events: WriteEvent[], source: object) => void>} */
const listeners = new Set();
/** Subscribes to committed local writes; `source` is the tracked adapter that wrote. @returns {() => void} unsubscribe */
export function onLocalWrite(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = (events, source) => {
  if (!events.length) return;
  for (const fn of listeners) { try { fn(events, source); } catch (err) { console.error('[tracking] listener failed', err); } }
};

const stampOne = (store, rec) => { if (!LOCAL_ONLY.has(store) && rec && typeof rec === 'object') rec._rev = newRev(); return rec; };

/** Wraps transaction ops: stamps puts and records what changed (reported after commit). */
function trackOps(t, events) {
  return {
    ...t,
    put: (store, rec) => { stampOne(store, rec); events.push({ store, id: rec[keyPathOf(store)] }); return t.put(store, rec); },
    putMany: (store, recs) => { recs.forEach((r) => { stampOne(store, r); events.push({ store, id: r[keyPathOf(store)] }); }); return t.putMany(store, recs); },
    delete: (store, id) => { events.push({ store, id, deleted: true }); return t.delete(store, id); },
    clear: (store) => { events.push({ store, cleared: true }); return t.clear(store); },
  };
}

/**
 * @template {object} A
 * @param {A & { put: Function, putMany: Function, delete: Function, clear: Function, transaction: Function }} raw
 */
export function trackAdapter(raw) {
  const synced = (events) => events.filter((e) => !LOCAL_ONLY.has(e.store));
  const wrapped = {
    ...raw,
    raw,
    async put(store, rec) { stampOne(store, rec); const r = await raw.put(store, rec); notify(synced([{ store, id: rec[keyPathOf(store)] }]), wrapped); return r; },
    async putMany(store, recs) { recs.forEach((r) => stampOne(store, r)); const r = await raw.putMany(store, recs); notify(synced(recs.map((x) => ({ store, id: x[keyPathOf(store)] }))), wrapped); return r; },
    async delete(store, id) { await raw.delete(store, id); notify(synced([{ store, id, deleted: true }]), wrapped); },
    async clear(store) { await raw.clear(store); notify(synced([{ store, cleared: true }]), wrapped); },
    async transaction(stores, mode, fn) {
      if (mode !== 'readwrite') return raw.transaction(stores, mode, fn);
      const events = [];
      const result = await raw.transaction(stores, mode, (t) => fn(trackOps(t, events)));
      notify(synced(events), wrapped);
      return result;
    },
  };
  return wrapped;
}
