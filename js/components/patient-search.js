/**
 * Top-bar patient search: type a name, phone or file number → dropdown of matches.
 * ↑/↓ to move, Enter to open, Esc to close. "/" or Ctrl+K focuses it from anywhere.
 */
import { html, render } from '../core/dom.js';
import { digits } from '../core/format.js';
import { navigate, href } from '../core/router.js';
import { searchPatients } from '../services/patients.js';
import { patientAvatar } from '../modules/patients/list.js';
import { medicalAlerts } from '../core/medical.js';

/** @param {HTMLInputElement} input */
export function attachPatientSearch(input) {
  const wrap = input.closest('.input-group');
  wrap.classList.add('gsearch');
  const list = document.createElement('ul');
  list.className = 'gsearch__list';
  list.id = 'gsearch-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');

  let results = [], active = -1, timer, seq = 0;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); };
  const draw = () => {
    if (!input.value.trim()) { close(); return; }
    render(list, results.length
      ? html`${results.map((p, i) => html`
          <li class="gsearch__item" role="option" id="gs-${i}" data-i="${i}" aria-selected="${String(i === active)}">
            ${patientAvatar(p)}
            <span class="gsearch__text"><strong>${p.name}</strong>
              <span class="gsearch__sub"><span class="ltr">${digits(p.fileNo)}</span>${p.phone ? html` · <span class="ltr">${digits(p.phone)}</span>` : ''}</span>
            </span>
            ${medicalAlerts(p).critical.length ? html`<span class="badge badge--danger">تنبيه</span>` : ''}
          </li>`)}
          <li class="gsearch__item" role="option" id="gs-all" data-all aria-selected="${String(active === results.length)}"><span class="gsearch__text"><span class="gsearch__sub">عرض كل النتائج في قائمة المرضى ←</span></span></li>`
      : html`<li class="gsearch__empty">لا يوجد مريض مطابق</li>`);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', active === results.length ? 'gs-all' : `gs-${active}`);
  };

  const open = (i) => {
    const p = results[i];
    close();
    input.value = '';
    input.blur();
    if (p) navigate(`/patients/${p.id}`);
  };
  const openAll = () => {
    const q = input.value.trim();
    close();
    input.value = '';
    location.hash = href('/patients', {}, q ? { q } : undefined);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const found = await searchPatients(input.value, { limit: 8 });
      if (mine !== seq) return;
      results = found;
      active = results.length ? 0 : -1;
      draw();
    }, 100);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && e.key !== 'Enter') return;
    const max = results.length; // last index = "show all"
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(max, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active === results.length || active < 0) openAll(); else open(active); }
    else if (e.key === 'Escape') { close(); }
  });
  list.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // keep focus in the input
    const li = /** @type {HTMLElement} */ (e.target).closest('[data-i],[data-all]');
    if (!li) return;
    if (li.hasAttribute('data-all')) openAll(); else open(Number(li.dataset.i));
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  document.addEventListener('keydown', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const typing = t.matches('input, textarea, select, [contenteditable]');
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      if (input.disabled || !input.offsetParent) return;
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
