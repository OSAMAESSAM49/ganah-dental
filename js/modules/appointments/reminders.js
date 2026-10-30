/**
 * Tomorrow's WhatsApp reminders: one row per booked appointment with a pre-filled wa.me link.
 * Sending is manual (one click per patient) — automatic sending needs a backend.
 */
import { html, ico, render } from '../../core/dom.js';
import { formatDateTime, digits } from '../../core/format.js';
import { formatClock, dayLabel, addDays } from '../../core/time.js';
import { todayISO } from '../../core/format.js';
import { can } from '../../core/permissions.js';
import { openModal } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import { tomorrowsReminders, buildReminders, markReminded } from '../../services/appointments.js';
import { tr } from '../../core/i18n.js';

export async function openReminders() {
  const day = addDays(todayISO(), 1);
  let rows = await buildReminders(await tomorrowsReminders());

  const markup = () => (rows.length ? html`
    <div class="stack">
      <p class="muted">اضغط «إرسال» لكل مريض: يفتح واتساب برسالة جاهزة، ثم اضغط إرسال داخل واتساب. يتم تعليم الموعد بأنه «أُرسل».</p>
      <ul class="list">
        ${rows.map((r, i) => html`
          <li class="list__item" style="align-items: flex-start; flex-wrap: wrap">
            <div class="list__main" style="min-inline-size: 220px">
              <span class="list__title">${formatClock(r.appt.startMin)} · ${r.patient?.name ?? r.appt.patientName}</span>
              <span class="list__meta">${r.patient?.phone ? html`<span class="ltr">${digits(r.patient.phone)}</span>` : 'لا يوجد رقم'}${r.appt.reminderSentAt ? html` · ${ico('circle-check', { size: 14 })} أُرسل ${formatDateTime(r.appt.reminderSentAt)}` : ''}</span>
              <details style="margin-block-start: var(--sp-2)"><summary class="text-sm muted" style="cursor:pointer">نص الرسالة</summary><p class="text-sm" style="white-space: pre-line; margin-block-start: var(--sp-2)">${r.message}</p></details>
            </div>
            <div class="row">
              ${r.link ? html`<button type="button" class="btn btn--whatsapp btn--sm" data-send="${i}">${ico('message-circle', { size: 18 })} ${r.appt.reminderSentAt ? 'إرسال مرة أخرى' : 'إرسال'}</button>` : html`<span class="badge badge--warning">لا يوجد موبايل صالح</span>`}
              <button type="button" class="btn btn--ghost btn--sm" data-copy="${i}" aria-label="نسخ الرسالة">${ico('file-text', { size: 18 })}</button>
            </div>
          </li>`)}
      </ul>
      ${can('settings', 'edit') ? html`<a class="link-btn" href="#/settings?tab=schedule" data-close-link>${ico('pencil', { size: 16 })} تعديل نص الرسالة</a>` : ''}
    </div>` : emptyState({ icon: 'calendar-check', title: 'لا توجد مواعيد محجوزة غدًا', hint: 'عند وجود مواعيد ليوم الغد ستظهر هنا مع زر واتساب لكل مريض.' }));

  await openModal({
    title: tr`تذكيرات الغد — ${dayLabel(day)}`,
    icon: 'message-circle',
    size: 'lg',
    body: markup(),
    actions: [{ label: 'إغلاق', value: true }],
    onOpen(dialog, close) {
      const body = dialog.querySelector('.modal__body');
      body.addEventListener('click', async (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest('[data-close-link]')) { close(null); return; }
        const send = t.closest('[data-send]');
        if (send) {
          const r = rows[Number(send.dataset.send)];
          window.open(r.link, '_blank', 'noopener');
          r.appt = await markReminded(r.appt.id);
          render(body, markup());
          return;
        }
        const copy = t.closest('[data-copy]');
        if (copy) {
          try { await navigator.clipboard.writeText(rows[Number(copy.dataset.copy)].message); toastSuccess('تم نسخ الرسالة'); }
          catch { toastError('تعذّر النسخ'); }
        }
      });
    },
  });
}
