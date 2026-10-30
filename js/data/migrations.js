/**
 * Database schema history. NEVER edit or reorder a migration that has shipped:
 * append a new one instead. The database version is MIGRATIONS.length.
 *
 * Each migration runs inside the upgrade transaction and must only issue IndexedDB
 * requests synchronously (see idb.js).
 */

import { seedCatalog } from './seed-catalog.js';
import { inferChartEffect } from '../core/chart-conditions.js';
import { SEED_EXPENSE_CATEGORIES, SEED_ITEMS, SEED_RECIPES } from './seed-inventory.js';
import { SEED_INSTRUCTIONS, SEED_MEDICINES, SEED_RX_TEMPLATES, instructionFor, scheduleFor } from './seed-rx.js';

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
  {
    version: 6,
    description: 'Billing: invoices (with installment schedule) and payments',
    up(db) {
      const inv = db.createObjectStore('invoices', { keyPath: 'id' });
      inv.createIndex('number', 'number', { unique: true });
      inv.createIndex('patientId', 'patientId');
      inv.createIndex('date', 'date');
      inv.createIndex('status', 'status');
      const pay = db.createObjectStore('payments', { keyPath: 'id' });
      pay.createIndex('receiptNo', 'receiptNo', { unique: true });
      pay.createIndex('patientId', 'patientId');
      pay.createIndex('invoiceId', 'invoiceId');
      pay.createIndex('date', 'date');
    },
  },
  {
    version: 7,
    description: 'Inventory (items, batches, movements), expenses (categories, recurring), lab cases; seeds',
    up(db, tx) {
      db.createObjectStore('inventoryItems', { keyPath: 'id' }).createIndex('category', 'category');
      db.createObjectStore('stockBatches', { keyPath: 'id' }).createIndex('itemId', 'itemId');
      const mv = db.createObjectStore('stockMovements', { keyPath: 'id' });
      mv.createIndex('itemId', 'itemId');
      mv.createIndex('date', 'date');
      mv.createIndex('treatmentItemId', 'treatmentItemId');
      db.createObjectStore('expenseCategories', { keyPath: 'id' });
      const ex = db.createObjectStore('expenses', { keyPath: 'id' });
      ex.createIndex('date', 'date');
      ex.createIndex('categoryId', 'categoryId');
      ex.createIndex('refId', 'refId');
      db.createObjectStore('recurringExpenses', { keyPath: 'id' });
      const lab = db.createObjectStore('labCases', { keyPath: 'id' });
      lab.createIndex('patientId', 'patientId');
      lab.createIndex('status', 'status');

      const t = new Date().toISOString();
      const meta = { createdAt: t, updatedAt: t, createdBy: null, updatedBy: null };
      SEED_EXPENSE_CATEGORIES.forEach((c, order) => tx.objectStore('expenseCategories').put({ ...c, order, active: true, ...meta }));
      const ids = {};
      for (const it of SEED_ITEMS) {
        ids[it.key] = crypto.randomUUID();
        tx.objectStore('inventoryItems').put({
          id: ids[it.key], name: it.name, category: it.category, unit: it.unit, minQty: it.minQty,
          qty: 0, costPerUnit: 0, supplier: '', notes: '', active: true, ...meta,
        });
      }
      // Example recipes from the brief, only where the procedure has none yet.
      tx.objectStore('procedures').openCursor().onsuccess = (e) => {
        const cursor = /** @type {IDBCursorWithValue} */ (/** @type {IDBRequest} */ (e.target).result);
        if (!cursor) return;
        const seed = SEED_RECIPES[cursor.value.name];
        if (seed && !cursor.value.recipe?.length) {
          cursor.update({ ...cursor.value, recipe: seed.map(([key, qty, per]) => ({ itemId: ids[key], qty, per })) });
        }
        cursor.continue();
      };
    },
  },
  {
    version: 8,
    description: 'Follow-ups, instruction templates, medicines, prescription templates, prescriptions; seeds',
    up(db, tx) {
      db.createObjectStore('instructionTemplates', { keyPath: 'id' });
      const fu = db.createObjectStore('followUps', { keyPath: 'id' });
      fu.createIndex('dueDate', 'dueDate');
      fu.createIndex('patientId', 'patientId');
      fu.createIndex('treatmentItemId', 'treatmentItemId');
      db.createObjectStore('medicines', { keyPath: 'id' });
      db.createObjectStore('rxTemplates', { keyPath: 'id' });
      const rx = db.createObjectStore('prescriptions', { keyPath: 'id' });
      rx.createIndex('patientId', 'patientId');
      rx.createIndex('date', 'date');

      const t = new Date().toISOString();
      const meta = { createdAt: t, updatedAt: t, createdBy: null, updatedBy: null };
      for (const tpl of SEED_INSTRUCTIONS) tx.objectStore('instructionTemplates').put({ ...tpl, active: true, ...meta });
      for (const m of SEED_MEDICINES) tx.objectStore('medicines').put({ strength: '', notes: '', ...m, active: true, ...meta });
      const meds = Object.fromEntries(SEED_MEDICINES.map((m) => [m.id, m]));
      for (const r of SEED_RX_TEMPLATES) {
        tx.objectStore('rxTemplates').put({
          id: r.id, name: r.name, active: true, ...meta,
          lines: r.meds.map((id) => ({ medicineId: id, name: meds[id].name, form: meds[id].form, dose: meds[id].dose, duration: meds[id].duration, notes: meds[id].notes ?? '' })),
        });
      }
      // Default instructions + follow-up schedule for existing procedures that have none.
      // On a fresh install the v4/v7 cursors are still updating these records in the same
      // transaction, so a cursor value can be stale: re-read each record before writing it.
      // Also repairs chartEffect, which the v7 cursor could overwrite the same way.
      const procs = tx.objectStore('procedures');
      procs.openCursor().onsuccess = (e) => {
        const cursor = /** @type {IDBCursorWithValue} */ (/** @type {IDBRequest} */ (e.target).result);
        if (!cursor) return;
        procs.get(cursor.primaryKey).onsuccess = (g) => {
          const p = /** @type {IDBRequest} */ (g.target).result;
          procs.put({
            ...p,
            chartEffect: p.chartEffect ?? inferChartEffect(p.name),
            instructionTemplateId: p.instructionTemplateId ?? instructionFor(p.name),
            followUpSchedule: p.followUpSchedule?.length ? p.followUpSchedule : scheduleFor(p.name),
          });
        };
        cursor.continue();
      };
    },
  },
  {
    version: 9,
    description: 'Orthodontic and implant case files with their follow-up visits',
    up(db) {
      const cases = db.createObjectStore('cases', { keyPath: 'id' });
      cases.createIndex('patientId', 'patientId');
      cases.createIndex('type', 'type');
      const visits = db.createObjectStore('caseVisits', { keyPath: 'id' });
      visits.createIndex('caseId', 'caseId');
      visits.createIndex('patientId', 'patientId');
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * When each store added after cloud sync went live first shipped (no data can be older).
 * A device that synced before updating skipped these rows; it reads them again from here.
 * Add every new store to this list.
 */
export const STORE_ADDED_AT = { cases: '2026-10-30T00:00:00Z', caseVisits: '2026-10-30T00:00:00Z' };
