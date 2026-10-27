/**
 * Prescription editor (patient, templates, medicine lines, safety warnings), its A5 print,
 * and the reusable medicine-lines editor used by prescription templates.
 */
import { html, ico, render, formData } from '../../core/dom.js';
import { todayISO, formatDate, formatAge, parseDateInput } from '../../core/format.js';
import { MED_FORMS } from '../../core/labels.js';
import { currentUser } from '../../core/session.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { selectField, textareaField } from '../../components/form.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { patientPicker, wirePatientPicker } from '../../components/patient-picker.js';
import { printHTML } from '../../components/print.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { getPatient } from '../../services/patients.js';
import { listDoctors } from '../../services/schedule.js';
import {
  listMedicines, listRxTemplates, lineFromMedicine, rxWarnings, createPrescription, updatePrescription,
  formatRxNo, doctorLabel,
} from '../../services/prescriptions.js';

/* ---------- Lines editor ---------- */

/** @param {{ lines: object[], warnings?: Array<{ line: string }> }} st */
export function linesMarkup(st) {
  const warned = new Set((st.warnings ?? []).map((w) => w.line));
  return html`
    ${st.lines.length ? html`<ol class="rx-lines">${st.lines.map((l, i) => html`
      <li class="rx-line ${warned.has(l.name) ? 'rx-line--warn' : ''}">
        <div class="rx-line__fields">
          <input class="input input--ltr rx-line__name" data-li="${i}" data-f="name" value="${l.name}" aria-label="اسم الدواء" dir="ltr">
          <input class="input" data-li="${i}" data-f="dose" value="${l.dose}" placeholder="الجرعة: قرص كل 8 ساعات" aria-label="الجرعة">
          <input class="input" data-li="${i}" data-f="duration" value="${l.duration}" placeholder="المدة: 5 أيام" aria-label="المدة">
          <input class="input rx-line__notes" data-li="${i}" data-f="notes" value="${l.notes}" placeholder="ملاحظة (اختياري)" aria-label="ملاحظة">
        </div>
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-rm="${i}" aria-label="حذف ${l.name}">${ico('trash-2', { size: 18 })}</button>
      </li>`)}</ol>` : html`<p class="muted">لم تُضف أدوية بعد — اختر قالبًا أو ابحث عن دواء.</p>`}
    <div class="rx-add">
      <div class="input-group">${ico('plus', { size: 20 })}<input class="input" id="rx-med" autocomplete="off" placeholder="أضف دواءً: اكتب الاسم (Amoxicillin، Brufen…)" aria-label="إضافة دواء" dir="auto"></div>
      <ul class="gsearch__list" id="rx-med-list" hidden></ul>
    </div>`;
}

/**
 * Wires a lines editor inside `box` (re-renders it on add/remove).
 * @param {HTMLElement} box @param {{ lines: object[] }} st @param {object[]} medicines
 * @param {() => void} [onChange] called after any change (to refresh warnings)
 */
export function wireLinesEditor(box, st, medicines, onChange = () => {}) {
  let matches = [];
  const redraw = () => { render(box, linesMarkup(st)); onChange(); };
  const add = (line) => { st.lines.push(line); redraw(); /** @type {HTMLInputElement} */ (box.querySelector('#rx-med'))?.focus(); };
  const search = (q) => {
    const list = box.querySelector('#rx-med-list');
    const n = q.trim().toLowerCase();
    matches = n ? medicines.filter((m) => m.name.toLowerCase().includes(n)).slice(0, 8) : [];
    render(list, html`${matches.map((m, i) => html`<li class="gsearch__item" data-add="${i}"><span class="gsearch__text"><strong class="ltr">${m.name}</strong><span class="gsearch__sub">${MED_FORMS[m.form] ?? ''} · ${m.dose}</span></span></li>`)}
      <li class="gsearch__item" data-add-custom><span class="gsearch__text"><strong>إضافة «<span class="ltr">${q.trim()}</span>» كدواء غير مسجل</strong></span></li>`);
    list.hidden = !n;
  };
  box.addEventListener('input', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.id === 'rx-med') { search(t.value); return; }
    if (t.dataset.li !== undefined) { st.lines[Number(t.dataset.li)][t.dataset.f] = t.value; if (t.dataset.f === 'name') onChange(); }
  });
  box.addEventListener('keydown', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.id !== 'rx-med' || e.key !== 'Enter') return;
    e.preventDefault();
    if (matches[0]) add(lineFromMedicine(matches[0]));
    else if (t.value.trim()) add({ medicineId: null, name: t.value.trim(), form: '', dose: '', duration: '', notes: '' });
  });
  box.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const pick = t.closest('[data-add]');
    if (pick) { add(lineFromMedicine(matches[Number(pick.dataset.add)])); return; }
    if (t.closest('[data-add-custom]')) {
      const v = /** @type {HTMLInputElement} */ (box.querySelector('#rx-med')).value.trim();
      if (v) add({ medicineId: null, name: v, form: '', dose: '', duration: '', notes: '' });
      return;
    }
    const rm = t.closest('[data-rm]');
    if (rm) { st.lines.splice(Number(rm.dataset.rm), 1); redraw(); }
  });
  redraw();
}

function warningsMarkup(warnings) {
  if (!warnings.length) return '';
  const critical = warnings.filter((w) => w.level === 'critical');
  return html`<div class="rx-warnings ${critical.length ? '' : 'rx-warnings--caution'}" role="alert">
    <strong>${ico('triangle-alert', { size: 18 })} تنبيهات من التاريخ الطبي</strong>
    <ul style="margin:0; padding:0">${warnings.map((w) => html`<li><span class="ltr">${w.line}</span>: ${w.text}</li>`)}</ul>
  </div>`;
}

/* ---------- Prescription dialog ---------- */

/**
 * New or edit prescription. Resolves with the saved record (or null).
 * @param {{ prescription?: object, patientId?: string, treatmentItemId?: string, templateId?: string, repeatOf?: object }} [preset]
 *   repeatOf: start a new prescription with the lines and notes of an earlier one
 */
export async function prescriptionDialog(preset = {}) {
  const editing = preset.prescription ?? null;
  const [medicines, templates, doctors] = await Promise.all([listMedicines({ includeInactive: true }), listRxTemplates(), listDoctors()]);
  const active = medicines.filter((m) => m.active !== false);
  const byId = new Map(medicines.map((m) => [m.id, m]));
  const st = {
    patient: await (editing?.patientId ?? preset.patientId ? getPatient(editing?.patientId ?? preset.patientId) : null),
    lines: (editing ?? preset.repeatOf)?.lines.map((l) => ({ ...l })) ?? [],
    warnings: [],
  };
  const preTemplate = templates.find((t) => t.id === preset.templateId);
  if (preTemplate) st.lines = preTemplate.lines.map((l) => ({ ...l }));
  const me = currentUser();
  const doctorOptions = doctors.map((d) => doctorLabel(d));
  const doctorValue = editing?.doctorName ?? (me?.isDoctor ? doctorLabel(me) : doctorOptions[0] ?? '');
  if (doctorValue && !doctorOptions.includes(doctorValue)) doctorOptions.unshift(doctorValue);
  let saved = null;

  const refreshWarnings = (d) => {
    st.warnings = st.patient ? rxWarnings(st.patient, st.lines, byId) : [];
    render(d.querySelector('#rx-warn'), warningsMarkup(st.warnings));
    d.querySelectorAll('.rx-line').forEach((li, i) => li.classList.toggle('rx-line--warn', st.warnings.some((w) => w.line === st.lines[i]?.name)));
  };

  const res = await openModal({
    title: editing ? `تعديل الروشتة ${formatRxNo(editing.number)}` : 'روشتة جديدة',
    dirty: true,
    icon: 'pill', size: 'lg',
    body: html`<form class="form" novalidate>
      <div data-pp>${patientPicker({ patient: st.patient, locked: !!(editing || preset.patientId) })}</div>
      ${templates.length && !editing ? html`<div class="stack-sm"><span class="field__label">قوالب جاهزة</span>
        <div class="chips">${templates.map((t) => html`<button type="button" class="chip" data-tpl="${t.id}">${t.name}</button>`)}</div></div>` : ''}
      <div id="rx-warn"></div>
      <div id="rx-lines-box" class="stack-sm"></div>
      ${textareaField({ name: 'notes', label: 'تعليمات إضافية', value: (editing ?? preset.repeatOf)?.notes ?? '', rows: 2, placeholder: 'مثال: مضمضة بماء دافئ وملح بعد 24 ساعة' })}
      <div class="form-grid">
        ${doctorOptions.length ? selectField({ name: 'doctorName', label: 'الطبيب', value: doctorValue, options: doctorOptions.map((d) => ({ value: d, label: d })) }) : ''}
        ${dateField({ name: 'date', label: 'التاريخ', value: editing?.date ?? todayISO() })}
      </div>
    </form>`,
    actions: [{ label: 'حفظ وطباعة', value: 'print', variant: 'primary' }, { label: 'حفظ', value: 'save' }, { label: 'إغلاق', value: null }],
    onOpen(d) {
      const f = d.querySelector('form');
      enhanceDateFields(f);
      wireLinesEditor(f.querySelector('#rx-lines-box'), st, active, () => refreshWarnings(d));
      if (!editing && !preset.patientId) wirePatientPicker(f.querySelector('[data-pp]'), (p) => { st.patient = p; refreshWarnings(d); });
      f.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement} */ (e.target).closest('[data-tpl]');
        if (!b) return;
        const tpl = templates.find((t) => t.id === b.dataset.tpl);
        st.lines.push(...tpl.lines.map((l) => ({ ...l })).filter((l) => !st.lines.some((x) => x.name === l.name)));
        render(f.querySelector('#rx-lines-box'), linesMarkup(st));
        refreshWarnings(d);
      });
      f.addEventListener('submit', (e) => e.preventDefault());
    },
    async beforeClose(v, d) {
      if (v !== 'save' && v !== 'print') return true;
      const data = formData(d.querySelector('form'));
      if (!st.patient) { toastError('اختر المريض'); return false; }
      if (!st.lines.some((l) => l.name.trim())) { toastError('أضف دواءً واحدًا على الأقل'); return false; }
      const date = parseDateInput(data.date);
      if (!date) { toastError('تاريخ غير صحيح'); return false; }
      if (st.warnings.some((w) => w.level === 'critical')) {
        const ok = await confirmDialog({ title: 'يوجد تحذير طبي', message: html`${st.warnings.filter((w) => w.level === 'critical').map((w) => html`<span class="ltr">${w.line}</span>: ${w.text}<br>`)}<br>هل تريد حفظ الروشتة رغم ذلك؟`, confirmLabel: 'حفظ رغم التحذير', danger: true });
        if (!ok) return false;
      }
      const input = { patientId: st.patient.id, lines: st.lines, notes: data.notes, doctorName: data.doctorName ?? '', date, treatmentItemId: preset.treatmentItemId };
      try {
        saved = editing ? await updatePrescription(editing.id, input) : await createPrescription(input);
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (!saved) return null;
  toastSuccess(editing ? 'تم حفظ الروشتة' : `تم حفظ الروشتة ${formatRxNo(saved.number)}`);
  if (res === 'print') printPrescription(saved, st.patient);
  return saved;
}

/* ---------- Print (A5) ---------- */

export function printPrescription(rx, patient) {
  printHTML(html`
    <div class="rx-print">
      ${rx.doctorName ? html`<div class="rx-print__doctor">${rx.doctorName}</div>` : ''}
      <div class="rx-print__meta">
        <span>الاسم: <strong>${rx.patientName}</strong></span>
        ${patient?.dob ? html`<span>السن: ${formatAge(patient.dob)}</span>` : ''}
        <span>التاريخ: ${formatDate(rx.date)}</span>
        <span class="ltr">${formatRxNo(rx.number)}</span>
      </div>
      <div class="rx-print__symbol" aria-hidden="true">℞</div>
      <ol class="rx-print__lines">${rx.lines.map((l) => html`<li>
        <div class="rx-print__drug" dir="ltr">${l.name}</div>
        <div class="rx-print__dose">${[l.dose, l.duration].filter(Boolean).join(' — ')}</div>
        ${l.notes ? html`<div class="rx-print__note">${l.notes}</div>` : ''}
      </li>`)}</ol>
      ${rx.notes ? html`<div class="rx-print__notes">${rx.notes}</div>` : ''}
      <div class="rx-print__sign"><span>توقيع الطبيب</span></div>
    </div>`, { size: 'a5' });
}

/** Short text of a prescription's drugs: "Amoxicillin 500 mg، Ibuprofen 400 mg". */
export const drugsText = (rx) => rx.lines.map((l) => l.name.replace(/\s*\(.*\)$/, '')).join('، ');

