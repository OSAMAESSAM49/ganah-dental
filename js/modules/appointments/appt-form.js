/**
 * Book / edit appointment dialog: patient search (or quick-add), linked treatment-plan items,
 * procedures (duration adds up automatically), date/time/doctor/chair, live conflict check
 * with "nearest free time" suggestion.
 */
import { html, ico, render, formData, showFieldErrors } from '../../core/dom.js';
import { digits, parseDateInput, todayISO, formatMoney } from '../../core/format.js';
import { formatClock, formatRange, dayLabel, nowMinutes } from '../../core/time.js';
import { APPT_STATUS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { currentUser } from '../../core/session.js';
import { validate, required, phone as phoneRule } from '../../core/validate.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { textareaField, textField } from '../../components/form.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { searchPatients, getPatient, createPatient, findByPhone } from '../../services/patients.js';
import { listItems, listPlans } from '../../services/treatment.js';
import { activeProcedures } from '../../services/procedures.js';
import { getSchedule, activeChairs, slotsFor, listDoctors, hoursFor } from '../../services/schedule.js';
import { listDay, findConflicts, nextFreeSlot, withinHours, createAppointment, updateAppointment } from '../../services/appointments.js';
import { medicalBanner } from '../patients/medical.js';
import { patientAvatar } from '../patients/list.js';
import { tr } from '../../core/i18n.js';

const DURATIONS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const REASON_LABEL = { chair: 'نفس الكرسي', doctor: 'نفس الطبيب', patient: 'نفس المريض' };

/**
 * @param {{ appt?: object, patientId?: string, date?: string, startMin?: number, chairId?: string, doctorId?: string }} [preset]
 * @returns {Promise<object|null>} the saved appointment
 */
export async function openAppointmentForm(preset = {}) {
  const editing = preset.appt ?? null;
  const schedule = getSchedule();
  const [doctors, procedures] = await Promise.all([listDoctors(), activeProcedures()]);
  const chairs = activeChairs();
  const me = currentUser();

  const st = {
    patient: null,
    planItems: [],
    linked: new Set(editing?.treatmentItemIds ?? []),
    procs: (editing?.procedureIds ?? []).map((id, i) => ({ id, name: editing.procedureNames?.[i] ?? '' })),
    date: editing?.date ?? preset.date ?? todayISO(),
    startMin: editing?.startMin ?? preset.startMin ?? null,
    duration: editing?.duration ?? schedule.defaultDuration,
    durationTouched: !!editing,
    doctorId: editing?.doctorId ?? preset.doctorId ?? (doctors.find((d) => d.id === me?.id)?.id ?? (doctors.length === 1 ? doctors[0].id : '')),
    chairId: editing?.chairId ?? preset.chairId ?? chairs[0]?.id ?? '',
    dayAppts: [],
    quickAdd: false,
  };

  const setPatient = async (id) => {
    st.patient = id ? await getPatient(id) : null;
    st.planItems = [];
    if (st.patient) {
      const [items, plans] = await Promise.all([listItems(st.patient.id), listPlans(st.patient.id)]);
      const open = new Set(plans.filter((p) => p.status === 'active' || p.status === 'completed').map((p) => p.id));
      st.planItems = items.filter((i) => open.has(i.planId) && (i.status === 'planned' || i.status === 'in_progress' || st.linked.has(i.id)));
    }
  };
  await setPatient(editing?.patientId ?? preset.patientId ?? null);
  st.dayAppts = await listDay(st.date);
  if (st.startMin === null) {
    st.startMin = nextFreeSlot({ date: st.date, startMin: 0, duration: st.duration, chairId: st.chairId, doctorId: st.doctorId }, st.dayAppts) ?? slotsFor(st.date)[0] ?? 16 * 60;
  }

  /** Duration from linked plan items + procedures (unless the user picked one). */
  const autoDuration = () => {
    if (st.durationTouched) return;
    const linkedDur = st.planItems.filter((i) => st.linked.has(i.id)).reduce((n, i) => n + (procedures.find((p) => p.id === i.procedureId)?.durationMin ?? 30), 0);
    const procDur = st.procs.reduce((n, p) => n + (procedures.find((x) => x.id === p.id)?.durationMin ?? 30), 0);
    const total = linkedDur + procDur;
    if (total) st.duration = Math.min(240, Math.max(15, Math.ceil(total / schedule.slotMin) * schedule.slotMin));
  };

  const candidate = () => ({ id: editing?.id, date: st.date, startMin: st.startMin, duration: st.duration, chairId: st.chairId, doctorId: st.doctorId, patientId: st.patient?.id });

  /* ---------- markup ---------- */
  const patientSection = () => {
    if (st.patient) {
      return html`
        <div class="appt-patient">
          ${patientAvatar(st.patient)}
          <div class="grow"><strong>${st.patient.name}</strong><div class="muted text-sm">${st.patient.pending ? html`<span class="badge badge--accent">مريض جديد · يُسجَّل مع تأكيد الحجز</span>` : html`<span class="ltr">${digits(st.patient.fileNo)}</span>`}${st.patient.phone ? html` · <span class="ltr">${digits(st.patient.phone)}</span>` : ''}</div></div>
          ${editing ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-change-patient>تغيير</button>`}
        </div>
        ${medicalBanner(st.patient)}`;
    }
    if (st.quickAdd) {
      return html`
        <div class="card card--flat"><div class="card__body form" id="quick-patient">
          <strong>مريض جديد (تسجيل سريع)</strong>
          <div class="form-grid">
            ${textField({ name: 'qp_name', label: 'الاسم', required: true })}
            ${textField({ name: 'qp_phone', label: 'الموبايل', ltr: true, inputmode: 'tel' })}
          </div>
          <p class="muted text-sm">يمكن استكمال باقي البيانات والتاريخ الطبي من ملف المريض لاحقًا.</p>
          <div class="row"><button type="button" class="btn btn--primary btn--sm" data-quick-save>${ico('user-plus', { size: 18 })} اختيار</button><button type="button" class="btn btn--ghost btn--sm" data-quick-cancel>رجوع للبحث</button></div>
        </div></div>`;
    }
    return html`
      <div class="field">
        <label class="field__label" for="appt-psearch">المريض<span class="req">*</span></label>
        <div class="input-group">${ico('search', { size: 20 })}<input class="input" id="appt-psearch" autocomplete="off" placeholder="ابحث بالاسم أو الموبايل أو رقم الملف…"></div>
        <ul class="gsearch__list" id="appt-presults" style="position: static; box-shadow: none; padding: 0; margin-block-start: var(--sp-2); max-block-size: 240px" role="listbox" hidden></ul>
        <span class="field__error" data-error-for="patient"></span>
        ${can('patients', 'create') ? html`<button type="button" class="link-btn" data-quick-add style="align-self:flex-start">${ico('user-plus', { size: 16 })} مريض جديد غير مسجّل؟</button>` : ''}
      </div>`;
  };

  const linkSection = () => (st.planItems.length ? html`
    <div class="stack-sm">
      <span class="field__label">${ico('list-checks', { size: 18 })} من خطة العلاج</span>
      <div class="chips">${st.planItems.map((i) => html`
        <label class="chip"><input type="checkbox" data-link="${i.id}" ${st.linked.has(i.id) ? 'checked' : ''}>${i.procedureName}${i.teeth?.length ? html` <span class="ltr subtle">${i.teeth.join(',')}</span>` : ''}</label>`)}</div>
    </div>` : '');

  const procSection = () => html`
    <div class="stack-sm">
      <span class="field__label">إجراءات أخرى</span>
      <div class="row">
        <select class="select" id="appt-proc" style="inline-size:auto; flex: 1 1 220px" aria-label="إضافة إجراء">
          <option value="">+ أضف إجراءً (كشف، تنظيف…)</option>
          ${procedures.map((p) => html`<option value="${p.id}">${p.name} · ${digits(p.durationMin)} د${p.price ? ` · ${formatMoney(p.price)}` : ''}</option>`)}
        </select>
      </div>
      ${st.procs.length ? html`<div class="chips">${st.procs.map((p, i) => html`<span class="chip" aria-pressed="true">${p.name}<button type="button" class="btn btn--ghost btn--icon btn--sm" data-remove-proc="${i}" aria-label="إزالة ${p.name}" style="min-block-size:24px; inline-size:24px; color: inherit">${ico('x', { size: 14 })}</button></span>`)}</div>` : ''}
    </div>`;

  const timeSection = () => {
    const slots = slotsFor(st.date);
    if (!slots.includes(st.startMin)) slots.push(st.startMin);
    slots.sort((a, b) => a - b);
    const durs = DURATIONS.includes(st.duration) ? DURATIONS : [...DURATIONS, st.duration].sort((a, b) => a - b);
    const h = hoursFor(st.date);
    // Free times as one-tap chips (the list below still has every time).
    const free = slotsFor(st.date, { duration: st.duration })
      .filter((m) => !(st.date === todayISO() && m < nowMinutes()) && !findConflicts({ ...candidate(), startMin: m }, st.dayAppts).length)
      .slice(0, 12);
    return html`
      <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr))">
        ${dateField({ name: 'date', label: 'التاريخ', value: st.date, required: true })}
        <div class="field">
          <label class="field__label" for="appt-time">الوقت</label>
          <select class="select" id="appt-time" name="startMin">${slots.map((m) => {
            const busy = findConflicts({ ...candidate(), startMin: m }, st.dayAppts).length > 0;
            return html`<option value="${m}" ${m === st.startMin ? 'selected' : ''}>${formatClock(m)}${busy ? ' · مشغول' : ''}</option>`;
          })}</select>
        </div>
        <div class="field">
          <label class="field__label" for="appt-dur">المدة</label>
          <select class="select" id="appt-dur" name="duration">${durs.map((d) => html`<option value="${d}" ${d === st.duration ? 'selected' : ''}>${digits(d)} دقيقة</option>`)}</select>
        </div>
      </div>
      ${free.length ? html`<div class="stack-sm"><span class="field__label" style="margin:0">أوقات متاحة</span>
        <div class="chips slot-chips">${free.map((m) => html`<button type="button" class="chip" data-use-slot="${m}" aria-pressed="${String(m === st.startMin)}">${formatClock(m)}</button>`)}</div></div>` : ''}
      <p class="muted text-sm">${dayLabel(st.date, { year: true })} · ${h?.open ? tr`مواعيد العمل ${formatRange(h.from, h.to - h.from)}` : 'العيادة مغلقة في هذا اليوم'}</p>
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="appt-doctor">الطبيب</label>
          <select class="select" id="appt-doctor" name="doctorId">
            <option value="">بدون تحديد</option>
            ${doctors.map((d) => html`<option value="${d.id}" ${d.id === st.doctorId ? 'selected' : ''}>${d.displayName}</option>`)}
          </select>
          ${doctors.length ? '' : html`<span class="field__hint">لا يوجد أطباء. فعّل «طبيب معالج» للمستخدمين من صفحة المستخدمين.</span>`}
        </div>
        <div class="field">
          <label class="field__label" for="appt-chair">الكرسي</label>
          <select class="select" id="appt-chair" name="chairId">${chairs.map((c) => html`<option value="${c.id}" ${c.id === st.chairId ? 'selected' : ''}>${c.name}</option>`)}</select>
        </div>
      </div>`;
  };

  const conflictSection = () => {
    const c = candidate();
    const conflicts = findConflicts(c, st.dayAppts);
    const outside = !withinHours(c);
    if (!conflicts.length && !outside) return html`<div class="alert alert--success">${ico('circle-check')}<div class="alert__content"><div class="alert__body">الوقت متاح: ${formatRange(st.startMin, st.duration)}</div></div></div>`;
    const free = nextFreeSlot(c, st.dayAppts, 0);
    return html`
      <div class="alert alert--warning">${ico('triangle-alert')}
        <div class="alert__content">
          ${conflicts.length ? html`<div class="alert__title">يتعارض مع ${digits(conflicts.length)} موعد</div>
            <div class="alert__body">${conflicts.map(({ appt, reasons }) => html`<div>${formatRange(appt.startMin, appt.duration)} · ${appt.patientName} <span class="badge badge--${APPT_STATUS[appt.status].tone}">${reasons.map((r) => REASON_LABEL[r]).join('، ')}</span></div>`)}</div>` : ''}
          ${outside ? html`<div class="alert__body">${hoursFor(st.date)?.open ? 'خارج مواعيد العمل.' : 'العيادة مغلقة في هذا اليوم.'}</div>` : ''}
          ${free !== null && free !== st.startMin ? html`<button type="button" class="btn btn--sm btn--dark" data-use-slot="${free}" style="margin-block-start: var(--sp-2)">${ico('clock', { size: 16 })} أقرب وقت متاح: ${formatClock(free)}</button>` : ''}
        </div>
      </div>`;
  };

  const bodyMarkup = () => html`
    <form class="form" id="appt-form" novalidate>
      <div id="sec-patient" class="stack-sm">${patientSection()}</div>
      <div id="sec-link">${linkSection()}</div>
      <div id="sec-procs">${procSection()}</div>
      <div id="sec-time" class="stack-sm">${timeSection()}</div>
      <div id="sec-conflict">${conflictSection()}</div>
      ${textareaField({ name: 'notes', label: 'ملاحظات للحجز', value: editing?.notes ?? '', rows: 2, placeholder: 'مثال: يفضّل أول الموعد، أو يحتاج متابعة ضغط' })}
    </form>`;

  let saved = null;
  await openModal({
    title: editing ? 'تعديل الموعد' : 'حجز موعد',
    dirty: true,
    icon: 'calendar-check',
    size: 'lg',
    body: bodyMarkup(),
    actions: [{ label: editing ? 'حفظ التعديل' : 'تأكيد الحجز', value: 'save', variant: 'primary' }, { label: 'إغلاق', value: null }],
    onOpen(dialog, close) {
      const $ = (sel) => dialog.querySelector(sel);
      enhanceDateFields(dialog);
      const redraw = (...sections) => {
        for (const s of sections) {
          if (s === 'patient') render($('#sec-patient'), patientSection());
          if (s === 'link') render($('#sec-link'), linkSection());
          if (s === 'procs') render($('#sec-procs'), procSection());
          if (s === 'time') { render($('#sec-time'), timeSection()); enhanceDateFields($('#sec-time')); }
        }
        render($('#sec-conflict'), conflictSection());
        wirePatientSearch();
      };

      // Patient search
      let timer;
      const wirePatientSearch = () => {
        const input = /** @type {HTMLInputElement} */ ($('#appt-psearch'));
        if (!input || input.dataset.wired) return;
        input.dataset.wired = '1';
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const list = $('#appt-presults');
            if (!input.value.trim()) { list.hidden = true; return; }
            const found = await searchPatients(input.value, { limit: 6 });
            render(list, found.length ? html`${found.map((p) => html`<li class="gsearch__item" role="option" data-pick-patient="${p.id}">${patientAvatar(p)}<span class="gsearch__text"><strong>${p.name}</strong><span class="gsearch__sub ltr">${digits(p.fileNo)}${p.phone ? ` · ${digits(p.phone)}` : ''}</span></span></li>`)}` : html`<li class="gsearch__empty">لا يوجد مريض مطابق</li>`);
            list.hidden = false;
          }, 120);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); $('[data-pick-patient]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
        });
        input.focus();
      };
      wirePatientSearch();

      dialog.addEventListener('click', async (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const pick = t.closest('[data-pick-patient]');
        if (pick) { await setPatient(pick.dataset.pickPatient); autoDuration(); redraw('patient', 'link', 'time'); return; }
        if (t.closest('[data-change-patient]')) { st.patient = null; st.planItems = []; st.linked.clear(); redraw('patient', 'link'); return; }
        if (t.closest('[data-quick-add]')) { st.quickAdd = true; redraw('patient'); $('[name=qp_name]')?.focus(); return; }
        if (t.closest('[data-quick-cancel]')) { st.quickAdd = false; redraw('patient'); return; }
        if (t.closest('[data-quick-save]')) {
          const box = $('#quick-patient');
          const data = { qp_name: $('[name=qp_name]').value, qp_phone: $('[name=qp_phone]').value };
          const errors = validate(data, { qp_name: (v) => required(v, 'الاسم'), qp_phone: (v) => phoneRule(v) });
          if (!showFieldErrors(/** @type {any} */ (box), errors)) return;
          // Same check as the full form; the patient is only saved when the booking is confirmed.
          const same = data.qp_phone ? await findByPhone(data.qp_phone) : [];
          if (same.length && !(await confirmDialog({
            title: 'رقم الموبايل مسجّل لمريض آخر',
            message: html`<p>الرقم مسجّل باسم: <strong>${same.map((x) => `${x.name} (${x.fileNo})`).join('، ')}</strong>.</p><p class="muted">إن كان هو نفس المريض فارجع للبحث واختره. قد يكون من نفس العائلة.</p>`,
            confirmLabel: 'مريض جديد على أي حال', cancelLabel: 'رجوع',
          }))) return;
          st.quickAdd = false;
          st.patient = { id: null, pending: true, name: data.qp_name.trim(), phone: data.qp_phone.trim() };
          st.planItems = [];
          redraw('patient', 'link', 'time');
          return;
        }
        const rm = t.closest('[data-remove-proc]');
        if (rm) { st.procs.splice(Number(rm.dataset.removeProc), 1); autoDuration(); redraw('procs', 'time'); return; }
        const slot = t.closest('[data-use-slot]');
        if (slot) { st.startMin = Number(slot.dataset.useSlot); redraw('time'); }
      });

      dialog.addEventListener('change', async (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.dataset.link) {
          if (t.checked) st.linked.add(t.dataset.link); else st.linked.delete(t.dataset.link);
          autoDuration(); redraw('time'); return;
        }
        if (t.id === 'appt-proc' && t.value) {
          const p = procedures.find((x) => x.id === t.value);
          st.procs.push({ id: p.id, name: p.name });
          autoDuration(); redraw('procs', 'time'); return;
        }
        if (t.name === 'date') {
          const iso = parseDateInput(t.value);
          if (!iso) return;
          st.date = iso;
          st.dayAppts = await listDay(iso);
          if (!slotsFor(iso).includes(st.startMin)) st.startMin = nextFreeSlot(candidate(), st.dayAppts, 0) ?? slotsFor(iso)[0] ?? st.startMin;
          redraw('time'); return;
        }
        if (t.name === 'startMin') { st.startMin = Number(t.value); redraw('time'); return; }
        if (t.name === 'duration') { st.duration = Number(t.value); st.durationTouched = true; redraw('time'); return; }
        if (t.name === 'doctorId') { st.doctorId = t.value; redraw('time'); return; }
        if (t.name === 'chairId') { st.chairId = t.value; redraw('time'); }
      });
      $('#appt-form').addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
    },
    async beforeClose(value, dialog) {
      if (value !== 'save') return true;
      const form = /** @type {HTMLFormElement} */ (dialog.querySelector('#appt-form'));
      if (!st.patient) { showFieldErrors(form, { patient: 'اختر المريض أو سجّل مريضًا جديدًا' }); return false; }
      const dateText = /** @type {HTMLInputElement} */ (dialog.querySelector('[name=date]')).value;
      if (!parseDateInput(dateText)) { showFieldErrors(form, { date: 'تاريخ غير صحيح' }); return false; }
      const conflicts = findConflicts(candidate(), st.dayAppts);
      if (conflicts.length || !withinHours(candidate())) {
        const ok = await confirmDialog({
          title: conflicts.length ? 'يوجد تعارض في المواعيد' : 'خارج مواعيد العمل',
          message: conflicts.length ? 'هل تريد الحجز رغم التعارض؟ يُفضّل اختيار «أقرب وقت متاح».' : 'هل تريد الحجز في هذا الوقت على أي حال؟',
          confirmLabel: 'احجز على أي حال',
        });
        if (!ok) return false;
      }
      if (st.patient.pending) {
        try {
          st.patient = await createPatient({ name: st.patient.name, phone: st.patient.phone });
          toastSuccess(tr`تم تسجيل المريض · ملف ${st.patient.fileNo}`);
        } catch (err) { toastError(err.message); return false; }
      }
      const linkedItems = st.planItems.filter((i) => st.linked.has(i.id));
      const input = {
        patientId: st.patient.id,
        patientName: st.patient.name,
        date: st.date,
        startMin: st.startMin,
        duration: st.duration,
        doctorId: st.doctorId,
        chairId: st.chairId,
        treatmentItemIds: linkedItems.map((i) => i.id),
        procedureIds: [...linkedItems.map((i) => i.procedureId), ...st.procs.map((p) => p.id)],
        procedureNames: [...linkedItems.map((i) => `${i.procedureName}${i.teeth?.length ? ` (${i.teeth.join(',')})` : ''}`), ...st.procs.map((p) => p.name)],
        notes: formData(form).notes,
      };
      try {
        saved = editing ? await updateAppointment(editing.id, input, { allowConflicts: true }) : await createAppointment(input, { allowConflicts: true });
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (saved) toastSuccess(`${editing ? 'تم تعديل الموعد' : 'تم الحجز'}: ${dayLabel(saved.date)} ${formatClock(saved.startMin)}`);
  return saved;
}

