import { describe, test, assert } from './runner.js';
import { archTeeth } from '../js/components/odontogram.js';
import { bracesMarkup } from '../js/components/odontogram-art.js';
import { chargedPerTooth } from '../js/services/treatment.js';
import { inferChartEffect } from '../js/core/chart-conditions.js';
import { suggestedDates } from '../js/services/cases.js';

describe('orthodontics and implants', () => {
  test('select all / one arch skips missing teeth', () => {
    const state = new Map([[18, { missing: { surfaces: [] } }], [38, { missing: { surfaces: [] } }]]);
    const all = archTeeth('adult', 'all', state);
    assert.equal(all.length, 30);
    assert.ok(!all.includes(18) && !all.includes(38));
    assert.equal(archTeeth('adult', 'upper', state).length, 15);
    assert.ok(archTeeth('adult', 'lower', state).every((t) => t >= 31 && t <= 48));
    assert.equal(archTeeth('primary', 'all', new Map()).length, 20);
  });
  test('a one-price procedure charges once however many teeth', () => {
    const teeth = archTeeth('adult', 'all', new Map());
    assert.equal(chargedPerTooth({ oncePerCase: true }, teeth), false);
    assert.equal(chargedPerTooth({}, teeth), true, 'several teeth of anything else: per tooth');
    assert.equal(chargedPerTooth({ perTooth: true, oncePerCase: true }, [11]), false);
  });
  test('braces: a bracket on each braced tooth, the wire only between neighbours', () => {
    const svg = bracesMarkup([{ x: 0, y: 0 }, { x: 10, y: 0 }, null, { x: 30, y: 0 }]);
    assert.equal((svg.match(/class="odo-bracket"/g) ?? []).length, 3);
    assert.equal((svg.match(/M/g) ?? []).length, 1, 'one wire segment: the gap breaks the wire');
    assert.equal(bracesMarkup([null, null]), '');
  });
  test('procedure names: bonding puts braces on the chart, debonding does not', () => {
    assert.equal(inferChartEffect('تركيب تقويم الفك العلوي'), 'braces');
    assert.equal(inferChartEffect('فك التقويم'), '');
    assert.equal(inferChartEffect('زراعة سن'), 'implant');
  });
  test('suggested implant dates', () => {
    assert.deepEqual(suggestedDates('2026-10-20', false), { sutureDate: '2026-10-30', loadingDate: '2027-01-18' });
    assert.equal(suggestedDates('2026-10-20', true).loadingDate, '2027-03-19');
    assert.deepEqual(suggestedDates('', true), { sutureDate: '', loadingDate: '' });
  });

  test('case files, visits and implant reminders (temporary database)', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const cases = await import('../js/services/cases.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    const reminders = async (id) => (await repos.followUps.list()).filter((f) => f.caseId === id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    try {
      const p = await repos.patients.create({ name: 'مريض زراعة', fileNo: 'G-00001', searchText: '' });
      const ortho = await cases.createCase(p.id, 'ortho', { startDate: '2026-10-01', malocclusion: 'II1', problems: ['crowding'] });
      assert.equal(ortho.startDate, '2026-10-01');
      assert.equal(ortho.plan.startDate, undefined, 'the start date is kept once, on the case');
      await cases.saveVisit(ortho.id, { date: '2026-10-01', data: { upperWire: 'NiTi 0.014' } });
      const v2 = await cases.saveVisit(ortho.id, { date: '2026-10-29', data: { upperWire: 'NiTi 0.016', nextWeeks: 4 } });
      await cases.saveVisit(ortho.id, { id: v2.id, date: '2026-10-29', data: { upperWire: 'NiTi 0.018' } });
      const visits = await cases.listVisits(ortho.id);
      assert.deepEqual(visits.map((v) => v.data.upperWire), ['NiTi 0.018', 'NiTi 0.014'], 'newest first, edit kept');
      assert.equal((await cases.openCasesSummary(p.id))[0].visits, 2);

      const imp = await cases.createCase(p.id, 'implant', { startDate: '2026-10-20', sutureDate: '2026-10-30', loadingDate: '2027-01-18', reminders: true });
      assert.deepEqual((await reminders(imp.id)).map((f) => [f.dueDate, f.caseReminder]), [['2026-10-30', 'sutures'], ['2027-01-18', 'prosthesis']]);
      await cases.updateCase(imp.id, { plan: { ...imp.plan, sutureDate: '2026-11-01' }, implants: [{ tooth: 36, brand: 'Straumann', graft: true }] });
      assert.equal((await reminders(imp.id))[0].dueDate, '2026-11-01', 'a pending reminder moves with its date');
      assert.ok((await repos.cases.get(imp.id)).implants[0].id, 'each implant gets an id');
      const [sutures] = await reminders(imp.id);
      await repos.followUps.update(sutures.id, { status: 'done' });
      await cases.updateCase(imp.id, { plan: { ...imp.plan, sutureDate: '2026-11-03', reminders: false } });
      assert.deepEqual((await reminders(imp.id)).map((f) => f.status), ['done'], 'reminders off: pending removed, done kept');

      await cases.deleteCase(ortho.id);
      assert.equal((await cases.listVisits(ortho.id)).length, 0, 'visits go with the case');
      assert.deepEqual((await cases.listCases(p.id)).map((c) => c.type), ['implant']);
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
