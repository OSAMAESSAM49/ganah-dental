/** Patient file → medical history: view, or edit with the checklist (patients.edit). */
import { html, ico, render, formData } from '../../core/dom.js';
import { can } from '../../core/permissions.js';
import { setLeaveGuard } from '../../core/router.js';
import { confirmDialog } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { updateMedical } from '../../services/patients.js';
import { medicalFields, readMedical, medicalSummary, sameMedical } from './medical.js';

export async function renderTab({ body, patient, signal }) {
  const editable = can('patients', 'edit');

  let latest = null; // freshest copy after a save (the file header refreshes on its own)
  const current = () => latest ?? patient();
  const view = () => render(body, html`
    <section class="card">
      <div class="card__header"><div class="card__heading"><h2 class="card__title">التاريخ الطبي</h2></div>
        ${editable ? html`<button type="button" class="btn btn--soft btn--sm" data-edit>${ico('pencil', { size: 16 })} تحديث</button>` : ''}</div>
      <div class="card__body">${medicalSummary(current())}</div>
    </section>`);

  const edit = () => {
    const p = current();
    render(body, html`
      <form class="card" id="med-form" novalidate>
        <div class="card__header"><div class="card__heading"><h2 class="card__title">تحديث التاريخ الطبي</h2><p class="card__subtitle">اسأل المريض عن كل بند. الخانات المميزة بعلامة ! تظهر كتنبيه أحمر.</p></div></div>
        <div class="card__body">${medicalFields(p.medical, p.gender)}</div>
        <div class="card__footer form-actions">
          <button type="submit" class="btn btn--primary">${ico('save')} حفظ</button>
          <button type="button" class="btn btn--ghost" data-cancel>إلغاء</button>
        </div>
      </form>`);
    const form = /** @type {HTMLFormElement} */ (body.querySelector('#med-form'));
    const guard = () => confirmDialog({ title: 'لم تحفظ التاريخ الطبي', message: 'هل تريد المغادرة بدون حفظ؟', confirmLabel: 'مغادرة بدون حفظ', danger: true });
    form.addEventListener('change', () => setLeaveGuard(guard), { signal });
    form.querySelector('[data-cancel]').addEventListener('click', () => { setLeaveGuard(null); view(); }, { signal });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const medical = readMedical(formData(form));
      try {
        if (!sameMedical(p.medical, medical)) latest = await updateMedical(p.id, medical);
        setLeaveGuard(null);
        toastSuccess('تم حفظ التاريخ الطبي');
        view();
      } catch (err) { toastError(err.message); }
    }, { signal });
  };

  body.addEventListener('click', (e) => { if (/** @type {HTMLElement} */ (e.target).closest('[data-edit]')) edit(); }, { signal });
  const p = patient();
  if (editable && !p.medical?.updatedAt && !Object.keys(p.medical?.items ?? {}).length) edit(); else view();
  return () => setLeaveGuard(null);
}
