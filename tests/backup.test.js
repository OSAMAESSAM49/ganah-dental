import { describe, test, assert } from './runner.js';
import { planMerge } from '../js/services/backup.js';

describe('merge import (pure)', () => {
  const local = {
    patients: [{ id: 'p1', fileNo: 'G-00001', name: 'سارة', updatedAt: '2026-10-01' }, { id: 'p2', fileNo: 'G-00002', name: 'محمد', updatedAt: '2026-10-05' }],
    invoices: [{ id: 'i1', number: 1, updatedAt: '2026-10-01' }],
    users: [{ id: 'u1', username: 'admin', updatedAt: '2026-01-01' }],
    roles: [{ id: 'admin' }],
    appointments: [],
  };
  const incoming = {
    patients: [
      { id: 'p1', fileNo: 'G-00001', name: 'سارة أحمد', updatedAt: '2026-10-03' }, // newer → update
      { id: 'p2', fileNo: 'G-00002', name: 'قديم', updatedAt: '2026-10-01' },       // older → keep local
      { id: 'p9', fileNo: 'G-00002', name: 'مريض الجهاز الآخر', updatedAt: '2026-10-04' }, // new, number clash
      { id: 'p8', fileNo: 'G-00007', name: 'جديد', updatedAt: '2026-10-04' },        // new, free number
    ],
    invoices: [{ id: 'i7', number: 1, updatedAt: '2026-10-02' }],
    users: [{ id: 'u1', username: 'admin', role: 'hacked', updatedAt: '2027-01-01' }, { id: 'u2', username: 'admin', updatedAt: '2026-01-01' }, { id: 'u3', username: 'reception' }],
    roles: [{ id: 'admin', changed: true }, { id: 'custom' }],
    appointments: [{ id: 'a1', date: '2026-10-10' }],
    meta: [{ key: 'counter.invoiceNo', value: 99 }],
  };
  const { writes, summary, counters } = planMerge(local, incoming, { patientFileNo: 2, invoiceNo: 1 });
  test('newest wins; older incoming is skipped', () => {
    assert.equal(writes.patients.find((p) => p.id === 'p1').name, 'سارة أحمد');
    assert.ok(!writes.patients.some((p) => p.id === 'p2'));
    assert.deepEqual(summary.patients, { added: 2, updated: 1, kept: 1, renumbered: 1 });
  });
  test('clashing numbers on new records are renumbered after the highest one', () => {
    assert.equal(writes.patients.find((p) => p.id === 'p9').fileNo, 'G-00008');
    assert.equal(writes.patients.find((p) => p.id === 'p8').fileNo, 'G-00007');
    assert.ok(writes.patients.find((p) => p.id === 'p9').searchText.includes('8'), 'search text rebuilt');
    assert.equal(writes.invoices[0].number, 2);
    assert.equal(counters.patientFileNo, 8);
    assert.equal(counters.invoiceNo, 2);
  });
  test('accounts are only added, never overwritten; meta/settings untouched', () => {
    assert.deepEqual(writes.users.map((u) => u.id), ['u3']);
    assert.deepEqual(writes.roles.map((r) => r.id), ['custom']);
    assert.ok(!writes.meta);
    assert.equal(writes.appointments.length, 1);
  });
});

describe('backup zip & demo data (temporary database)', () => {
  test('zip round-trip keeps images; demo data creates and removes cleanly', async () => {
    const { initData, repos, getAdapter } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { loadSettings } = await import('../js/data/settings.js');
    const backup = await import('../js/services/backup.js');
    const demo = await import('../js/services/demo.js');
    const reports = await import('../js/services/reports.js');
    const { todayISO } = await import('../js/core/format.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      await loadSettings();
      // A real patient and an image, before the demo.
      const { createPatient } = await import('../js/services/patients.js');
      const real = await createPatient({ name: 'مريض حقيقي', phone: '01011111111' });
      await repos.users.create({ username: 'admin', displayName: 'د. تجربة', roleId: 'admin', active: true, isDoctor: true });
      const img = new Blob([new Uint8Array([255, 216, 255, 1, 2, 3])], { type: 'image/jpeg' });
      await repos.media.create({ patientId: real.id, kind: 'photo', blob: img, thumb: img });

      const { blob } = await backup.buildBackupZip();
      const parsed = backup.parseBackupZip(new Uint8Array(await blob.arrayBuffer()));
      assert.equal(parsed.preview.counts.media, 1);
      assert.equal(parsed.backup.format, 2);
      assert.equal(parsed.files.size, 2, 'blob and thumb stored as files');
      const media = backup.decodeValue(parsed.backup.stores.media[0], parsed.files);
      assert.deepEqual([...new Uint8Array(await media.blob.arrayBuffer())], [255, 216, 255, 1, 2, 3]);
      assert.equal(media.thumb.type, 'image/jpeg');

      // Demo data
      const n = await demo.createDemoData();
      assert.equal(n, 36);
      assert.equal((await demo.demoStatus()).patients, 36);
      const t = await reports.treatmentsReport('2000-01-01', todayISO());
      assert.ok(t.count > 20, 'completed treatments');
      const f = await reports.financialReport('2000-01-01', todayISO());
      assert.ok(f.collections > 0 && f.expenses > 0);
      assert.ok((await repos.invoices.list()).length > 10);

      await demo.removeDemoData();
      assert.equal((await demo.demoStatus()).patients, 0);
      const a = getAdapter();
      for (const s of ['appointments', 'invoices', 'payments', 'treatmentItems', 'followUps', 'prescriptions', 'labCases', 'stockBatches', 'stockMovements', 'expenses']) {
        assert.equal((await a.list(s)).length, 0, `${s} emptied`);
      }
      assert.equal((await a.list('patients')).length, 1, 'real patient kept');
      assert.equal((await a.list('media')).length, 1, 'real image kept');
      assert.equal(await repos.meta.get('counter.patientFileNo'), 1, 'numbering continues after the real patient');
      assert.equal(await repos.meta.get('counter.invoiceNo'), 0);
      assert.ok((await repos.inventoryItems.list()).every((i) => i.qty === 0), 'stock back to zero');
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
