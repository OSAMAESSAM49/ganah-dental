/**
 * Data table with sorting, row links and phone-friendly stacked layout.
 *
 * Column: { key, label, sortable?, num?, render?(row) → SafeHTML|string, value?(row) → sort value }
 */
import { html, ico, on, render } from '../core/dom.js';
import { normalizeArabic } from '../core/text.js';
import { emptyState } from './states.js';

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

/** Sorts rows by a column (stable; nulls last). Exported for tests. */
export function sortRows(rows, column, dir = 'asc') {
  const get = column.value ?? ((r) => r[column.key]);
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}

/** Case/diacritic-insensitive text search across the given fields. */
export function searchRows(rows, query, fields) {
  const q = normalizeArabic(query);
  if (!q) return rows;
  return rows.filter((r) => fields.some((f) => normalizeArabic(typeof f === 'function' ? f(r) : r[f]).includes(q)));
}

/**
 * Mounts a table into el. Returns { update(rows) }.
 * @param {HTMLElement} el
 * @param {{ columns: any[], rows: any[], caption?: string, rowHref?: (row) => string,
 *           sort?: { key: string, dir: 'asc'|'desc' }, empty?: Parameters<typeof emptyState>[0],
 *           signal?: AbortSignal }} opts
 */
export function mountTable(el, opts) {
  let rows = opts.rows;
  let sort = opts.sort ?? null;

  const draw = () => {
    if (!rows.length) {
      render(el, html`<div class="card">${emptyState(opts.empty ?? { title: 'لا توجد بيانات بعد' })}</div>`);
      return;
    }
    const col = sort && opts.columns.find((c) => c.key === sort.key);
    const shown = col ? sortRows(rows, col, sort.dir) : rows;
    render(el, html`
      <div class="table-wrap">
        <table class="table table--stack">
          ${opts.caption ? html`<caption class="visually-hidden">${opts.caption}</caption>` : ''}
          <thead><tr>
            ${opts.columns.map((c) => {
              const active = sort?.key === c.key;
              const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
              return html`<th scope="col" class="${c.num ? 'num' : ''}">
                ${c.sortable
                  ? html`<button type="button" class="table__sort" data-sort="${c.key}" aria-sort="${aria}">${c.label} ${ico('arrow-up-down', { size: 14 })}</button>`
                  : c.label}
              </th>`;
            })}
          </tr></thead>
          <tbody>
            ${shown.map((row) => html`
              <tr ${opts.rowHref ? html`data-href="${opts.rowHref(row)}" tabindex="0"` : ''}>
                ${opts.columns.map((c) => html`<td data-label="${c.label}" class="${c.num ? 'num' : ''}">${c.render ? c.render(row) : row[c.key] ?? '—'}</td>`)}
              </tr>`)}
          </tbody>
        </table>
      </div>`);
  };

  on(el, 'click', '[data-sort]', (_, btn) => {
    const key = btn.dataset.sort;
    sort = { key, dir: sort?.key === key && sort.dir === 'asc' ? 'desc' : 'asc' };
    draw();
    el.querySelector(`[data-sort="${CSS.escape(key)}"]`)?.focus();
  }, { signal: opts.signal });

  if (opts.rowHref) {
    const go = (tr) => { location.hash = tr.dataset.href.replace(/^#/, ''); };
    on(el, 'click', 'tr[data-href]', (e, tr) => { if (!(/** @type {HTMLElement} */ (e.target)).closest('a,button,input')) go(tr); }, { signal: opts.signal });
    on(el, 'keydown', 'tr[data-href]', (e, tr) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') go(tr); }, { signal: opts.signal });
  }

  draw();
  return { update(next) { rows = next; draw(); } };
}
