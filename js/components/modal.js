/**
 * Modals built on the native <dialog> element (focus trap, Esc to close, inert background).
 * Every destructive action in the app must go through confirmDialog().
 */
import { html, ico, render, SafeHTML, toElement } from '../core/dom.js';

/**
 * Opens a modal and resolves with the clicked action's value (null when dismissed).
 * @param {{
 *   title: string,
 *   body?: SafeHTML|string|Node,
 *   icon?: string, tone?: 'primary'|'danger',
 *   size?: 'md'|'lg',
 *   actions?: Array<{ label: string, value: any, variant?: string, autofocus?: boolean }>,
 *   dismissible?: boolean,
 *   onOpen?: (dialog: HTMLDialogElement, close: (value: any) => void) => void,
 *   beforeClose?: (value: any, dialog: HTMLDialogElement) => boolean | Promise<boolean>,
 * }} opts beforeClose may return false to keep the modal open (e.g. failed validation)
 * @returns {Promise<any>}
 */
export function openModal({
  title, body = '', icon, tone = 'primary', size = 'md',
  actions = [{ label: 'حسنًا', value: true, variant: 'primary' }],
  dismissible = true, onOpen, beforeClose,
}) {
  return new Promise((resolve) => {
    const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
    const dialog = /** @type {HTMLDialogElement} */ (toElement(html`
      <dialog class="modal ${size === 'lg' ? 'modal--lg' : ''}" aria-labelledby="${titleId}">
        <div class="modal__header">
          ${icon ? html`<span class="modal__icon modal__icon--${tone}">${ico(icon, { size: 24 })}</span>` : ''}
          <h2 class="modal__title" id="${titleId}">${title}</h2>
          ${dismissible ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-close aria-label="إغلاق">${ico('x')}</button>` : ''}
        </div>
        <div class="modal__body"></div>
        ${actions.length ? html`<div class="modal__footer">
          ${actions.map((a, i) => html`<button type="button" class="btn ${a.variant ? `btn--${a.variant}` : ''}" data-action-index="${i}" ${a.autofocus ? 'autofocus' : ''}>${a.label}</button>`)}
        </div>` : ''}
      </dialog>`));

    const bodyEl = dialog.querySelector('.modal__body');
    if (body instanceof Node) bodyEl.append(body);
    else render(bodyEl, body instanceof SafeHTML ? body : html`<p>${body}</p>`);

    let settled = false;
    const close = async (value) => {
      if (settled) return;
      if (beforeClose && value !== null && !(await beforeClose(value, dialog))) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    dialog.addEventListener('click', (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (t.closest('[data-close]')) close(null);
      const btn = t.closest('[data-action-index]');
      if (btn) close(actions[Number(btn.dataset.actionIndex)].value);
      if (t === dialog && dismissible) close(null); // backdrop click
    });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) close(null); });

    document.body.append(dialog);
    dialog.showModal();
    onOpen?.(dialog, close);
  });
}

/**
 * Asks the user to confirm. Resolves true only on explicit confirmation.
 * @param {{ title: string, message: string|SafeHTML, confirmLabel?: string, cancelLabel?: string,
 *           danger?: boolean, requireText?: string }} opts
 *   requireText: the user must type this word to enable the button (for irreversible actions).
 */
export async function confirmDialog({ title, message, confirmLabel = 'تأكيد', cancelLabel = 'إلغاء', danger = false, requireText }) {
  const body = html`
    <div class="stack">
      ${message instanceof SafeHTML ? message : html`<p>${message}</p>`}
      ${requireText ? html`
        <div class="field">
          <label class="field__label" for="confirm-text">للتأكيد اكتب: <strong>${requireText}</strong></label>
          <input id="confirm-text" class="input" autocomplete="off">
        </div>` : ''}
    </div>`;

  const result = await openModal({
    title, body,
    icon: danger ? 'triangle-alert' : 'circle-help',
    tone: danger ? 'danger' : 'primary',
    actions: [
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' },
      { label: cancelLabel, value: false, autofocus: true },
    ],
    onOpen(dialog) {
      if (!requireText) return;
      const input = /** @type {HTMLInputElement} */ (dialog.querySelector('#confirm-text'));
      const btn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-action-index="0"]'));
      btn.disabled = true;
      input.addEventListener('input', () => { btn.disabled = input.value.trim() !== requireText; });
      input.focus();
    },
  });
  return result === true;
}
