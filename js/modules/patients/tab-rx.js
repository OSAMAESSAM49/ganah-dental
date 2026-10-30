/** Patient file → prescriptions: write, reprint, repeat. */
import { html, ico, render, on } from '../../core/dom.js';
import { formatDate } from '../../core/format.js';
import { can } from '../../core/permissions.js';
import { onEvent } from '../../core/bus.js';
import { openMenu } from '../../components/menu.js';
import { confirmDialog } from '../../components/modal.js';
import { emptyState } from '../../components/states.js';
import { toastSuccess } from '../../components/toast.js';
import { prescriptionsForPatient, deletePrescription, formatRxNo } from '../../services/prescriptions.js';
import { prescriptionDialog, printPrescription } from '../prescriptions/dialogs.js';
import { tr } from '../../core/i18n.js';

export async function renderTab({ body, patient, signal }) {
  const perm = { create: can('prescriptions', 'create'), edit: can('prescriptions', 'edit'), del: can('prescriptions', 'delete') };
  let list = [];

  const draw = () => render(body, html`
    <section class="card">
      <div class="card__header">
        <div class="card__heading"><h2 class="card__title">الروشتات</h2><p class="card__subtitle">تظهر تنبيهات الحساسية والأمراض المزمنة تلقائيًا أثناء الكتابة</p></div>
        ${perm.create ? html`<button type="button" class="btn btn--primary btn--sm" data-new-rx>${ico('plus', { size: 18 })} روشتة جديدة</button>` : ''}
      </div>
      <div class="card__body">${list.length ? html`<div class="stack-sm">${list.map((r) => html`
        <article class="rx-card">
          <span class="rx-card__symbol" aria-hidden="true">℞</span>
          <div class="rx-card__main">
            <div><strong>${formatDate(r.date)}</strong> <span class="muted ltr">${formatRxNo(r.number)}</span>${r.doctorName ? html` <span class="muted">· ${r.doctorName}</span>` : ''}</div>
            <ul style="margin:0; padding-inline-start: var(--sp-5)" class="text-sm">${r.lines.map((l) => html`<li><strong class="ltr">${l.name}</strong> <span class="muted">${[l.dose, l.duration].filter(Boolean).join(' — ')}</span></li>`)}</ul>
            ${r.notes ? html`<p class="muted text-sm" style="margin:0; white-space: pre-line">${r.notes}</p>` : ''}
          </div>
          <div class="row">
            <button type="button" class="btn btn--soft btn--sm" data-print="${r.id}">${ico('printer', { size: 18 })} طباعة</button>
            ${perm.edit || perm.del || perm.create ? html`<button type="button" class="btn btn--icon btn--sm" data-rx-menu="${r.id}" aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
          </div>
        </article>`)}</div>` : emptyState({ icon: 'pill', title: 'لا توجد روشتات', hint: 'اكتب روشتة من قالب جاهز (بعد الخلع، حشو العصب…) أو أضف الأدوية واحدًا واحدًا.' })}</div>
    </section>`);

  const load = async () => { list = await prescriptionsForPatient(patient().id); draw(); };
  on(body, 'click', '[data-new-rx]', () => prescriptionDialog({ patientId: patient().id }), { signal });
  on(body, 'click', '[data-print]', (_, b) => printPrescription(list.find((r) => r.id === b.dataset.print), patient()), { signal });
  on(body, 'click', '[data-rx-menu]', (_, b) => {
    const r = list.find((x) => x.id === b.dataset.rxMenu);
    openMenu(b, { header: formatRxNo(r.number), items: [
      ...(perm.create ? [{ label: 'تكرار الروشتة', icon: 'repeat', onSelect: () => prescriptionDialog({ patientId: r.patientId, repeatOf: r }) }] : []),
      ...(perm.edit ? [{ label: 'تعديل', icon: 'pencil', onSelect: () => prescriptionDialog({ prescription: r }) }] : []),
      ...(perm.del ? ['sep', { label: 'حذف', icon: 'trash-2', danger: true, onSelect: async () => {
        if (await confirmDialog({ title: tr`حذف الروشتة ${formatRxNo(r.number)}؟`, message: `${r.patientName} · ${formatDate(r.date)}`, confirmLabel: 'حذف', danger: true })) { await deletePrescription(r.id); toastSuccess('تم الحذف'); }
      } }] : []),
    ] });
  }, { signal });
  const off = onEvent('data:changed', ({ store }) => { if (store === 'prescriptions') load(); });
  await load();
  return off;
}
