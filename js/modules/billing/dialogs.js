/**
 * Billing dialogs: create invoice (from done items + extra lines, discount, credit,
 * pay now, installments), record payment, void with reason, edit installments.
 */
import { html, ico, render, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, toPiasters, piastersToInput, digits, formatDate, todayISO, parseDateInput } from '../../core/format.js';
import { normalizeDigits } from '../../core/text.js';
import { addDays } from '../../core/time.js';
import { PAYMENT_METHODS } from '../../core/labels.js';
import { openModal } from '../../components/modal.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { textareaField } from '../../components/form.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { can } from '../../core/permissions.js';
import { searchPatients, getPatient } from '../../services/patients.js';
import {
  uninvoicedItems, chargeAt, patientAccount, createInvoice, recordPayment, voidPayment, voidInvoice, setInstallments,
  lineFromItem, invoiceTotals, splitInstallments, invoiceInstallments, formatInvoiceNo,
} from '../../services/billing.js';
import { patientAvatar } from '../patients/list.js';
import { printInvoice, printReceipt } from './print.js';
import { setPref } from '../../core/prefs.js';

const methodChips = (value = 'cash') => html`
  <div class="chips" role="radiogroup" aria-label="طريقة الدفع">
    ${Object.entries(PAYMENT_METHODS).map(([k, m]) => html`<label class="chip"><input type="radio" name="method" value="${k}" ${k === value ? 'checked' : ''}>${ico(m.icon, { size: 16 })} ${m.label}</label>`)}
  </div>`;

/** Offers to print right after saving. */
async function offerPrint(kind, id) {
  const size = await openModal({
    title: kind === 'invoice' ? 'تم إنشاء الفاتورة' : 'تم تسجيل الدفعة',
    icon: 'circle-check',
    body: html`<p>هل تريد طباعة ${kind === 'invoice' ? 'الفاتورة' : 'الإيصال'} الآن؟</p>`,
    actions: [
      { label: 'طباعة A4', value: 'a4', variant: 'primary' },
      { label: 'إيصال حراري 80مم', value: '80mm' },
      { label: 'لاحقًا', value: null, variant: 'ghost' },
    ],
  });
  if (!size) return;
  setPref('printSize', size);
  if (kind === 'invoice') await printInvoice(id, size); else await printReceipt(id, size);
}

/* ---------- Create invoice ---------- */

/** @param {string} patientId @returns {Promise<object|null>} */
/** Asks which patient (search by name, phone or file number). @returns {Promise<string|null>} id */
export async function pickPatient({ title = 'اختر المريض' } = {}) {
  return openModal({
    title, icon: 'search',
    body: html`<div class="field"><label class="field__label" for="pick-psearch">المريض</label>
      <div class="input-group">${ico('search', { size: 20 })}<input class="input" id="pick-psearch" autocomplete="off" placeholder="ابحث بالاسم أو الموبايل أو رقم الملف…"></div>
      <ul class="gsearch__list" id="pick-presults" style="position: static; box-shadow: none; padding: 0; margin-block-start: var(--sp-2)" hidden></ul></div>`,
    actions: [{ label: 'إغلاق', value: null }],
    onOpen(dialog, close) {
      const input = /** @type {HTMLInputElement} */ (dialog.querySelector('#pick-psearch'));
      const list = dialog.querySelector('#pick-presults');
      let timer;
      input.focus();
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const found = input.value.trim() ? await searchPatients(input.value, { limit: 8 }) : [];
          render(list, found.length ? html`${found.map((p) => html`<li class="gsearch__item" data-pick="${p.id}">${patientAvatar(p)}<span class="gsearch__text"><strong>${p.name}</strong><span class="gsearch__sub ltr">${digits(p.fileNo)}${p.phone ? ` · ${digits(p.phone)}` : ''}</span></span></li>`)}` : html`<li class="gsearch__empty">لا يوجد مريض مطابق</li>`);
          list.hidden = !input.value.trim();
        }, 120);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); /** @type {HTMLElement|null} */ (list.querySelector('[data-pick]'))?.click(); } });
      list.addEventListener('click', (e) => { const li = /** @type {HTMLElement} */ (e.target).closest('[data-pick]'); if (li) close(li.dataset.pick); });
    },
  });
}

/**
 * Right after a treatment is marked «تم»: offer the invoice (or tell who can issue it).
 * Says nothing when the work was already invoiced.
 */
export async function offerInvoice(patientId) {
  if (!(await uninvoicedItems(patientId)).length) return;
  if (can('billing', 'create')) {
    toast('انتهى العلاج — هل تُصدر الفاتورة الآن؟', { action: { label: 'إصدار فاتورة', onClick: () => openInvoiceDialog(patientId) } });
  } else {
    toast('ظهر حساب العلاج في «فواتير اليوم» — أبلغ الاستقبال لإصدار الفاتورة.');
  }
}

export async function openInvoiceDialog(patientId, { preselect = null } = {}) {
  const [patient, items, account] = await Promise.all([getPatient(patientId), uninvoicedItems(patientId), patientAccount(patientId)]);
  const st = {
    selected: new Set(preselect ?? items.map((i) => i.id)),
    extra: [],
    discountType: 'amount',
    discountValue: 0,
    applyCredit: account.credit > 0,
    payMode: 'now',      // 'now' | 'later' | 'installments'
    payAmount: null,     // null = full remaining
    method: 'cash',
    instCount: 3,
    instStart: addDays(todayISO(), 30),
  };

  const totals = () => {
    const lines = [...items.filter((i) => st.selected.has(i.id)).map(lineFromItem), ...st.extra.filter((l) => l.amount > 0).map((l) => ({ total: l.amount }))];
    const t = invoiceTotals({ lines, discountType: st.discountType, discountValue: st.discountValue });
    const credit = st.applyCredit ? Math.min(t.total, account.credit) : 0;
    const due = t.total - credit;
    const pay = st.payMode === 'later' ? 0 : st.payMode === 'installments' ? Math.min(due, st.payAmount ?? 0) : Math.min(due, st.payAmount ?? due);
    return { ...t, credit, due, pay, rest: due - pay };
  };

  const itemsMarkup = () => html`
    ${items.length ? html`<div class="stack-sm">
      <span class="field__label">علاجات بدأت أو انتهت ولم تُفوتر</span>
      ${items.map((i) => html`<label class="check" style="justify-content: space-between; inline-size: 100%; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); background: var(--c-surface-2)">
        <span class="row" style="gap: var(--sp-2)"><input type="checkbox" data-item="${i.id}" ${st.selected.has(i.id) ? 'checked' : ''}> ${i.procedureName} ${i.teeth?.length ? html`<span class="ltr subtle">${i.teeth.join(',')}</span>` : ''} <span class="subtle text-sm">${formatDate(chargeAt(i))}${i.status === 'in_progress' ? ' · جاري' : ''}</span></span>
        <strong>${formatMoney(lineFromItem(i).total)}</strong></label>`)}
    </div>` : html`<p class="muted">لا توجد علاجات لم تُفوتر. يمكنك إضافة بند يدوي.</p>`}
    <div class="stack-sm">
      ${st.extra.map((l, i) => html`<div class="row">
        <input class="input grow" data-extra-desc="${i}" value="${l.description}" placeholder="البيان (مثال: كشف)" aria-label="البيان">
        <input class="input input--ltr" style="inline-size: 140px" data-extra-amt="${i}" value="${l.amount ? piastersToInput(l.amount) : ''}" inputmode="decimal" placeholder="0" aria-label="المبلغ">
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-extra-rm="${i}" aria-label="حذف البند">${ico('x', { size: 16 })}</button>
      </div>`)}
      <button type="button" class="btn btn--sm" data-extra-add style="align-self:flex-start">${ico('plus', { size: 16 })} بند إضافي</button>
    </div>`;

  const summaryMarkup = () => {
    const t = totals();
    return html`
      <div class="totals">
        <div class="totals__item"><div class="totals__label">الإجمالي</div><div class="totals__value">${formatMoney(t.subtotal)}</div></div>
        <div class="totals__item"><div class="totals__label">الخصم</div><div class="totals__value">${formatMoney(t.discount)}</div></div>
        ${t.credit ? html`<div class="totals__item"><div class="totals__label">من الرصيد الدائن</div><div class="totals__value">${formatMoney(t.credit)}</div></div>` : ''}
        <div class="totals__item totals__item--hero"><div class="totals__label">المستحق</div><div class="totals__value">${formatMoney(t.due)}</div></div>
      </div>
      ${st.payMode === 'installments' && t.rest > 0 ? html`<div class="stack-sm"><span class="field__label">جدول الأقساط</span>
        ${splitInstallments(t.rest, st.instCount, st.instStart).map((i, n) => html`<div class="row row--between text-sm"><span>القسط ${digits(n + 1)} · ${formatDate(i.dueDate)}</span><strong>${formatMoney(i.amount)}</strong></div>`)}</div>` : ''}`;
  };

  let created = null;
  await openModal({
    title: `فاتورة جديدة — ${patient.name}`,
    dirty: true,
    icon: 'receipt',
    size: 'lg',
    body: html`
      <form class="form" id="inv-form" novalidate>
        <div id="inv-items">${itemsMarkup()}</div>
        <fieldset class="field" style="border:0;padding:0;margin:0">
          <legend class="field__label" style="margin-block-end: var(--sp-2)">خصم على الفاتورة</legend>
          <div class="row">
            <div class="segmented"><label><input type="radio" name="discountType" value="amount" checked><span>مبلغ ج.م</span></label><label><input type="radio" name="discountType" value="percent"><span>نسبة %</span></label></div>
            <input class="input input--ltr" name="discountValue" inputmode="decimal" style="inline-size: 140px" placeholder="0" aria-label="قيمة الخصم">
          </div>
          <span class="field__error" data-error-for="discountValue"></span>
        </fieldset>
        ${account.credit > 0 ? html`<label class="check"><input type="checkbox" name="applyCredit" checked> استخدام الرصيد الدائن للمريض (${formatMoney(account.credit)})</label>` : ''}
        <fieldset class="field" style="border:0;padding:0;margin:0">
          <legend class="field__label" style="margin-block-end: var(--sp-2)">الدفع</legend>
          <div class="segmented">
            <label><input type="radio" name="payMode" value="now" checked><span>${ico('banknote', { size: 16 })} دفع الآن</span></label>
            <label><input type="radio" name="payMode" value="installments"><span>${ico('calendar-days', { size: 16 })} أقساط</span></label>
            <label><input type="radio" name="payMode" value="later"><span>${ico('clock', { size: 16 })} لاحقًا</span></label>
          </div>
        </fieldset>
        <div id="pay-box"></div>
        <div id="inv-summary"></div>
        ${textareaField({ name: 'notes', label: 'ملاحظات على الفاتورة', rows: 2 })}
      </form>`,
    actions: [{ label: 'إنشاء الفاتورة', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(dialog) {
      const $ = (s) => dialog.querySelector(s);
      const drawPay = () => {
        const t = totals();
        render($('#pay-box'), st.payMode === 'later' ? html`<p class="muted text-sm">ستُسجّل الفاتورة كغير مدفوعة ويظهر المبلغ في «أرصدة مستحقة».</p>` : html`
          <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr))">
            <label class="field"><span class="field__label">${st.payMode === 'installments' ? 'مقدم يُدفع الآن' : 'المبلغ المدفوع الآن'}</span>
              <input class="input input--ltr" name="payAmount" inputmode="decimal" value="${st.payAmount === null ? (st.payMode === 'installments' ? '' : piastersToInput(t.due)) : piastersToInput(st.payAmount)}" placeholder="0">
              <span class="field__error" data-error-for="payAmount"></span></label>
            ${st.payMode === 'installments' ? html`
              <label class="field"><span class="field__label">عدد الأقساط</span><select class="select" name="instCount">${[2, 3, 4, 5, 6, 8, 10, 12].map((n) => html`<option value="${n}" ${n === st.instCount ? 'selected' : ''}>${digits(n)}</option>`)}</select></label>
              ${dateField({ name: 'instStart', label: 'أول قسط', value: st.instStart })}` : ''}
          </div>
          ${methodChips(st.method)}`);
        enhanceDateFields($('#pay-box'));
      };
      const refresh = () => render($('#inv-summary'), summaryMarkup());
      drawPay(); refresh();

      dialog.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.name === 'discountValue') st.discountValue = st.discountType === 'percent' ? Number(normalizeDigits(t.value)) || 0 : toPiasters(t.value || '0') || 0;
        if (t.name === 'payAmount') st.payAmount = t.value.trim() ? (toPiasters(t.value) || 0) : null;
        if (t.dataset.extraDesc !== undefined) st.extra[Number(t.dataset.extraDesc)].description = t.value;
        if (t.dataset.extraAmt !== undefined) st.extra[Number(t.dataset.extraAmt)].amount = toPiasters(t.value || '0') || 0;
        refresh();
      });
      dialog.addEventListener('change', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.dataset.item) { if (t.checked) st.selected.add(t.dataset.item); else st.selected.delete(t.dataset.item); }
        if (t.name === 'discountType') { st.discountType = /** @type {any} */ (t.value); const v = /** @type {HTMLInputElement} */ ($('[name=discountValue]')).value; st.discountValue = st.discountType === 'percent' ? Number(normalizeDigits(v)) || 0 : toPiasters(v || '0') || 0; }
        if (t.name === 'applyCredit') st.applyCredit = t.checked;
        if (t.name === 'payMode') { st.payMode = /** @type {any} */ (t.value); st.payAmount = null; drawPay(); }
        if (t.name === 'method') st.method = t.value;
        if (t.name === 'instCount') st.instCount = Number(t.value);
        if (t.name === 'instStart') { const iso = parseDateInput(t.value); if (iso) st.instStart = iso; }
        refresh();
      });
      dialog.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest('[data-extra-add]')) { st.extra.push({ description: '', amount: 0 }); render($('#inv-items'), itemsMarkup()); $(`[data-extra-desc="${st.extra.length - 1}"]`)?.focus(); }
        const rm = t.closest('[data-extra-rm]');
        if (rm) { st.extra.splice(Number(rm.dataset.extraRm), 1); render($('#inv-items'), itemsMarkup()); refresh(); }
      });
    },
    async beforeClose(v, dialog) {
      if (v !== 'save') return true;
      const form = /** @type {HTMLFormElement} */ (dialog.querySelector('#inv-form'));
      const t = totals();
      const errors = {};
      if (st.discountType === 'percent' && (st.discountValue < 0 || st.discountValue > 100)) errors.discountValue = 'النسبة من 0 إلى 100';
      if (t.subtotal <= 0) { toastError('اختر بندًا واحدًا على الأقل أو أضف بندًا إضافيًا بمبلغ'); return false; }
      if (st.payMode !== 'later' && st.payAmount !== null && st.payAmount > t.due) errors.payAmount = 'أكبر من المستحق';
      if (!showFieldErrors(form, errors)) return false;
      try {
        const installments = st.payMode === 'installments' && t.rest > 0 ? splitInstallments(t.rest, st.instCount, st.instStart) : [];
        const res = await createInvoice({
          patientId,
          itemIds: [...st.selected],
          extraLines: st.extra,
          discountType: st.discountType,
          discountValue: st.discountValue,
          applyCredit: st.applyCredit,
          payNow: t.pay > 0 ? { amount: t.pay, method: st.method } : null,
          installments,
          notes: formData(form).notes,
        });
        created = res.invoice;
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (created) {
    toastSuccess(`تم إنشاء ${formatInvoiceNo(created.number)}`);
    await offerPrint('invoice', created.id);
  }
  return created;
}

/* ---------- Record payment ---------- */

/**
 * @param {{ patientId?: string, invoiceId?: string }} [preset]
 * @returns {Promise<object|null>}
 */
export async function openPaymentDialog(preset = {}) {
  const st = { patient: preset.patientId ? await getPatient(preset.patientId) : null, account: null, invoiceId: preset.invoiceId ?? '', date: todayISO() };
  const loadAccount = async () => { st.account = st.patient ? await patientAccount(st.patient.id) : null; };
  await loadAccount();

  const openInvoices = () => (st.account?.invoices ?? []).filter((i) => i.status === 'open' || i.status === 'partial');

  const markup = () => {
    if (!st.patient) {
      return html`<div class="field"><label class="field__label" for="pay-psearch">المريض</label>
        <div class="input-group">${ico('search', { size: 20 })}<input class="input" id="pay-psearch" autocomplete="off" placeholder="ابحث بالاسم أو الموبايل أو رقم الملف…"></div>
        <ul class="gsearch__list" id="pay-presults" style="position: static; box-shadow: none; padding: 0; margin-block-start: var(--sp-2)" hidden></ul></div>`;
    }
    const invs = openInvoices();
    if (!st.invoiceId && invs.length === 1) st.invoiceId = invs[0].id;
    const sel = invs.find((i) => i.id === st.invoiceId);
    const nextInst = sel ? invoiceInstallments(sel, sel.paid).find((i) => i.status !== 'paid') : null;
    const owed = invs.reduce((n, i) => n + i.remaining, 0);
    const suggested = sel ? (nextInst ? nextInst.amount - nextInst.covered : sel.remaining) : owed;
    return html`
      <div class="appt-patient">${patientAvatar(st.patient)}<div class="grow"><strong>${st.patient.name}</strong>
        <div class="muted text-sm">المتبقي عليه: <strong>${formatMoney(Math.max(0, st.account.balance))}</strong>${st.account.credit ? ` · رصيد دائن ${formatMoney(st.account.credit)}` : ''}</div></div>
        ${preset.patientId ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-change>تغيير</button>`}</div>
      <label class="field"><span class="field__label">عن</span>
        <select class="select" name="invoiceId">
          ${invs.map((i) => html`<option value="${i.id}" ${i.id === st.invoiceId ? 'selected' : ''}>${formatInvoiceNo(i.number)} · ${formatDate(i.date)} · متبقٍ ${formatMoney(i.remaining)}</option>`)}
          <option value="" ${!st.invoiceId ? 'selected' : ''}>${invs.length ? `سداد الفواتير المفتوحة (الأقدم أولًا) · متبقٍ ${formatMoney(owed)}` : 'دفعة تحت الحساب (رصيد مقدم)'}</option>
        </select></label>
      ${!sel && invs.length ? html`<p class="muted text-sm">${ico('info', { size: 14 })} يُخصم المبلغ من الفواتير المفتوحة بالأقدم أولًا، والزيادة تبقى رصيدًا مقدمًا للمريض.</p>` : ''}
      ${nextInst ? html`<p class="muted text-sm">${ico('calendar-days', { size: 14 })} القسط المستحق ${formatDate(nextInst.dueDate)}: ${formatMoney(nextInst.amount - nextInst.covered)}${nextInst.status === 'overdue' ? ' (متأخر)' : ''}</p>` : ''}
      <label class="field"><span class="field__label">المبلغ (ج.م)<span class="req">*</span></span>
        <input class="input input--ltr" name="amount" inputmode="decimal" value="${suggested ? piastersToInput(suggested) : ''}" placeholder="0" style="font-size: var(--fs-xl); font-weight: 700">
        <span class="field__error" data-error-for="amount"></span></label>
      ${methodChips()}
      ${dateField({ name: 'date', label: 'تاريخ الدفع', value: st.date })}
      <label class="field"><span class="field__label">ملاحظة (اختياري)</span><input class="input" name="note"></label>`;
  };

  let saved = null;
  await openModal({
    title: 'تسجيل دفعة',
    dirty: true,
    icon: 'banknote',
    body: html`<form class="form" id="pay-form" novalidate>${markup()}</form>`,
    actions: [{ label: 'تسجيل الدفعة', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(dialog, close) {
      const form = dialog.querySelector('#pay-form');
      const redraw = () => { render(form, markup()); wire(); };
      let timer;
      const wire = () => {
        const input = /** @type {HTMLInputElement} */ (form.querySelector('#pay-psearch'));
        if (!input) { enhanceDateFields(form); /** @type {HTMLInputElement} */ (form.querySelector('[name=amount]'))?.focus(); return; }
        input.focus();
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const list = form.querySelector('#pay-presults');
            const found = input.value.trim() ? await searchPatients(input.value, { limit: 6 }) : [];
            render(list, found.length ? html`${found.map((p) => html`<li class="gsearch__item" data-pick="${p.id}">${patientAvatar(p)}<span class="gsearch__text"><strong>${p.name}</strong><span class="gsearch__sub ltr">${digits(p.fileNo)}</span></span></li>`)}` : html`<li class="gsearch__empty">لا يوجد مريض مطابق</li>`);
            list.hidden = !input.value.trim();
          }, 120);
        });
      };
      wire();
      form.addEventListener('click', async (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const pick = t.closest('[data-pick]');
        if (pick) { st.patient = await getPatient(pick.dataset.pick); await loadAccount(); redraw(); }
        if (t.closest('[data-change]')) { st.patient = null; st.invoiceId = ''; redraw(); }
      });
      form.addEventListener('change', (e) => {
        const t = /** @type {HTMLSelectElement} */ (e.target);
        if (t.name === 'invoiceId') { st.invoiceId = t.value; redraw(); }
        if (t.name === 'date') { const d = parseDateInput(t.value); if (d) st.date = d; }
      });
      form.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
    },
    async beforeClose(v, dialog) {
      if (v !== 'save') return true;
      const form = /** @type {HTMLFormElement} */ (dialog.querySelector('#pay-form'));
      if (!st.patient) { toastError('اختر المريض'); return false; }
      const data = formData(form);
      const amount = toPiasters(data.amount);
      const sel = openInvoices().find((i) => i.id === data.invoiceId);
      const errors = {};
      const date = parseDateInput(data.date);
      if (!date) errors.date = 'تاريخ غير صحيح';
      else if (date > todayISO()) errors.date = 'لا يمكن تسجيل دفعة بتاريخ قادم';
      if (!(amount > 0)) errors.amount = 'أدخل مبلغًا صحيحًا';
      else if (sel && amount > sel.remaining) errors.amount = `المتبقي على الفاتورة ${formatMoney(sel.remaining)} فقط. اختر «سداد الفواتير المفتوحة» لتُسجَّل الزيادة رصيدًا مقدمًا.`;
      if (!showFieldErrors(form, errors)) return false;
      try {
        saved = await recordPayment({ patientId: st.patient.id, invoiceId: data.invoiceId || null, amount, method: data.method || 'cash', note: data.note, date });
        return true;
      } catch (err) { showFieldErrors(form, { amount: err.message }); return false; }
    },
  });
  if (saved) {
    toastSuccess(`تم تسجيل ${formatMoney(saved.amount)}`);
    await offerPrint('payment', saved.id);
  }
  return saved;
}

/* ---------- Void with reason ---------- */

async function askReason(title, message) {
  let reason = '';
  const res = await openModal({
    title, icon: 'triangle-alert', tone: 'danger',
    body: html`<div class="stack"><p>${message}</p><label class="field"><span class="field__label">سبب الإلغاء<span class="req">*</span></span><input class="input" id="void-reason" placeholder="مثال: خطأ في المبلغ"></label><span class="field__error" id="void-err"></span></div>`,
    actions: [{ label: 'إلغاء نهائي', value: 'ok', variant: 'danger' }, { label: 'رجوع', value: null }],
    onOpen(d) { d.querySelector('#void-reason').focus(); },
    beforeClose(v, d) {
      if (v !== 'ok') return true;
      reason = /** @type {HTMLInputElement} */ (d.querySelector('#void-reason')).value.trim();
      if (!reason) { d.querySelector('#void-err').textContent = 'اكتب سبب الإلغاء'; return false; }
      return true;
    },
  });
  return res === 'ok' ? reason : null;
}

export async function voidPaymentFlow(payment) {
  const reason = await askReason('إلغاء الإيصال؟', `إيصال بمبلغ ${formatMoney(payment.amount)} من ${payment.patientName}. يبقى ظاهرًا في السجل كملغى.`);
  if (!reason) return false;
  try { await voidPayment(payment.id, reason); toastSuccess('تم إلغاء الإيصال'); return true; } catch (err) { toastError(err.message); return false; }
}

export async function voidInvoiceFlow(invoice) {
  const reason = await askReason(`إلغاء ${formatInvoiceNo(invoice.number)}؟`, 'تعود بنودها قابلة للفوترة من جديد، والمبالغ المدفوعة عليها تبقى رصيدًا دائنًا للمريض.');
  if (!reason) return false;
  try { await voidInvoice(invoice.id, reason); toastSuccess('تم إلغاء الفاتورة'); return true; } catch (err) { toastError(err.message); return false; }
}

/** Re-plan the remaining amount of an invoice into installments. */
export async function editInstallmentsDialog(invoice) {
  let count = 3;
  let start = addDays(todayISO(), 30);
  const preview = () => splitInstallments(invoice.remaining, count, start);
  const res = await openModal({
    title: `أقساط ${formatInvoiceNo(invoice.number)}`,
    icon: 'calendar-days',
    body: html`<div class="stack" id="inst-box"></div>`,
    actions: [{ label: 'حفظ الجدول', value: 'ok', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d) {
      const box = d.querySelector('#inst-box');
      const draw = () => {
        render(box, html`
          <p>المتبقي: <strong>${formatMoney(invoice.remaining)}</strong>. الأقساط المدفوعة سابقًا تبقى كما هي.</p>
          <div class="form-grid">
            <label class="field"><span class="field__label">عدد الأقساط</span><select class="select" id="ic">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => html`<option value="${n}" ${n === count ? 'selected' : ''}>${digits(n)}</option>`)}</select></label>
            ${dateField({ name: 'is', label: 'أول قسط', value: start })}
          </div>
          ${preview().map((i, n) => html`<div class="row row--between"><span>القسط ${digits(n + 1)} · ${formatDate(i.dueDate)}</span><strong>${formatMoney(i.amount)}</strong></div>`)}`);
        enhanceDateFields(box);
      };
      draw();
      box.addEventListener('change', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.id === 'ic') count = Number(t.value);
        if (t.name === 'is') { const iso = parseDateInput(t.value); if (iso) start = iso; }
        draw();
      });
    },
  });
  if (res !== 'ok') return false;
  try { await setInstallments(invoice.id, preview()); toastSuccess('تم حفظ جدول الأقساط'); return true; } catch (err) { toastError(err.message); return false; }
}
