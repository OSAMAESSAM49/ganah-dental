/**
 * Date input that always shows DD/MM/YYYY (native <input type="date"> follows the OS
 * locale, which may be MM/DD). Typing auto-inserts slashes; a calendar popover helps pick.
 * The field's value is the typed text — read it with parseDateInput() → 'YYYY-MM-DD'.
 *
 * Usage: render dateField({...}) in markup, then call enhanceDateFields(root, signal).
 */
import { html, ico, render } from '../core/dom.js';
import { digits, parseDateInput, toDate, toISODate, todayISO } from '../core/format.js';
import { normalizeDigits } from '../core/text.js';

export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** Week starts on Saturday (Egypt). */
const WEEK = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

let seq = 0;

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (Western digits, for input values). */
export function isoToInput(iso) {
  const d = toDate(iso);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Applies the DD/MM/YYYY mask to typed text. Exported for tests. */
export function maskDate(text) {
  const d = normalizeDigits(text).replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * @param {{ name: string, label: string, value?: string, required?: boolean, hint?: string,
 *           min?: string, max?: string }} o value/min/max as 'YYYY-MM-DD'
 */
export function dateField(o) {
  const id = `f-${o.name}-d${++seq}`;
  return html`
    <div class="field">
      <label class="field__label" for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
      <div class="date-field" data-date-field ${o.min ? html`data-min="${o.min}"` : ''} ${o.max ? html`data-max="${o.max}"` : ''}>
        <input id="${id}" name="${o.name}" class="input input--ltr" inputmode="numeric" autocomplete="off"
          placeholder="يوم/شهر/سنة" value="${isoToInput(o.value)}" maxlength="10"
          ${o.required ? 'required aria-required="true"' : ''} aria-describedby="${o.hint ? `${id}-hint ` : ''}${id}-err">
        <button type="button" class="date-field__btn" data-date-open aria-label="اختيار من التقويم" aria-haspopup="dialog">${ico('calendar', { size: 20 })}</button>
      </div>
      ${o.hint ? html`<span class="field__hint" id="${id}-hint">${o.hint}</span>` : ''}
      <span class="field__error" id="${id}-err" data-error-for="${o.name}" role="alert"></span>
    </div>`;
}

/** Validator for date fields: '' when valid/empty, Arabic message otherwise. */
export function dateRule(value, { required = false, label = 'التاريخ' } = {}) {
  if (!String(value ?? '').trim()) return required ? `${label} مطلوب` : '';
  return parseDateInput(value) ? '' : 'اكتب التاريخ بالشكل يوم/شهر/سنة، مثال 05/03/2026';
}

function calendarMarkup(view, selectedISO, minISO, maxISO) {
  const y = view.getFullYear(), m = view.getMonth();
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 1) % 7; // Saturday = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayISO();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(html`<span></span>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toISODate(new Date(y, m, d));
    const disabled = (minISO && iso < minISO) || (maxISO && iso > maxISO);
    cells.push(html`<button type="button" class="cal__day" data-day="${iso}" tabindex="-1"
      ${iso === selectedISO ? html`aria-selected="true"` : ''} ${iso === today ? html`data-today` : ''} ${disabled ? 'disabled' : ''}>${digits(d)}</button>`);
  }
  return html`
    <div class="cal__head">
      <button type="button" class="btn btn--ghost btn--icon btn--sm" data-cal-nav="-1" aria-label="الشهر السابق">${ico('chevron-right')}</button>
      <div class="cal__title" aria-live="polite">${MONTHS[m]} ${digits(y)}</div>
      <button type="button" class="btn btn--ghost btn--icon btn--sm" data-cal-nav="1" aria-label="الشهر التالي">${ico('chevron-left')}</button>
    </div>
    <div class="cal__grid" role="grid">
      ${WEEK.map((w) => html`<span class="cal__wd" title="${w}">${w.replace('ال', '').slice(0, 2)}</span>`)}
      ${cells}
    </div>
    <div class="cal__foot">
      <button type="button" class="btn btn--soft btn--sm" data-day="${today}">اليوم</button>
      <button type="button" class="btn btn--ghost btn--sm" data-cal-clear>مسح</button>
    </div>`;
}

/**
 * Wires masking and the calendar popover for every [data-date-field] under root.
 * @param {HTMLElement} root @param {AbortSignal} [signal]
 */
export function enhanceDateFields(root, signal) {
  for (const wrap of root.querySelectorAll('[data-date-field]')) {
    if (wrap.dataset.enhanced) continue;
    wrap.dataset.enhanced = '1';
    const input = /** @type {HTMLInputElement} */ (wrap.querySelector('input'));
    const btn = wrap.querySelector('[data-date-open]');
    let pop = null;
    let view = new Date();

    input.addEventListener('input', () => {
      const pos = input.selectionStart === input.value.length;
      const masked = maskDate(input.value);
      if (masked !== input.value) {
        input.value = masked;
        if (pos) input.setSelectionRange(masked.length, masked.length);
      }
    }, { signal });

    const close = () => {
      pop?.remove();
      pop = null;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e) => { if (!wrap.contains(e.target)) close(); };
    const draw = () => {
      render(pop, calendarMarkup(view, parseDateInput(input.value), wrap.dataset.min, wrap.dataset.max));
      const focusIso = parseDateInput(input.value) ?? todayISO();
      const target = pop.querySelector(`[data-day="${focusIso}"]:not([disabled])`) ?? pop.querySelector('.cal__day:not([disabled])');
      target?.setAttribute('tabindex', '0');
    };
    const open = () => {
      if (pop) { close(); return; }
      view = toDate(parseDateInput(input.value)) ?? new Date();
      pop = document.createElement('div');
      pop.className = 'cal';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'التقويم');
      wrap.append(pop);
      draw();
      btn.setAttribute('aria-expanded', 'true');
      pop.querySelector('.cal__day[tabindex="0"]')?.focus();
      document.addEventListener('pointerdown', outside, true);

      pop.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const nav = t.closest('[data-cal-nav]');
        if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.calNav), 1); draw(); return; }
        if (t.closest('[data-cal-clear]')) { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); close(); input.focus(); return; }
        const day = t.closest('[data-day]');
        if (day && !day.hasAttribute('disabled')) {
          input.value = isoToInput(day.dataset.day);
          input.dispatchEvent(new Event('change', { bubbles: true }));
          close();
          input.focus();
        }
      });
      pop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); input.focus(); return; }
        const cur = /** @type {HTMLElement} */ (document.activeElement)?.closest?.('.cal__day');
        if (!cur) return;
        // RTL: ArrowLeft = next day
        const step = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = new Date(toDate(cur.dataset.day).getTime());
        next.setDate(next.getDate() + step);
        if (next.getMonth() !== view.getMonth()) { view = new Date(next.getFullYear(), next.getMonth(), 1); draw(); }
        const el = pop.querySelector(`[data-day="${toISODate(next)}"]`);
        pop.querySelectorAll('.cal__day').forEach((d) => d.setAttribute('tabindex', '-1'));
        el?.setAttribute('tabindex', '0');
        el?.focus();
      });
    };

    btn.addEventListener('click', open, { signal });
    input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); open(); } }, { signal });
    signal?.addEventListener('abort', close);
  }
}
