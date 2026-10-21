/** Patient file → account: balance, unbilled work, invoices, payments, installments, ledger. */
import { html, ico, render, on } from '../../core/dom.js';
import { formatMoney, formatDate, formatDateTime, digits } from '../../core/format.js';
import { PAYMENT_METHODS, INVOICE_STATUS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { onEvent } from '../../core/bus.js';
import { openMenu } from '../../components/menu.js';
import { emptyState } from '../../components/states.js';
import { patientAccount, uninvoicedItems, invoiceInstallments, formatInvoiceNo, formatReceiptNo, lineFromItem } from '../../services/billing.js';
import { openInvoiceDialog, openPaymentDialog, voidPaymentFlow, voidInvoiceFlow, editInstallmentsDialog } from '../billing/dialogs.js';
import { printInvoice, printReceipt, choosePrintSize } from '../billing/print.js';

const INST_STATUS = { paid: ['مدفوع', 'success'], partial: ['جزئي', 'warning'], due: ['لم يحن', ''], overdue: ['متأخر', 'danger'] };

export async function renderTab({ body, patient, signal }) {
  const p = patient();
  const perm = { create: can('billing', 'create'), void: can('billing', 'delete') };
  let acc = null, unbilled = [], view = 'invoices';

  const draw = () => {
    const unbilledTotal = unbilled.reduce((n, i) => n + lineFromItem(i).total, 0);
    render(body, html`
      <div class="stack">
        <div class="totals">
          <div class="totals__item totals__item--hero"><div class="totals__label">المتبقي على المريض</div><div class="totals__value">${formatMoney(Math.max(0, acc.balance))}</div></div>
          <div class="totals__item"><div class="totals__label">إجمالي الفواتير</div><div class="totals__value">${formatMoney(acc.billed)}</div></div>
          <div class="totals__item"><div class="totals__label">إجمالي المدفوع</div><div class="totals__value">${formatMoney(acc.paid)}</div></div>
          ${acc.credit ? html`<div class="totals__item"><div class="totals__label">رصيد دائن (مقدم)</div><div class="totals__value">${formatMoney(acc.credit)}</div></div>` : ''}
          ${unbilled.length ? html`<div class="totals__item"><div class="totals__label">أعمال منتهية لم تُفوتر</div><div class="totals__value">${formatMoney(unbilledTotal)}</div></div>` : ''}
        </div>

        ${unbilled.length && perm.create ? html`
          <div class="alert alert--warning">${ico('receipt')}
            <div class="alert__content"><div class="alert__title">${digits(unbilled.length)} بند منتهٍ لم تُصدر له فاتورة</div>
              <div class="alert__body">${unbilled.map((i) => i.procedureName).join('، ')}</div></div>
            <button type="button" class="btn btn--primary btn--sm" data-new-invoice>${ico('plus', { size: 18 })} إنشاء فاتورة</button>
          </div>` : ''}

        <div class="toolbar" style="margin:0">
          <div class="segmented" role="radiogroup" aria-label="العرض">
            <label><input type="radio" name="accView" value="invoices" ${view === 'invoices' ? 'checked' : ''}><span>الفواتير</span></label>
            <label><input type="radio" name="accView" value="payments" ${view === 'payments' ? 'checked' : ''}><span>المدفوعات</span></label>
            <label><input type="radio" name="accView" value="ledger" ${view === 'ledger' ? 'checked' : ''}><span>كشف الحساب</span></label>
          </div>
          <div class="grow"></div>
          ${perm.create ? html`
            <button type="button" class="btn btn--sm" data-new-invoice>${ico('receipt', { size: 18 })} فاتورة</button>
            <button type="button" class="btn btn--accent btn--sm" data-pay>${ico('banknote', { size: 18 })} تسجيل دفعة</button>` : ''}
        </div>

        <div id="acc-body">${view === 'invoices' ? invoicesMarkup() : view === 'payments' ? paymentsMarkup() : ledgerMarkup()}</div>
      </div>`);
  };

  const invoicesMarkup = () => (acc.invoices.length ? html`<div class="stack">${acc.invoices.map((inv) => {
    const st = INVOICE_STATUS[inv.status];
    const inst = invoiceInstallments(inv, inv.paid);
    return html`<section class="card ${inv.status === 'void' ? 'card--flat' : ''}">
      <div class="card__header">
        <div class="card__heading">
          <h3 class="card__title"><span class="ltr">${formatInvoiceNo(inv.number)}</span> <span class="badge badge--dot badge--${st.tone}">${st.label}</span></h3>
          <p class="card__subtitle">${formatDate(inv.date)} · ${inv.lines.map((l) => l.description).join('، ')}</p>
        </div>
        <div class="row" style="gap: var(--sp-1)">
          ${perm.create && (inv.status === 'open' || inv.status === 'partial') ? html`<button type="button" class="btn btn--accent btn--sm" data-pay-inv="${inv.id}">${ico('banknote', { size: 16 })} سداد</button>` : ''}
          <button type="button" class="btn btn--icon btn--sm" data-print-inv="${inv.id}" aria-label="طباعة الفاتورة">${ico('printer', { size: 18 })}</button>
          ${perm.create || perm.void ? html`<button type="button" class="btn btn--icon btn--sm" data-inv-menu="${inv.id}" aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
        </div>
      </div>
      <div class="card__body">
        <div class="row" style="gap: var(--sp-6)">
          <span>المستحق: <strong>${formatMoney(inv.total)}</strong>${inv.discount ? html` <span class="muted text-sm">(بعد خصم ${formatMoney(inv.discount)})</span>` : ''}</span>
          <span>المدفوع: <strong>${formatMoney(inv.paid)}</strong></span>
          ${inv.status !== 'void' ? html`<span>المتبقي: <strong style="color: ${inv.remaining ? 'var(--c-danger)' : 'var(--c-success)'}">${formatMoney(inv.remaining)}</strong></span>` : html`<span class="muted">سبب الإلغاء: ${inv.voidReason}</span>`}
        </div>
        ${inst.length && inv.status !== 'void' ? html`<div class="stack-sm" style="margin-block-start: var(--sp-3)">
          <span class="field__label">${ico('calendar-days', { size: 16 })} الأقساط</span>
          ${inst.map((i, n) => html`<div class="row row--between text-sm"><span>القسط ${digits(n + 1)} · ${formatDate(i.dueDate)}</span>
            <span class="row" style="gap: var(--sp-2)">${formatMoney(i.amount)} <span class="badge badge--${INST_STATUS[i.status][1]}">${INST_STATUS[i.status][0]}</span></span></div>`)}
        </div>` : ''}
      </div>
    </section>`;
  })}</div>` : html`<div class="card">${emptyState({ icon: 'receipt', title: 'لا توجد فواتير بعد', hint: 'عند انتهاء بنود خطة العلاج أنشئ لها فاتورة، أو سجّل دفعة مقدمة تحت الحساب.' })}</div>`);

  const paymentsMarkup = () => (acc.payments.length ? html`
    <div class="table-wrap"><table class="table table--stack">
      <thead><tr><th>الإيصال</th><th>التاريخ</th><th>عن</th><th>الطريقة</th><th>المستلم</th><th class="num">المبلغ</th><th></th></tr></thead>
      <tbody>${acc.payments.map((pay) => html`<tr ${pay.voided ? html`style="opacity:.55"` : ''}>
        <td data-label="الإيصال" class="ltr">${formatReceiptNo(pay.receiptNo)}${pay.voided ? html` <span class="badge">ملغى</span>` : ''}</td>
        <td data-label="التاريخ">${formatDateTime(pay.at)}</td>
        <td data-label="عن">${pay.invoiceId ? html`<span class="ltr">${formatInvoiceNo(acc.invoices.find((i) => i.id === pay.invoiceId)?.number ?? 0)}</span>` : 'تحت الحساب'}</td>
        <td data-label="الطريقة">${PAYMENT_METHODS[pay.method]?.label}</td>
        <td data-label="المستلم">${pay.userName ?? '—'}</td>
        <td data-label="المبلغ" class="num"><strong>${pay.voided ? html`<s>${formatMoney(pay.amount)}</s>` : formatMoney(pay.amount)}</strong></td>
        <td data-label=""><div class="table__actions">
          <button type="button" class="btn btn--icon btn--sm" data-print-pay="${pay.id}" aria-label="طباعة الإيصال">${ico('printer', { size: 18 })}</button>
          ${perm.void && !pay.voided ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-void-pay="${pay.id}" aria-label="إلغاء الإيصال">${ico('circle-x', { size: 18 })}</button>` : ''}
        </div></td>
      </tr>`)}</tbody>
    </table></div>` : html`<div class="card">${emptyState({ icon: 'banknote', title: 'لا توجد مدفوعات بعد' })}</div>`);

  const ledgerMarkup = () => (acc.ledger.length ? html`
    <div class="table-wrap"><table class="table table--stack">
      <thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th class="num">مدين (عليه)</th><th class="num">دائن (دفع)</th><th class="num">الرصيد</th></tr></thead>
      <tbody>${acc.ledger.map((r) => html`<tr>
        <td data-label="التاريخ">${formatDate(r.date)}</td>
        <td data-label="المرجع" class="ltr">${r.ref}</td>
        <td data-label="البيان">${r.description}${r.method ? html` · <span class="muted">${PAYMENT_METHODS[r.method]?.label}</span>` : ''}</td>
        <td data-label="مدين" class="num">${r.debit ? formatMoney(r.debit) : ''}</td>
        <td data-label="دائن" class="num">${r.credit ? formatMoney(r.credit) : ''}</td>
        <td data-label="الرصيد" class="num"><strong>${formatMoney(r.balance)}</strong></td>
      </tr>`)}</tbody>
    </table></div>` : html`<div class="card">${emptyState({ icon: 'scroll-text', title: 'لا توجد حركات بعد' })}</div>`);

  const load = async () => { [acc, unbilled] = await Promise.all([patientAccount(p.id), uninvoicedItems(p.id)]); draw(); };

  body.addEventListener('change', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.name === 'accView') { view = t.value; draw(); }
  }, { signal });
  on(body, 'click', '[data-new-invoice]', () => openInvoiceDialog(p.id), { signal });
  on(body, 'click', '[data-pay]', () => openPaymentDialog({ patientId: p.id }), { signal });
  on(body, 'click', '[data-pay-inv]', (_, b) => openPaymentDialog({ patientId: p.id, invoiceId: b.dataset.payInv }), { signal });
  on(body, 'click', '[data-print-inv]', (_, b) => choosePrintSize(b, (size) => printInvoice(b.dataset.printInv, size)), { signal });
  on(body, 'click', '[data-print-pay]', (_, b) => choosePrintSize(b, (size) => printReceipt(b.dataset.printPay, size)), { signal });
  on(body, 'click', '[data-void-pay]', (_, b) => voidPaymentFlow(acc.payments.find((x) => x.id === b.dataset.voidPay)), { signal });
  on(body, 'click', '[data-inv-menu]', (_, b) => {
    const inv = acc.invoices.find((x) => x.id === b.dataset.invMenu);
    openMenu(b, { items: [
      ...(perm.create && (inv.status === 'open' || inv.status === 'partial') ? [{ label: inv.installments?.length ? 'تعديل جدول الأقساط' : 'تقسيط المتبقي', icon: 'calendar-days', onSelect: () => editInstallmentsDialog(inv) }] : []),
      ...(perm.void && inv.status !== 'void' ? [{ label: 'إلغاء الفاتورة', icon: 'circle-x', danger: true, onSelect: () => voidInvoiceFlow(inv) }] : []),
    ] });
  }, { signal });

  const off = onEvent('data:changed', ({ store }) => { if (['invoices', 'payments', 'treatmentItems'].includes(store)) load(); });
  await load();
  return off;
}
