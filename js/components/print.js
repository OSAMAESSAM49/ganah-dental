/**
 * Prints arbitrary markup through #print-root (see css/print.css). The browser's print
 * dialog also offers "Save as PDF", which shapes Arabic correctly.
 */
import { html, render } from '../core/dom.js';
import { getSettings } from '../data/settings.js';
import { formatDateTime } from '../core/format.js';
import { inArabic } from '../core/i18n.js';

/**
 * @param {import('../core/dom.js').SafeHTML} body
 * @param {{ size?: 'a4'|'a5'|'80mm', title?: string, header?: boolean }} [opts]
 */
export function printHTML(body, { size = 'a4', title, header = true } = {}) {
  const root = document.getElementById('print-root');
  const clinic = getSettings('clinic');
  // Papers for patients are always Arabic, even when the screens are in English.
  root.setAttribute('dir', 'rtl');
  root.setAttribute('lang', 'ar');
  inArabic(() => render(root, html`
    ${header ? html`<header class="print-header">
      <div>
        <div class="print-header__clinic">${clinic.name}</div>
        <div class="print-header__meta">${clinic.address}${clinic.phone ? html` · <span class="ltr">${clinic.phone}</span>` : ''}</div>
      </div>
      ${clinic.logo ? html`<img class="print-header__logo" src="${clinic.logo}" alt="">` : ''}
    </header>` : ''}
    ${title ? html`<h1 class="print-title">${title}</h1>` : ''}
    ${body}
    <footer class="print-footer">طُبع في ${formatDateTime(new Date())}</footer>`));
  document.body.dataset.print = size;
  document.body.classList.add('is-printing');
  const done = () => {
    document.body.classList.remove('is-printing');
    delete document.body.dataset.print;
    root.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // Let images (logo) load before opening the dialog.
  const imgs = [...root.querySelectorAll('img')];
  Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => window.print());
}
