/**
 * Minimal, safe DOM templating. Every interpolated value is HTML-escaped unless it is a
 * SafeHTML (produced by `html` or `raw`). Patient-entered text can never inject markup.
 * In English, the Arabic text of templates and of plain strings is translated here (core/i18n.js).
 */
import { icon } from './icons.js';
import { isEnglish, translateTemplate, translateText, inDataAttribute } from './i18n.js';

export class SafeHTML {
  /** @param {string} value */
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** @param {unknown} value @returns {string} */
export function escapeHTML(value) {
  return String(value).replace(/[&<>"'`]/g, (ch) => ESCAPES[ch]);
}

/** Text shown exactly as given, never translated (e.g. a WhatsApp message preview). */
export class KeepText {
  /** @param {string} value */
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}
export const keep = (text) => new KeepText(String(text ?? ''));

/** @param {unknown} v @param {boolean} [translate] @returns {string} */
function toHTML(v, translate = false) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHTML) return v.value;
  if (v instanceof KeepText) return escapeHTML(v.value);
  if (Array.isArray(v)) return v.map((x) => toHTML(x, translate)).join('');
  return escapeHTML(translate && typeof v === 'string' ? translateText(v) : v);
}

/**
 * Tagged template: html`<p>${name}</p>` → SafeHTML with `name` escaped.
 * Arrays are joined; null/undefined/booleans render nothing (handy for `cond && html`...``).
 * @returns {SafeHTML}
 */
export function html(strings, ...values) {
  if (!isEnglish()) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += toHTML(values[i]) + strings[i + 1];
    return new SafeHTML(out);
  }
  // English: the template's own text is translated once; string values (labels, messages)
  // too, except inside data attributes (value="…", data-…="…").
  const { parts, order } = translateTemplate(strings);
  let out = parts[0];
  for (let i = 0; i < order.length; i++) out += toHTML(values[order[i]], !inDataAttribute(out)) + parts[i + 1];
  return new SafeHTML(out);
}

/** Marks trusted markup as safe. Never pass user input. @param {string} markup */
export const raw = (markup) => new SafeHTML(String(markup));

/** Icon as SafeHTML. @param {string} name @param {Parameters<typeof icon>[1]} [opts] */
export const ico = (name, opts) => raw(icon(name, opts));

/**
 * Replaces the element's content with the template.
 * @param {Element} el @param {SafeHTML|string} tpl
 */
export function render(el, tpl) {
  el.innerHTML = tpl instanceof SafeHTML ? tpl.value : escapeHTML(tpl instanceof KeepText ? tpl.value : translateText(tpl ?? ''));
}

/** Parses a template into a single element (first element child). @returns {HTMLElement} */
export function toElement(tpl) {
  const t = document.createElement('template');
  t.innerHTML = String(tpl).trim();
  return /** @type {HTMLElement} */ (t.content.firstElementChild);
}

/** @returns {HTMLElement|null} */
export const qs = (sel, root = document) => root.querySelector(sel);
/** @returns {HTMLElement[]} */
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Delegated event listener. Handler receives (event, matchedElement).
 * @param {EventTarget} root
 * @param {string} type
 * @param {string} selector
 * @param {(e: Event, el: HTMLElement) => void} handler
 * @param {AddEventListenerOptions} [opts] pass { signal } to auto-remove with the view
 */
export function on(root, type, selector, handler, opts) {
  const listener = (e) => {
    const el = /** @type {HTMLElement} */ (e.target)?.closest?.(selector);
    if (el && /** @type {Element} */ (root).contains?.(el) !== false) handler(e, el);
  };
  root.addEventListener(type, listener, opts);
  return () => root.removeEventListener(type, listener, opts);
}

/** Reads a form into a plain object (checkbox → boolean, multiple same names → array). */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      const group = form.querySelectorAll(`[name="${CSS.escape(el.name)}"]`);
      if (group.length > 1) { (out[el.name] ??= []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
      else out[el.name] ??= '';
    } else {
      out[el.name] = el.value;
    }
  }
  return out;
}

/**
 * Shows/clears field errors produced by a validator map { name: 'message' }.
 * Expects markup from components/form.js (input + .field__error[data-error-for]).
 * Focuses the first invalid field. Returns true when there are no errors.
 */
export function showFieldErrors(form, errors) {
  let first = null;
  for (const el of form.querySelectorAll('[name]')) {
    const msg = errors[el.name] || '';
    if (msg) { el.setAttribute('aria-invalid', 'true'); first ??= el; }
    else el.removeAttribute('aria-invalid');
  }
  for (const box of form.querySelectorAll('[data-error-for]')) {
    box.textContent = errors[box.dataset.errorFor] || '';
  }
  first?.focus();
  return !first;
}
