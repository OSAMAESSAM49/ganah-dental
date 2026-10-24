import { describe, test, assert } from './runner.js';

describe('full patient archive (temporary database)', () => {
  test('admin only; every record linked to its patient with totals', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { loadSettings } = await import('../js/data/settings.js');
    const { getSession, setSession, clearSession } = await import('../js/core/session.js');
    const { fullMatrix } = await import('../js/core/permissions.js');
    const { collectArchive, medicalText } = await import('../js/services/patient-archive.js');
    const patients = await import('../js/services/patients.js');
    const treatment = await import('../js/services/treatment.js');
    const billing = await import('../js/services/billing.js');
    const rx = await import('../js/services/prescriptions.js');
    const saved = getSession();
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    const as = (roleId) => setSession({ user: { id: `u-${roleId}`, displayName: roleId, roleId }, role: { id: roleId }, permissions: fullMatrix() });
    try {
      await loadSettings();
      as('admin');
      const p = await patients.createPatient({ name: 'مريض الأرشيف', phone: '01055555555', gender: 'female', medical: { items: { allergyPenicillin: true, diabetes: true } } });
      const other = await patients.createPatient({ name: 'مريض آخر' });
      await repos.appointments.create({ patientId: p.id, patientName: p.name, date: '2026-10-20', startMin: 600, duration: 30, status: 'done', procedureNames: ['كشف'], clinicalNotes: 'لا شيء' });
      const proc = (await repos.procedures.list()).find((x) => x.name === 'كشف');
      const [ti] = await treatment.addItems((await treatment.ensureActivePlan(p.id)).id, { procedure: proc, unitPrice: 40000 });
      await treatment.setItemStatus(ti.id, 'done');
      await billing.createInvoice({ patientId: p.id, itemIds: [ti.id], payNow: { amount: 15000, method: 'cash' } });
      await rx.createPrescription({ patientId: p.id, lines: [{ name: 'Paracetamol 500 mg', dose: 'قرصان', duration: '3 أيام' }] });

      as('reception');
      let refused = false;
      try { await collectArchive(); } catch { refused = true; }
      assert.ok(refused, 'non-admin cannot export');

      as('admin');
      const a = await collectArchive();
      assert.equal(a.patients.length, 2);
      const row = a.patients.find((x) => x.id === p.id);
      assert.equal(row.billed, 40000);
      assert.equal(row.paid, 15000);
      assert.equal(row.balance, 25000);
      assert.equal(row.appointmentsCount, 1);
      assert.equal(row.lastVisit, '2026-10-20');
      assert.ok(row.medicalText.includes('البنسلين') && row.medicalText.includes('سكري'));
      assert.equal(a.appointments[0].fileNo, p.fileNo, 'rows carry the file number');
      assert.equal(a.treatments[0].total, 40000);
      assert.ok(a.treatments[0].invoiceNo > 0);
      assert.equal(a.invoices[0].remaining, 25000);
      assert.equal(a.payments[0].patientName, 'مريض الأرشيف');
      assert.equal(a.prescriptions.length, 1);
      assert.equal(medicalText({ gender: 'male', medical: { items: { pregnancy: true } } }), '', 'pregnancy ignored for men');

      await patients.deletePatient(other.id);
      assert.equal((await collectArchive()).patients.length, 1, 'trash excluded by default');
      assert.equal((await collectArchive({ includeDeleted: true })).patients.length, 2);
    } finally {
      if (saved) setSession(saved); else clearSession();
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
