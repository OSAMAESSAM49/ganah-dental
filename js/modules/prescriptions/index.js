/**
 * Prescriptions: all prescriptions, the medicines list (with risk groups used for safety
 * warnings), and prescription templates.
 */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { formatDate } from '../../core/format.js';
import { MED_FORMS, MED_CATEGORIES } from '../../core/labels.js';
import { normalizeArabic } from '../../core/text.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { mountTable } from '../../components/table.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textField, selectField } from '../../components/form.js';
import { emptyState } from '../../components/states.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { getPatient } from '../../services/patients.js';
import {
  listPrescriptions, deletePrescription, listMedicines, saveMedicine, setMedicineActive,
  listRxTemplates, saveRxTemplate, setRxTemplateActive, formatRxNo,
} from '../../services/prescriptions.js';
import { prescriptionDialog, printPrescription, linesMarkup, wireLinesEditor, drugsText } from './dialogs.js';

const TABS = [['list', 'الروشتات', 'pill'], ['medicines', 'الأدوية', 'list-checks'], ['templates', 'القوالب', 'file-text']];
const GROUPS = { penicillin: 'بنسلين', nsaid: 'مسكن مضاد للالتهاب (NSAID)', pregnancy: 'حذر في الحمل' };

async function medicineDialog(med) {
  let saved = null;
  await openModal({
    title: med ? 'تعديل الدواء' : 'دواء جديد', icon: 'pill',
    dirty: true,
    body: html`<form class="form" novalidate>
      ${textField({ name: 'name', label: 'الاسم العلمي / التجاري (بالإنجليزية)', value: med?.name ?? '', required: true, ltr: true, placeholder: 'Amoxicillin 500 mg' })}
      <div class="form-grid">
        ${selectField({ name: 'form', label: 'الشكل', value: med?.form ?? 'tablet', options: Object.entries(MED_FORMS).map(([value, label]) => ({ value, label })) })}
        ${selectField({ name: 'category', label: 'التصنيف', value: med?.category ?? 'other', options: Object.entries(MED_CATEGORIES).map(([value, label]) => ({ value, label })) })}
      </div>
      <div class="form-grid">
        ${textField({ name: 'dose', label: 'الجرعة الافتراضية', value: med?.dose ?? '', placeholder: 'قرص كل 8 ساعات' })}
        ${textField({ name: 'duration', label: 'المدة الافتراضية', value: med?.duration ?? '', placeholder: '5 أيام' })}
      </div>
      ${textField({ name: 'notes', label: 'ملاحظة تُطبع مع الدواء', value: med?.notes ?? '' })}
      <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="field__label">مجموعات الخطورة (للتنبيه من التاريخ الطبي)</legend>
        <div class="chips">${Object.entries(GROUPS).map(([k, label]) => html`<label class="check"><input type="checkbox" name="groups" value="${k}" ${med?.groups?.includes(k) ? 'checked' : ''}> ${label}</label>`)}</div>
      </fieldset>
    </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إغلاق', value: null }],
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const groups = [...f.querySelectorAll('[name=groups]:checked')].map((i) => /** @type {HTMLInputElement} */ (i).value);
      if (!showFieldErrors(f, data.name.trim() ? {} : { name: 'اكتب اسم الدواء' })) return false;
      try { saved = await saveMedicine(med?.id, { ...data, groups }); return true; } catch (err) { toastError(err.message); return false; }
    },
  });
  if (saved) toastSuccess('تم حفظ الدواء');
}

async function templateDialog(tpl) {
  const medicines = await listMedicines();
  const st = { lines: (tpl?.lines ?? []).map((l) => ({ ...l })) };
  let saved = null;
  await openModal({
    title: tpl ? 'تعديل قالب الروشتة' : 'قالب روشتة جديد', icon: 'file-text', size: 'lg',
    dirty: true,
    body: html`<form class="form" novalidate>
      ${textField({ name: 'name', label: 'اسم القالب', value: tpl?.name ?? '', required: true, placeholder: 'مثال: بعد الخلع' })}
      <div id="tpl-lines" class="stack-sm">${linesMarkup(st)}</div>
    </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إغلاق', value: null }],
    onOpen(d) { wireLinesEditor(d.querySelector('#tpl-lines'), st, medicines); d.querySelector('form').addEventListener('submit', (e) => e.preventDefault()); },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      try { saved = await saveRxTemplate(tpl?.id, { name: formData(d.querySelector('form')).name, lines: st.lines }); return true; } catch (err) { toastError(err.message); return false; }
    },
  });
  if (saved) toastSuccess('تم حفظ القالب');
}

export default {
  title: 'الروشتات',
  async render({ el, query, signal }) {
    const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'list';
    const perm = { create: can('prescriptions', 'create'), edit: can('prescriptions', 'edit'), del: can('prescriptions', 'delete') };
    const st = { q: '' };
    let rows = [], medicines = [], templates = [];
    const NEW = { list: 'روشتة جديدة', medicines: 'دواء جديد', templates: 'قالب جديد' };

    render(el, html`
      <header class="page-header">
        <div class="page-header__text"><h1 class="page-header__title">الروشتات</h1>
          <p class="page-header__sub">روشتات بأسماء الأدوية بالإنجليزية وتعليمات بالعربي، مع تنبيه تلقائي من التاريخ الطبي</p></div>
        <div class="page-header__actions">${(tab === 'list' ? perm.create : perm.edit) ? html`<button type="button" class="btn btn--primary" data-new>${ico('plus')} ${NEW[tab]}</button>` : ''}</div>
      </header>
      <nav class="tabs" aria-label="أقسام الروشتات">
        ${TABS.map(([k, label, icon]) => html`<a class="tab" href="${href('/prescriptions', {}, k === 'list' ? undefined : { tab: k })}" aria-selected="${String(k === tab)}">${ico(icon, { size: 18 })} ${label}</a>`)}
      </nav>
      <div class="toolbar"><div class="input-group toolbar__search">${ico('search', { size: 20 })}<input class="input input--pill" id="rq" placeholder="${tab === 'list' ? 'ابحث باسم المريض أو الدواء…' : 'ابحث…'}" aria-label="بحث"></div></div>
      <div id="tbl"></div>`);
    const tbl = el.querySelector('#tbl');
    const match = (text) => !st.q || normalizeArabic(text).toLowerCase().includes(normalizeArabic(st.q).toLowerCase());

    const draw = () => {
      if (tab === 'list') {
        mountTable(tbl, {
          signal, caption: 'الروشتات', rows: rows.filter((r) => match(`${r.patientName} ${drugsText(r)} ${formatRxNo(r.number)}`)),
          empty: { icon: 'pill', title: 'لا توجد روشتات', hint: 'اكتب روشتة من ملف المريض أو من زر «روشتة جديدة».' },
          columns: [
            { key: 'no', label: 'الرقم', render: (r) => html`<span class="ltr">${formatRxNo(r.number)}</span>` },
            { key: 'date', label: 'التاريخ', render: (r) => formatDate(r.date) },
            { key: 'patient', label: 'المريض', render: (r) => html`<a href="${href('/patients/:id', { id: r.patientId }, { tab: 'rx' })}">${r.patientName}</a>` },
            { key: 'drugs', label: 'الأدوية', render: (r) => html`<span class="ltr" style="display:inline">${drugsText(r)}</span>` },
            { key: 'doctor', label: 'الطبيب', render: (r) => r.doctorName || '—' },
            { key: 'a', label: '', render: (r) => html`<div class="table__actions">
              <button type="button" class="btn btn--soft btn--sm" data-print="${r.id}">${ico('printer', { size: 18 })} طباعة</button>
              ${perm.edit || perm.del ? html`<button type="button" class="btn btn--icon btn--sm" data-rx-menu="${r.id}" aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}</div>` },
          ],
        });
      } else if (tab === 'medicines') {
        mountTable(tbl, {
          signal, caption: 'الأدوية', rows: medicines.filter((m) => match(`${m.name} ${MED_CATEGORIES[m.category] ?? ''}`)), sort: { key: 'name', dir: 'asc' },
          empty: { icon: 'pill', title: 'لا توجد أدوية' },
          columns: [
            { key: 'name', label: 'الدواء', sortable: true, render: (m) => html`<strong class="ltr">${m.name}</strong>${m.active === false ? html` <span class="badge">موقوف</span>` : ''}<br><span class="muted text-sm">${MED_FORMS[m.form] ?? ''} · ${MED_CATEGORIES[m.category] ?? ''}</span>` },
            { key: 'dose', label: 'الجرعة والمدة', render: (m) => html`${m.dose}${m.duration ? html`<br><span class="muted text-sm">${m.duration}</span>` : ''}` },
            { key: 'groups', label: 'تنبيهات', render: (m) => (m.groups?.length ? html`${m.groups.map((g) => html`<span class="badge badge--warning">${GROUPS[g]}</span> `)}` : '—') },
            { key: 'a', label: '', render: (m) => (perm.edit ? html`<div class="table__actions">
              <button type="button" class="btn btn--soft btn--sm" data-edit-med="${m.id}">${ico('pencil', { size: 16 })} تعديل</button>
              <button type="button" class="btn btn--ghost btn--sm" data-toggle-med="${m.id}">${m.active === false ? 'تفعيل' : 'إيقاف'}</button></div>` : '') },
          ],
        });
      } else {
        const list = templates.filter((t) => match(`${t.name} ${t.lines.map((l) => l.name).join(' ')}`));
        render(tbl, list.length ? html`<div class="tpl-grid">${list.map((t) => html`
          <article class="tpl-card ${t.active === false ? 'tpl-card--off' : ''}">
            <header class="tpl-card__head"><strong>${t.name}</strong>${t.active === false ? html`<span class="badge">موقوف</span>` : ''}</header>
            <ol style="margin:0; padding-inline-start: var(--sp-5)" class="text-sm">${t.lines.map((l) => html`<li><span class="ltr">${l.name}</span><br><span class="muted">${l.dose}${l.duration ? ` — ${l.duration}` : ''}</span></li>`)}</ol>
            ${perm.edit ? html`<footer class="row"><button type="button" class="btn btn--soft btn--sm" data-edit-tpl="${t.id}">${ico('pencil', { size: 16 })} تعديل</button>
              <button type="button" class="btn btn--ghost btn--sm" data-toggle-tpl="${t.id}">${t.active === false ? 'تفعيل' : 'إيقاف'}</button></footer>` : ''}
          </article>`)}</div>` : html`<div class="card">${emptyState({ icon: 'file-text', title: 'لا توجد قوالب' })}</div>`);
      }
    };

    const load = async () => {
      if (tab === 'list') rows = await listPrescriptions();
      else if (tab === 'medicines') medicines = await listMedicines({ includeInactive: true });
      else templates = await listRxTemplates({ includeInactive: true });
      draw();
    };

    let qTimer;
    on(el, 'input', '#rq', (_, i) => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = i.value; draw(); }, 200); }, { signal });
    on(el, 'click', '[data-new]', () => (tab === 'list' ? prescriptionDialog() : tab === 'medicines' ? medicineDialog(null) : templateDialog(null)), { signal });
    on(el, 'click', '[data-edit-med]', (_, b) => medicineDialog(medicines.find((m) => m.id === b.dataset.editMed)), { signal });
    on(el, 'click', '[data-toggle-med]', async (_, b) => {
      const m = medicines.find((x) => x.id === b.dataset.toggleMed);
      const on = m.active === false;
      await setMedicineActive(m.id, on);
      toastSuccess(on ? `عاد «${m.name}» لقائمة الأدوية` : `أُوقف «${m.name}» — لن يظهر عند كتابة روشتة`);
    }, { signal });
    on(el, 'click', '[data-edit-tpl]', (_, b) => templateDialog(templates.find((t) => t.id === b.dataset.editTpl)), { signal });
    on(el, 'click', '[data-toggle-tpl]', async (_, b) => {
      const t = templates.find((x) => x.id === b.dataset.toggleTpl);
      const on = t.active === false;
      await setRxTemplateActive(t.id, on);
      toastSuccess(on ? `تم تفعيل قالب «${t.name}»` : `أُوقف قالب «${t.name}»`);
    }, { signal });
    on(el, 'click', '[data-print]', async (_, b) => { const r = rows.find((x) => x.id === b.dataset.print); printPrescription(r, await getPatient(r.patientId)); }, { signal });
    on(el, 'click', '[data-rx-menu]', (_, b) => {
      const r = rows.find((x) => x.id === b.dataset.rxMenu);
      openMenu(b, { header: formatRxNo(r.number), items: [
        ...(perm.edit ? [{ label: 'تعديل', icon: 'pencil', onSelect: () => prescriptionDialog({ prescription: r }) }] : []),
        ...(perm.create ? [{ label: 'تكرار الروشتة', icon: 'repeat', onSelect: () => prescriptionDialog({ patientId: r.patientId, repeatOf: r }) }] : []),
        ...(perm.del ? ['sep', { label: 'حذف', icon: 'trash-2', danger: true, onSelect: async () => {
          if (await confirmDialog({ title: `حذف الروشتة ${formatRxNo(r.number)}؟`, message: r.patientName, confirmLabel: 'حذف', danger: true })) { await deletePrescription(r.id); toastSuccess('تم الحذف'); }
        } }] : []),
      ] });
    }, { signal });

    const STORE = { list: 'prescriptions', medicines: 'medicines', templates: 'rxTemplates' }[tab];
    const off = onEvent('data:changed', ({ store }) => { if (store === STORE) load(); });
    await load();
    return off;
  },
};

