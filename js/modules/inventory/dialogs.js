/** Inventory dialogs: add/edit item, receive purchase, adjust stock, item details. */
import { html, render, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, toPiasters, piastersToInput, formatDate, formatDateTime, todayISO, parseDateInput, formatNumber } from '../../core/format.js';
import { normalizeDigits } from '../../core/text.js';
import { UNITS, MOVEMENT_TYPES, ADJUST_REASONS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { openModal } from '../../components/modal.js';
import { textField, selectField, textareaField } from '../../components/form.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { createItem, updateItem, receiveStock, adjustStock, batchesFor, movementsFor, listItems, inventoryHints, unitLabel, EXPIRY_WARNING_DAYS } from '../../services/inventory.js';
import { addDays } from '../../core/time.js';

const num = (v) => Number(normalizeDigits(v).replace(',', '.'));
export const qtyText = (q, unit) => `${formatNumber(q, { decimals: 3 })} ${unitLabel(unit)}`;

const datalist = (id, values) => html`<datalist id="${id}">${values.map((v) => html`<option value="${v}"></option>`)}</datalist>`;

/** @returns {Promise<object|null>} */
export async function itemDialog(item = null) {
  const hints = await inventoryHints();
  let saved = null;
  await openModal({
    title: item ? `تعديل ${item.name}` : 'صنف جديد',
    dirty: true,
    icon: item ? 'pencil' : 'package',
    body: html`
      <form class="form" novalidate>
        ${textField({ name: 'name', label: 'اسم الصنف', value: item?.name ?? '', required: true, placeholder: 'مثال: كمبوزيت A2' })}
        <div class="form-grid">
          ${textField({ name: 'category', label: 'الفئة', value: item?.category ?? '', attrs: html`list="dl-cat"`, placeholder: 'حشوات، تخدير، مستلزمات…' })}
          ${selectField({ name: 'unit', label: 'الوحدة', value: item?.unit ?? 'piece', options: Object.entries(UNITS).map(([value, label]) => ({ value, label })) })}
        </div>
        <div class="form-grid">
          ${textField({ name: 'minQty', label: 'الحد الأدنى (للتنبيه)', value: item?.minQty ?? '', ltr: true, inputmode: 'decimal', hint: 'ينبهك البرنامج عندما تقل الكمية عنه' })}
          ${textField({ name: 'supplier', label: 'المورد المعتاد', value: item?.supplier ?? '', attrs: html`list="dl-sup"` })}
        </div>
        ${textareaField({ name: 'notes', label: 'ملاحظات', value: item?.notes ?? '', rows: 2 })}
        ${datalist('dl-cat', hints.categories)}${datalist('dl-sup', hints.suppliers)}
      </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) { const f = d.querySelector('form'); f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); f.querySelector('input').focus(); },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const min = data.minQty === '' ? 0 : num(data.minQty);
      if (!data.name.trim()) { showFieldErrors(f, { name: 'اسم الصنف مطلوب' }); return false; }
      if (!(min >= 0)) { showFieldErrors(f, { minQty: 'رقم غير صحيح' }); return false; }
      try { saved = item ? await updateItem(item.id, { ...data, minQty: min }) : await createItem({ ...data, minQty: min }); return true; }
      catch (err) { showFieldErrors(f, { name: err.message }); return false; }
    },
  });
  if (saved) toastSuccess(item ? 'تم حفظ الصنف' : 'تمت إضافة الصنف — سجّل الكمية الموجودة بـ«استلام بضاعة»');
  return saved;
}

/** Receive a purchase (new batch). @param {object|null} item preselected */
export async function receiveDialog(item = null) {
  const [items, hints] = await Promise.all([listItems(), inventoryHints()]);
  let ok = false;
  await openModal({
    title: 'استلام بضاعة',
    dirty: true,
    icon: 'download',
    body: html`
      <form class="form" novalidate>
        ${selectField({ name: 'itemId', label: 'الصنف', value: item?.id ?? '', required: true, placeholder: 'اختر الصنف…', options: items.map((i) => ({ value: i.id, label: `${i.name} (${unitLabel(i.unit)})` })) })}
        <div class="form-grid">
          ${textField({ name: 'qty', label: 'الكمية المستلمة', ltr: true, inputmode: 'decimal', required: true })}
          ${textField({ name: 'unitCost', label: 'سعر الوحدة (ج.م)', ltr: true, inputmode: 'decimal', value: item?.costPerUnit ? piastersToInput(item.costPerUnit) : '' })}
        </div>
        <div class="form-grid">
          ${textField({ name: 'batchNo', label: 'رقم التشغيلة (اختياري)', ltr: true })}
          ${dateField({ name: 'expiry', label: 'تاريخ الصلاحية', hint: 'اتركه فارغًا إذا لا ينتهي' })}
        </div>
        <div class="form-grid">
          ${textField({ name: 'supplier', label: 'المورد', value: item?.supplier ?? '', attrs: html`list="dl-sup2"` })}
          ${dateField({ name: 'date', label: 'تاريخ الاستلام', value: todayISO() })}
        </div>
        <p class="muted" id="rcv-total"></p>
        ${can('expenses', 'create') ? html`<label class="check"><input type="checkbox" name="createExpense" checked> تسجيل قيمة الشراء كمصروف (شراء خامات)</label>` : ''}
        ${datalist('dl-sup2', hints.suppliers)}
      </form>`,
    actions: [{ label: 'استلام', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      enhanceDateFields(f);
      const total = () => {
        const q = num(f.querySelector('[name=qty]').value), c = toPiasters(f.querySelector('[name=unitCost]').value || '0');
        d.querySelector('#rcv-total').textContent = q > 0 && c >= 0 ? `الإجمالي: ${formatMoney(Math.round(q * c))}` : '';
      };
      f.addEventListener('input', total);
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
      f.querySelector(item ? '[name=qty]' : 'select').focus();
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const qty = num(data.qty), unitCost = data.unitCost ? toPiasters(data.unitCost) : 0;
      const expiry = data.expiry ? parseDateInput(data.expiry) : null;
      const date = parseDateInput(data.date) ?? todayISO();
      const errors = {};
      if (!data.itemId) errors.itemId = 'اختر الصنف';
      if (!(qty > 0)) errors.qty = 'أدخل كمية صحيحة';
      if (Number.isNaN(unitCost)) errors.unitCost = 'مبلغ غير صحيح';
      if (data.expiry && !expiry) errors.expiry = 'تاريخ غير صحيح';
      if (!showFieldErrors(f, errors)) return false;
      try {
        await receiveStock({ itemId: data.itemId, qty, unitCost, batchNo: data.batchNo, expiry, supplier: data.supplier, date, createExpense: !!data.createExpense });
        ok = true;
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (ok) toastSuccess('تم تسجيل الاستلام');
  return ok;
}

/** Manual stock correction with a reason. */
export async function adjustDialog(item) {
  const batches = await batchesFor(item.id);
  let ok = false;
  await openModal({
    title: `تسوية مخزون ${item.name}`,
    dirty: true,
    icon: 'refresh-cw',
    body: html`
      <form class="form" novalidate>
        <p>الكمية الحالية في البرنامج: <strong>${qtyText(item.qty, item.unit)}</strong></p>
        <div class="segmented" role="radiogroup" aria-label="نوع التسوية">
          <label><input type="radio" name="mode" value="count" checked><span>جرد: الكمية الفعلية</span></label>
          <label><input type="radio" name="mode" value="out"><span>خصم كمية</span></label>
          <label><input type="radio" name="mode" value="in"><span>إضافة كمية</span></label>
        </div>
        ${textField({ name: 'qty', label: 'الكمية', ltr: true, inputmode: 'decimal', required: true })}
        <div id="batch-pick"></div>
        ${selectField({ name: 'reason', label: 'السبب', required: true, placeholder: 'اختر…', options: ADJUST_REASONS.map((r) => ({ value: r, label: r })) })}
        ${textField({ name: 'note', label: 'تفاصيل (اختياري)' })}
      </form>`,
    actions: [{ label: 'حفظ التسوية', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      const drawBatch = () => {
        const mode = /** @type {HTMLInputElement} */ (f.querySelector('[name=mode]:checked')).value;
        render(f.querySelector('#batch-pick'), mode === 'out' && batches.length > 1 ? html`<label class="field"><span class="field__label">من تشغيلة</span>
          <select class="select" name="batchId"><option value="">الأقرب انتهاءً أولًا</option>${batches.map((b) => html`<option value="${b.id}">${b.batchNo || 'بدون رقم'} · ${qtyText(b.qty, item.unit)}${b.expiry ? ` · ينتهي ${formatDate(b.expiry)}` : ''}</option>`)}</select></label>` : '');
      };
      drawBatch();
      f.addEventListener('change', (e) => { if (/** @type {HTMLInputElement} */ (e.target).name === 'mode') drawBatch(); });
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
      f.querySelector('[name=qty]').focus();
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const q = num(data.qty);
      const errors = {};
      if (!(q >= 0) || (data.mode !== 'count' && !(q > 0))) errors.qty = 'أدخل كمية صحيحة';
      if (!data.reason) errors.reason = 'اختر السبب';
      if (!showFieldErrors(f, errors)) return false;
      const delta = data.mode === 'count' ? q - item.qty : data.mode === 'in' ? q : -q;
      if (!delta) { toastSuccess('الكمية مطابقة — لا حاجة لتسوية'); return true; }
      try {
        await adjustStock({ itemId: item.id, delta, reason: data.note ? `${data.reason}: ${data.note}` : data.reason, batchId: data.batchId || null });
        ok = true;
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (ok) toastSuccess('تم حفظ التسوية');
  return ok;
}

/** Item details: batches with expiry + full movement history. */
export async function itemDetails(item) {
  const [batches, moves] = await Promise.all([batchesFor(item.id), movementsFor(item.id)]);
  const soon = addDays(todayISO(), EXPIRY_WARNING_DAYS);
  await openModal({
    title: item.name,
    dirty: true,
    icon: 'package',
    size: 'lg',
    body: html`
      <div class="stack">
        <div class="totals">
          <div class="totals__item totals__item--hero"><div class="totals__label">الكمية</div><div class="totals__value">${qtyText(item.qty, item.unit)}</div></div>
          <div class="totals__item"><div class="totals__label">الحد الأدنى</div><div class="totals__value">${qtyText(item.minQty, item.unit)}</div></div>
          <div class="totals__item"><div class="totals__label">متوسط تكلفة الوحدة</div><div class="totals__value">${formatMoney(Math.round(item.costPerUnit))}</div></div>
          <div class="totals__item"><div class="totals__label">قيمة المخزون</div><div class="totals__value">${formatMoney(Math.round(Math.max(0, item.qty) * item.costPerUnit))}</div></div>
        </div>
        <div><span class="field__label">التشغيلات الموجودة</span>
          ${batches.length ? html`<div class="table-wrap" style="box-shadow:none; background: var(--c-surface-2); margin-block-start: var(--sp-2)"><table class="table">
            <thead><tr><th>التشغيلة</th><th>الكمية</th><th>الصلاحية</th><th>التكلفة</th><th>المورد</th><th>الاستلام</th></tr></thead>
            <tbody>${batches.map((b) => html`<tr><td class="ltr">${b.batchNo || '—'}</td><td>${qtyText(b.qty, item.unit)}</td>
              <td>${b.expiry ? html`${formatDate(b.expiry)} ${b.expiry < todayISO() ? html`<span class="badge badge--danger">منتهي</span>` : b.expiry <= soon ? html`<span class="badge badge--warning">قريب</span>` : ''}` : '—'}</td>
              <td>${formatMoney(Math.round(b.unitCost))}</td><td>${b.supplier || '—'}</td><td>${formatDate(b.receivedAt)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">لا توجد كمية حاليًا.</p>`}
        </div>
        <div><span class="field__label">سجل الحركات</span>
          ${moves.length ? html`<ul class="timeline" style="margin-block-start: var(--sp-2)">${moves.slice(0, 150).map((m) => html`<li class="timeline__item">
            <span class="badge badge--${MOVEMENT_TYPES[m.type].tone}">${MOVEMENT_TYPES[m.type].label}</span>
            <span class="timeline__main"><strong class="ltr">${m.qty > 0 ? '+' : ''}${formatNumber(m.qty, { decimals: 3 })}</strong> ${unitLabel(m.unit)}
              ${m.procedureName ? html` · ${m.procedureName}${m.patientName ? ` — ${m.patientName}` : ''}` : ''}${m.reason ? html` · ${m.reason}` : ''}${m.returned ? ' · أُرجع' : ''}
              <br><span class="subtle">${formatDateTime(m.at)}${m.userName ? ` · ${m.userName}` : ''}${m.cost ? ` · ${formatMoney(m.cost)}` : ''}</span></span>
          </li>`)}</ul>` : html`<p class="muted">لا توجد حركات بعد.</p>`}
        </div>
      </div>`,
    actions: [{ label: 'إغلاق', value: true }],
  });
}

