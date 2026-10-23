import { describe, test, assert } from './runner.js';
import { monthKeys, presetRange, bucketsFor, change } from '../js/services/reports.js';
import { niceMax, compact } from '../js/components/chart.js';
import { cellText } from '../js/components/export.js';

describe('reports & charts (pure)', () => {
  test('month and day buckets', () => {
    assert.deepEqual(monthKeys('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.equal(bucketsFor('2026-10-01', '2026-10-22').unit, 'day');
    assert.equal(bucketsFor('2026-10-01', '2026-10-22').keys.length, 22);
    assert.equal(bucketsFor('2026-01-01', '2026-10-22').unit, 'month');
    assert.equal(bucketsFor('2026-01-01', '2026-10-22').of('2026-03-09'), '2026-03');
  });
  test('preset periods', () => {
    assert.deepEqual(presetRange('month', '2026-10-22'), ['2026-10-01', '2026-10-22']);
    assert.deepEqual(presetRange('lastMonth', '2026-01-10'), ['2025-12-01', '2025-12-31']);
    assert.deepEqual(presetRange('lastMonth', '2024-03-05'), ['2024-02-01', '2024-02-29']);
    assert.deepEqual(presetRange('quarter', '2026-11-03'), ['2026-10-01', '2026-11-03']);
    assert.deepEqual(presetRange('last12', '2026-10-22'), ['2025-11-01', '2026-10-22']);
    assert.deepEqual(presetRange('week', '2026-10-22'), ['2026-10-17', '2026-10-22'], 'week starts Saturday');
  });
  test('chart scale, compact ticks, change', () => {
    assert.deepEqual(niceMax(395000), { max: 400000, step: 100000 });
    assert.deepEqual(niceMax(7), { max: 8, step: 2 });
    assert.deepEqual(niceMax(0), { max: 4, step: 1 });
    assert.equal(compact(2500), '2.5K');
    assert.equal(compact(1200000), '1.2M');
    assert.equal(change(0, 5), null);
    assert.equal(change(200, 250), 0.25);
  });
  test('export cell text by column type', () => {
    assert.equal(cellText({ key: 'a', type: 'money' }, { a: 125000 }), '1,250 ج.م');
    assert.equal(cellText({ key: 'd', type: 'date' }, { d: '2026-10-22' }), '22/10/2026');
    assert.equal(cellText({ key: 'x' }, {}), '—');
    assert.equal(cellText({ key: 'n', value: (r) => r.a * 2 }, { a: 2 }), '4');
  });
});

describe('reports (temporary database)', () => {
  test('finance, treatments and appointments aggregate the period only', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { loadSettings } = await import('../js/data/settings.js');
    const billing = await import('../js/services/billing.js');
    const expenses = await import('../js/services/expenses.js');
    const treatment = await import('../js/services/treatment.js');
    const reports = await import('../js/services/reports.js');
    const { todayISO } = await import('../js/core/format.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      await loadSettings();
      const today = todayISO();
      const patient = await repos.patients.create({ name: 'مريض تقارير', fileNo: 'G-66666', searchText: '', gender: 'female', referralSource: 'facebook' });
      await billing.recordPayment({ patientId: patient.id, amount: 50000, method: 'cash' });
      await billing.recordPayment({ patientId: patient.id, amount: 20000, method: 'instapay' });
      await billing.recordPayment({ patientId: patient.id, amount: 99900, method: 'cash', date: '2001-01-01' });
      const voided = await billing.recordPayment({ patientId: patient.id, amount: 1000, method: 'card' });
      await billing.voidPayment(voided.id, 'خطأ');
      await expenses.createExpense({ categoryId: 'rent', amount: 30000, description: 'إيجار', date: today });

      const f = await reports.financialReport(today.slice(0, 8) + '01', today);
      assert.equal(f.collections, 70000, 'void and out-of-period payments excluded');
      assert.equal(f.expenses, 30000);
      assert.equal(f.net, 40000);
      assert.deepEqual(f.byMethod.map((m) => [m.method, m.amount]), [['cash', 50000], ['instapay', 20000]]);
      assert.equal(f.series.reduce((n, s) => n + s.income, 0), 70000);

      const proc = (await repos.procedures.list()).find((p) => p.name === 'كشف');
      const plan = await repos.treatmentPlans.create({ patientId: patient.id, name: 'خطة', status: 'active' });
      const [ti] = await treatment.addItems(plan.id, { procedure: proc, unitPrice: 15000 });
      await treatment.setItemStatus(ti.id, 'done');
      const t = await reports.treatmentsReport(today, today);
      assert.equal(t.count, 1);
      assert.equal(t.value, 15000);
      assert.equal(t.byProcedure[0].name, 'كشف');

      const p = await reports.patientsReport(today, today);
      assert.equal(p.newCount, 1);
      assert.equal(p.bySource[0].key, 'facebook');

      const k = await reports.dashboardKpis(today);
      assert.equal(k.current.collections, 70000);
      assert.equal(k.trend.length, 12);
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});

describe('cloud usage estimate (pure)', () => {
  test('free space → roughly how many more patients fit', async () => {
    const { summarizeUsage, FREE_DB_BYTES } = await import('../js/components/cloud-usage.js');
    const u = summarizeUsage({ db_bytes: 11818675, patients: 2, records: 265, records_bytes: 230056, storage_bytes: 0 });
    assert.equal(u.perPatient, 80 * 1024, 'few patients → default 80 KB each');
    assert.equal(u.morePatients, Math.floor((FREE_DB_BYTES - 11818675) / (80 * 1024)));
    assert.ok(u.dbPct > 0.02 && u.dbPct < 0.03);
    // A clinic with its own history uses its real average when it is larger.
    const big = summarizeUsage({ db_bytes: 300 * 1024 * 1024, patients: 2000, records: 90000, records_bytes: 200 * 1024 * 1024, storage_bytes: 0 });
    assert.equal(big.perPatient, Math.round((200 * 1024 * 1024 * 1.4) / 2000));
    assert.equal(summarizeUsage({ db_bytes: FREE_DB_BYTES + 5, patients: 1, records: 1, records_bytes: 1, storage_bytes: 0 }).morePatients, 0, 'never negative');
  });
});
