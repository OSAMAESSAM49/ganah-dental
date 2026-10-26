/**
 * Appointment details: arrival flow buttons (arrived → in chair → done, no-show, cancel,
 * undo), clinical notes, linked plan items, WhatsApp reminder, edit, follow-up booking.
 */
import { html, ico, render } from '../../core/dom.js';
import { formatDateTime, digits } from '../../core/format.js';
import { formatRange, dayLabel, addDays } from '../../core/time.js';
import { APPT_STATUS, TREATMENT_STATUS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { repos } from '../../data/index.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { getPatient } from '../../services/patients.js';
import { activeChairs } from '../../services/schedule.js';
import { setItemStatus } from '../../services/treatment.js';
import { setAppointmentStatus, saveClinicalNotes, deleteAppointment, buildReminders, markReminded, NEXT_STEPS, PREVIOUS } from '../../services/appointments.js';
import { medicalBanner } from '../patients/medical.js';
import { patientAvatar } from '../patients/list.js';
import { confirmDone } from '../patients/plan-dialogs.js';
import { offerInstructions } from '../followups/shared.js';
import { openAppointmentForm } from './appt-form.js';

const STEP_UI = {
  arrived: { label: 'وصل — في الانتظار', icon: 'user-round', variant: 'accent' },
  in_chair: { label: 'دخل الكرسي', icon: 'stethoscope', variant: 'primary' },
  done: { label: 'انتهت الزيارة', icon: 'circle-check', variant: 'primary' },
  no_show: { label: 'لم يحضر', icon: 'circle-x', variant: 'ghost' },
  cancelled: { label: 'إلغاء الموعد', icon: 'x', variant: 'ghost' },
};

/** Asks for a reason, then cancels. Shared with quick actions. */
export async function cancelWithReason(appt) {
  let reason = '';
  const res = await openModal({
    title: 'إلغاء الموعد؟', icon: 'triangle-alert', tone: 'danger',
    body: html`<div class="stack"><p>${appt.patientName} · ${dayLabel(appt.date)} ${formatRange(appt.startMin, appt.duration)}</p>
      <label class="field"><span class="field__label">سبب الإلغاء (اختياري)</span><input class="input" id="cancel-reason" placeholder="مثال: اعتذر المريض بالتليفون"></label></div>`,
    actions: [{ label: 'إلغاء الموعد', value: 'ok', variant: 'danger' }, { label: 'رجوع', value: null }],
    beforeClose(v, d) { reason = /** @type {HTMLInputElement} */ (d.querySelector('#cancel-reason')).value; return true; },
  });
  if (res !== 'ok') return false;
  await setAppointmentStatus(appt.id, 'cancelled', { reason });
  return true;
}

/**
 * @param {object} appt
 * @returns {Promise<boolean>} true if anything changed (caller refreshes)
 */
export async function openAppointmentDetails(appt) {
  let a = appt;
  let changed = false;
  const canEdit = can('appointments', 'edit');
  const patient = await getPatient(a.patientId);
  const chairs = Object.fromEntries(activeChairs().map((c) => [c.id, c.name]));
  const doctor = a.doctorId ? await repos.users.get(a.doctorId, { includeDeleted: true }) : null;

  // Doctors / Admin add work straight from the visit (fewest taps: button → tooth → procedure → add).
  const canAddWork = () => can('treatment', 'create') && !['cancelled', 'no_show'].includes(a.status);
  const linkedItems = async () => (await Promise.all((a.treatmentItemIds ?? []).map((id) => repos.treatmentItems.get(id)))).filter(Boolean);

  const bodyMarkup = async () => {
    const items = await linkedItems();
    const st = APPT_STATUS[a.status];
    return html`
      <div class="stack">
        <div class="appt-patient">
          ${patient ? patientAvatar(patient) : ''}
          <div class="grow">
            <a href="${href('/patients/:id', { id: a.patientId })}" data-close class="bold">${patient?.name ?? a.patientName}</a>
            <div class="muted text-sm">${patient ? html`<span class="ltr">${digits(patient.fileNo)}</span>` : ''}${patient?.phone ? html` · <span class="ltr">${digits(patient.phone)}</span>` : ''}</div>
          </div>
          <span class="badge badge--dot badge--${st.tone}" style="font-size: var(--fs-md)">${st.label}</span>
        </div>
        ${patient ? medicalBanner(patient) : ''}
        <dl class="dl">
          <dt>الموعد</dt><dd>${dayLabel(a.date, { year: true })} · ${formatRange(a.startMin, a.duration)}</dd>
          <dt>الطبيب</dt><dd>${doctor?.displayName ?? html`<span class="muted">بدون تحديد</span>`}</dd>
          <dt>الكرسي</dt><dd>${chairs[a.chairId] ?? '—'}</dd>
          ${a.procedureNames?.length ? html`<dt>الإجراءات</dt><dd>${a.procedureNames.join('، ')}</dd>` : ''}
          ${a.notes ? html`<dt>ملاحظات</dt><dd style="white-space: pre-line">${a.notes}</dd>` : ''}
          ${a.reminderSentAt ? html`<dt>التذكير</dt><dd>${ico('circle-check', { size: 16 })} أُرسل ${formatDateTime(a.reminderSentAt)}</dd>` : ''}
          ${a.status === 'cancelled' && a.cancelReason ? html`<dt>سبب الإلغاء</dt><dd>${a.cancelReason}</dd>` : ''}
        </dl>

        ${canEdit ? html`
          <div class="row">
            ${NEXT_STEPS[a.status].map((s) => html`<button type="button" class="btn btn--${STEP_UI[s].variant}" data-step="${s}">${ico(STEP_UI[s].icon, { size: 18 })} ${STEP_UI[s].label}</button>`)}
            ${PREVIOUS[a.status] ? html`<button type="button" class="btn btn--ghost btn--sm" data-step="${PREVIOUS[a.status]}">${ico('refresh-cw', { size: 16 })} تراجع إلى «${APPT_STATUS[PREVIOUS[a.status]].label}»</button>` : ''}
          </div>` : ''}

        ${items.length || canAddWork() ? html`
          <div class="stack-sm">
            <div class="row row--between">
              <span class="field__label" style="margin:0">${ico('list-checks', { size: 18 })} العلاج في هذه الزيارة</span>
              ${canAddWork() ? html`<button type="button" class="btn btn--primary btn--sm" data-quick-add>${ico('tooth', { size: 18 })} إضافة إجراء</button>` : ''}
            </div>
            ${items.length ? items.map((i) => html`<div class="row row--between" style="gap: var(--sp-2)">
              <span>${i.procedureName} ${i.teeth?.length ? html`<span class="ltr subtle">${i.teeth.join(',')}</span>` : ''} <span class="badge badge--${TREATMENT_STATUS[i.status].tone}">${TREATMENT_STATUS[i.status].label}</span></span>
              <span class="row" style="gap: var(--sp-2)">
                ${can('treatment', 'edit') && i.status === 'planned' && a.status !== 'cancelled' && a.status !== 'no_show' ? html`<button type="button" class="btn btn--soft btn--sm" data-item-start="${i.id}">${ico('arrow-left', { size: 16 })} بدء</button>` : ''}
                ${can('treatment', 'edit') && (i.status === 'planned' || i.status === 'in_progress') && (a.status === 'in_chair' || a.status === 'done') ? html`<button type="button" class="btn btn--accent btn--sm" data-item-done="${i.id}">${ico('check', { size: 16 })} تم</button>` : ''}
              </span>
            </div>`) : html`<p class="muted text-sm" style="margin:0">لم يُضف علاج لهذه الزيارة بعد.</p>`}
          </div>` : ''}

        ${(a.status === 'in_chair' || a.status === 'done') && can('patients', 'edit') ? html`
          <div class="field">
            <label class="field__label" for="clin-notes">ملاحظات الطبيب عن الزيارة</label>
            <textarea class="textarea" id="clin-notes" rows="3" placeholder="ما تم في الجلسة، وتوصيات للزيارة القادمة…">${a.clinicalNotes ?? ''}</textarea>
            <button type="button" class="btn btn--sm" data-save-notes style="align-self:flex-start">${ico('save', { size: 16 })} حفظ الملاحظات</button>
          </div>` : (a.clinicalNotes ? html`<div><span class="field__label">ملاحظات الطبيب</span><p style="white-space: pre-line">${a.clinicalNotes}</p></div>` : '')}

        <div class="row" style="border-block-start: 1px solid var(--c-border); padding-block-start: var(--sp-4)">
          ${a.status === 'booked' ? html`<button type="button" class="btn btn--whatsapp btn--sm" data-remind>${ico('message-circle', { size: 18 })} تذكير واتساب</button>` : ''}
          ${canEdit && !['done', 'cancelled', 'no_show'].includes(a.status) ? html`<button type="button" class="btn btn--sm" data-edit>${ico('pencil', { size: 18 })} تعديل / تأجيل</button>` : ''}
          ${can('billing', 'view') && (a.status === 'done' || a.status === 'in_chair') ? html`<a class="btn btn--sm" href="${href('/patients/:id', { id: a.patientId }, { tab: 'payments' })}" data-close>${ico('receipt', { size: 18 })} الحساب والفاتورة</a>` : ''}
          ${can('appointments', 'create') ? html`<button type="button" class="btn btn--sm btn--soft" data-followup>${ico('calendar-check', { size: 18 })} حجز موعد قادم</button>` : ''}
          ${can('appointments', 'delete') ? html`<button type="button" class="btn btn--ghost btn--sm" data-delete style="color: var(--c-danger); margin-inline-start: auto">${ico('trash-2', { size: 18 })} حذف</button>` : ''}
        </div>
      </div>`;
  };

  await openModal({
    title: 'تفاصيل الموعد',
    icon: 'calendar-days',
    size: 'lg',
    body: await bodyMarkup(),
    actions: [],
    async onOpen(dialog, close) {
      const bodyEl = dialog.querySelector('.modal__body');
      const refresh = async () => { a = await repos.appointments.get(a.id, { includeDeleted: true }); render(bodyEl, await bodyMarkup()); };
      bodyEl.addEventListener('click', async (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest('a[data-close]')) { close(null); return; }
        const step = t.closest('[data-step]');
        try {
          if (step) {
            const s = step.dataset.step;
            if (s === 'cancelled') { if (!(await cancelWithReason(a))) return; }
            else if (s === 'no_show') { if (!(await confirmDialog({ title: 'تسجيل عدم الحضور؟', message: `${a.patientName} لم يحضر موعده.`, confirmLabel: 'لم يحضر', danger: true }))) return; await setAppointmentStatus(a.id, s); }
            else await setAppointmentStatus(a.id, s);
            changed = true;
            toastSuccess(`${a.patientName}: ${APPT_STATUS[s].label}`);
            await refresh();
            return;
          }
          if (t.closest('[data-quick-add]')) {
            const { openQuickTreatment } = await import('./quick-treatment.js');
            if (await openQuickTreatment(a)) { changed = true; await refresh(); }
            return;
          }
          const start = t.closest('[data-item-start]');
          if (start) {
            await setItemStatus(start.dataset.itemStart, 'in_progress');
            changed = true;
            toastSuccess('بدأ العلاج — ظهر الحساب في «فواتير اليوم»');
            await refresh();
            return;
          }
          const done = t.closest('[data-item-done]');
          if (done) {
            const item = await repos.treatmentItems.get(done.dataset.itemDone);
            const res = await confirmDone(item);
            if (res) { await setItemStatus(item.id, 'done', res); changed = true; toastSuccess(`تم: ${item.procedureName}`); await refresh(); await offerInstructions(item); }
            return;
          }
          if (t.closest('[data-save-notes]')) {
            await saveClinicalNotes(a.id, /** @type {HTMLTextAreaElement} */ (bodyEl.querySelector('#clin-notes')).value);
            changed = true;
            toastSuccess('تم حفظ ملاحظات الزيارة');
            return;
          }
          if (t.closest('[data-remind]')) {
            const [r] = await buildReminders([a]);
            if (!r.link) { toastError('لا يوجد رقم موبايل صالح لهذا المريض'); return; }
            window.open(r.link, '_blank', 'noopener');
            await markReminded(a.id);
            changed = true;
            await refresh();
            return;
          }
          if (t.closest('[data-edit]')) {
            close(null);
            if (await openAppointmentForm({ appt: a })) changed = true;
            return;
          }
          if (t.closest('[data-followup]')) {
            close(null);
            if (await openAppointmentForm({ patientId: a.patientId, date: addDays(a.date, 7), doctorId: a.doctorId, chairId: a.chairId })) changed = true;
            return;
          }
          if (t.closest('[data-delete]')) {
            if (!(await confirmDialog({ title: 'حذف الموعد؟', message: 'يُفضّل «إلغاء الموعد» ليبقى في السجل. الحذف يخفيه من التقويم.', confirmLabel: 'حذف', danger: true }))) return;
            await deleteAppointment(a.id);
            changed = true;
            toastSuccess('تم حذف الموعد');
            close(null);
          }
        } catch (err) { toastError(err.message); }
      });
    },
  });
  return changed;
}
