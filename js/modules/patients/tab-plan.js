/**
 * Patient file → treatment plan. Kanban (Planned / In progress / Done) with drag & drop
 * (mouse and touch) plus buttons for keyboard users, a list view, plan options
 * (alternatives the patient chooses from), totals and a printable quote.
 */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, digits, formatDate, arabicCount } from '../../core/format.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { getPref, setPref } from '../../core/prefs.js';
import { TREATMENT_STATUS, PLAN_STATUS, LAB_STATUS } from '../../core/labels.js';
import { labCasesForPatient } from '../../services/labs.js';
import { surfacesText } from '../../core/teeth.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textField } from '../../components/form.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import { loadCatalog } from '../../services/procedures.js';
import {
  listPlans, listItems, ensureActivePlan, isImportedHistory, createPlan, updatePlan, choosePlan, setPlanStatus, deletePlan,
  setItemStatus, addSession, deleteItem, itemMath, planTotals,
} from '../../services/treatment.js';
import { addItemDialog, editItemDialog, confirmDone, printQuote } from './plan-dialogs.js';
import { offerInstructions } from '../followups/shared.js';

const COLUMNS = [
  { key: 'planned', label: 'مخطط', color: 'var(--c-primary)' },
  { key: 'in_progress', label: 'جاري', color: 'var(--c-warning)' },
  { key: 'done', label: 'تم', color: 'var(--c-success)' },
];
const ITEMS = { one: 'بند واحد', two: 'بندان', few: 'بنود', many: 'بندًا' };

export async function renderTab({ body, patient, query, signal }) {
  const p = patient();
  const perm = { create: can('treatment', 'create'), edit: can('treatment', 'edit'), del: can('treatment', 'delete') };
  let plans = [], items = [], catalog = [], labCases = [];
  let planId = query.plan ?? '';
  let view = getPref('planView', 'kanban');
  let showCancelled = false;

  const load = async () => {
    [plans, items, labCases] = await Promise.all([listPlans(p.id), listItems(p.id), can('labs', 'view') ? labCasesForPatient(p.id) : []]);
    // No plan yet (or only the history imported from Dentolize): start the main plan.
    if (plans.every(isImportedHistory) && perm.create) { await ensureActivePlan(p.id); plans = await listPlans(p.id); }
    if (!plans.find((pl) => pl.id === planId)) planId = (plans.find((pl) => pl.status === 'active') ?? plans[0])?.id ?? '';
    if (perm.create && !catalog.length) catalog = await loadCatalog({ includeInactive: false });
  };

  const plan = () => plans.find((pl) => pl.id === planId);
  const planItems = (id = planId) => items.filter((i) => i.planId === id);

  /* ---------- markup ---------- */
  const priceMarkup = (i) => {
    const m = itemMath(i);
    return html`<span class="tcard__price">${m.discount ? html`<s>${formatMoney(m.gross)}</s>` : ''}${formatMoney(m.total)}</span>`;
  };
  const sessionsMarkup = (i) => (i.sessionsPlanned > 1 ? html`<span class="sessions" title="الجلسات ${digits(i.sessionsDone ?? 0)} من ${digits(i.sessionsPlanned)}">${Array.from({ length: i.sessionsPlanned }, (_, k) => html`<span ${k < (i.sessionsDone ?? 0) ? html`data-on` : ''}></span>`)}</span>` : '');
  const teethMarkup = (i) => (i.teeth?.length ? html`<span class="tooth-pills">${i.teeth.map((t) => html`<span class="tooth-pill">${t}${i.surfaces?.length ? html`<small>${surfacesText(t, i.surfaces)}</small>` : ''}</span>`)}</span>` : html`<span class="subtle">عام</span>`);

  const labBadge = (i) => {
    const lc = labCases.find((c) => c.treatmentItemId === i.id && c.status !== 'cancelled');
    if (lc) return html`<a class="badge badge--${LAB_STATUS[lc.status].tone}" href="#/labs">${ico('flask-conical', { size: 13 })} ${LAB_STATUS[lc.status].label}</a>`;
    if (can('labs', 'create') && (i.status === 'planned' || i.status === 'in_progress')) return html`<button type="button" class="btn btn--sm btn--soft" data-to-lab="${i.id}" style="min-block-size: 30px">${ico('flask-conical', { size: 14 })} إرسال للمعمل</button>`;
    return html`<span class="badge badge--info">${ico('flask-conical', { size: 13 })} معمل</span>`;
  };

  const card = (i) => {
    const active = plan()?.status === 'active' || plan()?.status === 'completed';
    return html`
      <article class="tcard" data-item="${i.id}" data-status="${i.status}">
        <div class="tcard__top">
          ${perm.edit && active ? html`<button type="button" class="tcard__grip" data-grip="${i.id}" aria-label="اسحب لتغيير الحالة">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
          <span class="tcard__title">${i.procedureName}</span>
          ${priceMarkup(i)}
        </div>
        <div class="tcard__meta">${teethMarkup(i)} ${sessionsMarkup(i)} ${i.needsLab ? labBadge(i) : ''}</div>
        ${i.notes ? html`<p class="tcard__notes">${i.notes}</p>` : ''}
        ${i.status === 'done' && i.doneAt ? html`<span class="subtle text-sm">${ico('circle-check', { size: 14 })} ${formatDate(i.doneAt)}</span>` : ''}
        ${perm.edit ? html`<div class="tcard__actions">
          ${active && i.status === 'planned' ? html`<button type="button" class="btn btn--soft btn--sm" data-status-to="in_progress" data-id="${i.id}">${ico('arrow-left', { size: 16 })} بدء</button>` : ''}
          ${active && i.status === 'in_progress' && i.sessionsPlanned > 1 ? html`<button type="button" class="btn btn--sm" data-session="${i.id}">${ico('plus', { size: 16 })} جلسة</button>` : ''}
          ${active && (i.status === 'planned' || i.status === 'in_progress') ? html`<button type="button" class="btn btn--accent btn--sm" data-status-to="done" data-id="${i.id}">${ico('check', { size: 16 })} تم</button>` : ''}
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-item-menu="${i.id}" aria-label="خيارات ${i.procedureName}" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>
        </div>` : ''}
      </article>`;
  };

  const kanban = () => {
    const list = planItems();
    return html`
      <div class="kanban">
        ${COLUMNS.map((col) => {
          const colItems = list.filter((i) => i.status === col.key);
          const sum = colItems.reduce((n, i) => n + itemMath(i).total, 0);
          return html`
            <section class="kanban__col" data-col="${col.key}" aria-label="${col.label}">
              <header class="kanban__head">
                <span class="kanban__title"><span class="kanban__dot" style="background:${col.color}"></span>${col.label} <span class="chip__count">${digits(colItems.length)}</span></span>
                <span class="kanban__sum">${formatMoney(sum)}</span>
              </header>
              ${colItems.length ? colItems.map(card) : html`<div class="kanban__empty">${col.key === 'planned' ? 'أضف إجراءات من خريطة الأسنان أو زر «إضافة إجراء»' : 'اسحب البطاقات هنا'}</div>`}
            </section>`;
        })}
      </div>
      ${list.some((i) => i.status === 'cancelled') ? html`
        <div style="margin-block-start: var(--sp-4)">
          <button type="button" class="btn btn--ghost btn--sm" data-toggle-cancelled>${ico('chevron-down', { size: 16 })} البنود الملغاة (${digits(list.filter((i) => i.status === 'cancelled').length)})</button>
          ${showCancelled ? html`<div class="grid grid--3" style="margin-block-start: var(--sp-3)">${list.filter((i) => i.status === 'cancelled').map(card)}</div>` : ''}
        </div>` : ''}`;
  };

  const listView = () => {
    const list = planItems();
    if (!list.length) return html`<div class="card">${emptyState({ icon: 'list-checks', title: 'لا توجد بنود في هذه الخطة', hint: 'أضف إجراءات من خريطة الأسنان أو من زر «إضافة إجراء».' })}</div>`;
    const active = plan()?.status === 'active' || plan()?.status === 'completed';
    return html`
      <div class="table-wrap"><table class="table table--stack">
        <thead><tr><th>الإجراء</th><th>الأسنان</th><th>الحالة</th><th class="num">السعر</th><th class="num">الخصم</th><th class="num">الصافي</th><th></th></tr></thead>
        <tbody>${list.map((i) => {
          const m = itemMath(i);
          return html`<tr>
            <td data-label="الإجراء"><strong>${i.procedureName}</strong>${i.notes ? html`<br><span class="muted text-sm">${i.notes}</span>` : ''}</td>
            <td data-label="الأسنان">${teethMarkup(i)}</td>
            <td data-label="الحالة">${perm.edit && active
              ? html`<select class="select" data-status-select="${i.id}" style="min-block-size: 38px; inline-size: auto" aria-label="حالة ${i.procedureName}">
                  ${Object.entries(TREATMENT_STATUS).map(([k, v]) => html`<option value="${k}" ${k === i.status ? 'selected' : ''}>${v.label}</option>`)}
                </select>`
              : html`<span class="badge badge--${TREATMENT_STATUS[i.status].tone}">${TREATMENT_STATUS[i.status].label}</span>`}</td>
            <td data-label="السعر" class="num">${formatMoney(m.gross)}</td>
            <td data-label="الخصم" class="num">${m.discount ? formatMoney(m.discount) : '—'}</td>
            <td data-label="الصافي" class="num"><strong>${i.status === 'cancelled' ? html`<s>${formatMoney(m.total)}</s>` : formatMoney(m.total)}</strong></td>
            <td data-label="">${perm.edit ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-item-menu="${i.id}" aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}</td>
          </tr>`;
        })}</tbody>
      </table></div>`;
  };

  const draw = () => {
    const pl = plan();
    if (!pl) {
      render(body, html`<div class="card">${emptyState({ icon: 'list-checks', title: 'لا توجد خطة علاج', hint: 'ليست لديك صلاحية إنشاء خطط علاج.' })}</div>`);
      return;
    }
    const t = planTotals(planItems());
    render(body, html`
      <div class="stack">
        <div class="row row--between">
          <div class="plan-tabs" role="tablist" aria-label="خطط العلاج">
            ${plans.map((x) => html`
              <button type="button" class="plan-tab" role="tab" data-plan="${x.id}" data-status="${x.status}" aria-selected="${String(x.id === planId)}">
                <span class="plan-tab__name">${x.name} <span class="badge badge--${PLAN_STATUS[x.status].tone}">${PLAN_STATUS[x.status].label}</span></span>
                <span class="plan-tab__total">${arabicCount(planTotals(planItems(x.id)).count, ITEMS)} · ${formatMoney(planTotals(planItems(x.id)).net)}</span>
              </button>`)}
            ${perm.create ? html`<button type="button" class="btn btn--sm" data-new-plan>${ico('plus', { size: 16 })} خطة بديلة</button>` : ''}
          </div>
        </div>

        ${pl.status === 'proposal' ? html`<div class="alert">${ico('info')}<div class="alert__content"><div class="alert__title">خطة بديلة (عرض على المريض)</div><div class="alert__body">اطبع عرض السعر للمقارنة. عندما يختار المريض هذه الخطة اضغط «اعتماد» لبدء العلاج.</div></div>${perm.edit ? html`<button type="button" class="btn btn--primary btn--sm" data-choose>${ico('circle-check', { size: 18 })} اعتماد</button>` : ''}</div>` : ''}

        <div class="totals">
          <div class="totals__item totals__item--hero"><div class="totals__label">إجمالي الخطة</div><div class="totals__value">${formatMoney(t.net)}</div></div>
          <div class="totals__item"><div class="totals__label">قبل الخصم</div><div class="totals__value">${formatMoney(t.gross)}</div></div>
          <div class="totals__item"><div class="totals__label">الخصومات</div><div class="totals__value">${formatMoney(t.discount)}</div></div>
          <div class="totals__item"><div class="totals__label">تم تنفيذه</div><div class="totals__value">${formatMoney(t.done)}</div></div>
          <div class="totals__item"><div class="totals__label">المتبقي</div><div class="totals__value">${formatMoney(t.remaining)}</div></div>
        </div>

        <div class="toolbar" style="margin: 0">
          <div class="segmented" role="radiogroup" aria-label="طريقة العرض">
            <label><input type="radio" name="planView" value="kanban" ${view === 'kanban' ? 'checked' : ''}><span>${ico('layout-dashboard', { size: 16 })} لوحة</span></label>
            <label><input type="radio" name="planView" value="list" ${view === 'list' ? 'checked' : ''}><span>${ico('list-checks', { size: 16 })} قائمة</span></label>
          </div>
          <div class="grow"></div>
          ${perm.create ? html`<a class="btn btn--sm" href="${href('/patients/:id', { id: p.id }, { tab: 'chart' })}">${ico('tooth', { size: 18 })} من الخريطة</a>
            <button type="button" class="btn btn--primary btn--sm" data-add-item>${ico('plus', { size: 18 })} إضافة إجراء</button>` : ''}
          <button type="button" class="btn btn--sm" data-print>${ico('printer', { size: 18 })} عرض سعر</button>
          ${perm.edit ? html`<button type="button" class="btn btn--icon btn--sm" data-plan-menu aria-label="خيارات الخطة" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
        </div>

        ${view === 'list' ? listView() : kanban()}
      </div>`);
  };

  const refresh = async () => { await load(); draw(); };
  const guard = async (fn, okMsg) => {
    let ok = false;
    try { await fn(); ok = true; if (okMsg) toastSuccess(okMsg); } catch (err) { toastError(err.message); }
    await refresh();
    return ok;
  };

  /** Changes status, asking for confirmation when completing. */
  const changeStatus = async (id, status) => {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === status) return;
    let opts = {};
    if (status === 'done') { const res = await confirmDone(item); if (!res) { draw(); return; } opts = res; }
    if (item.status === 'done' && !(await confirmDialog({ title: 'إرجاع البند من «تم»؟', message: 'سيُلغى أثره على خريطة الأسنان، وتعود المواد للمخزون، وتُحذف متابعاته التي لم تتم.', confirmLabel: 'إرجاع' }))) { draw(); return; }
    const ok = await guard(() => setItemStatus(id, status, opts), status === 'done' ? 'أحسنت! تم تسجيل الانتهاء' : null);
    if (ok && status === 'done') offerInstructions(item);
  };

  /* ---------- events ---------- */
  on(body, 'click', '[data-plan]', (_, b) => { planId = b.dataset.plan; draw(); }, { signal });
  body.addEventListener('change', (e) => {
    const t = /** @type {HTMLSelectElement} */ (e.target);
    if (t.name === 'planView') { view = t.value; setPref('planView', view); draw(); }
    if (t.dataset.statusSelect) changeStatus(t.dataset.statusSelect, t.value);
  }, { signal });
  on(body, 'click', '[data-status-to]', (_, b) => changeStatus(b.dataset.id, b.dataset.statusTo), { signal });
  on(body, 'click', '[data-session]', async (_, b) => {
    try {
      const { item, complete } = await addSession(b.dataset.session);
      await refresh();
      if (complete && await confirmDialog({ title: 'اكتملت كل الجلسات', message: `هل تريد تسجيل «${item.procedureName}» كمنتهٍ الآن؟`, confirmLabel: 'نعم، تم' })) await changeStatus(item.id, 'done');
      else toastSuccess(`الجلسة ${digits(item.sessionsDone)} من ${digits(item.sessionsPlanned)}`);
    } catch (err) { toastError(err.message); }
  }, { signal });
  on(body, 'click', '[data-to-lab]', async (_, b) => {
    const { labCaseDialog } = await import('../labs/index.js');
    if (await labCaseDialog({ patientId: p.id, treatmentItemId: b.dataset.toLab })) refresh();
  }, { signal });
  on(body, 'click', '[data-toggle-cancelled]', () => { showCancelled = !showCancelled; draw(); }, { signal });
  on(body, 'click', '[data-add-item]', async () => { if (await addItemDialog(plan(), catalog)) { toastSuccess('تمت إضافة الإجراء'); refresh(); } }, { signal });
  on(body, 'click', '[data-print]', () => printQuote(p, [{ plan: plan(), items: planItems() }]), { signal });
  on(body, 'click', '[data-choose]', async () => {
    const others = plans.filter((x) => x.id !== planId && (x.status === 'proposal' || x.status === 'active'));
    const ok = await confirmDialog({ title: `اعتماد «${plan().name}»؟`, message: others.length ? 'ستصبح هذه هي الخطة المعتمدة. الخطط الأخرى التي لم يبدأ تنفيذها تُعلَّم بأنها «لم تُختر» (وتبقى محفوظة للرجوع إليها).' : 'ستصبح هذه الخطة المعتمدة ويمكن بدء العلاج.', confirmLabel: 'اعتماد' });
    if (ok) guard(async () => { const r = await choosePlan(planId); if (r.length) toastSuccess(`لم تُختر: ${r.join('، ')}`); }, 'تم اعتماد الخطة');
  }, { signal });

  on(body, 'click', '[data-item-menu]', (_, b) => {
    const i = items.find((x) => x.id === b.dataset.itemMenu);
    const active = plan()?.status === 'active' || plan()?.status === 'completed';
    openMenu(b, { items: [
      { label: 'تعديل السعر والخصم والتفاصيل', icon: 'pencil', onSelect: async () => { if (await editItemDialog(i)) { toastSuccess('تم الحفظ'); refresh(); } } },
      ...(active && i.status !== 'planned' && i.status !== 'cancelled' ? [{ label: 'إرجاع إلى «مخطط»', icon: 'refresh-cw', onSelect: () => changeStatus(i.id, 'planned') }] : []),
      ...(i.status === 'cancelled' ? [{ label: 'إعادة تفعيل البند', icon: 'refresh-cw', onSelect: () => changeStatus(i.id, 'planned') }] : []),
      ...(i.status !== 'cancelled' && i.status !== 'done' ? [{ label: 'إلغاء البند', icon: 'circle-x', onSelect: async () => {
        if (await confirmDialog({ title: 'إلغاء هذا البند؟', message: 'يبقى ظاهرًا في «البنود الملغاة» ولا يُحسب في الإجمالي.', confirmLabel: 'إلغاء البند', danger: true })) guard(() => setItemStatus(i.id, 'cancelled'));
      } }] : []),
      ...(perm.del && (i.status === 'planned' || i.status === 'cancelled') ? ['sep', { label: 'حذف البند', icon: 'trash-2', danger: true, onSelect: async () => {
        if (await confirmDialog({ title: 'حذف هذا البند نهائيًا؟', message: i.procedureName, confirmLabel: 'حذف', danger: true })) guard(() => deleteItem(i.id), 'تم الحذف');
      } }] : []),
    ] });
  }, { signal });

  on(body, 'click', '[data-new-plan]', async () => {
    let created = null;
    const res = await openModal({
      title: 'خطة بديلة',
      dirty: true,
      icon: 'list-checks',
      body: html`<form class="form" novalidate>
        <p class="muted">أنشئ خيارًا آخر للمريض (مثلًا «اقتصادي» و«مميز») ثم اطبع عرض سعر يقارن بينهما.</p>
        ${textField({ name: 'name', label: 'اسم الخطة', required: true, placeholder: 'مثال: الخيار الاقتصادي' })}
        <label class="check"><input type="checkbox" name="copy" checked> ابدأ بنسخة من بنود «${plan().name}»</label>
      </form>`,
      actions: [{ label: 'إنشاء', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
      onOpen(d, close) { const f = d.querySelector('form'); f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); f.querySelector('input').focus(); },
      async beforeClose(v, d) {
        if (v !== 'save') return true;
        const f = d.querySelector('form');
        const data = formData(f);
        if (!showFieldErrors(f, data.name.trim() ? {} : { name: 'اسم الخطة مطلوب' })) return false;
        created = await createPlan(p.id, { name: data.name, status: 'proposal', copyFrom: data.copy ? planId : undefined });
        return true;
      },
    });
    if (res === 'save' && created) { planId = created.id; toastSuccess('تم إنشاء الخطة البديلة — عدّل أسعارها وبنودها'); refresh(); }
  }, { signal });

  on(body, 'click', '[data-plan-menu]', (_, b) => {
    const pl = plan();
    const proposals = plans.filter((x) => x.status === 'proposal' || x.status === 'active');
    openMenu(b, { items: [
      { label: 'إعادة تسمية الخطة', icon: 'pencil', onSelect: async () => {
        let name = '';
        const r = await openModal({
          title: 'إعادة تسمية', icon: 'pencil',
          dirty: true,
          body: html`<form class="form" novalidate>${textField({ name: 'name', label: 'اسم الخطة', value: pl.name, required: true })}</form>`,
          actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
          onOpen(d, close) { d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); },
          beforeClose(v, d) { if (v !== 'save') return true; name = formData(d.querySelector('form')).name.trim(); return !!name; },
        });
        if (r === 'save') guard(() => updatePlan(pl.id, { name }), 'تم');
      } },
      ...(proposals.length > 1 ? [{ label: 'طباعة مقارنة الخطط البديلة', icon: 'printer', onSelect: () => printQuote(p, proposals.map((x) => ({ plan: x, items: planItems(x.id) }))) }] : []),
      ...(pl.status === 'proposal' ? [{ label: 'تعليم أنها «لم تُختر»', icon: 'circle-x', onSelect: () => guard(() => setPlanStatus(pl.id, 'rejected')) }] : []),
      ...(pl.status === 'rejected' ? [{ label: 'إرجاعها كخطة بديلة', icon: 'refresh-cw', onSelect: () => guard(() => setPlanStatus(pl.id, 'proposal')) }] : []),
      ...(perm.del ? ['sep', { label: 'حذف الخطة', icon: 'trash-2', danger: true, onSelect: async () => {
        if (await confirmDialog({ title: `حذف «${pl.name}»؟`, message: 'ستُحذف الخطة وكل بنودها المخططة. لا يمكن حذف خطة بدأ تنفيذها.', confirmLabel: 'حذف', danger: true })) {
          await guard(() => deletePlan(pl.id), 'تم حذف الخطة');
        }
      } }] : []),
    ] });
  }, { signal });

  /* ---------- drag & drop (pointer events: mouse + touch + pen) ---------- */
  let drag = null;
  body.addEventListener('pointerdown', (e) => {
    const grip = /** @type {HTMLElement} */ (e.target).closest('[data-grip]');
    if (!grip || e.button > 0) return;
    const cardEl = /** @type {HTMLElement} */ (grip.closest('.tcard'));
    const rect = cardEl.getBoundingClientRect();
    const ghost = /** @type {HTMLElement} */ (cardEl.cloneNode(true));
    ghost.classList.add('tcard__ghost');
    ghost.style.inlineSize = `${rect.width}px`;
    document.body.append(ghost);
    cardEl.classList.add('is-dragging');
    drag = { id: grip.dataset.grip, cardEl, ghost, dx: e.clientX - rect.left, dy: e.clientY - rect.top, col: null };
    try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    moveGhost(e);
    e.preventDefault();
  }, { signal });
  const moveGhost = (e) => {
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;
    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-col]');
    body.querySelectorAll('[data-col]').forEach((c) => c.toggleAttribute('data-over', c === col));
    drag.col = col?.getAttribute('data-col') ?? null;
  };
  body.addEventListener('pointermove', (e) => { if (drag) moveGhost(e); }, { signal });
  const endDrag = async () => {
    if (!drag) return;
    const { id, cardEl, ghost, col } = drag;
    drag = null;
    ghost.remove();
    cardEl.classList.remove('is-dragging');
    body.querySelectorAll('[data-col]').forEach((c) => c.removeAttribute('data-over'));
    if (col) await changeStatus(id, col);
  };
  body.addEventListener('pointerup', endDrag, { signal });
  body.addEventListener('pointercancel', endDrag, { signal });
  signal.addEventListener('abort', () => drag?.ghost.remove());

  await refresh();
}
