/** Inventory: items with stock status, movements log, alerts (low / expiring), shopping list. */
import { html, ico, render, on } from '../../core/dom.js';
import { formatMoney, formatDate, formatDateTime, digits, todayISO, parseDateInput, formatNumber } from '../../core/format.js';
import { addDays } from '../../core/time.js';
import { MOVEMENT_TYPES } from '../../core/labels.js';
import { normalizeArabic } from '../../core/text.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { mountTable } from '../../components/table.js';
import { openMenu } from '../../components/menu.js';
import { confirmDialog } from '../../components/modal.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { emptyState } from '../../components/states.js';
import { toastSuccess } from '../../components/toast.js';
import { printHTML } from '../../components/print.js';
import { listItems, movementsBetween, inventoryAlerts, shoppingList, updateItem, deleteItem, unitLabel, batchesFor } from '../../services/inventory.js';
import { itemDialog, receiveDialog, adjustDialog, itemDetails, qtyText } from './dialogs.js';
import { tr } from '../../core/i18n.js';
import { inArabic } from '../../core/i18n.js';

const TABS = [['items', 'الأصناف', 'package'], ['movements', 'الحركات', 'arrow-up-down'], ['alerts', 'التنبيهات', 'triangle-alert'], ['shopping', 'قائمة المشتريات', 'clipboard-list']];
const STATUS = { ok: ['متوفر', 'success'], low: ['قارب على النفاد', 'warning'], out: ['نفد', 'danger'], negative: ['رصيد سالب', 'danger'] };

export default {
  title: 'المخزون',
  async render({ el, query, signal }) {
    const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'items';
    const perm = { create: can('inventory', 'create'), edit: can('inventory', 'edit'), del: can('inventory', 'delete') };
    const st = { q: '', category: '', status: '', from: addDays(todayISO(), -30), to: todayISO(), type: '' };

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">المخزون</h1>
          <p class="page-header__sub">الخامات والمستلزمات، تُخصم تلقائيًا عند انتهاء كل علاج</p>
        </div>
        <div class="page-header__actions">
          ${perm.create ? html`<button type="button" class="btn" data-new-item>${ico('plus')} صنف جديد</button>
            <button type="button" class="btn btn--primary" data-receive>${ico('download')} استلام بضاعة</button>` : ''}
        </div>
      </header>
      <nav class="tabs" aria-label="أقسام المخزون">
        ${TABS.map(([k, label, icon]) => html`<a class="tab" href="${href('/inventory', {}, { tab: k })}" aria-selected="${String(k === tab)}">${ico(icon, { size: 18 })} ${label} ${k === 'alerts' ? html`<span class="chip__count" id="alert-count"></span>` : ''}</a>`)}
      </nav>
      <div id="inv-body"></div>`);
    const body = el.querySelector('#inv-body');
    let shopping = [];
    let searchTimer, refreshTimer;

    const itemsTab = async () => {
      const [items, alerts] = await Promise.all([listItems({ includeInactive: true }), inventoryAlerts()]);
      const expiryOf = new Map();
      for (const b of [...alerts.expired, ...alerts.expiring]) if (!expiryOf.has(b.itemId)) expiryOf.set(b.itemId, b.expiry);
      const cats = [...new Set(items.map((i) => i.category))];
      const rows = items.filter((i) => (!st.category || i.category === st.category) && (!st.status || (st.status === 'inactive' ? i.active === false : i.active !== false && (st.status === 'attention' ? i.status !== 'ok' : true)))
        && (st.status === 'inactive' || i.active !== false) && (!st.q || normalizeArabic(`${i.name} ${i.category} ${i.supplier}`).includes(normalizeArabic(st.q))));
      const value = items.filter((i) => i.active !== false).reduce((n, i) => n + Math.max(0, i.qty) * i.costPerUnit, 0);
      render(body, html`
        <div class="totals" style="margin-block-end: var(--sp-4)">
          <div class="totals__item totals__item--hero"><div class="totals__label">قيمة المخزون الحالي</div><div class="totals__value">${formatMoney(Math.round(value))}</div></div>
          <div class="totals__item"><div class="totals__label">عدد الأصناف</div><div class="totals__value">${digits(items.filter((i) => i.active !== false).length)}</div></div>
          <div class="totals__item"><div class="totals__label">تحتاج شراء</div><div class="totals__value">${digits(alerts.low.length)}</div></div>
          <div class="totals__item"><div class="totals__label">صلاحية قريبة / منتهية</div><div class="totals__value">${digits(alerts.expiring.length + alerts.expired.length)}</div></div>
        </div>
        <div class="toolbar">
          <div class="input-group toolbar__search">${ico('search', { size: 20 })}<input class="input input--pill" id="iq" value="${st.q}" placeholder="ابحث عن صنف…" aria-label="بحث"></div>
          <select class="select input--pill" id="icat" style="inline-size:auto" aria-label="الفئة"><option value="">كل الفئات</option>${cats.map((c) => html`<option ${c === st.category ? 'selected' : ''}>${c}</option>`)}</select>
          <div class="chips">
            <button type="button" class="chip" data-istatus="" aria-pressed="${String(!st.status)}">الكل</button>
            <button type="button" class="chip" data-istatus="attention" aria-pressed="${String(st.status === 'attention')}">تحتاج انتباه</button>
            <button type="button" class="chip" data-istatus="inactive" aria-pressed="${String(st.status === 'inactive')}">الموقوفة</button>
          </div>
        </div>
        <div id="tbl"></div>`);
      mountTable(body.querySelector('#tbl'), {
        signal, caption: 'الأصناف', rows, sort: { key: 'name', dir: 'asc' },
        empty: { icon: 'package', title: 'لا توجد أصناف مطابقة', actions: perm.create ? html`<button type="button" class="btn btn--primary" data-new-item>${ico('plus')} صنف جديد</button>` : '' },
        columns: [
          { key: 'name', label: 'الصنف', sortable: true, render: (i) => html`<button type="button" class="link-btn" data-details="${i.id}" style="padding:0; min-block-size:0; text-decoration:none; color: inherit"><strong>${i.name}</strong></button><br><span class="muted text-sm">${i.category}${i.supplier ? ` · ${i.supplier}` : ''}</span>` },
          { key: 'qty', label: 'الكمية', sortable: true, value: (i) => i.qty, render: (i) => html`<strong>${qtyText(i.qty, i.unit)}</strong> <span class="badge badge--${STATUS[i.status][1]}">${STATUS[i.status][0]}</span>` },
          { key: 'minQty', label: 'الحد الأدنى', render: (i) => qtyText(i.minQty, i.unit) },
          { key: 'cost', label: 'تكلفة الوحدة', num: true, render: (i) => (i.costPerUnit ? formatMoney(Math.round(i.costPerUnit)) : html`<span class="subtle">—</span>`) },
          { key: 'exp', label: 'أقرب صلاحية', render: (i) => (expiryOf.has(i.id) ? html`<span class="badge badge--${expiryOf.get(i.id) < todayISO() ? 'danger' : 'warning'}">${formatDate(expiryOf.get(i.id))}</span>` : html`<span class="subtle">—</span>`) },
          { key: 'a', label: '', render: (i) => html`<div class="table__actions">
            ${perm.create ? html`<button type="button" class="btn btn--soft btn--sm" data-receive-item="${i.id}">${ico('download', { size: 16 })} استلام</button>` : ''}
            ${perm.edit ? html`<button type="button" class="btn btn--icon btn--sm" data-item-menu="${i.id}" aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}</div>` },
        ],
      });
    };

    const movementsTab = async () => {
      const rows = (await movementsBetween(st.from, st.to)).filter((m) => !st.type || m.type === st.type);
      render(body, html`
        <div class="toolbar" style="align-items:flex-end">${dateField({ name: 'from', label: 'من', value: st.from })}${dateField({ name: 'to', label: 'إلى', value: st.to })}
          <div class="chips" style="align-self:flex-end"><button type="button" class="chip" data-mtype="" aria-pressed="${String(!st.type)}">الكل</button>
          ${Object.entries(MOVEMENT_TYPES).map(([k, t]) => html`<button type="button" class="chip" data-mtype="${k}" aria-pressed="${String(st.type === k)}">${t.label}</button>`)}</div></div>
        <div id="tbl"></div>`);
      mountTable(body.querySelector('#tbl'), {
        signal, caption: 'حركات المخزون', rows,
        empty: { icon: 'arrow-up-down', title: 'لا توجد حركات في هذه الفترة' },
        columns: [
          { key: 'at', label: 'الوقت', render: (m) => formatDateTime(m.at) },
          { key: 'item', label: 'الصنف', render: (m) => m.itemName },
          { key: 'type', label: 'النوع', render: (m) => html`<span class="badge badge--${MOVEMENT_TYPES[m.type].tone}">${MOVEMENT_TYPES[m.type].label}</span>` },
          { key: 'qty', label: 'الكمية', render: (m) => html`<strong class="ltr">${m.qty > 0 ? '+' : ''}${formatNumber(m.qty, { decimals: 3 })}</strong> ${unitLabel(m.unit)}` },
          { key: 'ref', label: 'التفاصيل', render: (m) => html`${m.procedureName ? html`${m.procedureName}${m.patientId ? html` — <a href="${href('/patients/:id', { id: m.patientId })}">${m.patientName}</a>` : ''}` : ''}${m.reason ? html` ${m.reason}` : ''}${m.returned ? html` <span class="badge">أُرجع</span>` : ''}` },
          { key: 'cost', label: 'التكلفة', num: true, render: (m) => (m.cost ? formatMoney(m.cost) : '—') },
          { key: 'user', label: 'بواسطة', render: (m) => m.userName ?? '—' },
        ],
      });
    };

    const alertsTab = async () => {
      const a = await inventoryAlerts();
      const section = (title, tone, list, rowFn, emptyText) => html`
        <section class="card"><div class="card__header"><div class="card__heading"><h2 class="card__title"><span class="badge badge--${tone}">${digits(list.length)}</span> ${title}</h2></div></div>
          <div class="card__body">${list.length ? html`<ul class="list">${list.map(rowFn)}</ul>` : html`<p class="muted">${emptyText}</p>`}</div></section>`;
      render(body, html`<div class="stack">
        ${section('صلاحية منتهية', 'danger', a.expired, (b) => html`<li class="list__item"><span class="list__main"><span class="list__title">${b.item.name}</span><span class="list__meta">تشغيلة ${b.batchNo || '—'} · ${qtyText(b.qty, b.item.unit)} · انتهت ${formatDate(b.expiry)}</span></span>${perm.edit ? html`<button type="button" class="btn btn--sm" data-adjust="${b.itemId}">تسوية</button>` : ''}</li>`, 'لا توجد خامات منتهية الصلاحية.')}
        ${section('تنتهي صلاحيتها خلال 60 يومًا', 'warning', a.expiring, (b) => html`<li class="list__item"><span class="list__main"><span class="list__title">${b.item.name}</span><span class="list__meta">تشغيلة ${b.batchNo || '—'} · ${qtyText(b.qty, b.item.unit)} · تنتهي ${formatDate(b.expiry)}</span></span></li>`, 'لا توجد خامات قريبة الانتهاء.')}
        ${section('نفدت أو قاربت على النفاد', 'warning', a.low, (i) => html`<li class="list__item"><span class="list__main"><span class="list__title">${i.name}</span><span class="list__meta">المتوفر ${qtyText(i.qty, i.unit)} · الحد الأدنى ${qtyText(i.minQty, i.unit)}</span></span><span class="badge badge--${STATUS[i.status][1]}">${STATUS[i.status][0]}</span>${perm.create ? html`<button type="button" class="btn btn--soft btn--sm" data-receive-item="${i.id}">استلام</button>` : ''}</li>`, 'كل الأصناف فوق الحد الأدنى.')}
      </div>`);
    };

    const shoppingTab = async () => {
      const list = await shoppingList();
      render(body, html`
        <div class="toolbar"><div class="grow"></div><button type="button" class="btn" data-print-shopping ${list.length ? '' : 'disabled'}>${ico('printer')} طباعة القائمة</button></div>
        ${list.length ? html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th>الصنف</th><th>المتوفر</th><th>الحد الأدنى</th><th>الكمية المقترحة</th><th>المورد</th><th class="num">التكلفة التقديرية</th></tr></thead>
          <tbody>${list.map((i) => html`<tr><td data-label="الصنف"><strong>${i.name}</strong></td><td data-label="المتوفر">${qtyText(i.qty, i.unit)}</td><td data-label="الحد الأدنى">${qtyText(i.minQty, i.unit)}</td><td data-label="المقترح"><strong>${qtyText(i.suggested, i.unit)}</strong></td><td data-label="المورد">${i.supplier || '—'}</td><td data-label="التكلفة" class="num">${i.costPerUnit ? formatMoney(Math.round(i.suggested * i.costPerUnit)) : '—'}</td></tr>`)}</tbody></table></div>`
          : html`<div class="card">${emptyState({ icon: 'clipboard-list', title: 'لا يوجد ما تحتاج شراءه الآن', hint: 'تظهر هنا الأصناف التي وصلت للحد الأدنى. حدّد الحد الأدنى لكل صنف من «تعديل».' })}</div>`}`);
      shopping = list;
    };

    const draw = async () => {
      await ({ items: itemsTab, movements: movementsTab, alerts: alertsTab, shopping: shoppingTab })[tab]();
      enhanceDateFields(body, signal);
      const a = await inventoryAlerts();
      const n = a.low.length + a.expired.length + a.expiring.length;
      el.querySelector('#alert-count').textContent = n ? digits(n) : '';
    };

    const itemById = async (id) => (await listItems({ includeInactive: true })).find((i) => i.id === id);

    body.addEventListener('input', (e) => {
      const t = /** @type {HTMLInputElement} */ (e.target);
      if (t.id === 'iq') { st.q = t.value; clearTimeout(searchTimer); searchTimer = setTimeout(async () => { await draw(); const i = /** @type {HTMLInputElement} */ (body.querySelector('#iq')); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 250); }
    }, { signal });
    body.addEventListener('change', (e) => {
      const t = /** @type {HTMLInputElement} */ (e.target);
      if (t.id === 'icat') { st.category = t.value; draw(); }
      if (t.name === 'from' || t.name === 'to') { const iso = parseDateInput(t.value); if (iso) { st[t.name] = iso; draw(); } }
    }, { signal });
    on(body, 'click', '[data-istatus]', (_, b) => { st.status = b.dataset.istatus; draw(); }, { signal });
    on(body, 'click', '[data-mtype]', (_, b) => { st.type = b.dataset.mtype; draw(); }, { signal });
    on(el, 'click', '[data-new-item]', () => itemDialog(), { signal });
    on(el, 'click', '[data-receive]', () => receiveDialog(), { signal });
    on(body, 'click', '[data-receive-item]', async (_, b) => receiveDialog(await itemById(b.dataset.receiveItem)), { signal });
    on(body, 'click', '[data-adjust]', async (_, b) => adjustDialog(await itemById(b.dataset.adjust)), { signal });
    on(body, 'click', '[data-details]', async (_, b) => itemDetails(await itemById(b.dataset.details)), { signal });
    on(body, 'click', '[data-item-menu]', async (_, b) => {
      const i = await itemById(b.dataset.itemMenu);
      openMenu(b, { items: [
        { label: 'التفاصيل والحركات', icon: 'eye', onSelect: () => itemDetails(i) },
        { label: 'تسوية / جرد', icon: 'refresh-cw', onSelect: () => adjustDialog(i) },
        { label: 'تعديل البيانات', icon: 'pencil', onSelect: () => itemDialog(i) },
        { label: i.active === false ? 'تفعيل الصنف' : 'إيقاف الصنف', icon: i.active === false ? 'eye' : 'eye-off', onSelect: async () => { await updateItem(i.id, { active: i.active === false }); toastSuccess('تم'); } },
        ...(perm.del ? ['sep', { label: 'حذف الصنف', icon: 'trash-2', danger: true, onSelect: async () => {
          const stock = (await batchesFor(i.id)).length;
          if (await confirmDialog({ title: tr`حذف ${i.name}؟`, message: stock ? 'يوجد رصيد لهذا الصنف. يُفضّل «إيقاف الصنف» بدلًا من حذفه.' : 'سيختفي من القوائم والوصفات. الحركات السابقة تبقى في السجل.', confirmLabel: 'حذف', danger: true })) { await deleteItem(i.id); toastSuccess('تم حذف الصنف'); }
        } }] : []),
      ] });
    }, { signal });
    on(body, 'click', '[data-print-shopping]', () => inArabic(() => printHTML(html`
      <table class="print-table"><thead><tr><th>#</th><th>الصنف</th><th>المتوفر</th><th>الكمية المطلوبة</th><th>المورد</th><th>ملاحظات</th></tr></thead>
      <tbody>${shopping.map((i, n) => html`<tr><td>${digits(n + 1)}</td><td>${i.name}</td><td>${qtyText(i.qty, i.unit)}</td><td><strong>${qtyText(i.suggested, i.unit)}</strong></td><td>${i.supplier || ''}</td><td></td></tr>`)}</tbody></table>`,
    { title: 'قائمة المشتريات' }), { signal });

    // one consumption writes many records: refresh once they settle
    const off = onEvent('data:changed', ({ store }) => {
      if (!['inventoryItems', 'stockMovements', 'stockBatches'].includes(store)) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(draw, 200);
    });
    await draw();
    return off;
  },
};
