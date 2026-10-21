/** Procedures catalog: categories, prices, durations, ordering, activation. */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, toPiasters, piastersToInput, digits, arabicCount } from '../../core/format.js';
import { normalizeDigits, normalizeArabic } from '../../core/text.js';
import { validate, required } from '../../core/validate.js';
import { can } from '../../core/permissions.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textField, selectField, textareaField } from '../../components/form.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import {
  loadCatalog, createCategory, updateCategory, deleteCategory,
  createProcedure, updateProcedure, deleteProcedure, move,
} from '../../services/procedures.js';

const MIN = { one: 'دقيقة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' };
const SESS = { one: 'جلسة', two: 'جلستان', few: 'جلسات', many: 'جلسة' };

export default {
  title: 'الإجراءات والأسعار',
  async render({ el, signal }) {
    const perm = { create: can('procedures', 'create'), edit: can('procedures', 'edit'), del: can('procedures', 'delete') };
    let catalog = [], q = '', showInactive = true;

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">الإجراءات والأسعار</h1>
          <p class="page-header__sub">الأسعار هنا هي الأسعار الافتراضية؛ يمكن تعديل السعر أو الخصم لكل مريض في خطة العلاج.</p>
        </div>
        <div class="page-header__actions">
          ${perm.create ? html`
            <button type="button" class="btn" data-add-cat>${ico('plus')} تصنيف جديد</button>
            <button type="button" class="btn btn--primary" data-add-proc>${ico('plus')} إجراء جديد</button>` : ''}
        </div>
      </header>
      <div id="unpriced"></div>
      <div class="toolbar">
        <div class="input-group toolbar__search">${ico('search', { size: 20 })}<input class="input input--pill" type="search" id="proc-q" placeholder="ابحث عن إجراء…" aria-label="بحث في الإجراءات"></div>
        <label class="switch"><input type="checkbox" id="show-inactive" checked><span class="switch__track"></span> إظهار الموقوفة</label>
      </div>
      <div id="catalog"></div>`);

    const draw = () => {
      const unpriced = catalog.flatMap((c) => c.procedures).filter((p) => p.active && !p.price).length;
      render(el.querySelector('#unpriced'), unpriced ? html`
        <div class="alert alert--warning" style="margin-block-end: var(--sp-5)">${ico('banknote')}
          <div class="alert__content"><div class="alert__title">${arabicCount(unpriced, { one: 'إجراء واحد', two: 'إجراءان', few: 'إجراءات', many: 'إجراءً' })} بدون سعر</div>
          <div class="alert__body">حدّد سعر كل إجراء بالضغط على ${ico('pencil', { size: 14 })} بجانبه، حتى تظهر الأسعار الصحيحة في خطط العلاج والفواتير.</div></div>
        </div>` : '');

      const nq = normalizeArabic(q);
      const cats = catalog
        .filter((c) => showInactive || c.active)
        .map((c) => ({ ...c, procedures: c.procedures.filter((p) => (showInactive || p.active) && (!nq || normalizeArabic(p.name).includes(nq))) }))
        .filter((c) => !nq || c.procedures.length);
      if (!cats.length) { render(el.querySelector('#catalog'), html`<div class="card">${emptyState({ icon: 'list-checks', title: 'لا توجد إجراءات مطابقة' })}</div>`); return; }

      render(el.querySelector('#catalog'), html`${cats.map((c, ci) => html`
        <section class="card cat-card" ${c.active ? '' : html`data-inactive`} aria-labelledby="cat-${c.id}">
          <div class="card__header">
            <div class="row">
              <span class="kpi__icon" style="inline-size:42px;block-size:42px">${ico(c.icon || 'clipboard-list', { size: 20 })}</span>
              <div class="card__heading">
                <h2 class="card__title" id="cat-${c.id}">${c.name} ${c.active ? '' : html`<span class="badge">موقوف</span>`}</h2>
                <p class="card__subtitle">${arabicCount(c.procedures.length, { one: 'إجراء واحد', two: 'إجراءان', few: 'إجراءات', many: 'إجراءً' })}</p>
              </div>
            </div>
            ${perm.edit || perm.del ? html`<div class="row" style="gap: var(--sp-1)">
              ${perm.edit && !nq ? html`<span class="order-btns">
                <button type="button" class="btn btn--ghost btn--icon btn--sm" data-cat-move="${c.id}" data-dir="-1" ${ci === 0 ? 'disabled' : ''} aria-label="تحريك التصنيف لأعلى">${ico('chevron-down', { size: 18, className: 'icon--up' })}</button>
                <button type="button" class="btn btn--ghost btn--icon btn--sm" data-cat-move="${c.id}" data-dir="1" ${ci === cats.length - 1 ? 'disabled' : ''} aria-label="تحريك التصنيف لأسفل">${ico('chevron-down', { size: 18 })}</button>
              </span>` : ''}
              <button type="button" class="btn btn--icon btn--sm" data-cat-menu="${c.id}" aria-label="خيارات التصنيف" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>
            </div>` : ''}
          </div>
          <div class="card__body">
            ${c.procedures.length ? html`
              <div class="table-wrap" style="box-shadow:none; background: var(--c-surface-2)">
                <table class="table table--stack">
                  <thead><tr><th>الإجراء</th><th class="num">السعر</th><th>المدة</th><th>الجلسات</th><th></th></tr></thead>
                  <tbody>${c.procedures.map((p, pi) => html`
                    <tr class="proc-row" ${p.active ? '' : html`data-inactive`}>
                      <td data-label="الإجراء"><span class="proc-name"><strong>${p.name}</strong>
                        <span class="proc-flags">
                          ${p.perTooth ? html`<span class="badge">${ico('tooth', { size: 13 })} لكل سن</span>` : ''}
                          ${p.needsLab ? html`<span class="badge badge--info">${ico('flask-conical', { size: 13 })} معمل</span>` : ''}
                          ${p.active ? '' : html`<span class="badge badge--danger">موقوف</span>`}
                        </span></span></td>
                      <td data-label="السعر" class="num">${p.price ? html`<strong>${formatMoney(p.price)}</strong>` : html`<span class="badge badge--warning">بدون سعر</span>`}</td>
                      <td data-label="المدة">${arabicCount(p.durationMin, MIN)}</td>
                      <td data-label="الجلسات">${arabicCount(p.sessions, SESS)}</td>
                      <td data-label=""><div class="table__actions">
                        ${perm.edit && !nq ? html`<span class="order-btns">
                          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-move="${p.id}" data-dir="-1" ${pi === 0 ? 'disabled' : ''} aria-label="لأعلى">${ico('chevron-down', { size: 16, className: 'icon--up' })}</button>
                          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-move="${p.id}" data-dir="1" ${pi === c.procedures.length - 1 ? 'disabled' : ''} aria-label="لأسفل">${ico('chevron-down', { size: 16 })}</button>
                        </span>` : ''}
                        ${perm.edit ? html`<button type="button" class="btn btn--icon btn--sm" data-edit="${p.id}" aria-label="تعديل ${p.name}">${ico('pencil', { size: 18 })}</button>` : ''}
                        ${perm.edit || perm.del ? html`<button type="button" class="btn btn--icon btn--sm" data-proc-menu="${p.id}" aria-label="خيارات ${p.name}" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
                      </div></td>
                    </tr>`)}</tbody>
                </table>
              </div>` : html`<p class="muted">لا توجد إجراءات في هذا التصنيف بعد.</p>`}
          </div>
        </section>`)}`);
    };

    const reload = async () => { catalog = await loadCatalog(); draw(); };
    const findProc = (id) => catalog.flatMap((c) => c.procedures).find((p) => p.id === id);
    const run = async (fn, okMsg) => {
      try { await fn(); if (okMsg) toastSuccess(okMsg); await reload(); } catch (err) { toastError(err.message); }
    };

    el.querySelector('#proc-q').addEventListener('input', (e) => { q = /** @type {HTMLInputElement} */ (e.target).value; draw(); }, { signal });
    el.querySelector('#show-inactive').addEventListener('change', (e) => { showInactive = /** @type {HTMLInputElement} */ (e.target).checked; draw(); }, { signal });

    on(el, 'click', '[data-add-proc]', () => procedureDialog(null, catalog).then((saved) => saved && reload()), { signal });
    on(el, 'click', '[data-edit]', (_, b) => procedureDialog(findProc(b.dataset.edit), catalog).then((saved) => saved && reload()), { signal });
    on(el, 'click', '[data-add-cat]', async () => {
      const name = await askName('تصنيف جديد', '');
      if (name) run(() => createCategory(name), 'تمت إضافة التصنيف');
    }, { signal });
    on(el, 'click', '[data-move]', (_, b) => run(() => move('procedures', b.dataset.move, Number(b.dataset.dir))), { signal });
    on(el, 'click', '[data-cat-move]', (_, b) => run(() => move('procedureCategories', b.dataset.catMove, Number(b.dataset.dir))), { signal });

    on(el, 'click', '[data-proc-menu]', (_, b) => {
      const p = findProc(b.dataset.procMenu);
      openMenu(b, { items: [
        ...(perm.edit ? [{ label: p.active ? 'إيقاف (إخفاؤه من الاختيارات)' : 'تفعيل', icon: p.active ? 'eye-off' : 'eye', onSelect: () => run(() => updateProcedure(p.id, { active: !p.active }), p.active ? 'تم إيقاف الإجراء' : 'تم تفعيل الإجراء') }] : []),
        ...(perm.del ? ['sep', { label: 'حذف الإجراء', icon: 'trash-2', danger: true, onSelect: async () => {
          if (await confirmDialog({ title: `حذف «${p.name}»؟`, message: 'إذا كان مستخدمًا في خطط علاج لن يُحذف، ويمكنك إيقافه بدلًا من ذلك.', confirmLabel: 'حذف', danger: true })) run(() => deleteProcedure(p.id), 'تم حذف الإجراء');
        } }] : []),
      ] });
    }, { signal });

    on(el, 'click', '[data-cat-menu]', (_, b) => {
      const c = catalog.find((x) => x.id === b.dataset.catMenu);
      openMenu(b, { items: [
        ...(perm.edit ? [
          { label: 'إعادة تسمية', icon: 'pencil', onSelect: async () => { const name = await askName('إعادة تسمية التصنيف', c.name); if (name) run(() => updateCategory(c.id, { name }), 'تم تغيير الاسم'); } },
          { label: c.active ? 'إيقاف التصنيف' : 'تفعيل التصنيف', icon: c.active ? 'eye-off' : 'eye', onSelect: () => run(() => updateCategory(c.id, { active: !c.active })) },
        ] : []),
        ...(perm.del ? ['sep', { label: 'حذف التصنيف', icon: 'trash-2', danger: true, onSelect: async () => {
          if (await confirmDialog({ title: `حذف تصنيف «${c.name}»؟`, message: 'يجب أن يكون التصنيف فارغًا.', confirmLabel: 'حذف', danger: true })) run(() => deleteCategory(c.id), 'تم حذف التصنيف');
        } }] : []),
      ] });
    }, { signal });

    await reload();
  },
};

async function askName(title, value) {
  let name = null;
  const res = await openModal({
    title, icon: 'pencil',
    body: html`<form class="form" novalidate>${textField({ name: 'name', label: 'الاسم', value, required: true })}</form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) { const f = d.querySelector('form'); f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); f.querySelector('input').select(); },
    beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      name = formData(f).name.trim();
      return showFieldErrors(f, name ? {} : { name: 'الاسم مطلوب' });
    },
  });
  return res === 'save' ? name : null;
}

/** Add / edit procedure. @returns {Promise<boolean>} saved */
async function procedureDialog(proc, catalog) {
  const isNew = !proc;
  const res = await openModal({
    title: isNew ? 'إجراء جديد' : `تعديل «${proc.name}»`,
    icon: isNew ? 'plus' : 'pencil',
    body: html`
      <form class="form" novalidate>
        ${textField({ name: 'name', label: 'اسم الإجراء', value: proc?.name ?? '', required: true })}
        <div class="form-grid">
          ${selectField({ name: 'categoryId', label: 'التصنيف', value: proc?.categoryId ?? catalog[0]?.id, required: true, options: catalog.map((c) => ({ value: c.id, label: c.name })) })}
          ${textField({ name: 'price', label: 'السعر الافتراضي (ج.م)', value: proc?.price ? piastersToInput(proc.price) : '', ltr: true, inputmode: 'decimal', placeholder: '0' })}
        </div>
        <div class="form-grid">
          ${textField({ name: 'durationMin', label: 'المدة المتوقعة (دقيقة)', value: proc?.durationMin ?? 30, ltr: true, inputmode: 'numeric', hint: 'تُستخدم عند حجز المواعيد' })}
          ${textField({ name: 'sessions', label: 'عدد الجلسات المعتاد', value: proc?.sessions ?? 1, ltr: true, inputmode: 'numeric' })}
        </div>
        <div class="row" style="gap: var(--sp-6)">
          <label class="check"><input type="checkbox" name="perTooth" ${proc?.perTooth ? 'checked' : ''}> السعر لكل سن</label>
          <label class="check"><input type="checkbox" name="needsLab" ${proc?.needsLab ? 'checked' : ''}> يحتاج معمل تركيبات</label>
        </div>
        ${textareaField({ name: 'notes', label: 'ملاحظات', value: proc?.notes ?? '', rows: 2 })}
        <p class="subtle text-sm">${ico('info', { size: 14 })} المواد المستهلكة وتعليمات ما بعد الإجراء ومواعيد المتابعة تُضاف في مراحل لاحقة.</p>
      </form>`,
    actions: [{ label: isNew ? 'إضافة' : 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) { const f = d.querySelector('form'); f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); f.querySelector(isNew ? '[name=name]' : '[name=price]').focus(); },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const intIn = (x, min, max, label) => {
        const n = Number(normalizeDigits(x));
        return Number.isInteger(n) && n >= min && n <= max ? '' : `${label} من ${digits(min)} إلى ${digits(max)}`;
      };
      const errors = validate(data, {
        name: (x) => required(x, 'اسم الإجراء'),
        price: (x) => (String(x).trim() && Number.isNaN(toPiasters(x)) ? 'أدخل مبلغًا صحيحًا' : ''),
        durationMin: (x) => intIn(x, 5, 480, 'المدة'),
        sessions: (x) => intIn(x, 1, 20, 'عدد الجلسات'),
      });
      if (!showFieldErrors(f, errors)) return false;
      const input = {
        ...data,
        price: String(data.price).trim() ? toPiasters(data.price) : 0,
        durationMin: Number(normalizeDigits(data.durationMin)),
        sessions: Number(normalizeDigits(data.sessions)),
      };
      try {
        if (isNew) await createProcedure(input); else await updateProcedure(proc.id, input);
        return true;
      } catch (err) { showFieldErrors(f, { name: err.message }); return false; }
    },
  });
  if (res === 'save') toastSuccess(isNew ? 'تمت إضافة الإجراء' : 'تم حفظ الإجراء');
  return res === 'save';
}
