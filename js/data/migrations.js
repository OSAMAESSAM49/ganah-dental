/**
 * Database schema history. NEVER edit or reorder a migration that has shipped:
 * append a new one instead. The database version is MIGRATIONS.length.
 *
 * Each migration runs inside the upgrade transaction and must only issue IndexedDB
 * requests synchronously (see idb.js).
 */

import { seedCatalog } from './seed-catalog.js';
import { inferChartEffect } from '../core/chart-conditions.js';

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
  {
    version: 3,
    description: 'Patients, patient media, procedures catalog (seeded)',
    up(db, tx) {
      const patients = db.createObjectStore('patients', { keyPath: 'id' });
      patients.createIndex('fileNo', 'fileNo', { unique: true });
      patients.createIndex('phone', 'phone');
      patients.createIndex('createdAt', 'createdAt');
      const media = db.createObjectStore('media', { keyPath: 'id' });
      media.createIndex('patientId', 'patientId');
      media.createIndex('kind', 'kind');
      db.createObjectStore('procedureCategories', { keyPath: 'id' });
      db.createObjectStore('procedures', { keyPath: 'id' }).createIndex('categoryId', 'categoryId');
      seedCatalog((store, record) => tx.objectStore(store).put(record));
    },
  },
  {
    version: 4,
    description: 'Dental chart events, treatment plans and items; chartEffect on procedures',
    up(db, tx) {
      db.createObjectStore('toothEvents', { keyPath: 'id' }).createIndex('patientId', 'patientId');
      db.createObjectStore('treatmentPlans', { keyPath: 'id' }).createIndex('patientId', 'patientId');
      const items = db.createObjectStore('treatmentItems', { keyPath: 'id' });
      items.createIndex('patientId', 'patientId');
      items.createIndex('planId', 'planId');
      items.createIndex('procedureId', 'procedureId');
      items.createIndex('status', 'status');
      // Backfill: what each existing procedure does to the chart when completed.
      tx.objectStore('procedures').openCursor().onsuccess = (e) => {
        const cursor = /** @type {IDBCursorWithValue} */ (/** @type {IDBRequest} */ (e.target).result);
        if (!cursor) return;
        if (cursor.value.chartEffect === undefined) cursor.update({ ...cursor.value, chartEffect: inferChartEffect(cursor.value.name) });
        cursor.continue();
      };
    },
  },
  {
    version: 5,
    description: 'Appointments',
    up(db) {
      const appts = db.createObjectStore('appointments', { keyPath: 'id' });
      appts.createIndex('date', 'date');
      appts.createIndex('patientId', 'patientId');
      appts.createIndex('doctorId', 'doctorId');
      appts.createIndex('status', 'status');
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;
