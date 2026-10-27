/**
 * Billing: invoices, payments, installments (due / overdue + WhatsApp reminder),
 * outstanding balances and the daily cash closing. Tab and dates live in the URL query.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { formatMoney, formatDate, formatDateTime, digits, todayISO, parseDateInput, toISODate, toDate } from '../../core/format.js';
import { PAYMENT_METHODS, INVOICE_STATUS } from '../../core/labels.js';
import { normalizeArabic } from '../../core/text.js';
import { can, ownsOrAdmin } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { repos } from '../../data/index.js';
import { getSettings } from '../../data/settings.js';
import { mountTable } from '../../components/table.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { emptyState } from '../../components/states.js';
import {
  invoiceState, formatInvoiceNo, formatReceiptNo, allInstallments, outstandingBalances, dailyClosing,
} from '../../services/billing.js';
import { whatsappLink } from '../../services/appointments.js';
import { openPaymentDialog, voidPaymentFlow, pickPatient, openInvoiceDialog } from './dialogs.js';
import { printInvoice, printReceipt, printClosing, choosePrintSize } from './print.js';

const TABS = [
  ['invoices', 'الفواتير', 'receipt'],
  ['payments', 'المدفوعات', 'banknote'],
  ['installments', 'الأقساط', 'calendar-days'],
  ['balances', 'أرصدة مستحقة', 'wallet'],
  ['closing', 'إقفال اليومية', 'clipboard-list'],
];

const monthStart = (iso = todayISO()) => `${iso.slice(0, 7)}-01`;
const patientLink = (id, name) => html`<a href="${href('/patients/:id', { id }, { tab: 'payments' })}">${name}</a>`;

export default {
  title: 'الحسابات والفواتير',
  async render({ el, query, signal }) {
    const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'invoices';
    const st = { from: query.from ?? (tab === 'payments' ? todayISO() : monthStart()), to: query.to ?? todayISO(), status: query.status ?? '', q: '', day: query.day ?? todayISO(), inst: 'overdue' };

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">الحسابات والفواتير</h1>
          <p class="page-header__sub">الفواتير والمدفوعات والأقساط وإقفال الخزينة اليومي</p>
        </div>
        <div class="page-header__actions">
          ${can('billing', 'create') ? html`<button type="button" class="btn" data-new-invoice>${ico('receipt')} فاتورة جديدة</button>
            <button type="button" class="btn btn--accent" data-pay>${ico('banknote')} تسجيل دفعة</button>` : ''}
        </div>
      </header>
      <nav class="tabs" aria-label="أقسام الحسابات">
        ${TABS.map(([k, label, icon]) => html`<a class="tab" href="${href('/billing', {}, { tab: k })}" aria-selected="${String(k === tab)}">${ico(icon, { size: 18 })} ${label}</a>`)}
      </nav>
      <div id="bill-body"></div>`);
    const body = el.querySelector('#bill-body');

    const rangeToolbar = (extra = '') => html`
      <div class="toolbar" style="align-items: flex-end">
        ${dateField({ name: 'from', label: 'من', value: st.from })}
        ${dateField({ name: 'to', label: 'إلى', value: st.to })}
        ${extra}
      </div>`;

    /* ---------- Invoices ---------- */
    const invoicesTab = async () => {
      const [invoices, payments] = await Promise.all([repos.invoices.list({ index: 'date', range: { gte: st.from, lte: st.to } }), repos.payments.list()]);
      const rows = invoices.map((i) => ({ ...i, ...invoiceState(i, payments) }))
        .filter((i) => (!st.status || i.status === st.status) && (!st.q || normalizeArabic(`${i.patientName} ${formatInvoiceNo(i.number)}`).includes(normalizeArabic(st.q))))
        .sort((a, b) => b.number - a.number);
      const live = rows.filter((r) => r.status !== 'void');
      render(body, html`
        ${rangeToolbar(html`
          <div class="input-group toolbar__search">${ico('search', { size: 20 })}<input class="input input--pill" id="inv-q" value="${st.q}" placeholder="اسم المريض أو رقم الفاتورة" aria-label="بحث"></div>`)}
        <div class="chips" style="margin-block-end: var(--sp-4)">
          <button type="button" class="chip" data-status="" aria-pressed="${String(!st.status)}">الكل</button>
          ${Object.entries(INVOICE_STATUS).map(([k, s]) => html`<button type="button" class="chip" data-status="${k}" aria-pressed="${String(st.status === k)}">${s.label}</button>`)}
        </div>
        <div class="totals" style="margin-block-end: var(--sp-4)">
          <div class="totals__item totals__item--hero"><div class="totals__label">إجمالي الفواتير</div><div class="totals__value">${formatMoney(live.reduce((n, r) => n + r.total, 0))}</div></div>
          <div class="totals__item"><div class="totals__label">المحصّل منها</div><div class="totals__value">${formatMoney(live.reduce((n, r) => n + r.paid, 0))}</div></div>
          <div class="totals__item"><div class="totals__label">المتبقي</div><div class="totals__value">${formatMoney(live.reduce((n, r) => n + r.remaining, 0))}</div></div>
          <div class="totals__item"><div class="totals__label">عدد الفواتير</div><div class="totals__value">${digits(live.length)}</div></div>
        </div>
        <div id="tbl"></div>`);
      mountTable(body.querySelector('#tbl'), {
        signal, caption: 'الفواتير', rows,
        empty: { icon: 'receipt', title: 'لا توجد فواتير في هذه الفترة', hint: 'اضغط «فاتورة جديدة» بالأعلى، أو من ملف المريض ← الحسابات.' },
        columns: [
          { key: 'number', label: 'الرقم', render: (r) => html`<span class="ltr num">${formatInvoiceNo(r.number)}</span>` },
          { key: 'date', label: 'التاريخ', render: (r) => formatDate(r.date) },
          { key: 'patient', label: 'المريض', render: (r) => patientLink(r.patientId, r.patientName) },
          { key: 'total', label: 'المستحق', num: true, render: (r) => formatMoney(r.total) },
          { key: 'paid', label: 'المدفوع', num: true, render: (r) => formatMoney(r.paid) },
          { key: 'remaining', label: 'المتبقي', num: true, render: (r) => (r.status === 'void' ? '—' : html`<strong>${formatMoney(r.remaining)}</strong>`) },
          { key: 'status', label: 'الحالة', render: (r) => html`<span class="badge badge--dot badge--${INVOICE_STATUS[r.status].tone}">${INVOICE_STATUS[r.status].label}</span>` },
          { key: 'a', label: '', render: (r) => html`<div class="table__actions">
            ${can('billing', 'create') && (r.status === 'open' || r.status === 'partial') ? html`<button type="button" class="btn btn--accent btn--sm" data-pay-inv="${r.id}" data-patient="${r.patientId}">سداد</button>` : ''}
            <button type="button" class="btn btn--icon btn--sm" data-print-inv="${r.id}" aria-label="طباعة">${ico('printer', { size: 18 })}</button></div>` },
        ],
      });
    };

    /* ---------- Payments ---------- */
    const paymentsTab = async () => {
      const rows = (await repos.payments.list({ index: 'date', range: { gte: st.from, lte: st.to } })).sort((a, b) => b.at.localeCompare(a.at));
      const live = rows.filter((p) => !p.voided);
      const byMethod = Object.keys(PAYMENT_METHODS).map((k) => [k, live.filter((p) => p.method === k).reduce((n, p) => n + p.amount, 0)]);
      render(body, html`
        ${rangeToolbar()}
        <div class="totals" style="margin-block-end: var(--sp-4)">
          <div class="totals__item totals__item--hero"><div class="totals__label">إجمالي المقبوضات</div><div class="totals__value">${formatMoney(live.reduce((n, p) => n + p.amount, 0))}</div></div>
          ${byMethod.map(([k, v]) => html`<div class="totals__item"><div class="totals__label">${PAYMENT_METHODS[k].label}</div><div class="totals__value">${formatMoney(v)}</div></div>`)}
        </div>
        <div id="tbl"></div>`);
      mountTable(body.querySelector('#tbl'), {
        signal, caption: 'المدفوعات', rows,
        empty: { icon: 'banknote', title: 'لا توجد مدفوعات في هذه الفترة' },
        columns: [
          { key: 'r', label: 'الإيصال', render: (p) => html`<span class="ltr num">${formatReceiptNo(p.receiptNo)}</span>${p.voided ? html` <span class="badge" title="${p.voidReason}">ملغى</span>` : ''}` },
          { key: 'at', label: 'الوقت', render: (p) => formatDateTime(p.at) },
          { key: 'patient', label: 'المريض', render: (p) => patientLink(p.patientId, p.patientName) },
          { key: 'method', label: 'الطريقة', render: (p) => PAYMENT_METHODS[p.method]?.label },
          { key: 'user', label: 'المستلم', render: (p) => p.userName ?? '—' },
          { key: 'amount', label: 'المبلغ', num: true, render: (p) => html`<strong>${p.voided ? html`<s>${formatMoney(p.amount)}</s>` : formatMoney(p.amount)}</strong>` },
          { key: 'a', label: '', render: (p) => html`<div class="table__actions">
            <button type="button" class="btn btn--icon btn--sm" data-print-pay="${p.id}" aria-label="طباعة الإيصال">${ico('printer', { size: 18 })}</button>
            ${can('billing', 'delete') && !p.voided && ownsOrAdmin(p) ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-void-pay="${p.id}" aria-label="إلغاء">${ico('circle-x', { size: 18 })}</button>` : ''}</div>` },
        ],
      });
    };

    /* ---------- Installments ---------- */
    const installmentsTab = async () => {
      const today = todayISO();
      const all = await allInstallments(today);
      const in30 = toISODate(new Date(toDate(today).getTime() + 30 * 86_400_000));
      const groups = { overdue: all.filter((i) => i.status === 'overdue'), upcoming: all.filter((i) => i.status !== 'overdue' && i.dueDate <= in30), all };
      const rows = groups[st.inst];
      const patients = new Map((await repos.patients.list({ includeDeleted: true })).map((p) => [p.id, p]));
      const clinic = getSettings('clinic');
      render(body, html`
        <div class="chips" style="margin-block-end: var(--sp-4)">
          <button type="button" class="chip" data-inst="overdue" aria-pressed="${String(st.inst === 'overdue')}">متأخرة <span class="chip__count">${digits(groups.overdue.length)}</span></button>
          <button type="button" class="chip" data-inst="upcoming" aria-pressed="${String(st.inst === 'upcoming')}">خلال 30 يومًا <span class="chip__count">${digits(groups.upcoming.length)}</span></button>
          <button type="button" class="chip" data-inst="all" aria-pressed="${String(st.inst === 'all')}">كل الأقساط المفتوحة <span class="chip__count">${digits(all.length)}</span></button>
        </div>
        <div id="tbl"></div>`);
      mountTable(body.querySelector('#tbl'), {
        signal, caption: 'الأقساط', rows,
        empty: { icon: 'calendar-days', title: st.inst === 'overdue' ? 'لا توجد أقساط متأخرة 🎉' : 'لا توجد أقساط' },
        columns: [
          { key: 'due', label: 'الاستحقاق', render: (i) => html`${formatDate(i.dueDate)} ${i.status === 'overdue' ? html`<span class="badge badge--danger">متأخر</span>` : i.status === 'partial' ? html`<span class="badge badge--warning">جزئي</span>` : ''}` },
          { key: 'patient', label: 'المريض', render: (i) => patientLink(i.invoice.patientId, i.invoice.patientName) },
          { key: 'inv', label: 'الفاتورة', render: (i) => html`<span class="ltr">${formatInvoiceNo(i.invoice.number)}</span>` },
          { key: 'amount', label: 'المطلوب', num: true, render: (i) => html`<strong>${formatMoney(i.remainingOnInstallment)}</strong>` },
          { key: 'a', label: '', render: (i) => {
            const p = patients.get(i.invoice.patientId);
            const msg = `مرحبًا ${(p?.name ?? '').split(' ')[0]}، نذكّرك بقسط مستحق بقيمة ${formatMoney(i.remainingOnInstallment)} بتاريخ ${formatDate(i.dueDate)} لدى ${clinic.name}. شكرًا لك.`;
            const link = whatsappLink(p?.phone, msg);
            return html`<div class="table__actions">
              ${link ? html`<a class="btn btn--whatsapp btn--icon btn--sm" href="${link}" target="_blank" rel="noopener" aria-label="تذكير واتساب">${ico('message-circle', { size: 18 })}</a>` : ''}
              ${can('billing', 'create') ? html`<button type="button" class="btn btn--accent btn--sm" data-pay-inv="${i.invoice.id}" data-patient="${i.invoice.patientId}">سداد</button>` : ''}</div>`;
          } },
        ],
      });
    };

    /* ---------- Balances ---------- */
    const balancesTab = async () => {
      const { rows, total } = await outstandingBalances();
      render(body, html`
        <div class="totals" style="margin-block-end: var(--sp-4)">
          <div class="totals__item totals__item--hero"><div class="totals__label">إجمالي المستحق على المرضى</div><div class="totals__value">${formatMoney(total)}</div></div>
          <div class="totals__item"><div class="totals__label">عدد المرضى</div><div class="totals__value">${digits(rows.length)}</div></div>
        </div>
        <div id="tbl"></div>`);
      mountTable(body.querySelector('#tbl'), {
        signal, caption: 'الأرصدة المستحقة', rows, sort: { key: 'balance', dir: 'desc' },
        empty: { icon: 'wallet', title: 'لا توجد أرصدة مستحقة 🎉' },
        columns: [
          { key: 'patientName', label: 'المريض', sortable: true, render: (r) => patientLink(r.patientId, r.patientName) },
          { key: 'billed', label: 'إجمالي الفواتير', num: true, sortable: true, render: (r) => formatMoney(r.billed) },
          { key: 'paid', label: 'المدفوع', num: true, sortable: true, render: (r) => formatMoney(r.paid) },
          { key: 'balance', label: 'المتبقي', num: true, sortable: true, render: (r) => html`<strong>${formatMoney(r.balance)}</strong>` },
          { key: 'a', label: '', render: (r) => (can('billing', 'create') ? html`<button type="button" class="btn btn--accent btn--sm" data-pay-patient="${r.patientId}">سداد</button>` : '') },
        ],
      });
    };

    /* ---------- Daily closing ---------- */
    const closingTab = async () => {
      const c = await dailyClosing(st.day);
      const methods = Object.keys(PAYMENT_METHODS);
      render(body, html`
        <div class="toolbar" style="align-items: flex-end">
          ${dateField({ name: 'day', label: 'اليوم', value: st.day })}
          <div class="grow"></div>
          <button type="button" class="btn" data-print-closing>${ico('printer')} طباعة الإقفال</button>
        </div>
        <div class="bento">
          <section class="card card--hero span-4"><div class="kpi">
            <div class="kpi__head"><span class="kpi__icon">${ico('banknote', { size: 22 })}</span><span class="kpi__label">إجمالي المقبوضات</span></div>
            <div class="kpi__value">${formatMoney(c.total, { currency: false })}<small>ج.م</small></div>
            <div class="kpi__foot"><span class="kpi__meta">${digits(c.payments.length)} إيصال · ${digits(c.invoicesCount)} فاتورة بإجمالي ${formatMoney(c.billed)}</span></div>
          </div></section>
          <section class="card span-4">
            <div class="card__header"><div class="card__heading"><h2 class="card__title">حسب طريقة الدفع</h2></div></div>
            <div class="card__body"><dl class="dl">${methods.map((m) => html`<dt>${PAYMENT_METHODS[m].label} <span class="subtle">(${digits(c.countByMethod[m] ?? 0)})</span></dt><dd class="num">${formatMoney(c.byMethod[m] ?? 0)}</dd>`)}</dl></div>
          </section>
          <section class="card span-4">
            <div class="card__header"><div class="card__heading"><h2 class="card__title">حسب المستخدم</h2></div></div>
            <div class="card__body">${Object.keys(c.byUser).length ? html`<dl class="dl">${Object.entries(c.byUser).map(([u, v]) => html`<dt>${u}</dt><dd class="num">${formatMoney(v)}</dd>`)}</dl>` : html`<p class="muted">لا توجد مقبوضات.</p>`}</div>
          </section>
          <section class="card span-12">
            <div class="card__header"><div class="card__heading"><h2 class="card__title">إيصالات اليوم</h2>${c.voided.length ? html`<p class="card__subtitle">${digits(c.voided.length)} إيصال ملغى (غير محسوب)</p>` : ''}</div></div>
            <div class="card__body">${c.payments.length ? html`<ul class="list">${c.payments.map((p) => html`<li class="list__item">
              <span class="ltr num muted">${formatReceiptNo(p.receiptNo)}</span>
              <span class="list__main"><span class="list__title">${p.patientName}</span><span class="list__meta">${formatDateTime(p.at)} · ${PAYMENT_METHODS[p.method]?.label} · ${p.userName ?? ''}</span></span>
              <strong>${formatMoney(p.amount)}</strong></li>`)}</ul>` : emptyState({ icon: 'banknote', title: 'لا توجد مقبوضات في هذا اليوم' })}</div>
          </section>
        </div>`);
    };

    const draw = async () => {
      await ({ invoices: invoicesTab, payments: paymentsTab, installments: installmentsTab, balances: balancesTab, closing: closingTab })[tab]();
      enhanceDateFields(body, signal);
    };

    body.addEventListener('change', (e) => {
      const t = /** @type {HTMLInputElement} */ (e.target);
      if (['from', 'to', 'day'].includes(t.name)) {
        const iso = parseDateInput(t.value);
        if (iso) { st[t.name] = iso; draw(); }
      }
    }, { signal });
    let qt;
    body.addEventListener('input', (e) => {
      const t = /** @type {HTMLInputElement} */ (e.target);
      if (t.id === 'inv-q') { clearTimeout(qt); qt = setTimeout(async () => { st.q = t.value; await draw(); const i = /** @type {HTMLInputElement} */ (body.querySelector('#inv-q')); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 250); }
    }, { signal });
    on(body, 'click', '[data-status]', (_, b) => { st.status = b.dataset.status; draw(); }, { signal });
    on(body, 'click', '[data-inst]', (_, b) => { st.inst = b.dataset.inst; draw(); }, { signal });
    on(el, 'click', '[data-pay]', () => openPaymentDialog(), { signal });
    on(el, 'click', '[data-new-invoice]', async () => {
      const id = await pickPatient({ title: 'فاتورة جديدة — اختر المريض' });
      if (id) await openInvoiceDialog(id);
    }, { signal });
    on(body, 'click', '[data-pay-inv]', (_, b) => openPaymentDialog({ patientId: b.dataset.patient, invoiceId: b.dataset.payInv }), { signal });
    on(body, 'click', '[data-pay-patient]', (_, b) => openPaymentDialog({ patientId: b.dataset.payPatient }), { signal });
    on(body, 'click', '[data-print-inv]', (_, b) => choosePrintSize(b, (size) => printInvoice(b.dataset.printInv, size)), { signal });
    on(body, 'click', '[data-print-pay]', (_, b) => choosePrintSize(b, (size) => printReceipt(b.dataset.printPay, size)), { signal });
    on(body, 'click', '[data-void-pay]', async (_, b) => { const p = await repos.payments.get(b.dataset.voidPay); if (p) voidPaymentFlow(p); }, { signal });
    on(body, 'click', '[data-print-closing]', (_, b) => choosePrintSize(b, (size) => printClosing(st.day, size)), { signal });

    const off = onEvent('data:changed', ({ store }) => { if (store === 'invoices' || store === 'payments') draw(); });
    await draw();
    return off;
  },
};

