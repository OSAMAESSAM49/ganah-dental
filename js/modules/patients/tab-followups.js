/** Patient file → follow-ups: pending and past follow-ups of this patient. */
import { html, ico, render, on } from '../../core/dom.js';
import { can } from '../../core/permissions.js';
import { onEvent } from '../../core/bus.js';
import { emptyState } from '../../components/states.js';
import { followUpsForPatient } from '../../services/followups.js';
import { renderRows, wireFollowUpRows, newFollowUpDialog } from '../followups/shared.js';

export async function renderTab({ body, patient, signal }) {
  const p = patient();
  let list = [];

  render(body, html`
    <div class="bento">
      <section class="card span-12">
        <div class="card__header">
          <div class="card__heading"><h2 class="card__title">المتابعات المطلوبة</h2></div>
          ${can('followups', 'create') ? html`<button type="button" class="btn btn--primary btn--sm" data-new-fu>${ico('plus', { size: 18 })} متابعة جديدة</button>` : ''}
        </div>
        <div class="card__body" id="fu-pending"></div>
      </section>
      <section class="card span-12">
        <div class="card__header"><div class="card__heading"><h2 class="card__title">السجل</h2></div></div>
        <div class="card__body" id="fu-past"></div>
      </section>
    </div>`);

  const draw = () => {
    const pending = list.filter((f) => f.status === 'pending').reverse();
    renderRows(body.querySelector('#fu-pending'), pending, { showPatient: false }, html`<p class="muted">لا توجد متابعات مطلوبة.</p>`);
    renderRows(body.querySelector('#fu-past'), list.filter((f) => f.status !== 'pending'), { showPatient: false },
      emptyState({ icon: 'bell', title: 'لا يوجد سجل متابعات', hint: 'تظهر هنا الاتصالات والفحوص بعد إتمامها مع نتيجتها.' }));
  };
  const load = async () => { list = await followUpsForPatient(p.id); draw(); };

  on(body, 'click', '[data-new-fu]', () => newFollowUpDialog({ patientId: p.id }), { signal });
  wireFollowUpRows(body, (id) => list.find((f) => f.id === id), signal);
  const off = onEvent('data:changed', ({ store }) => { if (store === 'followUps') load(); });
  await load();
  return off;
}
