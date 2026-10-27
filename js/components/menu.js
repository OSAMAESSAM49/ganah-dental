/**
 * Popover menu anchored to a button. Closes on outside click, Esc, or choosing an item.
 * Arrow keys move between items.
 */
import { html, ico, render } from '../core/dom.js';

/**
 * @param {HTMLElement} anchor
 * @param {{ header?: import('../core/dom.js').SafeHTML,
 *           items: Array<{ label: string, icon?: string, danger?: boolean, onSelect: () => void } | 'sep'> }} opts
 */
let closeOpen = null;

/** Closes the open menu, if any. @returns {boolean} true when one was open */
export function closeMenu() {
  if (!closeOpen) return false;
  closeOpen();
  return true;
}

export function openMenu(anchor, { header, items }) {
  closeOpen?.();
  document.querySelector('.menu[data-popover]')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.dataset.popover = '';
  menu.setAttribute('role', 'menu');
  render(menu, html`
    ${header ?? ''}
    ${items.map((it, i) => (it === 'sep'
      ? html`<div class="menu__sep" role="separator"></div>`
      : html`<button type="button" role="menuitem" class="menu__item ${it.danger ? 'menu__item--danger' : ''}" data-i="${i}">${it.icon ? ico(it.icon, { size: 20 }) : ''}${it.label}</button>`))}`);
  document.body.append(menu);

  // Position under the anchor, aligned to its inline-start edge, kept on screen.
  const r = anchor.getBoundingClientRect();
  const rtl = document.dir === 'rtl';
  const w = menu.offsetWidth;
  let left = rtl ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = r.bottom + 8 + scrollY;
  if (r.bottom + 8 + menu.offsetHeight > innerHeight) top = r.top - menu.offsetHeight - 8 + scrollY;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const buttons = [...menu.querySelectorAll('[role="menuitem"]')];
  buttons[0]?.focus();

  const close = () => {
    if (closeOpen === close) closeOpen = null;
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', close);
  };
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', close);
  closeOpen = close;

  menu.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-i]');
    if (!b) return;
    close();
    anchor.focus();
    /** @type {any} */ (items[Number(b.dataset.i)]).onSelect();
  });
  menu.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(/** @type {any} */ (document.activeElement));
    if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Tab') close();
  });
  return close;
}
