import { describe, test, assert } from './runner.js';
import { monthsBetween } from '../js/services/expenses.js';
import { recipeCost, stockStatus, round3 } from '../js/services/inventory.js';

describe('inventory & expenses (pure)', () => {
  test('stock status and rounding', () => {
    assert.equal(stockStatus({ qty: 0, minQty: 5 }), 'out');
    assert.equal(stockStatus({ qty: 3, minQty: 5 }), 'low');
    assert.equal(stockStatus({ qty: 9, minQty: 5 }), 'ok');
    assert.equal(stockStatus({ qty: -1, minQty: 5 }), 'negative');
    assert.equal(round3(0.1 + 0.2), 0.3);
  });
  test('recipe cost from average unit costs', () => {
    const items = new Map([['c', { costPerUnit: 2500 }], ['b', { costPerUnit: 40 }]]);
    assert.equal(recipeCost([{ itemId: 'c', qty: 0.3 }, { itemId: 'b', qty: 1 }], items), 790);
  });
  test('monthsBetween spans years', () => {
    assert.deepEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.deepEqual(monthsBetween('2026-05', '2026-05'), ['2026-05']);
  });
});

describe('inventory flow (temporary database)', () => {
  test('receive → FEFO consumption on done (edited qty) → return on undo; recurring & lab expenses', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const inv = await import('../js/services/inventory.js');
    const treatment = await import('../js/services/treatment.js');
    const expenses = await import('../js/services/expenses.js');
    const labs = await import('../js/services/labs.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      const composite = (await inv.listItems()).find((i) => i.name === 'كمبوزيت');
      assert.ok(composite, 'seeded item exists');
      await inv.receiveStock({ itemId: composite.id, qty: 4, unitCost: 3000, expiry: '2027-06-01', batchNo: 'B-late', createExpense: true });
      await inv.receiveStock({ itemId: composite.id, qty: 2, unitCost: 2000, expiry: '2026-12-01', batchNo: 'B-early' });
      let item = await repos.inventoryItems.get(composite.id);
      assert.equal(item.qty, 6);
      assert.equal(Math.round(item.costPerUnit), 2667, 'weighted average');
      assert.equal((await expenses.listExpenses('2000-01-01', '2100-01-01')).filter((e) => e.source === 'inventory')[0].amount, 12000);

      // Procedure "حشو تجميلي عالي الجودة" has the seeded recipe (composite 0.3 g …)
      const proc = (await repos.procedures.list()).find((p) => p.name === 'حشو تجميلي عالي الجودة');
      assert.ok(proc.recipe.length >= 4, 'seed recipe applied');
      const patient = await repos.patients.create({ name: 'مريض مخزون', fileNo: 'G-88888', searchText: '' });
      const plan = await repos.treatmentPlans.create({ patientId: patient.id, name: 'خطة', status: 'active' });
      const [ti] = await treatment.addItems(plan.id, { procedure: proc, teeth: [16], surfaces: ['O'] });
      const preview = await inv.stockPreview(ti);
      assert.equal(preview.find((l) => l.itemId === composite.id).qty, 0.3);

      // Done with an edited quantity (2.5 g) → takes 2 g from the early-expiry batch first
      await treatment.setItemStatus(ti.id, 'done', { consumption: [{ itemId: composite.id, qty: 2.5 }] });
      item = await repos.inventoryItems.get(composite.id);
      assert.equal(item.qty, 3.5);
      const batches = await inv.batchesFor(composite.id, { withEmpty: true });
      assert.deepEqual(batches.map((b) => [b.batchNo, b.qty]), [['B-early', 0], ['B-late', 3.5]]);
      assert.equal(await inv.actualMaterialCost(ti.id), 2 * 2000 + 0.5 * 3000);

      // Undo → materials return to the same batches
      await treatment.setItemStatus(ti.id, 'planned');
      item = await repos.inventoryItems.get(composite.id);
      assert.equal(item.qty, 6);
      assert.equal(await inv.actualMaterialCost(ti.id), 0);

      // Shortfall goes negative instead of failing
      await inv.adjustStock({ itemId: composite.id, delta: -7, reason: 'جرد' });
      assert.equal((await repos.inventoryItems.get(composite.id)).qty, -1);
      assert.equal(inv.stockStatus(await repos.inventoryItems.get(composite.id)), 'negative');

      // Recurring expense: started 3 months ago → 3 or 4 entries (depending on day), idempotent
      const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth() - 3, 1);
      await expenses.createRecurring({ categoryId: 'rent', amount: 500000, description: 'إيجار', dayOfMonth: 1, startMonth: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}` });
      const n1 = (await repos.expenses.list()).filter((e) => e.source === 'recurring').length;
      await expenses.generateRecurringExpenses();
      const n2 = (await repos.expenses.list()).filter((e) => e.source === 'recurring').length;
      assert.equal(n1, 4);
      assert.equal(n2, 4, 'no duplicates');

      // Lab case cost ↔ expense sync
      const lc = await labs.createLabCase({ patientId: patient.id, patientName: patient.name, labName: 'معمل النور', workType: 'crown', cost: 60000 });
      assert.equal((await expenses.expenseFor(lc.id)).amount, 60000);
      await labs.updateLabCase(lc.id, { cost: 75000 });
      assert.equal((await expenses.expenseFor(lc.id)).amount, 75000);
      await labs.setLabStatus(lc.id, 'try_in');
      const after = await repos.labCases.get(lc.id);
      assert.ok(after.receivedAt && after.tryInAt && !after.cementedAt);
      await labs.setLabStatus(lc.id, 'cancelled');
      assert.equal(await expenses.expenseFor(lc.id), null, 'cancelled case removes its expense');
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
