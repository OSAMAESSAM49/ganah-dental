/**
 * Database schema history. NEVER edit or reorder a migration that has shipped:
 * append a new one instead. The database version is MIGRATIONS.length.
 *
 * Each migration runs inside the upgrade transaction and must only issue IndexedDB
 * requests synchronously (see idb.js).
 */

/** @type {import('./idb.js').Migration[]} */
export const MIGRATIONS = [
  {
    version: 1,
    description: 'Core: meta and settings key-value stores',
    up(db, tx) {
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('settings', { keyPath: 'key' });
      tx.objectStore('meta').put({ key: 'createdAt', value: new Date().toISOString() });
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;
