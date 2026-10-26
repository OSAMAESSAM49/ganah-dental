import { describe, test, assert } from './runner.js';

describe('dashboard cards, ownership rules and day billing (temporary database)', () => {
  test('only Admin or the creator may void/edit invoices and change patients with invoices', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { loadSettings } = await import('../js/data/settings.js');
    const { getSession, setSession, clearSession } = await import('../js/core/session.js');
    const { fullMatrix } = await import('../js/core/permissions.js');
    const { cardVisible } = await import('../js/core/dashboard-cards.js');
    const billing = await import('../js/services/billing.js');
    const patients = await import('../js/services/patients.js');
    const treatment = await import('../js/services/treatment.js');
    const { todayISO } = await import('../js/core/format.js');
    const { repoHooks } = await import('../js/data/repository.js');
    const savedActor = repoHooks.actor;
    repoHooks.actor = () => getSession()?.user?.id ?? null; // records remember who created them
    const saved = getSession();
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    const as = (id, roleId = 'reception') => setSession({ user: { id, displayName: id, roleId }, role: { id: roleId }, permissions: fullMatrix(), startedAt: new Date().toISOString() });
    try {
      await loadSettings();
      // Reception user A registers a patient and bills them.
      as('user-a');
      const p = await patients.createPatient({ name: 'مريض فواتير', phone: '01012121212' });
      const proc = (await repos.procedures.list()).find((x) => x.name === 'كشف');
      const plan = await treatment.ensureActivePlan(p.id);
      const [ti] = await treatment.addItems(plan.id, { procedure: proc, unitPrice: 30000 });
      await treatment.setItemStatus(ti.id, 'done');

      // Before invoicing: the day's card shows a new charge waiting for an invoice.
      let day = await billing.dayBilling(todayISO());
      assert.equal(day.uninvoiced.length, 1);
      assert.equal(day.uninvoiced[0].value, 30000);
      assert.equal(day.due, 1);

      const { invoice } = await billing.createInvoice({ patientId: p.id, itemIds: [ti.id], payNow: { amount: 10000, method: 'cash' } });
      day = await billing.dayBilling(todayISO());
      assert.equal(day.uninvoiced.length, 0, 'invoiced items leave the "new charge" list');
      assert.equal(day.invoices[0].remaining, 20000);
      assert.equal(day.due, 1, 'partly paid invoice still needs collecting');

      // Another non-admin user (B) may not void, re-plan or edit/delete the patient.
      as('user-b');
      const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };
      assert.ok(await fails(() => billing.voidInvoice(invoice.id, 'خطأ')), 'B cannot void A\'s invoice');
      assert.ok(await fails(() => billing.setInstallments(invoice.id, [{ dueDate: '2030-01-01', amount: 20000 }])), 'B cannot edit A\'s invoice');
      const pay = (await repos.payments.findBy('invoiceId', invoice.id))[0];
      assert.ok(await fails(() => billing.voidPayment(pay.id, 'خطأ')), 'B cannot void A\'s receipt');
      assert.ok(await fails(() => patients.updatePatient(p.id, { name: 'تغيير' })), 'B cannot edit a patient with invoices');
      assert.ok(await fails(() => patients.deletePatient(p.id)), 'B cannot delete a patient with invoices');
      assert.equal(await patients.canChangePatient(await patients.getPatient(p.id)), false);
      // A patient without invoices stays editable by anyone with the permission.
      const other = await patients.createPatient({ name: 'بدون فواتير' });
      as('user-c');
      await patients.updatePatient(other.id, { name: 'بدون فواتير (معدّل)' });

      // The creator (A) and the Admin may.
      as('user-a');
      await patients.updatePatient(p.id, { name: 'مريض فواتير (معدّل)' });
      as('admin-1', 'admin');
      await billing.voidPayment(pay.id, 'إيصال مكرر');
      await billing.voidInvoice(invoice.id, 'خطأ في البنود');
      assert.equal((await repos.invoices.get(invoice.id)).status, 'void');

      // Dashboard cards: hidden by the Admin → not shown; no list → every permitted card.
      as('user-a');
      assert.equal(cardVisible('invoices', { dashboardCards: null }), true);
      assert.equal(cardVisible('invoices', { dashboardCards: ['appointments'] }), false);
      assert.equal(cardVisible('appointments', { dashboardCards: ['appointments'] }), true);
      setSession({ user: { id: 'n', roleId: 'nurse' }, role: { id: 'nurse' }, permissions: { appointments: { view: true } } });
      assert.equal(cardVisible('collections', null), false, 'no billing permission → no money cards');
    } finally {
      repoHooks.actor = savedActor;
      if (saved) setSession(saved); else clearSession();
      adapter.close();
      await deleteDatabase(name);
    }
  });
test('treatment is charged from the moment it starts', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { loadSettings } = await import('../js/data/settings.js');
    const billing = await import('../js/services/billing.js');
    const patients = await import('../js/services/patients.js');
    const treatment = await import('../js/services/treatment.js');
    const { todayISO } = await import('../js/core/format.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      await loadSettings();
      const p = await patients.createPatient({ name: 'مريض جاري', phone: '01013131313' });
      const proc = (await repos.procedures.list()).find((x) => x.name === 'كشف');
      const plan = await treatment.ensureActivePlan(p.id);
      const [ti] = await treatment.addItems(plan.id, { procedure: proc, unitPrice: 25000 });
      assert.equal((await billing.uninvoicedItems(p.id)).length, 0, 'planned work is not charged');

      await treatment.setItemStatus(ti.id, 'in_progress');
      assert.equal((await billing.uninvoicedItems(p.id)).length, 1, 'started work is charged');
      const day = await billing.dayBilling(todayISO());
      assert.equal(day.uninvoiced.length, 1);
      assert.equal(day.uninvoiced[0].value, 25000);

      await billing.createInvoice({ patientId: p.id, itemIds: [ti.id] });
      const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };
      assert.ok(await fails(() => treatment.setItemStatus(ti.id, 'planned')), 'invoiced work cannot go back to planned');
      assert.ok(await fails(() => treatment.updateItem(ti.id, { unitPrice: 1 })), 'invoiced price is locked');
      await treatment.setItemStatus(ti.id, 'done');
      assert.equal((await repos.treatmentItems.get(ti.id)).status, 'done', 'invoiced work can still be finished');
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
