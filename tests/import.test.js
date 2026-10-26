import { describe, test, assert } from './runner.js';

// Made-up rows shaped like Dentolize's Excel exports (wall-clock times stored as UTC dates).
const at = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const P10 = { 'المريض': 'سارة علي', 'رقم ملف المريض': '#10', 'رقم الهاتف': '+20 1012345678', 'تاريخ إنشاء المريض': at(2026, 1, 1, 17) };
const P11 = { 'المريض': 'منى علي', 'رقم ملف المريض': '#11', 'رقم الهاتف': '+20 01012345678', 'تاريخ إنشاء المريض': at(2026, 1, 2, 17) };
const appt = (p, start, status, extra = {}) => ({ '#': 1, ...p, 'ابدأ': start, 'إنهاء': new Date(+start + 30 * 60000), 'الحالة': status, 'النوع': 'كشف', 'طبيب': 'Dr Test', 'تم الإنشاء': at(2026, 1, 1, 12), 'تم الإنشاء بواسطة': 'Reception', ...extra });
const sheets = () => ({
  appointments: [
    appt(P10, at(2026, 1, 5, 18, 20), 'محجوز'),
    appt(P10, at(2099, 1, 1, 17), 'محجوز'),
    appt(P11, at(2026, 1, 6, 19), 'ملغي', { 'سبب الإلغاء': 'ظرف طارئ' }),
    appt(P10, at(2026, 1, 5, 18, 20), 'محجوز'), // the same row again (overlapping export files)
  ],
  patients: [
    { '#': 1, 'الإسم الأول': 'سارة', 'إسم العائلة': 'علي', 'آخر موعد Date': at(2099, 1, 1, 17) },
    { '#': 2, 'الإسم الأول': 'هند', 'إسم العائلة': 'سمير', 'الهاتف الثاني': '01198765432' },
  ],
  invoices: [
    { '#': 1, ...P10, 'رقم الملف': 5, 'المجموع': 600, 'خصم': 0, 'المطلوب دفعه': 100, 'المجموع الفرعي': 650, 'تم الإنشاء': at(2026, 1, 5, 18, 40), 'تم الإنشاء بواسطة': 'Dr Test' },
    { '#': null, 'الإجراءات العلاجية': 'حشو عصب', 'سن': 'UL6', 'Procedure Quantity': 1, 'Procedure Price': 650, 'Procedure Discount': 0, 'Net Price': 650 },
    { '#': 2, ...P11, 'رقم الملف': 6, 'المجموع': 300, 'خصم': 0, 'المطلوب دفعه': 0, 'تم الإنشاء': at(2026, 1, 6, 19, 10) },
    { '#': null, 'الإجراءات العلاجية': 'تنظيف جير', 'سن': 'mouth', 'Procedure Quantity': 1, 'Procedure Price': 300, 'Procedure Discount': 0, 'Net Price': 300 },
    { '#': 'Total : 2', 'المجموع': 900 },
  ],
  payments: [
    { '#': 1, ...P10, 'فاتورة رقم الملف': '#5', 'المبلغ': 300, 'النوع': 'نقدي', 'مسترد': 'خطأ', 'تم الإنشاء': at(2026, 1, 5, 18, 45) },
    { '#': 2, ...P10, 'فاتورة رقم الملف': '#5', 'المبلغ': 200, 'النوع': 'محفظة الهاتف المحمول', 'مسترد': 'خطأ', 'تم الإنشاء': at(2026, 1, 5, 18, 46) },
    { '#': 3, ...P10, 'فاتورة رقم الملف': '#5', 'المبلغ': 100, 'النوع': 'نقدي', 'مسترد': 'صحيح', 'تم الإنشاء': at(2026, 1, 5, 18, 47) },
    { '#': 4, ...P11, 'فاتورة رقم الملف': '#6', 'المبلغ': 500, 'النوع': 'نقدي', 'مسترد': 'خطأ', 'تم الإنشاء': at(2026, 1, 6, 19, 20) },
  ],
  expenses: [
    { '#': 1, 'إسم': 'إيجار', 'النوع': 'المصروفات الشهرية', 'المبلغ': 4700, 'تاريخ': at(2026, 1, 15, 9), 'تم الإنشاء': at(2026, 1, 15, 9, 3) },
    { '#': 2, 'إسم': 'خامات', 'النوع': 'مواد خام', 'المبلغ': 0, 'تاريخ': at(2026, 1, 16, 9), 'تم الإنشاء': at(2026, 1, 16, 9) },
  ],
});
const people = { userFor: (n) => ({ id: n ? `u-${n}` : null, displayName: n || null }), doctorFor: () => 'doc-1' };
const empty = () => ({ patients: [], appointments: [], treatmentPlans: [], treatmentItems: [], invoices: [], payments: [], expenseCategories: [], expenses: [] });

describe('Dentolize import', () => {
  test('helpers: teeth, wall-clock times, statuses, phones, missing parts', async () => {
    const dz = await import('../js/services/dentolize-import.js');
    assert.deepEqual(dz.parseTeeth('UL6, LL7, UR1, LR8'), [26, 37, 11, 48]);
    assert.deepEqual(dz.parseTeeth('mouth'), []);
    assert.equal(dz.wallDate(at(2026, 1, 5, 18, 20)), '2026-01-05');
    assert.equal(dz.wallMinutes(at(2026, 1, 5, 18, 20)), 18 * 60 + 20);
    assert.equal(dz.wallToISO(at(2026, 1, 5, 18)), '2026-01-05T16:00:00.000Z', 'Cairo winter: UTC+2');
    assert.equal(dz.wallToISO(at(2026, 7, 1, 18)), '2026-07-01T15:00:00.000Z', 'Cairo summer: UTC+3');
    assert.equal(dz.appointmentStatus('محجوز', '2026-01-05', '2026-10-26'), 'done', 'past bookings never closed count as attended');
    assert.equal(dz.appointmentStatus('محجوز', '2026-11-01', '2026-10-26'), 'booked');
    assert.equal(dz.appointmentStatus('لم يتم الحضور', '2026-01-05', '2026-10-26'), 'no_show');
    assert.equal(dz.appointmentStatus('ملغي', '2026-01-05', '2026-10-26'), 'cancelled');
    assert.equal(dz.phoneOf('+20 1229376504'), '01229376504');
    assert.equal(dz.phoneOf('+20 01157422569'), '01157422569');
    assert.equal(dz.paymentMethod('محفظة الهاتف المحمول'), 'vodafone');
    assert.equal(dz.detectSheet(['#', 'المبلغ', 'فاتورة رقم الملف']), 'payments');
    assert.deepEqual(dz.missingParts([
      { type: 'appointments', total: 2500, from: 1, to: 1000 }, { type: 'appointments', total: 2500, from: 2001, to: 2500 },
    ]), [{ type: 'appointments', from: 1001, to: 2000 }]);
    assert.equal(dz.mixedExports([{ type: 'appointments', total: 2500, from: 1, to: 1000, file: 'a' }, { type: 'appointments', total: 2532, from: 1001, to: 2000, file: 'b' }]).length, 1);
  });

  test('plan: merge by phone + name, families stay apart, money matches Dentolize', async () => {
    const dz = await import('../js/services/dentolize-import.js');
    const existing = empty();
    existing.patients.push({ id: 'p-old', name: 'سارة علي', phone: '01012345678', fileNo: 'G-00001' });
    const plan = dz.planImport(sheets(), { ...people, today: '2026-10-26', existing, counters: { patientFileNo: 1, invoiceNo: 0, receiptNo: 0 } });
    const r = plan.report;
    assert.equal(r.patients.merged, 1, 'سارة (same phone and name) joins her existing file');
    assert.equal(r.patients.added, 2, 'منى shares the phone but is another person; هند has only a name');
    assert.equal(r.patients.nameOnly, 1);
    const mona = plan.writes.patients.find((p) => p.name === 'منى علي');
    assert.equal(mona.fileNo, 'G-00002');
    assert.equal(mona.legacyFileNo, '11');
    assert.equal(plan.writes.patients.find((p) => p.id === 'p-old').legacyFileNo, '10');

    assert.equal(r.appointments.added, 3, 'the repeated row is imported once');
    const ap = plan.writes.appointments;
    assert.deepEqual(ap.map((a) => a.status).sort(), ['booked', 'cancelled', 'done']);
    const first = ap.find((a) => a.date === '2026-01-05');
    assert.equal(first.startMin, 18 * 60 + 20);
    assert.equal(first.patientId, 'p-old');
    assert.equal(ap.find((a) => a.status === 'cancelled').cancelReason, 'ظرف طارئ');

    const inv5 = plan.writes.invoices.find((i) => i.notes.startsWith('Dentolize #5'));
    assert.equal(inv5.discountValue, 5000, 'Dentolize total (600) wins over the lines (650)');
    assert.deepEqual(inv5.lines[0].teeth, [26]);
    assert.equal(inv5.status, 'partial');
    assert.equal(r.invoices.total, r.invoices.dentolizeTotal);
    assert.equal(r.invoices.remaining, r.invoices.dentolizeRemaining);
    assert.equal(r.invoices.mismatches.length, 0);
    assert.equal(r.payments.voided, 1);
    assert.equal(r.payments.onAccount, 20000, 'paid 500 on a 300 invoice → 200 on account');
    assert.ok(plan.writes.payments.some((p) => p.invoiceId === null && p.amount === 20000));
    assert.equal(plan.writes.treatmentItems.length, 2);
    assert.equal(plan.writes.treatmentItems[0].status, 'done');
    assert.equal(r.expenses.added, 1, 'zero-amount expenses are skipped');
    assert.deepEqual(plan.counters, { patientFileNo: 3, invoiceNo: 2, receiptNo: 5 });
  });

  test('import writes everything once; importing again adds nothing', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { loadSettings } = await import('../js/data/settings.js');
    const dz = await import('../js/services/dentolize-import.js');
    const { searchPatients } = await import('../js/services/patients.js');
    const { patientAccount } = await import('../js/services/billing.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      await loadSettings();
      const ctx = async () => dz.importContext({ ...people, today: '2026-10-26' });
      const plan = dz.planImport(sheets(), await ctx());
      await dz.applyImport(plan);
      assert.equal((await repos.patients.list()).length, 3);
      assert.equal((await repos.appointments.list()).length, 3);
      const [mona] = await searchPatients('11');
      assert.equal(mona?.name, 'منى علي', 'the old Dentolize number finds the patient');
      const acc = await patientAccount(mona.id);
      assert.equal(acc.balance, -20000, 'overpaid 200 → credit');
      assert.equal(acc.credit, 20000);
      assert.equal(await repos.meta.get('counter.invoiceNo'), 2);

      const again = dz.planImport(sheets(), await ctx());
      assert.equal(Object.values(again.writes).reduce((n, w) => n + w.length, 0), 0, 'nothing to write the second time');
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
