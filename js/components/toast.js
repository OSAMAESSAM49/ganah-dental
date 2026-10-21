/** Toast notifications (success / error / warning / info) with an optional action button. */
import { html, ico, render, toElement } from '../core/dom.js';

const ICONS = { success: 'circle-check', error: 'circle-x', warning: 'triangle-alert', info: 'info' };
const MAX_VISIBLE = 4;

function region() {
  let el = document.getElementById('toast-region');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-region';
    el.className = 'toast-region';
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  return el;
}

/**
 * Shows a toast.
 * @param {string} message
 * @param {{ type?: 'success'|'error'|'warning'|'info', duration?: number,
 *           action?: { label: string, onClick: () => void } }} [opts]
 *   duration in ms; 0 keeps it until closed. Errors stay longer by default.
 * @returns {() => void} dismiss
 */
export function toast(message, { type = 'info', duration, action } = {}) {
  const ms = duration ?? (type === 'error' ? 7000 : action ? 10000 : 4000);
  const el = toElement(html`
    <div class="toast toast--${type}" role="${type === 'error' ? 'alert' : 'status'}">
      ${ico(ICONS[type], { size: 22 })}
      <span class="toast__msg"></span>
      ${action ? html`<button type="button" class="toast__action">${action.label}</button>` : ''}
      <button type="button" class="toast__close" aria-label="إغلاق">${ico('x', { size: 18 })}</button>
    </div>`);
  render(el.querySelector('.toast__msg'), message);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected || el.dataset.leaving) return;
    el.dataset.leaving = '1';
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('.toast__close').addEventListener('click', dismiss);
  el.querySelector('.toast__action')?.addEventListener('click', () => { action.onClick(); dismiss(); });
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { if (ms) timer = setTimeout(dismiss, 2500); });

  const r = region();
  r.append(el);
  while (r.children.length > MAX_VISIBLE) r.firstElementChild.remove();
  if (ms) timer = setTimeout(dismiss, ms);
  return dismiss;
}

export const toastSuccess = (msg, opts) => toast(msg, { ...opts, type: 'success' });
export const toastError = (msg, opts) => toast(msg, { ...opts, type: 'error' });
export const toastWarning = (msg, opts) => toast(msg, { ...opts, type: 'warning' });
