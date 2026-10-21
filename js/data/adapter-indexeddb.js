/**
 * IndexedDB storage adapter.
 *
 * This is the ONLY layer that knows about IndexedDB. Repositories talk to an adapter through
 * the backend-neutral interface below, so a Supabase/Firebase adapter with the same methods
 * can replace it later without touching repositories or UI.
 *
 * Adapter interface (all async):
 *   get(store, id) · getMany(store, ids) · list(store, opts) · count(store, opts)
 *   put(store, record) · putMany(store, records) · delete(store, id) · clear(store)
 *   transaction(stores, mode, fn) · storeNames() · close()
 *
 * Query options (opts):
 *   index      name of an index (omit for primary key)
 *   range      { eq } | { gt, gte, lt, lte } | { prefix } (string prefix)
 *   direction  'next' (ascending, default) | 'prev' (descending)
 *   offset, limit
 */
import { openDatabase, request, transactionDone } from './idb.js';

/** Converts a neutral range spec to an IDBKeyRange. Exported for tests. */
export function toKeyRange(range) {
  if (!range) return undefined;
  if ('eq' in range) return IDBKeyRange.only(range.eq);
  if ('prefix' in range) return IDBKeyRange.bound(range.prefix, range.prefix + '￿');
  const lower = range.gte ?? range.gt;
  const upper = range.lte ?? range.lt;
  const lowerOpen = range.gte === undefined && range.gt !== undefined;
  const upperOpen = range.lte === undefined && range.lt !== undefined;
  if (lower !== undefined && upper !== undefined) return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
  if (lower !== undefined) return IDBKeyRange.lowerBound(lower, lowerOpen);
  if (upper !== undefined) return IDBKeyRange.upperBound(upper, upperOpen);
  return undefined;
}

/** Store operations bound to one IDBTransaction. */
function ops(tx) {
  const source = (store, index) => {
    const os = tx.objectStore(store);
    return index ? os.index(index) : os;
  };

  return {
    get: (store, id) => request(tx.objectStore(store).get(id)).then((r) => r ?? null),

    getMany: (store, ids) => Promise.all(ids.map((id) => request(tx.objectStore(store).get(id)).then((r) => r ?? null))),

    async list(store, { index, range, direction = 'next', offset = 0, limit } = {}) {
      const src = source(store, index);
      const keyRange = toKeyRange(range);
      if (direction === 'next' && !offset) return request(src.getAll(keyRange, limit));
      const out = [];
      await new Promise((resolve, reject) => {
        const req = src.openCursor(keyRange, direction);
        let skipped = false;
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) { resolve(); return; }
          if (offset && !skipped) { skipped = true; cursor.advance(offset); return; }
          out.push(cursor.value);
          if (limit && out.length >= limit) { resolve(); return; }
          cursor.continue();
        };
      });
      return out;
    },

    count: (store, { index, range } = {}) => request(source(store, index).count(toKeyRange(range))),

    put: (store, record) => request(tx.objectStore(store).put(record)).then(() => record),

    putMany: (store, records) => Promise.all(records.map((r) => request(tx.objectStore(store).put(r)))).then(() => records),

    delete: (store, id) => request(tx.objectStore(store).delete(id)).then(() => undefined),

    clear: (store) => request(tx.objectStore(store).clear()).then(() => undefined),
  };
}

/**
 * Opens the database and returns an adapter.
 * @param {string} name
 * @param {import('./idb.js').Migration[]} migrations
 * @param {{ onVersionChange?: () => void, onBlocked?: () => void }} [handlers]
 */
export async function createIndexedDBAdapter(name, migrations, handlers) {
  const db = await openDatabase(name, migrations, handlers);

  /** Runs a single-store operation in its own transaction. */
  const one = async (store, mode, fn) => {
    const tx = db.transaction(store, mode);
    const done = transactionDone(tx);
    try {
      const result = await fn(ops(tx));
      await done;
      return result;
    } catch (err) {
      done.catch(() => {});
      throw err;
    }
  };

  return {
    kind: 'indexeddb',
    name,
    version: db.version,

    get: (store, id) => one(store, 'readonly', (o) => o.get(store, id)),
    getMany: (store, ids) => one(store, 'readonly', (o) => o.getMany(store, ids)),
    list: (store, opts) => one(store, 'readonly', (o) => o.list(store, opts)),
    count: (store, opts) => one(store, 'readonly', (o) => o.count(store, opts)),
    put: (store, record) => one(store, 'readwrite', (o) => o.put(store, record)),
    putMany: (store, records) => one(store, 'readwrite', (o) => o.putMany(store, records)),
    delete: (store, id) => one(store, 'readwrite', (o) => o.delete(store, id)),
    clear: (store) => one(store, 'readwrite', (o) => o.clear(store)),

    /**
     * Atomic multi-store work: everything commits together or nothing does.
     * Inside fn, await only the provided ops (no fetch/crypto/timers), or IndexedDB
     * commits the transaction early.
     * @template T
     * @param {string[]} stores
     * @param {'readonly'|'readwrite'} mode
     * @param {(t: ReturnType<typeof ops>) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async transaction(stores, mode, fn) {
      const tx = db.transaction(stores, mode);
      const done = transactionDone(tx);
      try {
        const result = await fn(ops(tx));
        await done;
        return result;
      } catch (err) {
        try { tx.abort(); } catch { /* already finished */ }
        await done.catch(() => {});
        throw err;
      }
    },

    storeNames: () => Array.from(db.objectStoreNames),
    close: () => db.close(),
  };
}
