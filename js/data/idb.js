/**
 * Low-level IndexedDB helpers: promisified requests and a migration-aware open().
 * Only js/data/adapter-indexeddb.js should import this file.
 */

/** @template T @param {IDBRequest<T>} req @returns {Promise<T>} */
export function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Resolves when the transaction commits; rejects on error/abort. @param {IDBTransaction} tx */
export function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

/**
 * @typedef {object} Migration
 * @property {number} version  1-based, consecutive
 * @property {string} description
 * @property {(db: IDBDatabase, tx: IDBTransaction) => void} up
 *   Runs inside the versionchange transaction. It must only issue IndexedDB requests
 *   (no awaits on other async work), otherwise the transaction auto-commits.
 */

/**
 * Opens (and upgrades) a database. The DB version equals the number of migrations;
 * every migration newer than the stored version runs in order, in one transaction.
 * @param {string} name
 * @param {Migration[]} migrations
 * @param {{ onVersionChange?: () => void, onBlocked?: () => void }} [handlers]
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase(name, migrations, handlers = {}) {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration #${i} must have version ${i + 1}, got ${m.version}`);
  });
  const version = migrations.length;

  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB is not supported')); return; }
    const req = indexedDB.open(name, version);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = /** @type {IDBTransaction} */ (req.transaction);
      const from = event.oldVersion;
      try {
        for (const m of migrations) {
          if (m.version > from) m.up(db, tx);
        }
      } catch (err) {
        tx.abort();
        reject(err);
      }
    };
    req.onblocked = () => handlers.onBlocked?.();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is upgrading: close so it can proceed, then ask the user to reload.
      db.onversionchange = () => { db.close(); handlers.onVersionChange?.(); };
      resolve(db);
    };
  });
}

/** Deletes a whole database (tests, factory reset). */
export function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // completes once other connections close
  });
}
