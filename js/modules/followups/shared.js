/**
 * Follow-up rows and dialogs shared by the follow-ups page and the patient file tab,
 * plus the "send post-op instructions" dialog used after completing a treatment item.
 */
import { html, ico, render, on, formData, showFieldErrors, keep } from '../../core/dom.js';
import { digits, todayISO, formatDate, formatDateTime, parseDateInput } from '../../core/format.js';
import { addDays, daysBetween, dayLabel } from '../../core/time.js';
import { FOLLOWUP_TYPES, FOLLOWUP_STATUS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textareaField, segmentedField } from '../../components/form.js';
import { dateField, enhanceDateFields, isoToInput } from '../../components/date-field.js';
import { patientPicker, wirePatientPicker } from '../../components/patient-picker.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { getPatient } from '../../services/patients.js';
import {
  followUpMessage, instructionsMessage, markFollowUpSent, completeFollowUp, reopenFollowUp,
  skipFollowUp, snoozeFollowUp, createFollowUp,
} from '../../services/followups.js';
import { repos } from '../../data/index.js';
import { tr, inArabic } from '../../core/i18n.js';

/** "اليوم" · "غدًا" · "متأخر 3 أيام" · "الخميس 22 أكتوبر" */
export function dueText(due, today = todayISO()) {
  const d = daysBetween(today, due);
  if (d === 0) return 'اليوم';
  if (d === 1) return 'غدًا';
  if (d === -1) return 'متأخر يومًا';
  if (d < 0) return tr`متأخر ${digits(-d)} ${-d <= 10 ? 'أيام' : 'يومًا'}`;
  return dayLabel(due, { year: due.slice(0, 4) !== today.slice(0, 4) });
}

/**
 * One follow-up row.
 * @param {object} f @param {{ showPatient?: boolean }} [o]
 */
export function followUpRow(f, { showPatient = true } = {}) {
  const t = FOLLOWUP_TYPES[f.type] ?? FOLLOWUP_TYPES.call;
  const today = todayISO();
  const pending = f.status === 'pending';
  const late = pending && f.dueDate < today;
  const edit = can('followups', 'edit');
  return html`
    <li class="fu-row ${pending ? '' : 'fu-row--closed'}" data-fu="${f.id}">
      <span class="fu-row__icon fu-row__icon--${t.tone}" title="${t.label}">${ico(t.icon, { size: 20 })}</span>
      <div class="fu-row__main">
        <div class="fu-row__title">
          ${showPatient ? html`<a href="${href('/patients/:id', { id: f.patientId }, { tab: 'followups' })}">${f.patientName || 'مريض'}</a> · ` : ''}<span>${t.label}</span>
          ${f.procedureName ? html`<span class="muted"> — ${f.procedureName}</span>` : ''}
        </div>
        <div class="fu-row__meta">
          ${pending
            ? html`<span class="badge ${late ? 'badge--danger' : f.dueDate === today ? 'badge--warning' : ''}">${ico('calendar-days', { size: 14 })} ${dueText(f.dueDate, today)}</span>`
            : html`<span class="badge badge--dot badge--${FOLLOWUP_STATUS[f.status].tone}">${FOLLOWUP_STATUS[f.status].label}</span> <span>${f.doneAt ? formatDateTime(f.doneAt) : ''}${f.doneBy ? ` · ${f.doneBy}` : ''}</span>`}
          ${f.note ? html`<span>${f.note}</span>` : ''}
          ${f.sentAt ? html`<span class="fu-row__sent">${ico('circle-check', { size: 14 })} أُرسلت رسالة ${formatDateTime(f.sentAt)}</span>` : ''}
        </div>
        ${f.outcome ? html`<div class="fu-row__outcome">${ico('stethoscope', { size: 14 })} ${f.outcome}</div>` : ''}
      </div>
      <div class="fu-row__actions">
        ${pending && edit ? html`
          <a class="btn btn--whatsapp btn--sm" data-fu-wa href="#" target="_blank" rel="noopener" aria-label="إرسال الرسالة واتساب">${ico('message-circle', { size: 18 })} واتساب</a>
          <button type="button" class="btn btn--soft btn--sm" data-fu-done>${ico('check', { size: 18 })}<span class="hide-sm">تم</span></button>` : ''}
        ${edit || can('followups', 'delete') ? html`<button type="button" class="btn btn--icon btn--sm" data-fu-menu aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
      </div>
    </li>`;
}

/**
 * Puts the ready WhatsApp link (message included) on every row's «واتساب», so a tap opens
 * WhatsApp straight away; phones block opening it after waiting for the message.
 */
async function fillWhatsAppLinks(box, list) {
  const byId = new Map(list.map((f) => [f.id, f]));
  const links = [...box.querySelectorAll('[data-fu-wa]')];
  await Promise.all(links.map(async (a) => {
    const f = byId.get(a.closest('[data-fu]')?.dataset.fu);
    if (!f) return;
    const msg = await followUpMessage(f);
    if (msg.link) a.setAttribute('href', msg.link);
    else { a.dataset.noPhone = ''; a.removeAttribute('target'); }
  }));
}

/** Opens WhatsApp with the follow-up message and marks it sent (when the link wasn't ready yet). */
export async function sendFollowUpWhatsApp(f) {
  const msg = await followUpMessage(f);
  if (!msg.link) { toastError('لا يوجد رقم موبايل صالح لهذا المريض'); return; }
  window.open(msg.link, '_blank', 'noopener');
  await markFollowUpSent(f.id);
}

async function completeDialog(f) {
  let outcome = null;
  await openModal({
    title: tr`تمت ${FOLLOWUP_TYPES[f.type]?.short ?? 'المتابعة'} — ${f.patientName}`,
    dirty: true,
    icon: 'circle-check',
    body: html`<form class="form" novalidate>
      ${textareaField({ name: 'outcome', label: 'النتيجة (اختياري)', rows: 3, placeholder: 'مثال: الحالة مستقرة، لا يوجد ألم' })}
      <div class="chips">${['الحالة مستقرة', 'يحتاج زيارة', 'لم يرد'].map((q) => html`<button type="button" class="chip" data-quick="${q}">${q}</button>`)}</div>
    </form>`,
    actions: [{ label: 'تسجيل', value: 'ok', variant: 'primary' }, { label: 'إغلاق', value: null }],
    onOpen(d) {
      const ta = /** @type {HTMLTextAreaElement} */ (d.querySelector('[name=outcome]'));
      ta.focus();
      d.addEventListener('click', (e) => {
        const q = /** @type {HTMLElement} */ (e.target).closest('[data-quick]');
        if (q) ta.value = ta.value.trim() ? `${ta.value.trim()} · ${q.dataset.quick}` : q.dataset.quick;
      });
    },
    beforeClose(v, d) { if (v === 'ok') outcome = formData(d.querySelector('form')).outcome; return true; },
  });
  if (outcome === null) return;
  await completeFollowUp(f.id, outcome);
  toastSuccess('تم تسجيل المتابعة');
  if (/يحتاج زيارة/.test(outcome) && can('appointments', 'create')) {
    const { openAppointmentForm } = await import('../appointments/appt-form.js');
    openAppointmentForm({ patientId: f.patientId });
  }
}

/** Manual follow-up. @param {{ patientId?: string }} [preset] */
export async function newFollowUpDialog(preset = {}) {
  let patient = preset.patientId ? await getPatient(preset.patientId) : null;
  let saved = null;
  await openModal({
    title: 'متابعة جديدة',
    dirty: true,
    icon: 'bell',
    body: html`<form class="form" novalidate>
      <div data-pp>${patientPicker({ patient, locked: !!preset.patientId })}</div>
      ${segmentedField({ name: 'type', label: 'النوع', value: 'call', options: Object.entries(FOLLOWUP_TYPES).map(([value, t]) => ({ value, label: t.short })) })}
      ${dateField({ name: 'dueDate', label: 'التاريخ', value: addDays(todayISO(), 1), required: true })}
      <div class="chips">${[[1, 'غدًا'], [3, 'بعد 3 أيام'], [7, 'بعد أسبوع'], [30, 'بعد شهر'], [180, 'بعد 6 أشهر']].map(([d, l]) => html`<button type="button" class="chip" data-days="${d}">${l}</button>`)}</div>
      ${textareaField({ name: 'note', label: 'ملاحظة', rows: 2, placeholder: 'مثال: الاطمئنان على التورم' })}
    </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إغلاق', value: null }],
    onOpen(d) {
      const f = d.querySelector('form');
      enhanceDateFields(f);
      if (!preset.patientId) wirePatientPicker(f.querySelector('[data-pp]'), (p) => { patient = p; });
      f.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement} */ (e.target).closest('[data-days]');
        if (!b) return;
        const input = /** @type {HTMLInputElement} */ (f.querySelector('[name=dueDate]'));
        input.value = isoToInput(addDays(todayISO(), Number(b.dataset.days)));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      if (!patient) { toastError('اختر المريض'); return false; }
      const dueDate = parseDateInput(data.dueDate);
      if (!showFieldErrors(f, dueDate ? {} : { dueDate: 'تاريخ غير صحيح' })) return false;
      try {
        saved = await createFollowUp({ patientId: patient.id, patientName: patient.name, type: data.type, dueDate, note: data.note });
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (saved) toastSuccess('تمت إضافة المتابعة');
  return saved;
}

/**
 * Wires the row buttons inside `root`. `find(id)` returns the current record.
 * @param {HTMLElement} root @param {(id: string) => object|undefined} find @param {AbortSignal} signal
 */
export function wireFollowUpRows(root, find, signal) {
  const rec = (b) => find(b.closest('[data-fu]').dataset.fu);
  /** Runs a change, then offers «تراجع» back to how the follow-up was. */
  const withUndo = async (f, change, message) => {
    const before = { status: f.status, dueDate: f.dueDate, doneAt: f.doneAt ?? null, doneBy: f.doneBy ?? null };
    try { await change(); } catch (err) { toastError(err.message); return; }
    toast(message, { type: 'success', action: { label: 'تراجع', onClick: () => repos.followUps.update(f.id, before) } });
  };
  const snooze = (f, days, label) => withUndo(f, () => snoozeFollowUp(f.id, days), tr`${f.patientName}: تأجيل ${label}`);
  on(root, 'click', '[data-fu-wa]', (e, a) => {
    const f = rec(a);
    if ('noPhone' in a.dataset) { e.preventDefault(); toastError('لا يوجد رقم موبايل صالح لهذا المريض'); return; }
    if (a.getAttribute('href') === '#') { e.preventDefault(); sendFollowUpWhatsApp(f); return; }
    // The link opens WhatsApp by itself; just remember that the message went out.
    setTimeout(() => markFollowUpSent(f.id), 300);
  }, { signal });
  on(root, 'click', '[data-fu-done]', (_, b) => completeDialog(rec(b)), { signal });
  on(root, 'click', '[data-fu-menu]', (_, b) => {
    const f = rec(b);
    const edit = can('followups', 'edit'), pending = f.status === 'pending';
    openMenu(b, { header: f.patientName, items: [
      ...(edit && pending ? [
        { label: 'تأجيل يوم', icon: 'clock', onSelect: () => snooze(f, 1, 'يوم') },
        { label: 'تأجيل 3 أيام', icon: 'clock', onSelect: () => snooze(f, 3, '3 أيام') },
        { label: 'تأجيل أسبوع', icon: 'clock', onSelect: () => snooze(f, 7, 'أسبوع') },
        'sep',
      ] : []),
      ...(can('appointments', 'create') ? [{ label: 'حجز موعد', icon: 'calendar-check', onSelect: async () => { const { openAppointmentForm } = await import('../appointments/appt-form.js'); openAppointmentForm({ patientId: f.patientId }); } }] : []),
      { label: 'نسخ نص الرسالة', icon: 'file-text', onSelect: async () => {
        try { await navigator.clipboard.writeText((await followUpMessage(f)).text); toastSuccess('تم نسخ الرسالة'); } catch { toastError('تعذّر النسخ'); }
      } },
      ...(edit && pending ? [{ label: 'إلغاء المتابعة', icon: 'circle-x', onSelect: () => withUndo(f, () => skipFollowUp(f.id), tr`ألغيت متابعة ${f.patientName}`) }] : []),
      ...(edit && !pending ? [{ label: 'إعادة فتح', icon: 'refresh-cw', onSelect: () => withUndo(f, () => reopenFollowUp(f.id), tr`أُعيد فتح متابعة ${f.patientName}`) }] : []),
      ...(can('followups', 'delete') ? ['sep', { label: 'حذف', icon: 'trash-2', danger: true, onSelect: async () => {
        if (await confirmDialog({ title: 'حذف المتابعة؟', message: `${f.patientName} — ${FOLLOWUP_TYPES[f.type]?.label}`, confirmLabel: 'حذف', danger: true })) { await repos.followUps.remove(f.id); toastSuccess('تم الحذف'); }
      } }] : []),
    ] });
  }, { signal });
}

/**
 * After a treatment item is completed: offers to send its post-op instructions on WhatsApp.
 * Does nothing when the procedure has no instruction template.
 */
export async function offerInstructions(item) {
  const msg = await instructionsMessage(item);
  if (!msg) return;
  const res = await openModal({
    title: 'إرسال تعليمات ما بعد العلاج؟',
    icon: 'message-circle',
    body: html`<div class="stack">
      <p>«${msg.template.name}» إلى <strong>${msg.patient?.name}</strong>${msg.patient?.phone ? html` (<span class="ltr">${digits(msg.patient.phone)}</span>)` : ''}</p>
      <div class="msg-preview">${keep(msg.text)}</div>
      ${msg.link ? '' : html`<p class="badge badge--warning">لا يوجد رقم موبايل صالح — يمكنك نسخ الرسالة أو طباعتها</p>`}
    </div>`,
    actions: [
      ...(msg.link ? [{ label: 'إرسال واتساب', value: 'wa', variant: 'whatsapp' }] : []),
      { label: 'نسخ', value: 'copy' }, { label: 'طباعة', value: 'print' }, { label: 'لاحقًا', value: null },
    ],
    // Open WhatsApp within the tap itself (phones block it once the window has closed).
    beforeClose(v) { if (v === 'wa') window.open(msg.link, '_blank', 'noopener'); return true; },
  });
  if (res === 'copy') {
    try { await navigator.clipboard.writeText(msg.text); toastSuccess('تم نسخ الرسالة'); } catch { toastError('تعذّر النسخ'); }
  }
  if (res === 'print') {
    const { printHTML } = await import('../../components/print.js');
    inArabic(() => printHTML(html`<p><strong>${msg.patient?.name ?? ''}</strong> · ${formatDate(todayISO())}</p><div class="print-instructions">${msg.template.body}</div>`, { size: 'a4', title: tr`تعليمات ${msg.template.name}` }));
  }
}

/** Renders `list` into `box` as rows, or an empty message. */
export function renderRows(box, list, opts, empty) {
  render(box, list.length ? html`<ul class="fu-list">${list.map((f) => followUpRow(f, opts))}</ul>` : empty);
  fillWhatsAppLinks(box, list).catch((err) => console.warn('[followups] links', err));
}
