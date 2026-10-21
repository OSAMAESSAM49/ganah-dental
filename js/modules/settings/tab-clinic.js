/** Clinic info: name, contact, logo (used in the sidebar and on printouts). */
import { html, ico, render, formData, showFieldErrors } from '../../core/dom.js';
import { validate, required, phone as phoneRule } from '../../core/validate.js';
import { can } from '../../core/permissions.js';
import { imageFileToDataURL } from '../../core/image.js';
import { getSettings, updateSettings } from '../../data/settings.js';
import { textField } from '../../components/form.js';
import { toastSuccess, toastError } from '../../components/toast.js';

export async function renderTab({ body, signal }) {
  const editable = can('settings', 'edit');
  let logo = getSettings('clinic').logo ?? null;

  const draw = () => {
    const c = getSettings('clinic');
    render(body, html`
      <form class="card" id="clinic-form" novalidate>
        <div class="card__body form">
          ${textField({ name: 'name', label: 'اسم العيادة', value: c.name, required: true })}
          <div class="form-grid">
            ${textField({ name: 'shortName', label: 'الاسم المختصر', value: c.shortName, hint: 'يظهر في القائمة الجانبية' })}
            ${textField({ name: 'tagline', label: 'الوصف', value: c.tagline, placeholder: 'لطب الفم والأسنان' })}
          </div>
          <div class="form-grid">
            ${textField({ name: 'phone', label: 'الهاتف', value: c.phone, ltr: true, inputmode: 'tel' })}
            ${textField({ name: 'address', label: 'العنوان', value: c.address })}
          </div>
          <div class="field">
            <span class="field__label">الشعار</span>
            <div class="logo-picker">
              <div class="logo-picker__preview">${logo ? html`<img src="${logo}" alt="الشعار">` : ico('image', { size: 28 })}</div>
              ${editable ? html`
                <label class="btn btn--soft btn--sm">${ico('upload', { size: 18 })} تغيير الشعار<input type="file" accept="image/*" id="logo-input" class="visually-hidden"></label>
                ${logo ? html`<button type="button" class="btn btn--ghost btn--sm" id="logo-clear">إزالة</button>` : ''}` : ''}
            </div>
          </div>
        </div>
        ${editable ? html`<div class="card__footer form-actions"><button type="submit" class="btn btn--primary">${ico('save')} حفظ</button></div>` : ''}
      </form>`);
    if (!editable) body.querySelectorAll('input').forEach((i) => { i.disabled = true; });
  };

  body.addEventListener('change', async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.id !== 'logo-input' || !t.files?.[0]) return;
    try { logo = await imageFileToDataURL(t.files[0], { maxSize: 400 }); keepValues(draw); }
    catch { toastError('تعذّرت قراءة الصورة'); }
  }, { signal });
  body.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('#logo-clear')) { logo = null; keepValues(draw); }
  }, { signal });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = /** @type {HTMLFormElement} */ (e.target);
    const data = formData(form);
    const errors = validate(data, { name: (v) => required(v, 'اسم العيادة'), phone: (v) => phoneRule(v) });
    if (!showFieldErrors(form, errors)) return;
    await updateSettings('clinic', { ...data, shortName: data.shortName.trim() || data.name.trim(), logo });
    toastSuccess('تم حفظ بيانات العيادة');
  }, { signal });

  /** Redraw without losing what the user typed. */
  function keepValues(fn) {
    const form = body.querySelector('form');
    const values = form ? formData(form) : {};
    fn();
    for (const [k, v] of Object.entries(values)) {
      const input = /** @type {HTMLInputElement} */ (body.querySelector(`[name="${k}"]`));
      if (input) input.value = v;
    }
  }

  draw();
}
