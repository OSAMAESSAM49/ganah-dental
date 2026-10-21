/** Empty, loading, skeleton and error states — every list and page uses these. */
import { html, ico } from '../core/dom.js';

/**
 * @param {{ icon?: string, title: string, hint?: string,
 *           actions?: import('../core/dom.js').SafeHTML }} opts
 */
export const emptyState = ({ icon = 'inbox', title, hint, actions }) => html`
  <div class="empty">
    <div class="empty__icon">${ico(icon, { size: 34 })}</div>
    <p class="empty__title">${title}</p>
    ${hint ? html`<p class="empty__hint">${hint}</p>` : ''}
    ${actions ? html`<div class="empty__actions">${actions}</div>` : ''}
  </div>`;

export const loadingState = (text = 'جارٍ التحميل…') => html`
  <div class="loading" role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true"></div>
    <span>${text}</span>
  </div>`;

/** Placeholder page while a view loads. */
export const pageSkeleton = () => html`
  <div class="stack" aria-busy="true" aria-label="جارٍ التحميل">
    <span class="skeleton skeleton--title"></span>
    <div class="bento">
      ${[0, 1, 2, 3].map(() => html`<span class="skeleton skeleton--block span-3"></span>`)}
      <span class="skeleton skeleton--block span-8" style="block-size: 280px"></span>
      <span class="skeleton skeleton--block span-4" style="block-size: 280px"></span>
    </div>
  </div>`;

/** @param {{ title?: string, message?: string }} [opts] */
export const errorState = ({ title = 'حدث خطأ غير متوقع', message = 'حاول مرة أخرى. إذا تكررت المشكلة أعد تحميل الصفحة.' } = {}) => html`
  <div class="empty" role="alert">
    <div class="empty__icon" style="background: var(--c-danger-soft); color: var(--c-danger)">${ico('triangle-alert', { size: 34 })}</div>
    <p class="empty__title">${title}</p>
    <p class="empty__hint">${message}</p>
    <div class="empty__actions">
      <button type="button" class="btn btn--primary" data-retry>${ico('refresh-cw')} إعادة المحاولة</button>
    </div>
  </div>`;
