/**
 * Form field builders. They produce consistent, accessible markup (label ↔ input,
 * hint and error wired with aria-describedby) that showFieldErrors() understands.
 */
import { html } from '../core/dom.js';

let seq = 0;
const fid = (name) => `f-${name}-${++seq}`;

/**
 * @param {{ name: string, label: string, type?: string, value?: string|number, required?: boolean,
 *           hint?: string, placeholder?: string, ltr?: boolean, inputmode?: string,
 *           autocomplete?: string, attrs?: import('../core/dom.js').SafeHTML }} o
 *   ltr: phone numbers, usernames, amounts — typed left-to-right
 */
export function textField(o) {
  const id = fid(o.name);
  return html`
    <div class="field">
      <label class="field__label" for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
      <input id="${id}" name="${o.name}" class="input ${o.ltr ? 'input--ltr' : ''}" type="${o.type ?? 'text'}"
        value="${o.value ?? ''}" ${o.placeholder ? html`placeholder="${o.placeholder}"` : ''}
        ${o.inputmode ? html`inputmode="${o.inputmode}"` : ''} autocomplete="${o.autocomplete ?? 'off'}"
        ${o.required ? 'required aria-required="true"' : ''} aria-describedby="${o.hint ? `${id}-hint ` : ''}${id}-err" ${o.attrs ?? ''}>
      ${o.hint ? html`<span class="field__hint" id="${id}-hint">${o.hint}</span>` : ''}
      <span class="field__error" id="${id}-err" data-error-for="${o.name}" role="alert"></span>
    </div>`;
}

/**
 * @param {{ name: string, label: string, options: Array<{ value: string, label: string }>,
 *           value?: string, required?: boolean, hint?: string, placeholder?: string }} o
 */
export function selectField(o) {
  const id = fid(o.name);
  return html`
    <div class="field">
      <label class="field__label" for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
      <select id="${id}" name="${o.name}" class="select" ${o.required ? 'required' : ''} aria-describedby="${o.hint ? `${id}-hint ` : ''}${id}-err">
        ${o.placeholder ? html`<option value="">${o.placeholder}</option>` : ''}
        ${o.options.map((opt) => html`<option value="${opt.value}" ${opt.value === o.value ? 'selected' : ''}>${opt.label}</option>`)}
      </select>
      ${o.hint ? html`<span class="field__hint" id="${id}-hint">${o.hint}</span>` : ''}
      <span class="field__error" id="${id}-err" data-error-for="${o.name}" role="alert"></span>
    </div>`;
}

/** @param {{ name: string, label: string, value?: string, hint?: string, placeholder?: string, rows?: number }} o */
export function textareaField(o) {
  const id = fid(o.name);
  return html`
    <div class="field">
      <label class="field__label" for="${id}">${o.label}</label>
      <textarea id="${id}" name="${o.name}" class="textarea" rows="${o.rows ?? 4}" ${o.placeholder ? html`placeholder="${o.placeholder}"` : ''} aria-describedby="${o.hint ? `${id}-hint ` : ''}${id}-err">${o.value ?? ''}</textarea>
      ${o.hint ? html`<span class="field__hint" id="${id}-hint">${o.hint}</span>` : ''}
      <span class="field__error" id="${id}-err" data-error-for="${o.name}" role="alert"></span>
    </div>`;
}

/** Pill-style radio group. @param {{ name: string, label: string, options: Array<{ value: string, label: string, icon?: any }>, value?: string }} o */
export function segmentedField(o) {
  return html`
    <fieldset class="field" style="border:0;padding:0;margin:0">
      <legend class="field__label" style="margin-block-end: var(--sp-2)">${o.label}</legend>
      <div class="segmented">
        ${o.options.map((opt) => html`
          <label><input type="radio" name="${o.name}" value="${opt.value}" ${opt.value === o.value ? 'checked' : ''}><span>${opt.icon ?? ''}${opt.label}</span></label>`)}
      </div>
    </fieldset>`;
}
