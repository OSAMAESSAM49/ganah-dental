/**
 * Modals built on the native <dialog> element (focus trap, Esc to close, inert background).
 * Every destructive action in the app must go through confirmDialog().
 */
import { html, ico, render, SafeHTML, toElement } from '../core/dom.js';

/** Open modals, newest last: what Back, a route change or the idle lock act on. */
const stack = [];

/** Dismisses the top modal as if its X was pressed (asks first when it has unsaved input). */
export function dismissTopModal() {
  const top = stack.at(-1);
  if (!top) return false;
  top.dismiss();
  return true;
}

/** Closes every modal at once (route change, idle lock); each resolves as dismissed. */
export function closeAllModals() {
  for (const m of [...stack].reverse()) m.force();
}

/** True while a modal holds input the user has not saved. */
export const hasDirtyModal = () => stack.some((m) => m.isDirty());

/**
 * Opens a modal and resolves with the clicked action's value (null when dismissed).
 * @param {{
 *   title: string,
 *   body?: SafeHTML|string|Node,
 *   icon?: string, tone?: 'primary'|'danger',
 *   size?: 'md'|'lg',
 *   actions?: Array<{ label: string, value: any, variant?: string, autofocus?: boolean }>,
 *   dismissible?: boolean,
 *   dirty?: boolean | ((dialog: HTMLDialogElement) => boolean),
 *   onOpen?: (dialog: HTMLDialogElement, close: (value: any) => void) => void,
 *   beforeClose?: (value: any, dialog: HTMLDialogElement) => boolean | Promise<boolean>,
 * }} opts beforeClose may return false to keep the modal open (e.g. failed validation).
 *   While it runs (usually the save) the buttons are disabled, so a double tap saves once.
 *   dirty: true asks «تجاهل التغييرات؟» before dismissing once the user typed or picked
 *   anything; a function decides by itself.
 * @returns {Promise<any>}
 */
export function openModal({
  title, body = '', icon, tone = 'primary', size = 'md',
  actions = [{ label: 'حسنًا', value: true, variant: 'primary' }],
  dismissible = true, dirty = false, onOpen, beforeClose,
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
    let busy = false; // beforeClose (the save) is running
    let asking = false; // the "discard changes?" question is open
    let touched = false;
    const markTouched = (e) => { if (e.isTrusted) touched = true; };
    bodyEl.addEventListener('input', markTouched);
    bodyEl.addEventListener('change', markTouched);
    const isDirty = () => !settled && (typeof dirty === 'function' ? dirty(dialog) : dirty && touched);

    const finish = (value) => {
      if (settled) return;
      settled = true;
      stack.splice(stack.indexOf(entry), 1);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const setBusy = (on) => {
      busy = on;
      dialog.toggleAttribute('aria-busy', on);
      for (const b of dialog.querySelectorAll('[data-action-index], [data-close]')) {
        const btn = /** @type {HTMLButtonElement} */ (b);
        if (on) { btn.dataset.wasDisabled = String(btn.disabled); btn.disabled = true; }
        else { btn.disabled = btn.dataset.wasDisabled === 'true'; delete btn.dataset.wasDisabled; }
      }
    };
    const close = async (value) => {
      if (settled || busy || asking) return;
      if (value === null) {
        if (isDirty()) {
          asking = true;
          const leave = await confirmDialog({ title: 'تجاهل التغييرات؟', message: 'ما كتبته في هذه النافذة لم يُحفظ بعد.', confirmLabel: 'تجاهل التغييرات', cancelLabel: 'متابعة الكتابة', danger: true });
          asking = false;
          if (!leave) return;
        }
        finish(null);
        return;
      }
      if (beforeClose) {
        setBusy(true);
        let ok = false;
        try { ok = await beforeClose(value, dialog); } finally { if (!settled) setBusy(false); }
        if (!ok) return;
      }
      finish(value);
    };
    const entry = { dialog, dismiss: () => { if (dismissible) close(null); }, force: () => finish(null), isDirty };

    dialog.addEventListener('click', (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (t.closest('[data-close]')) close(null);
      const btn = t.closest('[data-action-index]');
      if (btn) close(actions[Number(btn.dataset.actionIndex)].value);
      if (t === dialog && dismissible) close(null); // backdrop click
    });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) close(null); });
    // Some phones close the dialog on Back even though 'cancel' was prevented: reopen it
    // while saving, when it cannot be dismissed, or when it holds unsaved input.
    dialog.addEventListener('close', () => {
      if (settled) return;
      if (busy || asking || !dismissible || isDirty()) {
        if (dialog.isConnected) dialog.showModal();
        if (dismissible && !busy && !asking) close(null);
        return;
      }
      finish(null);
    });

    document.body.append(dialog);
    stack.push(entry);
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
