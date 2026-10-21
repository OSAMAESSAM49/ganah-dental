import { describe, test, assert } from './runner.js';
import { fillMessage, buildFollowUps, describeSchedule } from '../js/services/followups.js';
import { rxWarnings, formatRxNo, doctorLabel } from '../js/services/prescriptions.js';
import { scheduleFor, instructionFor } from '../js/data/seed-rx.js';
import { daysBetween } from '../js/core/time.js';

describe('follow-ups & prescriptions (pure)', () => {
  test('message placeholders: known replaced, unknown kept', () => {
    assert.equal(fillMessage('مرحبًا {الاسم} من {العيادة} {غير}', { 'الاسم': 'سارة', 'العيادة': 'جنة' }), 'مرحبًا سارة من جنة {غير}');
  });
  test('follow-ups from a schedule get due dates from the done day', () => {
    const item = { id: 't1', patientId: 'p1', procedureName: 'خلع جراحي' };
    const out = buildFollowUps(item, [{ offsetDays: 1, type: 'call', note: 'a' }, { offsetDays: 7, type: 'check' }, { offsetDays: 3, type: 'bogus' }], '2026-12-30', 'سارة');
    assert.deepEqual(out.map((f) => [f.type, f.dueDate, f.status]), [['call', '2026-12-31', 'pending'], ['check', '2027-01-06', 'pending']]);
    assert.equal(out[0].patientName, 'سارة');
    assert.equal(out[0].treatmentItemId, 't1');
  });
  test('seed schedules and instruction mapping', () => {
    assert.deepEqual(scheduleFor('خلع جراحي').map((s) => s.offsetDays), [1, 7]);
    assert.deepEqual(scheduleFor('خلع عادي').map((s) => s.type), ['call']);
    assert.deepEqual(scheduleFor('استشارة'), []);
    assert.equal(instructionFor('حشو عصب ضرس'), 'tpl-rct');
    assert.equal(instructionFor('زراعة سن'), 'tpl-surgery');
    assert.equal(describeSchedule([{ offsetDays: 1, type: 'call' }, { offsetDays: 180, type: 'recall' }]), 'اتصال بعد يوم، استدعاء بعد 6 أشهر');
    assert.equal(daysBetween('2026-12-30', '2027-01-02'), 3);
  });
  test('prescription warnings vs medical history', () => {
    const meds = new Map([
      ['amox', { groups: ['penicillin'] }], ['ibu', { groups: ['nsaid'] }], ['metro', { groups: ['pregnancy'] }], ['para', { groups: [] }],
    ]);
    const lines = [{ medicineId: 'amox', name: 'Amoxicillin 500 mg' }, { medicineId: 'ibu', name: 'Ibuprofen 400 mg' }, { medicineId: 'para', name: 'Paracetamol 500 mg' }];
    const patient = { gender: 'female', medical: { items: { allergyPenicillin: true, kidneyDisease: true }, allergyOther: '' } };
    const w = rxWarnings(patient, lines, meds);
    assert.deepEqual(w.map((x) => [x.line, x.level]), [['Amoxicillin 500 mg', 'critical'], ['Ibuprofen 400 mg', 'caution']]);
    assert.equal(rxWarnings({ medical: { items: {} } }, lines, meds).length, 0);
    // Pregnancy ignored for male patients; free-text allergy matches the drug name
    const male = { gender: 'male', medical: { items: { pregnancy: true }, allergyOther: 'paracetamol' } };
    assert.deepEqual(rxWarnings(male, [...lines, { medicineId: 'metro', name: 'Metronidazole' }], meds).map((x) => x.line), ['Paracetamol 500 mg']);
    assert.equal(formatRxNo(7), 'Rx-0007');
    assert.equal(doctorLabel({ title: 'د.', displayName: 'د. أحمد محمود' }), 'د. أحمد محمود');
    assert.equal(doctorLabel({ title: 'د.', displayName: 'أحمد محمود' }), 'د. أحمد محمود');
  });
});

describe('follow-ups flow (temporary database)', () => {
  test('done creates follow-ups from the procedure schedule; undo removes pending ones; rx numbering', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { loadSettings } = await import('../js/data/settings.js');
    const treatment = await import('../js/services/treatment.js');
    const fu = await import('../js/services/followups.js');
    const rx = await import('../js/services/prescriptions.js');
    const { todayISO } = await import('../js/core/format.js');
    const { addDays } = await import('../js/core/time.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      await loadSettings();
      // v8 seeds
      assert.ok((await repos.instructionTemplates.list()).length >= 7, 'instruction templates seeded');
      assert.ok((await rx.listMedicines()).length >= 10, 'medicines seeded');
      const proc = (await repos.procedures.list()).find((p) => /خلع جراحي/.test(p.name));
      assert.ok(proc, 'surgical extraction exists');
      assert.equal(proc.instructionTemplateId, 'tpl-surgery');
      assert.deepEqual(proc.followUpSchedule.map((s) => s.offsetDays), [1, 7]);
      // Fresh install: the v4/v7/v8 backfills on procedures must not overwrite each other.
      const filling = (await repos.procedures.list()).find((p) => p.name === 'حشو تجميلي عالي الجودة');
      assert.ok(filling.recipe.length >= 4, 'v7 recipe kept');
      assert.ok(filling.chartEffect, 'v4 chart effect kept');
      assert.equal(filling.instructionTemplateId, 'tpl-filling');

      const patient = await repos.patients.create({ name: 'سارة أحمد', fileNo: 'G-77777', phone: '01012345678', searchText: '', medical: { items: { allergyPenicillin: true } } });
      const plan = await repos.treatmentPlans.create({ patientId: patient.id, name: 'خطة', status: 'active' });
      const [ti] = await treatment.addItems(plan.id, { procedure: proc, teeth: [38] });
      const effects = await treatment.describeDone(ti);
      assert.ok(effects.some((e) => e.includes('جدولة المتابعة')), 'confirmation lists the follow-ups');

      await treatment.setItemStatus(ti.id, 'done');
      let list = await fu.followUpsForPatient(patient.id);
      assert.deepEqual(list.map((f) => f.dueDate).sort(), [addDays(todayISO(), 1), addDays(todayISO(), 7)]);
      assert.equal(list[0].patientName, 'سارة أحمد');

      // WhatsApp texts
      const call = list.find((f) => f.type === 'call');
      const msg = await fu.followUpMessage(call);
      assert.ok(msg.text.startsWith('مرحبًا سارة'), 'first name used');
      assert.ok(msg.link.startsWith('https://wa.me/201012345678?text='));
      const ins = await fu.instructionsMessage(ti);
      assert.ok(ins.text.includes('الكمادات الباردة'), 'surgery instructions included');

      // Complete one, then undo the treatment: only the pending one is removed
      await fu.completeFollowUp(call.id, 'الحالة مستقرة');
      assert.deepEqual(await fu.followUpCounts(addDays(todayISO(), 7)), { today: 1, overdue: 0 });
      await treatment.setItemStatus(ti.id, 'planned');
      list = await fu.followUpsForPatient(patient.id);
      assert.deepEqual(list.map((f) => [f.type, f.status]), [['call', 'done']]);

      // Snooze from an overdue date counts from today
      const manual = await fu.createFollowUp({ patientId: patient.id, patientName: patient.name, type: 'recall', dueDate: addDays(todayISO(), -5) });
      assert.equal((await fu.snoozeFollowUp(manual.id, 3)).dueDate, addDays(todayISO(), 3));

      // Custom message text
      await fu.saveMessages({ call: 'أهلًا {الاسم_الكامل}' });
      assert.equal((await fu.followUpMessage(call)).text, 'أهلًا سارة أحمد');

      // Prescriptions: numbered, lines cleaned, warnings from the seeded groups
      const tpl = (await rx.listRxTemplates()).find((t) => t.id === 'rx-extraction');
      const meds = new Map((await rx.listMedicines()).map((m) => [m.id, m]));
      const warnings = rx.rxWarnings(await repos.patients.get(patient.id), tpl.lines, meds);
      assert.ok(warnings.some((w) => w.level === 'critical' && /Augmentin/.test(w.line)), 'penicillin allergy flagged');
      const r1 = await rx.createPrescription({ patientId: patient.id, lines: [...tpl.lines, { name: '  ' }], doctorName: 'د. أحمد' });
      const r2 = await rx.createPrescription({ patientId: patient.id, lines: [{ name: 'Paracetamol 500 mg', dose: 'قرصان' }] });
      assert.equal(r1.number, 1);
      assert.equal(r2.number, 2);
      assert.equal(r1.lines.length, 3, 'blank lines dropped');
      assert.equal(r1.patientName, 'سارة أحمد');
      assert.deepEqual((await rx.prescriptionsForPatient(patient.id)).map((r) => r.number), [2, 1]);
      let failed = false;
      try { await rx.createPrescription({ patientId: patient.id, lines: [] }); } catch { failed = true; }
      assert.ok(failed, 'empty prescription rejected');
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
