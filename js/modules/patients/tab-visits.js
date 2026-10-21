/** Patient file → visits: upcoming appointments and past visits with the doctor's notes. */
import { html, ico, render, on } from '../../core/dom.js';
import { todayISO, digits } from '../../core/format.js';
import { dayLabel, formatRange, nowMinutes } from '../../core/time.js';
import { APPT_STATUS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { onEvent } from '../../core/bus.js';
import { emptyState } from '../../components/states.js';
import { listForPatient } from '../../services/appointments.js';
import { openAppointmentForm } from '../appointments/appt-form.js';
import { openAppointmentDetails } from '../appointments/appt-details.js';

export async function renderTab({ body, patient, signal }) {
  const p = patient();
  let appts = [];

  const row = (a) => html`
    <li class="today-item" style="--st:${APPT_STATUS[a.status].color}">
      <span class="today-item__time">${dayLabel(a.date, { year: a.date.slice(0, 4) !== todayISO().slice(0, 4) })}<br><span class="muted text-sm">${formatRange(a.startMin, a.duration)}</span></span>
      <span class="today-item__main">
        <span>${a.procedureNames?.length ? a.procedureNames.join('، ') : html`<span class="muted">زيارة</span>`}</span>
        ${a.clinicalNotes ? html`<span class="muted text-sm" style="white-space: pre-line">${ico('stethoscope', { size: 14 })} ${a.clinicalNotes}</span>` : ''}
        ${a.status === 'cancelled' && a.cancelReason ? html`<span class="muted text-sm">سبب الإلغاء: ${a.cancelReason}</span>` : ''}
      </span>
      <span class="badge badge--dot badge--${APPT_STATUS[a.status].tone}">${APPT_STATUS[a.status].label}</span>
      <button type="button" class="btn btn--ghost btn--icon btn--sm" data-open="${a.id}" aria-label="التفاصيل">${ico('eye', { size: 18 })}</button>
    </li>`;

  const draw = () => {
    const today = todayISO(), now = nowMinutes();
    const upcoming = appts.filter((a) => (a.status === 'booked' || a.status === 'arrived' || a.status === 'in_chair') && (a.date > today || (a.date === today && a.startMin + a.duration >= now - 120)));
    const past = appts.filter((a) => !upcoming.includes(a)).reverse();
    const counts = { done: past.filter((a) => a.status === 'done').length, noShow: past.filter((a) => a.status === 'no_show').length };
    render(body, html`
      <div class="bento">
        <section class="card span-12">
          <div class="card__header">
            <div class="card__heading"><h2 class="card__title">المواعيد القادمة</h2></div>
            ${can('appointments', 'create') ? html`<button type="button" class="btn btn--primary btn--sm" data-book>${ico('plus', { size: 18 })} حجز موعد</button>` : ''}
          </div>
          <div class="card__body">${upcoming.length ? html`<ul class="list">${upcoming.map(row)}</ul>` : html`<p class="muted">لا توجد مواعيد قادمة.</p>`}</div>
        </section>
        <section class="card span-12">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">الزيارات السابقة</h2>
            <p class="card__subtitle">${digits(counts.done)} زيارة مكتملة${counts.noShow ? ` · ${digits(counts.noShow)} مرة لم يحضر` : ''}</p></div></div>
          <div class="card__body">${past.length ? html`<ul class="list">${past.map(row)}</ul>` : emptyState({ icon: 'calendar-days', title: 'لا توجد زيارات سابقة', hint: 'ستظهر هنا كل زيارة مع ملاحظات الطبيب.' })}</div>
        </section>
      </div>`);
  };

  const load = async () => { appts = await listForPatient(p.id); draw(); };
  on(body, 'click', '[data-book]', () => openAppointmentForm({ patientId: p.id }), { signal });
  on(body, 'click', '[data-open]', (_, b) => { const a = appts.find((x) => x.id === b.dataset.open); if (a) openAppointmentDetails(a); }, { signal });
  const off = onEvent('data:changed', ({ store }) => { if (store === 'appointments') load(); });
  await load();
  return off;
}
