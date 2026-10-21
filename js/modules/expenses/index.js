/** Expenses: monthly list with totals by category, recurring monthly expenses, categories. */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, toPiasters, piastersToInput, formatDate, digits, todayISO, parseDateInput, toDate, toISODate } from '../../core/format.js';
import { normalizeDigits } from '../../core/text.js';
import { monthLabel } from '../../core/time.js';
import { PAYMENT_METHODS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { repos } from '../../data/index.js';
import { mountTable } from '../../components/table.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textField, selectField } from '../../components/form.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import {
  listCategories, createCategory, updateCategory, listExpenses, createExpense, updateExpense, deleteExpense,
  listRecurring, createRecurring, updateRecurring, generateRecurringExpenses,
} from '../../services/expenses.js';
import { revenueBetween } from '../../services/billing.js';
import { urlPool } from '../../services/media.js';

const TABS = [['list', 'المصروفات', 'wallet'], ['recurring', 'المصروفات الشهرية الثابتة', 'repeat'], ['categories', 'التصنيفات', 'list-checks']];
const SOURCE = { manual: ['يدوي', ''], inventory: ['من المخزون', 'info'], lab: ['معمل', 'primary'], recurring: ['شهري ثابت', 'accent'] };

const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return [`${ym}-01`, toISODate(new Date(y, m, 0))];
};

export async function expenseDialog(expense = null) {
  const cats = await listCategories({ includeInactive: false });
  let saved = false;
  await openModal({
    title: expense ? 'تعديل مصروف' : 'مصروف جديد',
    icon: 'wallet',
    body: html`
      <form class="form" novalidate>
        <div class="form-grid">
          ${selectField({ name: 'categoryId', label: 'التصنيف', value: expense?.categoryId ?? '', required: true, placeholder: 'اختر…', options: cats.map((c) => ({ value: c.id, label: c.name })) })}
          ${textField({ name: 'amount', label: 'المبلغ (ج.م)', value: expense ? piastersToInput(expense.amount) : '', ltr: true, inputmode: 'decimal', required: true })}
        </div>
        ${textField({ name: 'description', label: 'البيان', value: expense?.description ?? '', placeholder: 'مثال: فاتورة الكهرباء لشهر أكتوبر' })}
        <div class="form-grid">
          ${dateField({ name: 'date', label: 'التاريخ', value: expense?.date ?? todayISO() })}
          <div class="field"><span class="field__label">طريقة الدفع</span>
            <div class="chips">${Object.entries(PAYMENT_METHODS).map(([k, m]) => html`<label class="chip"><input type="radio" name="method" value="${k}" ${k === (expense?.method ?? 'cash') ? 'checked' : ''}>${m.label}</label>`)}</div></div>
        </div>
        <label class="btn btn--soft btn--sm" style="align-self:flex-start">${ico('image', { size: 18 })} ${expense?.receiptMediaId ? 'تغيير صورة الإيصال' : 'إرفاق صورة الإيصال'}
          <input type="file" accept="image/*" capture="environment" name="receipt" class="visually-hidden"></label>
        <span class="muted text-sm" id="rcpt-name"></span>
        ${expense ? '' : html`
          <label class="check"><input type="checkbox" name="recurring"> يتكرر كل شهر (إيجار، رواتب…)</label>
          <div id="rec-box" hidden>${textField({ name: 'dayOfMonth', label: 'يوم الاستحقاق في الشهر', value: String(toDate(todayISO()).getDate()), ltr: true, inputmode: 'numeric', hint: 'من 1 إلى 28. يُسجّل تلقائيًا كل شهر عند فتح البرنامج.' })}</div>`}
      </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      enhanceDateFields(f);
      f.addEventListener('change', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.name === 'recurring') d.querySelector('#rec-box').hidden = !t.checked;
        if (t.name === 'receipt') d.querySelector('#rcpt-name').textContent = t.files?.[0]?.name ?? '';
      });
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const amount = toPiasters(data.amount);
      const date = parseDateInput(data.date);
      const errors = {};
      if (!data.categoryId) errors.categoryId = 'اختر التصنيف';
      if (!(amount > 0)) errors.amount = 'أدخل مبلغًا صحيحًا';
      if (!date) errors.date = 'تاريخ غير صحيح';
      const day = Number(normalizeDigits(data.dayOfMonth ?? '1'));
      if (data.recurring && !(day >= 1 && day <= 28)) errors.dayOfMonth = 'من 1 إلى 28';
      if (!showFieldErrors(f, errors)) return false;
      const receiptFile = /** @type {HTMLInputElement} */ (f.querySelector('[name=receipt]')).files?.[0] ?? null;
      try {
        if (expense) await updateExpense(expense.id, { categoryId: data.categoryId, amount, date, description: data.description, method: data.method, receiptFile });
        else if (data.recurring) await createRecurring({ categoryId: data.categoryId, amount, description: data.description, dayOfMonth: day, startMonth: date.slice(0, 7) });
        else await createExpense({ categoryId: data.categoryId, amount, date, description: data.description, method: data.method, receiptFile });
        saved = true;
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (saved) toastSuccess('تم حفظ المصروف');
  return saved;
}

async function showReceipt(mediaId) {
  const m = await repos.media.get(mediaId);
  if (!m) { toastError('الصورة غير موجودة'); return; }
  const pool = urlPool();
  await openModal({ title: 'صورة الإيصال', icon: 'image', size: 'lg', body: html`<img src="${pool.url(m.blob)}" alt="الإيصال" style="max-block-size: 70vh; margin-inline: auto; border-radius: var(--radius-md)">`, actions: [{ label: 'إغلاق', value: true }] });
  pool.revokeAll();
}

export default {
  title: 'المصروفات',
  async render({ el, query, signal }) {
    const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'list';
    const st = { month: /^\d{4}-\d{2}$/.test(query.month ?? '') ? query.month : todayISO().slice(0, 7), category: '' };
    const perm = { create: can('expenses', 'create'), edit: can('expenses', 'edit'), del: can('expenses', 'delete') };
    await generateRecurringExpenses();

    render(el, html`
      <header class="page-header">
        <div class="page-header__text"><h1 class="page-header__title">المصروفات</h1><p class="page-header__sub">كل ما تصرفه العيادة، لحساب صافي الربح</p></div>
        <div class="page-header__actions">${perm.create ? html`<button type="button" class="btn btn--primary" data-new>${ico('plus')} مصروف جديد</button>` : ''}</div>
      </header>
      <nav class="tabs" aria-label="أقسام المصروفات">${TABS.map(([k, label, icon]) => html`<a class="tab" href="${href('/expenses', {}, { tab: k })}" aria-selected="${String(k === tab)}">${ico(icon, { size: 18 })} ${label}</a>`)}</nav>
      <div id="ex-body"></div>`);
    const body = el.querySelector('#ex-body');
    const current = { rows: [], recurring: [], cats: [] }; // what the active tab rendered

    const listTab = async () => {
      const [from, to] = monthRange(st.month);
      const [cats, rows, revenue] = await Promise.all([listCategories(), listExpenses(from, to), can('billing', 'view') ? revenueBetween(from, to) : null]);
      const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
      const shown = rows.filter((e) => !st.category || e.categoryId === st.category);
      const total = rows.reduce((n, e) => n + e.amount, 0);
      const byCat = cats.map((c) => [c, rows.filter((e) => e.categoryId === c.id).reduce((n, e) => n + e.amount, 0)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      render(body, html`
        <div class="toolbar">
          <div class="row" style="gap: var(--sp-1)">
            <button type="button" class="icon-btn" data-month="-1" aria-label="الشهر السابق">${ico('chevron-right')}</button>
            <strong style="min-inline-size: 130px; text-align:center">${monthLabel(`${st.month}-01`)}</strong>
            <button type="button" class="icon-btn" data-month="1" aria-label="الشهر التالي">${ico('chevron-left')}</button>
          </div>
          <div class="grow"></div>
          <select class="select input--pill" id="ex-cat" style="inline-size:auto" aria-label="التصنيف"><option value="">كل التصنيفات</option>${cats.map((c) => html`<option value="${c.id}" ${c.id === st.category ? 'selected' : ''}>${c.name}</option>`)}</select>
        </div>
        <div class="bento" style="margin-block-end: var(--sp-5)">
          <section class="card card--hero span-4"><div class="kpi">
            <div class="kpi__head"><span class="kpi__icon">${ico('wallet', { size: 22 })}</span><span class="kpi__label">مصروفات الشهر</span></div>
            <div class="kpi__value">${formatMoney(total, { currency: false })}<small>ج.م</small></div>
            ${revenue !== null ? html`<div class="kpi__foot"><span class="kpi__meta">الإيراد ${formatMoney(revenue)} · الصافي <strong>${formatMoney(revenue - total)}</strong></span></div>` : ''}
          </div></section>
          <section class="card span-8"><div class="card__header"><div class="card__heading"><h2 class="card__title">حسب التصنيف</h2></div></div>
            <div class="card__body">${byCat.length ? html`<div class="stack-sm">${byCat.map(([c, v]) => html`
              <button type="button" class="bar-row" data-cat="${c.id}"><span class="bar-row__label">${c.name}</span>
                <span class="bar-row__track"><span class="bar-row__fill" style="inline-size:${Math.max(3, (v / byCat[0][1]) * 100)}%"></span></span>
                <strong class="bar-row__value">${formatMoney(v)}</strong></button>`)}</div>` : html`<p class="muted">لا توجد مصروفات في هذا الشهر.</p>`}</div></section>
        </div>
        <div id="tbl"></div>`);
      mountTable(body.querySelector('#tbl'), {
        signal, caption: 'المصروفات', rows: shown,
        empty: { icon: 'wallet', title: 'لا توجد مصروفات', hint: 'سجّل الإيجار والرواتب والكهرباء… أو اجعلها «شهرية ثابتة» لتُسجّل تلقائيًا.', actions: perm.create ? html`<button type="button" class="btn btn--primary" data-new>${ico('plus')} مصروف جديد</button>` : '' },
        columns: [
          { key: 'date', label: 'التاريخ', render: (e) => formatDate(e.date) },
          { key: 'cat', label: 'التصنيف', render: (e) => catName[e.categoryId] ?? '—' },
          { key: 'desc', label: 'البيان', render: (e) => html`${e.description || html`<span class="subtle">—</span>`} ${e.source !== 'manual' ? html`<span class="badge badge--${SOURCE[e.source][1]}">${SOURCE[e.source][0]}</span>` : ''}` },
          { key: 'method', label: 'الدفع', render: (e) => PAYMENT_METHODS[e.method]?.label ?? '—' },
          { key: 'amount', label: 'المبلغ', num: true, render: (e) => html`<strong>${formatMoney(e.amount)}</strong>` },
          { key: 'a', label: '', render: (e) => html`<div class="table__actions">
            ${e.receiptMediaId ? html`<button type="button" class="btn btn--icon btn--sm" data-receipt="${e.receiptMediaId}" aria-label="صورة الإيصال">${ico('image', { size: 18 })}</button>` : ''}
            ${perm.edit || perm.del ? html`<button type="button" class="btn btn--icon btn--sm" data-ex-menu="${e.id}" aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}</div>` },
        ],
      });
      current.rows = rows;
    };

    const recurringTab = async () => {
      const [cats, rows] = await Promise.all([listCategories(), listRecurring()]);
      const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
      render(body, rows.length ? html`<ul class="list">${rows.map((r) => html`<li class="list__item" ${r.active ? '' : html`style="opacity:.6"`}>
        ${ico('repeat', { size: 20 })}
        <span class="list__main"><span class="list__title">${r.description || catName[r.categoryId]} · ${formatMoney(r.amount)}</span>
          <span class="list__meta">${catName[r.categoryId]} · يوم ${digits(r.dayOfMonth)} من كل شهر${r.lastGenerated ? ` · آخر تسجيل ${monthLabel(`${r.lastGenerated}-01`)}` : ''}${r.active ? '' : ' · متوقف'}</span></span>
        ${perm.edit ? html`<button type="button" class="btn btn--sm" data-rec-toggle="${r.id}">${r.active ? 'إيقاف' : 'استئناف'}</button>
          <button type="button" class="btn btn--ghost btn--sm" data-rec-amount="${r.id}">${ico('pencil', { size: 16 })} المبلغ</button>` : ''}
      </li>`)}</ul>` : html`<div class="card">${emptyState({ icon: 'repeat', title: 'لا توجد مصروفات شهرية ثابتة', hint: 'من «مصروف جديد» اختر «يتكرر كل شهر» للإيجار أو الرواتب، ليُسجّل تلقائيًا كل شهر.' })}</div>`);
      current.recurring = rows;
    };

    const categoriesTab = async () => {
      const cats = await listCategories();
      render(body, html`
        <section class="card"><div class="card__body stack">
          <ul class="list">${cats.map((c) => html`<li class="list__item" ${c.active === false ? html`style="opacity:.6"` : ''}>
            <span class="list__main"><span class="list__title">${c.name}</span>${c.active === false ? html`<span class="list__meta">موقوف</span>` : ''}</span>
            ${perm.edit ? html`<button type="button" class="btn btn--ghost btn--sm" data-cat-rename="${c.id}">${ico('pencil', { size: 16 })} تسمية</button>
              <button type="button" class="btn btn--ghost btn--sm" data-cat-toggle="${c.id}">${c.active === false ? 'تفعيل' : 'إيقاف'}</button>` : ''}
          </li>`)}</ul>
          ${perm.create ? html`<button type="button" class="btn btn--sm" data-cat-add style="align-self:flex-start">${ico('plus', { size: 16 })} تصنيف جديد</button>` : ''}
        </div></section>`);
      current.cats = cats;
    };

    const draw = () => ({ list: listTab, recurring: recurringTab, categories: categoriesTab })[tab]();

    const askText = async (title, label, value) => {
      let out = null;
      const r = await openModal({
        title, icon: 'pencil',
        body: html`<form class="form" novalidate>${textField({ name: 'v', label, value })}</form>`,
        actions: [{ label: 'حفظ', value: 'ok', variant: 'primary' }, { label: 'إلغاء', value: null }],
        onOpen(d, close) { d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); close('ok'); }); d.querySelector('input').select(); },
        beforeClose(v, d) { if (v !== 'ok') return true; out = /** @type {HTMLInputElement} */ (d.querySelector('input')).value.trim(); return !!out; },
      });
      return r === 'ok' ? out : null;
    };

    on(el, 'click', '[data-new]', () => expenseDialog(), { signal });
    on(body, 'click', '[data-month]', (_, b) => { const [y, m] = st.month.split('-').map(Number); st.month = toISODate(new Date(y, m - 1 + Number(b.dataset.month), 1)).slice(0, 7); draw(); }, { signal });
    on(body, 'click', '[data-cat]', (_, b) => { st.category = st.category === b.dataset.cat ? '' : b.dataset.cat; draw(); }, { signal });
    body.addEventListener('change', (e) => { const t = /** @type {HTMLSelectElement} */ (e.target); if (t.id === 'ex-cat') { st.category = t.value; draw(); } }, { signal });
    on(body, 'click', '[data-receipt]', (_, b) => showReceipt(b.dataset.receipt), { signal });
    on(body, 'click', '[data-ex-menu]', (_, b) => {
      const e = current.rows.find((x) => x.id === b.dataset.exMenu);
      openMenu(b, { items: [
        ...(perm.edit ? [{ label: 'تعديل', icon: 'pencil', onSelect: () => expenseDialog(e) }] : []),
        ...(perm.del ? [{ label: 'حذف', icon: 'trash-2', danger: true, onSelect: async () => {
          if (await confirmDialog({ title: 'حذف المصروف؟', message: e.source === 'lab' ? 'هذا المصروف مرتبط بحالة معمل؛ الأفضل تعديل التكلفة من صفحة المعمل.' : `${e.description || ''} · ${formatMoney(e.amount)}`, confirmLabel: 'حذف', danger: true })) { await deleteExpense(e.id); toastSuccess('تم الحذف'); }
        } }] : []),
      ] });
    }, { signal });
    on(body, 'click', '[data-rec-toggle]', async (_, b) => { const r = current.recurring.find((x) => x.id === b.dataset.recToggle); await updateRecurring(r.id, { active: !r.active }); if (!r.active) await generateRecurringExpenses(); draw(); }, { signal });
    on(body, 'click', '[data-rec-amount]', async (_, b) => {
      const r = current.recurring.find((x) => x.id === b.dataset.recAmount);
      const v = await askText('المبلغ الشهري', 'المبلغ (ج.م)', piastersToInput(r.amount));
      const p = v ? toPiasters(v) : NaN;
      if (p > 0) { await updateRecurring(r.id, { amount: p }); toastSuccess('يُطبّق من الشهر القادم'); draw(); } else if (v) toastError('مبلغ غير صحيح');
    }, { signal });
    on(body, 'click', '[data-cat-add]', async () => { const n = await askText('تصنيف جديد', 'الاسم', ''); if (n) { try { await createCategory(n); draw(); } catch (err) { toastError(err.message); } } }, { signal });
    on(body, 'click', '[data-cat-rename]', async (_, b) => { const c = current.cats.find((x) => x.id === b.dataset.catRename); const n = await askText('إعادة تسمية', 'الاسم', c.name); if (n) { await updateCategory(c.id, { name: n }); draw(); } }, { signal });
    on(body, 'click', '[data-cat-toggle]', async (_, b) => { const c = current.cats.find((x) => x.id === b.dataset.catToggle); await updateCategory(c.id, { active: c.active === false }); draw(); }, { signal });

    const off = onEvent('data:changed', ({ store }) => { if (['expenses', 'recurringExpenses', 'expenseCategories'].includes(store)) draw(); });
    await draw();
    return off;
  },
};
