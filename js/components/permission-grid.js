/**
 * Module × action checkbox grid for editing role permissions or per-user overrides.
 * Rules applied while editing: any action requires "view"; removing "view" clears the row.
 * In user mode (base given), cells that differ from the role default are highlighted.
 */
import { html, ico } from '../core/dom.js';
import { ACTIONS, ACTION_LABELS, MODULES } from '../core/permissions.js';

/**
 * @param {{ value: Record<string, Record<string, boolean>>, base?: Record<string, Record<string, boolean>>,
 *           locked?: boolean, caption?: string }} o
 */
export function permissionGrid({ value, base, locked = false, caption = 'الصلاحيات' }) {
  return html`
    <div class="table-wrap perm-grid" data-perm-grid ${base ? html`data-mode="user"` : ''}>
      <table class="table">
        <caption class="visually-hidden">${caption}</caption>
        <thead><tr>
          <th scope="col">القسم</th>
          ${ACTIONS.map((a) => html`<th scope="col" class="perm-grid__col">${ACTION_LABELS[a]}</th>`)}
          <th scope="col" class="perm-grid__col">الكل</th>
        </tr></thead>
        <tbody>
          ${MODULES.map((m) => {
            const rowLocked = locked || m.adminOnly;
            return html`<tr data-module="${m.key}">
              <th scope="row" class="perm-grid__module">
                <span>${m.label}</span>
                ${m.adminOnly ? html`<span class="badge badge--dark" title="متاح لمدير النظام فقط">${ico('lock', { size: 14 })} المدير فقط</span>` : ''}
                ${m.hint ? html`<span class="perm-grid__hint">${m.hint}</span>` : ''}
              </th>
              ${ACTIONS.map((a) => {
                if (!m.actions.includes(a)) return html`<td class="perm-grid__cell"><span class="subtle" aria-hidden="true">—</span></td>`;
                const checked = !!value?.[m.key]?.[a];
                const differs = base && !!base?.[m.key]?.[a] !== checked;
                return html`<td class="perm-grid__cell" ${differs ? html`data-overridden` : ''}>
                  <input type="checkbox" class="perm-grid__box" data-action="${a}" ${checked ? 'checked' : ''} ${rowLocked ? 'disabled' : ''}
                    ${base ? html`data-base="${String(!!base?.[m.key]?.[a])}"` : ''}
                    aria-label="${ACTION_LABELS[a]} — ${m.label}">
                </td>`;
              })}
              <td class="perm-grid__cell">
                <input type="checkbox" class="perm-grid__box perm-grid__box--row" data-row-toggle ${rowLocked ? 'disabled' : ''}
                  ${m.actions.every((a) => value?.[m.key]?.[a]) ? 'checked' : ''} aria-label="كل صلاحيات ${m.label}">
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
}

/** Reads the grid back into a matrix (only applicable cells). */
export function readPermissionGrid(root) {
  const out = {};
  for (const row of root.querySelectorAll('[data-perm-grid] tr[data-module]')) {
    const m = row.dataset.module;
    out[m] = {};
    for (const box of row.querySelectorAll('input[data-action]')) out[m][box.dataset.action] = box.checked;
  }
  return out;
}

/** Wires row toggles, the view dependency and override highlighting. */
export function enhancePermissionGrid(root, onChange, signal) {
  root.addEventListener('change', (e) => {
    const box = /** @type {HTMLInputElement} */ (e.target);
    if (!box.matches('.perm-grid__box')) return;
    const row = box.closest('tr');
    const boxes = [...row.querySelectorAll('input[data-action]')];
    const view = boxes.find((b) => b.dataset.action === 'view');

    if (box.hasAttribute('data-row-toggle')) {
      boxes.forEach((b) => { b.checked = box.checked; });
    } else if (box === view && !box.checked) {
      boxes.forEach((b) => { b.checked = false; });
    } else if (box !== view && box.checked && view) {
      view.checked = true;
    }
    const rowToggle = row.querySelector('[data-row-toggle]');
    if (rowToggle) rowToggle.checked = boxes.every((b) => b.checked);
    for (const b of boxes) {
      if (b.dataset.base === undefined) continue;
      b.closest('td').toggleAttribute('data-overridden', String(b.checked) !== b.dataset.base);
    }
    onChange?.();
  }, { signal });
}
