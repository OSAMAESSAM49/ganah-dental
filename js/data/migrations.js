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
  {
    version: 2,
    description: 'Accounts: users, roles, audit log',
    up(db) {
      const users = db.createObjectStore('users', { keyPath: 'id' });
      users.createIndex('username', 'username', { unique: true });
      users.createIndex('roleId', 'roleId');
      db.createObjectStore('roles', { keyPath: 'id' });
      const audit = db.createObjectStore('auditLog', { keyPath: 'id' });
      audit.createIndex('at', 'at');
      audit.createIndex('userId', 'userId');
      audit.createIndex('entity', 'entity');
      audit.createIndex('entityRef', ['entity', 'entityId']);
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;
