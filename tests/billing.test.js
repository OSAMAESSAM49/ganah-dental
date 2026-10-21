import { describe, test, assert } from './runner.js';
import { invoiceTotals, invoiceState, installmentsState, invoiceInstallments, splitInstallments, lineFromItem, formatInvoiceNo, formatReceiptNo } from '../js/services/billing.js';

describe('billing math', () => {
  test('invoice totals with amount and percent discounts', () => {
    const lines = [{ total: 80000 }, { total: 40000 }];
    assert.deepEqual(invoiceTotals({ lines }), { subtotal: 120000, discount: 0, total: 120000 });
    assert.deepEqual(invoiceTotals({ lines, discountType: 'percent', discountValue: 10 }), { subtotal: 120000, discount: 12000, total: 108000 });
    assert.deepEqual(invoiceTotals({ lines, discountType: 'amount', discountValue: 999999 }), { subtotal: 120000, discount: 120000, total: 0 });
  });
  test('invoice state: open → partial → paid, credit counts as paid, voided payments ignored', () => {
    const inv = { id: 'i1', lines: [{ total: 100000 }], appliedCredit: 0 };
    assert.equal(invoiceState(inv, []).status, 'open');
    assert.equal(invoiceState(inv, [{ invoiceId: 'i1', amount: 30000 }]).status, 'partial');
    assert.equal(invoiceState(inv, [{ invoiceId: 'i1', amount: 30000 }, { invoiceId: 'i1', amount: 70000, voided: true }]).remaining, 70000);
    assert.equal(invoiceState({ ...inv, appliedCredit: 20000 }, [{ invoiceId: 'i1', amount: 80000 }]).status, 'paid');
    assert.equal(invoiceState({ ...inv, status: 'void' }, []).status, 'void');
  });
  test('installments are covered in due-date order', () => {
    const plan = [{ id: 'b', dueDate: '2026-12-01', amount: 30000 }, { id: 'a', dueDate: '2026-11-01', amount: 30000 }, { id: 'c', dueDate: '2027-01-01', amount: 40000 }];
    const s = installmentsState(plan, 45000, '2026-12-15');
    assert.deepEqual(s.map((i) => [i.id, i.covered, i.status]), [['a', 30000, 'paid'], ['b', 15000, 'overdue'], ['c', 0, 'due']]);
  });
  test('a deposit paid outside the schedule does not cover installments', () => {
    const inv = { installments: [{ id: 'a', dueDate: '2026-11-21', amount: 40000 }, { id: 'b', dueDate: '2026-12-21', amount: 40000 }], installmentsBase: 40000 };
    assert.deepEqual(invoiceInstallments(inv, 40000, '2026-10-22').map((i) => i.status), ['due', 'due']);
    assert.deepEqual(invoiceInstallments(inv, 60000, '2026-10-22').map((i) => [i.status, i.covered]), [['partial', 20000], ['due', 0]]);
  });
  test('splitInstallments: whole pounds, remainder on the last, month-end safe', () => {
    const s = splitInstallments(100000, 3, '2026-01-31');
    assert.deepEqual(s.map((i) => i.amount), [33300, 33300, 33400]);
    assert.deepEqual(s.map((i) => i.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
    assert.equal(s.reduce((n, i) => n + i.amount, 0), 100000);
  });
  test('lines from treatment items keep item discounts; numbering', () => {
    const l = lineFromItem({ id: 't', procedureName: 'حشو', teeth: [16], unitPrice: 80000, qty: 1, discountType: 'percent', discountValue: 25 });
    assert.deepEqual([l.discount, l.total, l.treatmentItemId], [20000, 60000, 't']);
    assert.equal(formatInvoiceNo(7), 'INV-00007');
    assert.equal(formatReceiptNo(123), 'RC-00123');
  });
});

describe('billing flow (temporary database)', () => {
  test('invoice → pay now + installments → payment → void → balances', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const billing = await import('../js/services/billing.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      const patient = await repos.patients.create({ name: 'مريض اختبار', fileNo: 'G-99999', searchText: '' });
      const plan = await repos.treatmentPlans.create({ patientId: patient.id, name: 'خطة', status: 'active' });
      const item = await repos.treatmentItems.create({ patientId: patient.id, planId: plan.id, procedureName: 'كراون', teeth: [11], unitPrice: 300000, qty: 1, status: 'done', doneAt: new Date().toISOString(), invoiceId: null });

      // Advance payment first → becomes credit
      await billing.recordPayment({ patientId: patient.id, amount: 50000, method: 'cash' });
      let acc = await billing.patientAccount(patient.id);
      assert.equal(acc.credit, 50000);
      assert.equal(acc.balance, -50000);

      const inst = billing.splitInstallments(150000, 2, '2026-12-01');
      const { invoice, payment } = await billing.createInvoice({
        patientId: patient.id, itemIds: [item.id], discountType: 'amount', discountValue: 0,
        applyCredit: true, payNow: { amount: 100000, method: 'vodafone' }, installments: inst,
      });
      assert.equal(invoice.number, 1);
      assert.equal(invoice.appliedCredit, 50000);
      assert.equal(payment.receiptNo, 2);
      assert.equal((await repos.treatmentItems.get(item.id)).invoiceId, invoice.id);
      await assert.rejects(() => billing.createInvoice({ patientId: patient.id, itemIds: [item.id] }), 'cannot invoice twice');

      acc = await billing.patientAccount(patient.id);
      assert.equal(acc.invoices[0].status, 'partial');
      assert.equal(acc.invoices[0].remaining, 150000);
      assert.equal(acc.balance, 150000);
      assert.equal(acc.credit, 0);
      assert.equal(acc.ledger.at(-1).balance, 150000);
      assert.deepEqual(invoiceInstallments(acc.invoices[0], acc.invoices[0].paid, '2026-10-22').map((i) => i.status), ['due', 'due'], 'deposit + credit excluded');

      await assert.rejects(() => billing.recordPayment({ patientId: patient.id, invoiceId: invoice.id, amount: 999999, method: 'cash' }), 'overpay rejected');
      const p3 = await billing.recordPayment({ patientId: patient.id, invoiceId: invoice.id, amount: 75000, method: 'card' });
      const closing = await billing.dailyClosing(p3.date);
      assert.equal(closing.total, 225000);
      assert.equal(closing.byMethod.card, 75000);

      await billing.voidPayment(p3.id, 'خطأ');
      acc = await billing.patientAccount(patient.id);
      assert.equal(acc.invoices[0].remaining, 150000);

      await billing.voidInvoice(invoice.id, 'إعادة إصدار');
      acc = await billing.patientAccount(patient.id);
      assert.equal(acc.invoices[0].status, 'void');
      assert.equal(acc.balance, -150000, 'all live payments become credit');
      assert.equal(acc.credit, 150000);
      assert.equal((await repos.treatmentItems.get(item.id)).invoiceId, null, 'item billable again');
      assert.equal((await billing.outstandingBalances()).total, 0);
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
