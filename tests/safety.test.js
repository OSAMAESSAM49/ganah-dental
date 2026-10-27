import { describe, test, assert } from './runner.js';
import { openModal, closeAllModals, hasDirtyModal } from '../js/components/modal.js';
import { rxWarnings } from '../js/services/prescriptions.js';
import { markdownToHTML } from '../js/core/markdown.js';

describe('in-app guide (Markdown)', () => {
  test('headings, nested lists, quotes and inline marks; raw HTML stays text', () => {
    const out = markdownToHTML([
      '# دليل', '', '## أول يوم', '1. **البيانات:** من الإعدادات', '   - الشعار', '   - الهاتف', '2. الأسعار', '',
      '> تنبيه `مهم`', '', 'رابط https://dentoganah.com و <script>x</script>',
    ].join('\n'));
    assert.ok(out.includes('<h2>دليل</h2>') && out.includes('<h3>أول يوم</h3>'));
    assert.ok(/<ol><li><strong>البيانات:<\/strong> من الإعدادات\s*<ul><li>الشعار<\/li><li>الهاتف<\/li><\/ul><\/li><li>الأسعار<\/li><\/ol>/.test(out.replace(/\n/g, '')), out);
    assert.ok(out.includes('<blockquote>تنبيه <code>مهم</code></blockquote>'));
    assert.ok(out.includes('<a href="https://dentoganah.com"'));
    assert.ok(!out.includes('<script>') && out.includes('&lt;script&gt;'));
  });
});

describe('windows: no double saves, unsaved input protected', () => {
  test('a double tap on save runs the save once', async () => {
    let saves = 0;
    const done = openModal({
      title: 'اختبار',
      actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }],
      async beforeClose() { saves++; await new Promise((r) => setTimeout(r, 40)); return true; },
    });
    const btn = /** @type {HTMLButtonElement} */ (document.querySelector('dialog [data-action-index="0"]'));
    btn.click();
    assert.ok(btn.disabled, 'button disabled while saving');
    btn.click();
    assert.equal(await done, 'save');
    assert.equal(saves, 1);
  });

  test('a window with unsaved input reports it, and route changes close windows', async () => {
    const done = openModal({ title: 'نموذج', body: 'x', dirty: () => true });
    assert.ok(hasDirtyModal());
    closeAllModals();
    assert.equal(await done, null);
    assert.ok(!hasDirtyModal());
    assert.equal(document.querySelectorAll('dialog').length, 0);
  });
});

describe('prescription safety for medicines typed by hand', () => {
  test('typed brand names still warn about allergies', () => {
    const patient = { gender: 'female', medical: { items: { allergyPenicillin: true, anticoagulants: true } } };
    const lines = [{ medicineId: null, name: 'Augmentin 1g' }, { medicineId: null, name: 'Cataflam 50mg' }, { medicineId: null, name: 'Paracetamol 500mg' }];
    const w = rxWarnings(patient, lines, new Map());
    assert.ok(w.some((x) => x.line === 'Augmentin 1g' && x.level === 'critical'), 'penicillin brand');
    assert.ok(w.some((x) => x.line === 'Cataflam 50mg' && x.level === 'critical'), 'NSAID with blood thinners');
    assert.ok(!w.some((x) => x.line === 'Paracetamol 500mg'), 'paracetamol is fine');
  });
});

describe('money paid without an invoice settles open invoices (temporary database)', () => {
  test('oldest invoice first, the rest stays as credit, voiding takes it back', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const billing = await import('../js/services/billing.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      const patient = await repos.patients.create({ name: 'مريض رصيد', fileNo: 'G-99998', searchText: '' });
      const line = (total) => [{ description: 'كشف', teeth: [], qty: 1, unitPrice: total, discount: 0, total }];
      const older = await repos.invoices.create({ number: 1, patientId: patient.id, patientName: patient.name, date: '2026-01-01', lines: line(30000), status: 'open', appliedCredit: 0 });
      const newer = await repos.invoices.create({ number: 2, patientId: patient.id, patientName: patient.name, date: '2026-02-01', lines: line(50000), status: 'open', appliedCredit: 0 });

      const pay = await billing.recordPayment({ patientId: patient.id, amount: 60000, method: 'cash' });
      let acc = await billing.patientAccount(patient.id);
      const byId = (id) => acc.invoices.find((i) => i.id === id);
      assert.equal(byId(older.id).status, 'paid', 'older invoice paid first');
      assert.equal(byId(newer.id).remaining, 20000);
      assert.equal(acc.credit, 0);
      assert.equal(acc.balance, 20000);
      assert.ok((await repos.payments.get(pay.id)).note.includes('INV-00001'), 'receipt says where it went');

      // More than what is owed: the rest stays as credit.
      await billing.recordPayment({ patientId: patient.id, amount: 30000, method: 'cash' });
      acc = await billing.patientAccount(patient.id);
      assert.equal(byId(newer.id).status, 'paid');
      assert.equal(acc.credit, 10000);

      // Voiding the first advance gives the invoices their debt back.
      await billing.voidPayment(pay.id, 'خطأ');
      acc = await billing.patientAccount(patient.id);
      assert.equal(acc.balance, 50000);
      assert.equal(acc.invoices.filter((i) => i.status !== 'void').reduce((n, i) => n + i.remaining, 0), 50000, 'invoices show what is really owed');
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
