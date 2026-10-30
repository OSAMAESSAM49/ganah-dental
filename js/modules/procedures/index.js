/** Procedures catalog: categories, prices, durations, ordering, activation. */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, toPiasters, piastersToInput, digits, arabicCount } from '../../core/format.js';
import { normalizeDigits, normalizeArabic } from '../../core/text.js';
import { CONDITIONS, CONDITION } from '../../core/chart-conditions.js';
import { listItems, recipeCost, unitLabel } from '../../services/inventory.js';
import { listTemplates, describeSchedule } from '../../services/followups.js';
import { FOLLOWUP_TYPES } from '../../core/labels.js';
import { formatNumber } from '../../core/format.js';
import { validate, required } from '../../core/validate.js';
import { can } from '../../core/permissions.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textField, selectField, textareaField } from '../../components/form.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import { tr } from '../../core/i18n.js';
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
    let items = [], itemsById = new Map();

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
                  <thead><tr><th>الإجراء</th><th class="num">السعر</th><th class="num">تكلفة الخامات</th><th>المدة</th><th>الجلسات</th><th></th></tr></thead>
                  <tbody>${c.procedures.map((p, pi) => html`
                    <tr class="proc-row" ${p.active ? '' : html`data-inactive`}>
                      <td data-label="الإجراء"><span class="proc-name"><strong>${p.name}</strong>
                        <span class="proc-flags">
                          ${p.perTooth ? html`<span class="badge">${ico('tooth', { size: 13 })} لكل سن</span>` : ''}
                          ${p.needsLab ? html`<span class="badge badge--info">${ico('flask-conical', { size: 13 })} معمل</span>` : ''}
                          ${CONDITION[p.chartEffect] ? html`<span class="badge"><span class="cond-dot" style="background:${CONDITION[p.chartEffect].color}"></span> ${CONDITION[p.chartEffect].short}</span>` : ''}
                          ${p.active ? '' : html`<span class="badge badge--danger">موقوف</span>`}
                        </span></span></td>
                      <td data-label="السعر" class="num">${p.price ? html`<strong>${formatMoney(p.price)}</strong>` : html`<span class="badge badge--warning">بدون سعر</span>`}</td>
                      <td data-label="تكلفة الخامات" class="num">${p.recipe?.length ? html`${formatMoney(recipeCost(p.recipe, itemsById))}${p.price ? html`<br><span class="subtle text-sm">الربح ${formatMoney(p.price - recipeCost(p.recipe, itemsById))}</span>` : ''}` : html`<span class="subtle">—</span>`}</td>
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

    const reload = async () => {
      [catalog, items] = await Promise.all([loadCatalog(), can('inventory', 'view') ? listItems() : []]);
      itemsById = new Map(items.map((i) => [i.id, i]));
      draw();
    };
    const findProc = (id) => catalog.flatMap((c) => c.procedures).find((p) => p.id === id);
    const run = async (fn, okMsg) => {
      try { await fn(); if (okMsg) toastSuccess(okMsg); await reload(); } catch (err) { toastError(err.message); }
    };

    el.querySelector('#proc-q').addEventListener('input', (e) => { q = /** @type {HTMLInputElement} */ (e.target).value; draw(); }, { signal });
    el.querySelector('#show-inactive').addEventListener('change', (e) => { showInactive = /** @type {HTMLInputElement} */ (e.target).checked; draw(); }, { signal });

    on(el, 'click', '[data-add-proc]', () => procedureDialog(null, catalog, items).then((saved) => saved && reload()), { signal });
    on(el, 'click', '[data-edit]', (_, b) => procedureDialog(findProc(b.dataset.edit), catalog, items).then((saved) => saved && reload()), { signal });
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
          if (await confirmDialog({ title: tr`حذف «${p.name}»؟`, message: 'إذا كان مستخدمًا في خطط علاج لن يُحذف، ويمكنك إيقافه بدلًا من ذلك.', confirmLabel: 'حذف', danger: true })) run(() => deleteProcedure(p.id), 'تم حذف الإجراء');
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
          if (await confirmDialog({ title: tr`حذف تصنيف «${c.name}»؟`, message: 'يجب أن يكون التصنيف فارغًا.', confirmLabel: 'حذف', danger: true })) run(() => deleteCategory(c.id), 'تم حذف التصنيف');
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
    dirty: true,
    body: html`<form class="form" novalidate>${textField({ name: 'name', label: 'الاسم', value, required: true })}</form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إغلاق', value: null }],
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
async function procedureDialog(proc, catalog, items = []) {
  const isNew = !proc;
  let recipe = (proc?.recipe ?? []).map((r) => ({ ...r }));
  const schedule = (proc?.followUpSchedule ?? []).map((s) => ({ ...s }));
  const templates = await listTemplates({ includeInactive: true });
  const scheduleMarkup = () => html`
    <div class="stack-sm">
      <span class="field__label">${ico('bell', { size: 18 })} المتابعة بعد الانتهاء (تُضاف تلقائيًا لقائمة المتابعات)</span>
      ${schedule.map((s, i) => html`<div class="row" style="gap: var(--sp-2)">
        <select class="select" data-s-type="${i}" style="inline-size: auto" aria-label="نوع المتابعة">${Object.entries(FOLLOWUP_TYPES).map(([k, t]) => html`<option value="${k}" ${k === s.type ? 'selected' : ''}>${t.label}</option>`)}</select>
        <span class="muted text-sm">بعد</span>
        <input class="input input--ltr" data-s-days="${i}" value="${s.offsetDays}" inputmode="numeric" style="inline-size: 72px" aria-label="عدد الأيام">
        <span class="muted text-sm">يوم</span>
        <input class="input" data-s-note="${i}" value="${s.note ?? ''}" placeholder="ملاحظة" style="flex: 1 1 140px" aria-label="ملاحظة">
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-s-rm="${i}" aria-label="حذف">${ico('x', { size: 16 })}</button>
      </div>`)}
      <div class="row row--between"><button type="button" class="btn btn--sm" data-s-add>${ico('plus', { size: 16 })} متابعة</button>
        ${schedule.length ? html`<span class="muted text-sm">${describeSchedule(schedule)}</span>` : html`<span class="subtle text-sm">بدون متابعة</span>`}</div>
    </div>`;
  const byId = new Map(items.map((i) => [i.id, i]));
  const recipeMarkup = () => html`
    <div class="stack-sm">
      <span class="field__label">${ico('package', { size: 18 })} المواد المستهلكة (تُخصم من المخزون عند «تم»)</span>
      ${recipe.map((r, i) => html`<div class="row" style="gap: var(--sp-2)">
        <select class="select" data-r-item="${i}" style="flex: 1 1 180px" aria-label="الصنف"><option value="">اختر الصنف…</option>${items.map((it) => html`<option value="${it.id}" ${it.id === r.itemId ? 'selected' : ''}>${it.name}</option>`)}</select>
        <input class="input input--ltr" data-r-qty="${i}" value="${r.qty ?? ''}" inputmode="decimal" style="inline-size: 90px" aria-label="الكمية">
        <span class="muted text-sm" style="min-inline-size: 44px">${unitLabel(byId.get(r.itemId)?.unit)}</span>
        <select class="select" data-r-per="${i}" style="inline-size: auto" aria-label="متى"><option value="completion" ${r.per !== 'session' ? 'selected' : ''}>عند الانتهاء</option><option value="session" ${r.per === 'session' ? 'selected' : ''}>لكل جلسة</option></select>
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-r-rm="${i}" aria-label="حذف">${ico('x', { size: 16 })}</button>
      </div>`)}
      <div class="row row--between"><button type="button" class="btn btn--sm" data-r-add ${items.length ? '' : 'disabled'}>${ico('plus', { size: 16 })} مادة</button>
        <span class="muted text-sm">التكلفة التقديرية: <strong>${formatMoney(recipeCost(recipe.filter((r) => r.itemId), byId))}</strong> لكل وحدة</span></div>
      ${items.length ? '' : html`<p class="subtle text-sm">أضف أصناف المخزون أولًا لربطها بالإجراء.</p>`}
    </div>`;
  const res = await openModal({
    title: isNew ? 'إجراء جديد' : tr`تعديل «${proc.name}»`,
    dirty: true,
    icon: isNew ? 'plus' : 'pencil',
    body: html`
      <form class="form" novalidate>
        ${textField({ name: 'name', label: 'اسم الإجراء', value: proc?.name ?? '', required: true })}
        ${textField({ name: 'nameEn', label: 'الاسم بالإنجليزية (اختياري)', value: proc?.nameEn ?? '', ltr: true, hint: 'يظهر بدل الاسم العربي عند استخدام البرنامج بالإنجليزية' })}
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
        ${selectField({ name: 'chartEffect', label: 'أثره على خريطة الأسنان عند الانتهاء', value: proc?.chartEffect ?? '', placeholder: 'لا يغيّر الخريطة', hint: 'مثال: الحشو يُسجّل «حشو» على السن والأسطح المختارة', options: CONDITIONS.filter((c) => !['caries', 'fractured', 'extract'].includes(c.key)).map((c) => ({ value: c.key, label: c.label })) })}
        ${textareaField({ name: 'notes', label: 'ملاحظات', value: proc?.notes ?? '', rows: 2 })}
        ${items.length || recipe.length ? html`<div id="recipe-box">${recipeMarkup()}</div>` : ''}
        ${selectField({ name: 'instructionTemplateId', label: 'تعليمات ما بعد الإجراء', value: proc?.instructionTemplateId ?? '', placeholder: 'بدون تعليمات', hint: 'يُعرض إرسالها للمريض على واتساب بعد «تم». تُعدّل من المتابعات ← التعليمات والرسائل', options: templates.map((t) => ({ value: t.id, label: t.active === false ? tr`${t.name} (موقوف)` : t.name })) })}
        <div id="schedule-box">${scheduleMarkup()}</div>
      </form>`,
    actions: [{ label: isNew ? 'إضافة' : 'حفظ', value: 'save', variant: 'primary' }, { label: 'إغلاق', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      const box = () => d.querySelector('#recipe-box');
      const redraw = () => { if (box()) render(box(), recipeMarkup()); };
      const redrawSchedule = () => render(d.querySelector('#schedule-box'), scheduleMarkup());
      f.addEventListener('change', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.dataset.rItem !== undefined) { recipe[Number(t.dataset.rItem)].itemId = t.value; redraw(); }
        if (t.dataset.rPer !== undefined) recipe[Number(t.dataset.rPer)].per = t.value;
        if (t.dataset.sType !== undefined) { schedule[Number(t.dataset.sType)].type = t.value; redrawSchedule(); }
        if (t.dataset.sDays !== undefined) redrawSchedule();
      });
      f.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.dataset.rQty !== undefined) recipe[Number(t.dataset.rQty)].qty = Number(normalizeDigits(t.value).replace(',', '.'));
        if (t.dataset.sDays !== undefined) schedule[Number(t.dataset.sDays)].offsetDays = Math.max(0, Math.round(Number(normalizeDigits(t.value)) || 0));
        if (t.dataset.sNote !== undefined) schedule[Number(t.dataset.sNote)].note = t.value;
      });
      f.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest('[data-r-add]')) { recipe.push({ itemId: '', qty: 1, per: 'completion' }); redraw(); }
        const rm = t.closest('[data-r-rm]');
        if (rm) { recipe.splice(Number(rm.dataset.rRm), 1); redraw(); }
        if (t.closest('[data-s-add]')) { schedule.push({ offsetDays: schedule.length ? 7 : 1, type: schedule.length ? 'check' : 'call', note: '' }); redrawSchedule(); }
        const srm = t.closest('[data-s-rm]');
        if (srm) { schedule.splice(Number(srm.dataset.sRm), 1); redrawSchedule(); }
      });
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
      f.querySelector(isNew ? '[name=name]' : '[name=price]').focus();
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const intIn = (x, min, max, label) => {
        const n = Number(normalizeDigits(x));
        return Number.isInteger(n) && n >= min && n <= max ? '' : tr`${label} من ${digits(min)} إلى ${digits(max)}`;
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
        recipe,
        followUpSchedule: schedule,
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
