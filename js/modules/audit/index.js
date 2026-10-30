/** Audit log viewer (Admin only): filter by date, user, action and section; view changes. */
import { html, ico, render, on, formData } from '../../core/dom.js';
import { formatDateTime, parseDateInput, todayISO, toISODate, arabicCount } from '../../core/format.js';
import { ENTITY_LABELS, AUDIT_ACTION_LABELS, AUDIT_ACTION_TONES, FIELD_LABELS } from '../../core/labels.js';
import { mountTable, searchRows } from '../../components/table.js';
import { dateField, enhanceDateFields, dateRule } from '../../components/date-field.js';
import { selectField } from '../../components/form.js';
import { openModal } from '../../components/modal.js';
import { toastError } from '../../components/toast.js';
import { listAudit } from '../../services/audit.js';
import { repos } from '../../data/index.js';
import { t } from '../../core/i18n.js';

const PAGE = 300;
const FIELDS = { one: 'حقل واحد', two: 'حقلان', few: 'حقول', many: 'حقلًا' };
const OPS = { one: 'عملية واحدة', two: 'عمليتان', few: 'عمليات', many: 'عملية' };

function formatValue(v, ctx) {
  if (v === null || v === undefined || v === '') return html`<span class="subtle">—</span>`;
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (ctx.field === 'roleId' && ctx.roles[v]) return ctx.roles[v];
  if (typeof v === 'object') return html`<code>${JSON.stringify(v, null, 1)}</code>`;
  return String(v);
}

function showDetails(entry, roles) {
  openModal({
    title: `${AUDIT_ACTION_LABELS[entry.action] ?? entry.action} · ${ENTITY_LABELS[entry.entity] ?? entry.entity}`,
    icon: 'scroll-text',
    size: 'lg',
    body: html`
      <div class="stack">
        <dl class="dl">
          <dt>الوقت</dt><dd>${formatDateTime(entry.at)}</dd>
          <dt>المستخدم</dt><dd>${entry.userName ?? '—'}</dd>
          ${entry.summary ? html`<dt>التفاصيل</dt><dd>${entry.summary}</dd>` : ''}
        </dl>
        ${entry.changes?.length ? html`
          <div class="table-wrap"><table class="diff">
            <thead><tr><th>الحقل</th><th>قبل</th><th>بعد</th></tr></thead>
            <tbody>${entry.changes.map((c) => html`<tr>
              <th scope="row">${FIELD_LABELS[c.field] ?? c.field}</th>
              <td class="diff__from">${formatValue(c.from, { field: c.field, roles })}</td>
              <td class="diff__to">${formatValue(c.to, { field: c.field, roles })}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<p class="muted">لا توجد تفاصيل حقول لهذه العملية.</p>`}
      </div>`,
    actions: [{ label: 'إغلاق', value: true }],
  });
}

export default {
  title: 'سجل العمليات',
  async render({ el, signal }) {
    const [users, roleRows] = await Promise.all([repos.users.list({ includeDeleted: true }), repos.roles.list()]);
    const roles = Object.fromEntries(roleRows.map((r) => [r.id, r.name]));
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">سجل العمليات</h1>
          <p class="page-header__sub">كل إضافة أو تعديل أو حذف، ومن قام به ومتى. لا يمكن تعديل هذا السجل.</p>
        </div>
      </header>
      <form class="card" id="audit-filters" novalidate>
        <div class="card__body form-grid" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); align-items: end">
          ${dateField({ name: 'from', label: 'من تاريخ', value: toISODate(monthAgo) })}
          ${dateField({ name: 'to', label: 'إلى تاريخ', value: todayISO() })}
          ${selectField({ name: 'userId', label: 'المستخدم', placeholder: 'الكل', options: users.map((u) => ({ value: u.id, label: u.displayName })) })}
          ${selectField({ name: 'action', label: 'العملية', placeholder: 'الكل', options: Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label })) })}
          ${selectField({ name: 'entity', label: 'القسم', placeholder: 'الكل', options: Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })) })}
          <button type="submit" class="btn btn--dark">${ico('filter', { size: 18 })} عرض</button>
        </div>
      </form>
      <div class="toolbar" style="margin-block-start: var(--sp-5)">
        <div class="input-group toolbar__search">${ico('search', { size: 20 })}<input class="input input--pill" type="search" id="audit-search" placeholder="ابحث في التفاصيل…" aria-label="بحث في السجل"></div>
        <span class="muted" id="audit-count" aria-live="polite"></span>
      </div>
      <div id="audit-table"></div>
      <div class="row" style="justify-content:center; margin-block-start: var(--sp-4)"><button type="button" class="btn" id="audit-more" hidden>عرض المزيد</button></div>`);

    enhanceDateFields(el, signal);
    const form = /** @type {HTMLFormElement} */ (el.querySelector('#audit-filters'));
    let rows = [], offset = 0, q = '', hasMore = false;

    const table = mountTable(el.querySelector('#audit-table'), {
      pageSize: Infinity, // pages itself (from the database)
      signal,
      caption: 'سجل العمليات',
      empty: { icon: 'scroll-text', title: 'لا توجد عمليات في هذه الفترة', hint: 'غيّر نطاق التاريخ أو المرشحات.' },
      rows: [],
      columns: [
        { key: 'at', label: 'الوقت', render: (r) => html`<span class="num">${formatDateTime(r.at)}</span>` },
        { key: 'user', label: 'المستخدم', render: (r) => r.userName ?? html`<span class="muted">—</span>` },
        { key: 'action', label: 'العملية', render: (r) => html`<span class="badge ${AUDIT_ACTION_TONES[r.action] ? `badge--${AUDIT_ACTION_TONES[r.action]}` : ''}">${AUDIT_ACTION_LABELS[r.action] ?? r.action}</span>` },
        { key: 'entity', label: 'القسم', render: (r) => ENTITY_LABELS[r.entity] ?? r.entity },
        { key: 'summary', label: 'التفاصيل', render: (r) => html`${r.summary || ''}${r.changes?.length ? html` <span class="subtle text-sm">(${arabicCount(r.changes.length, FIELDS)})</span>` : ''}` },
        { key: 'view', label: '', render: (r) => html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-entry="${r.id}" aria-label="عرض التفاصيل">${ico('eye', { size: 18 })}</button>` },
      ],
    });

    const filters = () => {
      const f = formData(form);
      const from = parseDateInput(f.from), to = parseDateInput(f.to);
      return { from, to, userId: f.userId, action: f.action, entity: f.entity, invalid: dateRule(f.from) || dateRule(f.to) };
    };

    const matches = (r, f) => (!f.userId || r.userId === f.userId) && (!f.action || r.action === f.action) && (!f.entity || r.entity === f.entity);

    const shown = () => searchRows(rows, q, ['summary', 'userName', (r) => AUDIT_ACTION_LABELS[r.action], (r) => ENTITY_LABELS[r.entity]]);

    const load = async (append = false) => {
      const f = filters();
      if (f.invalid) { toastError(f.invalid); return; }
      if (!append) { offset = 0; rows = []; }
      const fromIso = f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined;
      const toIso = f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : undefined;
      const page = await listAudit({ from: fromIso, to: toIso, limit: PAGE, offset });
      offset += page.length;
      hasMore = page.length === PAGE;
      rows = rows.concat(page.filter((r) => matches(r, f)));
      const visible = shown();
      table.update(visible);
      el.querySelector('#audit-count').textContent = visible.length ? t(`${arabicCount(visible.length, OPS)}${hasMore ? ' أو أكثر' : ''}`) : '';
      el.querySelector('#audit-more').hidden = !hasMore;
    };

    form.addEventListener('submit', (e) => { e.preventDefault(); load(); }, { signal });
    el.querySelector('#audit-more').addEventListener('click', () => load(true), { signal });
    el.querySelector('#audit-search').addEventListener('input', (e) => {
      q = /** @type {HTMLInputElement} */ (e.target).value;
      table.update(shown());
    }, { signal });
    on(el, 'click', '[data-entry]', (_, b) => showDetails(rows.find((r) => r.id === b.dataset.entry), roles), { signal });

    await load();
  },
};
