/**
 * Appointments calendar: day / week / month / list, filters by doctor and chair, booking,
 * arrival flow, tomorrow's WhatsApp reminders. State lives in the URL query
 * (?view=day&date=2026-10-22&doctor=…&chair=…&by=doctor).
 */
import { html, ico, render, on } from '../../core/dom.js';
import { digits, formatDate, todayISO, parseDateInput, toDate, toISODate } from '../../core/format.js';
import { addDays, weekDays, monthGrid, dayLabel, monthLabel, formatRange, nowMinutes } from '../../core/time.js';
import { APPT_STATUS } from '../../core/labels.js';
import { medicalAlerts } from '../../core/medical.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { getPref, setPref } from '../../core/prefs.js';
import { mountTable } from '../../components/table.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { allPatients } from '../../services/patients.js';
import { activeChairs, calendarRange, listDoctors, getSchedule } from '../../services/schedule.js';
import { listRange, setAppointmentStatus, tomorrowsReminders, NEXT_STEPS } from '../../services/appointments.js';
import { dayView, weekView, monthView, PX_PER_MIN } from './views.js';
import { openAppointmentForm } from './appt-form.js';
import { openAppointmentDetails, cancelWithReason } from './appt-details.js';
import { openReminders } from './reminders.js';

const VIEWS = [['day', 'يوم'], ['week', 'أسبوع'], ['month', 'شهر'], ['list', 'قائمة']];
const QUICK = { arrived: 'وصل', in_chair: 'على الكرسي', done: 'انتهى' };

/** Phones remember their own view and start on the list (big rows, one-tap status). */
const phone = () => matchMedia('(max-width: 639px)').matches;
const viewPref = () => (phone() ? 'apptViewPhone' : 'apptView');

export default {
  title: 'المواعيد',
  async render({ el, query, signal }) {
    const st = {
      view: VIEWS.some(([k]) => k === query.view) ? query.view : getPref(viewPref(), phone() ? 'list' : 'day'),
      date: /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? '') ? query.date : todayISO(),
      doctor: query.doctor ?? '',
      chair: query.chair ?? '',
      by: query.by === 'doctor' ? 'doctor' : 'chair',
      listTo: '',
      listStatus: '',
    };
    const canCreate = can('appointments', 'create');
    const canEdit = can('appointments', 'edit');
    const [doctors, patientsList] = await Promise.all([listDoctors(), allPatients()]);
    const patients = new Map(patientsList.map((p) => [p.id, p]));
    const chairs = activeChairs();

    const rangeFor = () => {
      if (st.view === 'day') return [st.date, st.date];
      if (st.view === 'week') { const d = weekDays(st.date); return [d[0], d[6]]; }
      if (st.view === 'month') { const g = monthGrid(st.date); return [g[0], g[41]]; }
      return [st.date, st.listTo || addDays(st.date, 6)];
    };

    const title = () => {
      if (st.view === 'day') return dayLabel(st.date, { year: true });
      if (st.view === 'week') { const d = weekDays(st.date); return `${formatDate(d[0])} – ${formatDate(d[6])}`; }
      if (st.view === 'month') return monthLabel(st.date);
      return `من ${formatDate(st.date)}`;
    };

    const syncUrl = () => {
      const q = { view: st.view, date: st.date === todayISO() ? '' : st.date, doctor: st.doctor, chair: st.chair, by: st.by === 'doctor' ? 'doctor' : '' };
      const clean = Object.fromEntries(Object.entries(q).filter(([, v]) => v));
      history.replaceState(history.state, '', href('/appointments', {}, clean));
      setPref(viewPref(), st.view);
    };

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">المواعيد</h1>
          <p class="page-header__sub" id="appt-title"></p>
        </div>
        <div class="page-header__actions">
          <button type="button" class="btn" data-reminders>${ico('message-circle')} تذكيرات الغد <span class="chip__count" id="remind-count"></span></button>
          ${canCreate ? html`<button type="button" class="btn btn--primary" data-new>${ico('plus')} حجز موعد</button>` : ''}
        </div>
      </header>
      <div class="toolbar cal-toolbar">
        <div class="row" style="gap: var(--sp-1)">
          <button type="button" class="icon-btn" data-nav="-1" aria-label="السابق">${ico('chevron-right')}</button>
          <button type="button" class="btn btn--sm" data-today>اليوم</button>
          <button type="button" class="icon-btn" data-nav="1" aria-label="التالي">${ico('chevron-left')}</button>
        </div>
        <div class="segmented" role="radiogroup" aria-label="طريقة العرض">
          ${VIEWS.map(([k, label]) => html`<label><input type="radio" name="view" value="${k}" ${st.view === k ? 'checked' : ''}><span>${label}</span></label>`)}
        </div>
        <div class="grow"></div>
        <button type="button" class="btn btn--sm cal-filters-btn" data-toggle-filters aria-expanded="false">${ico('filter', { size: 18 })} تصفية${st.doctor || st.chair ? ' •' : ''}</button>
        <select class="select input--pill" id="f-doctor" aria-label="الطبيب" style="inline-size:auto">
          <option value="">كل الأطباء</option>
          ${doctors.map((d) => html`<option value="${d.id}" ${st.doctor === d.id ? 'selected' : ''}>${d.displayName}</option>`)}
        </select>
        ${chairs.length > 1 ? html`<select class="select input--pill" id="f-chair" aria-label="الكرسي" style="inline-size:auto">
          <option value="">كل الكراسي</option>
          ${chairs.map((c) => html`<option value="${c.id}" ${st.chair === c.id ? 'selected' : ''}>${c.name}</option>`)}
        </select>` : ''}
        <span id="by-toggle"></span>
      </div>
      <div id="cal-legend" class="legend-grid" style="margin-block-end: var(--sp-3)">
        ${Object.entries(APPT_STATUS).map(([, s]) => html`<span class="legend__item"><span class="cond-dot" style="background:${s.color}"></span>${s.label}</span>`)}
      </div>
      <div id="cal-body"></div>`);

    let rows = [];

    const filtered = () => rows.filter((a) => (!st.doctor || a.doctorId === st.doctor) && (!st.chair || a.chairId === st.chair));

    let scrolledFor = '';
    let keptScroll = 0;
    const draw = () => {
      el.querySelector('#appt-title').textContent = title();
      render(el.querySelector('#by-toggle'), st.view === 'day' && doctors.length > 1 ? html`
        <div class="segmented" role="radiogroup" aria-label="أعمدة اليوم">
          <label><input type="radio" name="by" value="chair" ${st.by === 'chair' ? 'checked' : ''}><span>حسب الكرسي</span></label>
          <label><input type="radio" name="by" value="doctor" ${st.by === 'doctor' ? 'checked' : ''}><span>حسب الطبيب</span></label>
        </div>` : '');
      const bodyEl = el.querySelector('#cal-body');
      const visible = filtered();
      const range = calendarRange();
      if (st.view === 'day') {
        const columns = st.by === 'doctor'
          ? [...doctors.filter((d) => !st.doctor || d.id === st.doctor).map((d) => ({ id: d.id, name: d.displayName })), ...(visible.some((a) => !a.doctorId) ? [{ id: '', name: 'بدون طبيب' }] : [])]
          : chairs.filter((c) => !st.chair || c.id === st.chair).map((c) => ({ id: c.id, name: c.name }));
        render(bodyEl, html`<div class="card cal-card">${dayView({ day: st.date, appts: visible, columns, columnKey: st.by === 'doctor' ? 'doctorId' : 'chairId', range, patients })}</div>`);
      } else if (st.view === 'week') {
        render(bodyEl, html`<div class="card cal-card">${weekView({ day: st.date, appts: visible, range, patients })}</div>`);
      } else if (st.view === 'month') {
        render(bodyEl, html`<div class="card cal-card">${monthView({ day: st.date, appts: visible, patients })}</div>`);
      } else {
        drawList(bodyEl, visible);
      }
      // Scroll the day/week body to "now" (or opening time) only when a day or view is
      // opened; redraws (every minute, after a change) keep where the user scrolled.
      const calBody = bodyEl.querySelector('.cal-body');
      if (calBody) {
        const key = `${st.view}|${st.date}`;
        if (key === scrolledFor) calBody.scrollTop = keptScroll;
        else {
          const target = st.date === todayISO() ? Math.max(0, nowMinutes() - range.from - 60) : 0;
          calBody.scrollTop = target * PX_PER_MIN;
          scrolledFor = key;
        }
        calBody.addEventListener('scroll', () => { keptScroll = calBody.scrollTop; }, { passive: true });
        keptScroll = calBody.scrollTop;
      }
    };

    const drawList = (bodyEl, visible) => {
      const list = st.listStatus ? visible.filter((a) => a.status === st.listStatus) : visible;
      render(bodyEl, html`
        <div class="toolbar">
          ${dateField({ name: 'listTo', label: 'حتى تاريخ', value: st.listTo || addDays(st.date, 6) })}
          <div class="chips list-status-chips" role="group" aria-label="الحالة" style="align-self: flex-end">
            <button type="button" class="chip" data-lstatus="" aria-pressed="${String(!st.listStatus)}">الكل <span class="chip__count">${digits(visible.length)}</span></button>
            ${Object.entries(APPT_STATUS).map(([k, s]) => html`<button type="button" class="chip" data-lstatus="${k}" aria-pressed="${String(st.listStatus === k)}">${s.label}</button>`)}
          </div>
        </div>
        <div id="appt-table"></div>`);
      enhanceDateFields(bodyEl, signal);
      mountTable(bodyEl.querySelector('#appt-table'), {
        signal,
        caption: 'قائمة المواعيد',
        rows: list,
        empty: { icon: 'calendar-days', title: 'لا توجد مواعيد في هذه الفترة', actions: canCreate ? html`<button type="button" class="btn btn--primary" data-new>${ico('plus')} حجز موعد</button>` : '' },
        columns: [
          { key: 'when', label: 'الموعد', render: (a) => html`<strong>${dayLabel(a.date)}</strong><br><span class="muted">${formatRange(a.startMin, a.duration)}</span>` },
          { key: 'patient', label: 'المريض', render: (a) => html`<a href="${href('/patients/:id', { id: a.patientId })}">${a.patientName}</a>${medicalAlerts(patients.get(a.patientId)).critical.length ? html` <span class="badge badge--danger">تنبيه</span>` : ''}` },
          { key: 'procs', label: 'الإجراءات', render: (a) => (a.procedureNames?.length ? a.procedureNames.join('، ') : html`<span class="subtle">—</span>`) },
          { key: 'doctor', label: 'الطبيب', render: (a) => doctors.find((d) => d.id === a.doctorId)?.displayName ?? html`<span class="subtle">—</span>` },
          { key: 'status', label: 'الحالة', render: (a) => html`<span class="badge badge--dot badge--${APPT_STATUS[a.status].tone}">${APPT_STATUS[a.status].label}</span>${a.reminderSentAt ? html` <span class="badge" title="أُرسل التذكير">${ico('message-circle', { size: 13 })}</span>` : ''}` },
          { key: 'actions', label: '', render: (a) => html`<div class="table__actions">
            ${canEdit ? NEXT_STEPS[a.status].filter((s) => QUICK[s]).map((s) => html`<button type="button" class="btn btn--sm btn--soft" data-quick="${s}" data-id="${a.id}">${QUICK[s]}</button>`) : ''}
            <button type="button" class="btn btn--icon btn--sm" data-appt="${a.id}" aria-label="تفاصيل">${ico('eye', { size: 18 })}</button>
          </div>` },
        ],
      });
    };

    const load = async () => {
      const [from, to] = rangeFor();
      rows = await listRange(from, to);
      draw();
      syncUrl();
      const n = (await tomorrowsReminders()).filter((a) => !a.reminderSentAt).length;
      el.querySelector('#remind-count').textContent = n ? digits(n) : '';
    };

    const shift = (dir) => {
      if (st.view === 'day') st.date = addDays(st.date, dir);
      else if (st.view === 'week') st.date = addDays(st.date, 7 * dir);
      else if (st.view === 'month') { const d = toDate(st.date); st.date = toISODate(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
      else st.date = addDays(st.date, 7 * dir);
      load();
    };

    /* ---------- events ---------- */
    on(el, 'click', '[data-nav]', (_, b) => shift(Number(b.dataset.nav)), { signal });
    on(el, 'click', '[data-today]', () => { st.date = todayISO(); load(); }, { signal });
    on(el, 'click', '[data-goto-day]', (_, b) => { st.date = b.dataset.gotoDay; st.view = 'day'; el.querySelector('[name=view][value=day]').checked = true; load(); }, { signal });
    on(el, 'click', '[data-new]', () => openAppointmentForm({ date: st.date >= todayISO() ? st.date : todayISO(), doctorId: st.doctor || undefined, chairId: st.chair || undefined }), { signal });
    on(el, 'click', '[data-reminders]', () => openReminders(), { signal });
    on(el, 'click', '[data-appt]', (_, b) => {
      const a = rows.find((x) => x.id === b.dataset.appt);
      if (a) openAppointmentDetails(a);
    }, { signal });
    on(el, 'click', '[data-quick]', async (_, b) => {
      const a = rows.find((x) => x.id === b.dataset.id);
      try {
        if (b.dataset.quick === 'cancelled') await cancelWithReason(a);
        else await setAppointmentStatus(a.id, b.dataset.quick);
        toastSuccess(`${a.patientName}: ${APPT_STATUS[b.dataset.quick].label}`);
      } catch (err) { toastError(err.message); }
    }, { signal });
    on(el, 'click', '[data-lstatus]', (_, b) => { st.listStatus = b.dataset.lstatus; draw(); }, { signal });

    // Click on an empty part of a day/week column → book at that time.
    on(el, 'click', '.cal-col', (e, col) => {
      if (!canCreate || /** @type {HTMLElement} */ (e.target).closest('[data-appt]')) return;
      const r = col.getBoundingClientRect();
      const { from } = calendarRange();
      const { slotMin } = getSchedule();
      const minute = from + Math.floor(((/** @type {MouseEvent} */ (e).clientY - r.top) / PX_PER_MIN) / slotMin) * slotMin;
      const colId = col.dataset.colId;
      openAppointmentForm({
        date: col.dataset.day,
        startMin: minute,
        chairId: st.view === 'day' && st.by === 'chair' ? colId : st.chair || undefined,
        doctorId: st.view === 'day' && st.by === 'doctor' ? (colId || undefined) : st.doctor || undefined,
      });
    }, { signal });

    el.addEventListener('change', (e) => {
      const t = /** @type {HTMLInputElement} */ (e.target);
      if (t.name === 'view') { st.view = t.value; load(); }
      if (t.name === 'by') { st.by = /** @type {any} */ (t.value); draw(); syncUrl(); }
      if (t.id === 'f-doctor') { st.doctor = t.value; draw(); syncUrl(); }
      if (t.id === 'f-chair') { st.chair = t.value; draw(); syncUrl(); }
      if (t.name === 'listTo') { const iso = parseDateInput(t.value); if (iso) { st.listTo = iso; load(); } }
    }, { signal });
    on(el, 'click', '[data-toggle-filters]', (_, b) => {
      const open = el.querySelector('.cal-toolbar').toggleAttribute('data-filters-open');
      el.querySelector('#cal-legend').toggleAttribute('data-filters-open', open);
      b.setAttribute('aria-expanded', String(open));
    }, { signal });

    // Live updates: any appointment change re-renders (once per burst of writes); the "now"
    // line moves every minute.
    let reloadTimer;
    const off = onEvent('data:changed', ({ store }) => {
      if (store !== 'appointments' && store !== 'treatmentItems') return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 250);
    });
    const tick = setInterval(() => { if (st.view === 'day' || st.view === 'week') draw(); }, 60_000);

    await load();
    return () => { off(); clearInterval(tick); clearTimeout(reloadTimer); };
  },
};

