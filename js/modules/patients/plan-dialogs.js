/** Dialogs for the treatment plan tab: add item, edit item, done confirmation, quote printing. */
import { html, render, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, toPiasters, piastersToInput, digits, formatDate } from '../../core/format.js';
import { normalizeDigits } from '../../core/text.js';
import { parseTeeth, sortTeeth, surfacesText } from '../../core/teeth.js';
import { CONDITION } from '../../core/chart-conditions.js';
import { PLAN_STATUS } from '../../core/labels.js';
import { openModal } from '../../components/modal.js';
import { textField, textareaField } from '../../components/form.js';
import { printHTML } from '../../components/print.js';
import { addItems, updateItem, itemMath, describeDone, planTotals } from '../../services/treatment.js';
import { stockPreview, unitLabel } from '../../services/inventory.js';

const SURFACE_RE = /^[MODBLIFP]*$/i;

/** Converts typed surfaces (MOD, also I/F/P) to canonical codes. Exported for tests. */
export function parseSurfaces(text) {
  const map = { I: 'O', F: 'B', P: 'L' };
  return [...new Set([...String(text ?? '').toUpperCase().replace(/[^A-Z]/g, '')].map((c) => map[c] ?? c).filter((c) => 'MODBL'.includes(c)))];
}

/** Add a procedure without the chart. @returns {Promise<boolean>} */
export async function addItemDialog(plan, catalog) {
  const all = catalog.flatMap((c) => c.procedures);
  const res = await openModal({
    title: `إضافة إجراء إلى «${plan.name}»`,
    icon: 'plus',
    body: html`
      <form class="form" novalidate>
        <div class="field">
          <label class="field__label" for="add-proc">الإجراء<span class="req">*</span></label>
          <select class="select" id="add-proc" name="procedureId" required>
            <option value="">اختر…</option>
            ${catalog.map((cat) => html`<optgroup label="${cat.name}">${cat.procedures.map((p) => html`<option value="${p.id}">${p.name}${p.price ? ` — ${formatMoney(p.price)}` : ''}</option>`)}</optgroup>`)}
          </select>
          <span class="field__error" data-error-for="procedureId"></span>
        </div>
        ${textField({ name: 'teeth', label: 'الأسنان', ltr: true, placeholder: '16, 26 أو 11-13', hint: 'أرقام FDI مفصولة بفاصلة. اتركه فارغًا للإجراءات العامة مثل التنظيف.' })}
        ${textField({ name: 'surfaces', label: 'الأسطح (للحشوات)', ltr: true, placeholder: 'MOD' })}
        ${textareaField({ name: 'notes', label: 'ملاحظات', rows: 2 })}
      </form>`,
    actions: [{ label: 'إضافة', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) { d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); d.querySelector('select').focus(); },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const proc = all.find((p) => p.id === data.procedureId);
      const teeth = parseTeeth(data.teeth);
      const errors = {};
      if (!proc) errors.procedureId = 'اختر الإجراء';
      if (data.teeth.trim() && !teeth.length) errors.teeth = 'أرقام أسنان غير صحيحة (مثال: 16 أو 11-13)';
      if (proc?.perTooth && !teeth.length) errors.teeth = 'هذا الإجراء لكل سن؛ اكتب رقم السن';
      if (!SURFACE_RE.test(data.surfaces.trim())) errors.surfaces = 'استخدم الحروف M O D B L فقط';
      if (!showFieldErrors(f, errors)) return false;
      try {
        await addItems(plan.id, { procedure: proc, teeth, surfaces: parseSurfaces(data.surfaces), notes: data.notes.trim() });
        return true;
      } catch (err) { showFieldErrors(f, { procedureId: err.message }); return false; }
    },
  });
  return res === 'save';
}

/** Edit price / discount / teeth / sessions / notes. @returns {Promise<boolean>} */
export async function editItemDialog(item) {
  const editingLocked = !!item.invoiceId;
  const res = await openModal({
    title: `تعديل «${item.procedureName}»`,
    icon: 'pencil',
    body: html`
      <form class="form" novalidate>
        <div class="form-grid">
          ${textField({ name: 'teeth', label: 'الأسنان', value: (item.teeth ?? []).join(', '), ltr: true })}
          ${textField({ name: 'surfaces', label: 'الأسطح', value: item.teeth?.length ? surfacesText(item.teeth[0], item.surfaces ?? []) : (item.surfaces ?? []).join(''), ltr: true, placeholder: CONDITION[item.chartEffect]?.surface ? 'MOD' : '—' })}
        </div>
        <div class="form-grid">
          ${textField({ name: 'unitPrice', label: 'السعر (ج.م)', value: piastersToInput(item.unitPrice), ltr: true, inputmode: 'decimal' })}
          ${textField({ name: 'qty', label: 'الكمية', value: item.qty ?? 1, ltr: true, inputmode: 'numeric' })}
        </div>
        <fieldset class="field" style="border:0;padding:0;margin:0">
          <legend class="field__label" style="margin-block-end: var(--sp-2)">الخصم</legend>
          <div class="row">
            <div class="segmented">
              <label><input type="radio" name="discountType" value="amount" ${item.discountType !== 'percent' ? 'checked' : ''}><span>مبلغ ج.م</span></label>
              <label><input type="radio" name="discountType" value="percent" ${item.discountType === 'percent' ? 'checked' : ''}><span>نسبة %</span></label>
            </div>
            <input class="input input--ltr" name="discountValue" inputmode="decimal" style="inline-size: 140px" aria-label="قيمة الخصم"
              value="${item.discountType === 'percent' ? item.discountValue : item.discountValue ? piastersToInput(item.discountValue) : ''}" placeholder="0">
          </div>
          <span class="field__error" data-error-for="discountValue"></span>
        </fieldset>
        <div class="form-grid">
          ${textField({ name: 'sessionsPlanned', label: 'الجلسات المخططة', value: item.sessionsPlanned ?? 1, ltr: true, inputmode: 'numeric' })}
          ${textField({ name: 'sessionsDone', label: 'الجلسات المنفذة', value: item.sessionsDone ?? 0, ltr: true, inputmode: 'numeric' })}
        </div>
        ${textareaField({ name: 'notes', label: 'ملاحظات', value: item.notes ?? '', rows: 2 })}
        <div class="totals"><div class="totals__item totals__item--hero"><div class="totals__label">صافي البند</div><div class="totals__value" id="live-total">${formatMoney(item.total ?? itemMath(item).total)}</div></div></div>
      </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      if (editingLocked) f.querySelectorAll('[name=unitPrice],[name=qty],[name=discountValue],[name=discountType]').forEach((i) => { i.disabled = true; });
      const live = () => {
        const x = read(formData(f));
        render(d.querySelector('#live-total'), x.errors ? '—' : formatMoney(itemMath(x.patch).total));
      };
      f.addEventListener('input', live);
      f.addEventListener('change', live);
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const { patch, errors } = read(formData(f));
      if (!showFieldErrors(f, errors ?? {})) return false;
      try { await updateItem(item.id, editingLocked ? { teeth: patch.teeth, surfaces: patch.surfaces, sessionsPlanned: patch.sessionsPlanned, sessionsDone: patch.sessionsDone, notes: patch.notes } : patch); return true; }
      catch (err) { showFieldErrors(f, { notes: err.message }); return false; }
    },
  });
  return res === 'save';

  function read(data) {
    const errors = {};
    const teeth = parseTeeth(data.teeth);
    if (data.teeth?.trim() && !teeth.length) errors.teeth = 'أرقام أسنان غير صحيحة';
    const unitPrice = toPiasters(data.unitPrice || '0');
    if (Number.isNaN(unitPrice)) errors.unitPrice = 'مبلغ غير صحيح';
    const qty = Number(normalizeDigits(data.qty));
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) errors.qty = 'من 1 إلى 99';
    const type = data.discountType === 'percent' ? 'percent' : 'amount';
    const rawDisc = String(data.discountValue ?? '').trim();
    let discountValue = 0;
    if (rawDisc) {
      if (type === 'percent') {
        discountValue = Number(normalizeDigits(rawDisc));
        if (!(discountValue >= 0 && discountValue <= 100)) errors.discountValue = 'النسبة من 0 إلى 100';
      } else {
        discountValue = toPiasters(rawDisc);
        if (Number.isNaN(discountValue)) errors.discountValue = 'مبلغ غير صحيح';
        else if (discountValue > unitPrice * qty) errors.discountValue = 'الخصم أكبر من السعر';
      }
    }
    const sp = Number(normalizeDigits(data.sessionsPlanned)), sd = Number(normalizeDigits(data.sessionsDone));
    if (!Number.isInteger(sp) || sp < 1 || sp > 20) errors.sessionsPlanned = 'من 1 إلى 20';
    if (!Number.isInteger(sd) || sd < 0 || sd > 20) errors.sessionsDone = 'من 0 إلى 20';
    if (!SURFACE_RE.test(String(data.surfaces ?? '').trim())) errors.surfaces = 'استخدم الحروف M O D B L فقط';
    const patch = { teeth: sortTeeth(teeth), surfaces: parseSurfaces(data.surfaces), unitPrice, qty, discountType: type, discountValue, sessionsPlanned: sp, sessionsDone: sd, notes: data.notes.trim() };
    return { patch, errors: Object.keys(errors).length ? errors : null };
  }
}

/**
 * Confirms marking an item done: lists the chart effect and the materials that will be
 * deducted from stock, with quantities the user can correct.
 * @returns {Promise<null | { consumption: Array<{ itemId: string, qty: number }> }>}
 */
export async function confirmDone(item) {
  const effects = describeDone(item);
  const lines = await stockPreview(item);
  let consumption = lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));
  const res = await openModal({
    title: `تم «${item.procedureName}»؟`,
    icon: 'circle-check',
    body: html`
      <div class="stack">
        <p>سيُسجّل البند كمنتهٍ بتاريخ اليوم.</p>
        ${effects.length ? html`<ul style="margin: 0; padding-inline-start: var(--sp-5)">${effects.map((e) => html`<li>${e}</li>`)}</ul>` : ''}
        ${lines.length ? html`
          <div class="stack-sm">
            <span class="field__label">المواد التي ستُخصم من المخزون (عدّل الكمية الفعلية إن اختلفت)</span>
            ${lines.map((l, i) => html`<div class="row" style="gap: var(--sp-2)">
              <span class="grow">${l.name}</span>
              <input class="input input--ltr" data-cq="${i}" value="${l.qty}" inputmode="decimal" style="inline-size: 100px" aria-label="كمية ${l.name}">
              <span class="muted text-sm" style="min-inline-size: 44px">${unitLabel(l.unit)}</span>
              ${l.available < l.qty ? html`<span class="badge badge--warning" title="المتوفر ${l.available}">غير كافٍ</span>` : ''}
            </div>`)}
          </div>` : ''}
      </div>`,
    actions: [{ label: 'تم الانتهاء', value: 'ok', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d) {
      d.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.dataset.cq !== undefined) consumption[Number(t.dataset.cq)].qty = Math.max(0, Number(normalizeDigits(t.value).replace(',', '.')) || 0);
      });
    },
  });
  return res === 'ok' ? { consumption } : null;
}

/* ---------- Quote printing ---------- */

const quoteTable = (items) => html`
  <table class="print-table">
    <thead><tr><th>#</th><th>الإجراء</th><th>الأسنان</th><th class="num">السعر</th><th class="num">الكمية</th><th class="num">الخصم</th><th class="num">الإجمالي</th></tr></thead>
    <tbody>${items.map((i, n) => {
      const m = itemMath(i);
      return html`<tr><td>${digits(n + 1)}</td><td>${i.procedureName}${i.notes ? html`<br><small>${i.notes}</small>` : ''}</td>
        <td class="ltr">${(i.teeth ?? []).join(', ') || '—'}${i.surfaces?.length && i.teeth?.length ? ` (${surfacesText(i.teeth[0], i.surfaces)})` : ''}</td>
        <td class="num">${formatMoney(i.unitPrice)}</td><td class="num">${digits(i.qty ?? 1)}</td>
        <td class="num">${m.discount ? formatMoney(m.discount) : '—'}</td><td class="num"><strong>${formatMoney(m.total)}</strong></td></tr>`;
    })}</tbody>
  </table>`;

const totalsBlock = (items) => {
  const t = planTotals(items);
  return html`<table class="print-table" style="inline-size: 60%; margin-inline-start: auto; margin-block-start: 3mm">
    <tbody>
      <tr><th>الإجمالي قبل الخصم</th><td class="num">${formatMoney(t.gross)}</td></tr>
      ${t.discount ? html`<tr><th>الخصم</th><td class="num">${formatMoney(t.discount)}</td></tr>` : ''}
      <tr><th>الإجمالي المستحق</th><td class="num"><strong>${formatMoney(t.net)}</strong></td></tr>
    </tbody></table>`;
};

/**
 * Prints a quote for one or several plans (several = comparison of options).
 * @param {object} patient @param {Array<{ plan: object, items: object[] }>} plans
 */
export function printQuote(patient, plans) {
  const live = plans.map(({ plan, items }) => ({ plan, items: items.filter((i) => i.status !== 'cancelled') }));
  printHTML(html`
    <p><strong>المريض:</strong> ${patient.name} &nbsp; · &nbsp; <strong>رقم الملف:</strong> <span class="ltr">${patient.fileNo}</span> &nbsp; · &nbsp; <strong>التاريخ:</strong> ${formatDate(new Date())}</p>
    ${live.length > 1 ? html`
      <h2 style="font-size: 12pt; margin-block: 5mm 2mm">ملخص الاختيارات</h2>
      <table class="print-table"><thead><tr><th>الخطة</th><th class="num">عدد البنود</th><th class="num">الإجمالي</th></tr></thead>
        <tbody>${live.map(({ plan, items }) => html`<tr><td>${plan.name}</td><td class="num">${digits(items.length)}</td><td class="num"><strong>${formatMoney(planTotals(items).net)}</strong></td></tr>`)}</tbody></table>` : ''}
    ${live.map(({ plan, items }) => html`
      <section style="break-inside: avoid; margin-block-start: 6mm">
        <h2 style="font-size: 12pt; margin-block-end: 2mm">${plan.name}${live.length === 1 && plan.status !== 'active' ? ` (${PLAN_STATUS[plan.status]?.label ?? ''})` : ''}</h2>
        ${items.length ? html`${quoteTable(items)}${totalsBlock(items)}` : html`<p>لا توجد بنود.</p>`}
        ${plan.notes ? html`<p style="margin-block-start: 2mm">${plan.notes}</p>` : ''}
      </section>`)}
    <p style="margin-block-start: 8mm; font-size: 9.5pt">هذه الأسعار تقديرية وصالحة لمدة 30 يومًا من تاريخه، وقد تتغير إذا تغيّرت الخطة العلاجية بعد الكشف.</p>
    <div style="display:flex; justify-content: space-between; margin-block-start: 14mm">
      <span>توقيع المريض: ....................</span><span>توقيع الطبيب: ....................</span>
    </div>`, { title: live.length > 1 ? 'عرض سعر — مقارنة خطط العلاج' : 'عرض سعر خطة العلاج' });
}

