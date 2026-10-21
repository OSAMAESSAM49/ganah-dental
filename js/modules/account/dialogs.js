/** "My account" dialogs: change password (also forced after a reset) and set/remove PIN. */
import { html, ico, formData, showFieldErrors } from '../../core/dom.js';
import { validate } from '../../core/validate.js';
import { currentUser } from '../../core/session.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { passwordField, textField, enhancePasswordFields } from '../../components/form.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { changeOwnPassword, setOwnPin, validatePassword, validatePin, passwordStrength } from '../../services/auth.js';

/**
 * @param {{ forced?: boolean }} [opts] forced: cannot be dismissed (after an admin reset)
 * @returns {Promise<boolean>} true when the password was changed
 */
export async function openChangePasswordDialog({ forced = false } = {}) {
  const me = currentUser();
  const result = await openModal({
    title: forced ? 'اختر كلمة مرور جديدة' : 'تغيير كلمة المرور',
    icon: 'key-round',
    dismissible: !forced,
    body: html`
      <form class="form" id="f-pw" novalidate>
        ${forced ? html`<div class="alert alert--warning">${ico('info')}<div class="alert__content"><div class="alert__body">تم تعيين كلمة مرور مؤقتة لحسابك. اختر كلمة مرور خاصة بك للمتابعة.</div></div></div>` : ''}
        ${passwordField({ name: 'current', label: forced ? 'كلمة المرور المؤقتة' : 'كلمة المرور الحالية', required: true, autocomplete: 'current-password' })}
        ${passwordField({ name: 'next', label: 'كلمة المرور الجديدة', required: true, meter: true, hint: '8 أحرف على الأقل' })}
        ${passwordField({ name: 'confirm', label: 'تأكيد كلمة المرور الجديدة', required: true })}
      </form>`,
    actions: [
      { label: 'حفظ', value: 'save', variant: 'primary' },
      ...(forced ? [] : [{ label: 'إلغاء', value: null }]),
    ],
    onOpen(dialog, close) {
      const form = dialog.querySelector('form');
      enhancePasswordFields(form, passwordStrength);
      form.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
      form.querySelector('input')?.focus();
    },
    async beforeClose(value, dialog) {
      if (value !== 'save') return true;
      const form = dialog.querySelector('form');
      const data = formData(form);
      const errors = validate(data, {
        current: (v) => (v ? '' : 'مطلوب'),
        next: (v) => validatePassword(v, me?.username) || (v === data.current ? 'اختر كلمة مرور مختلفة عن الحالية' : ''),
        confirm: (v) => (v !== data.next ? 'كلمتا المرور غير متطابقتين' : ''),
      });
      if (!showFieldErrors(form, errors)) return false;
      try {
        await changeOwnPassword(data.current, data.next);
        return true;
      } catch (err) {
        showFieldErrors(form, err.code === 'invalid' ? { current: err.message } : { next: err.message });
        return false;
      }
    },
  });
  if (result === 'save') toastSuccess('تم تغيير كلمة المرور');
  return result === 'save';
}

/** Set, change or remove the signed-in user's quick-switch PIN. */
export async function openPinDialog() {
  const me = currentUser();
  const result = await openModal({
    title: me?.hasPin ? 'تغيير الرمز السريع' : 'تعيين رمز سريع',
    icon: 'lock',
    body: html`
      <form class="form" novalidate>
        <p class="muted">الرمز السريع (4–6 أرقام) يسمح بالدخول بسرعة من شاشة تبديل المستخدم على هذا البرنامج.</p>
        ${textField({ name: 'pin', label: 'الرمز الجديد', type: 'password', ltr: true, inputmode: 'numeric', required: true })}
        ${textField({ name: 'confirm', label: 'تأكيد الرمز', type: 'password', ltr: true, inputmode: 'numeric', required: true })}
      </form>`,
    actions: [
      { label: 'حفظ', value: 'save', variant: 'primary' },
      ...(me?.hasPin ? [{ label: 'إزالة الرمز', value: 'remove', variant: 'ghost' }] : []),
      { label: 'إلغاء', value: null },
    ],
    onOpen(dialog, close) {
      const form = dialog.querySelector('form');
      form.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
      form.querySelector('input')?.focus();
    },
    async beforeClose(value, dialog) {
      if (value !== 'save') return true;
      const form = dialog.querySelector('form');
      const data = formData(form);
      const errors = validate(data, {
        pin: (v) => validatePin(v),
        confirm: (v) => (v !== data.pin ? 'الرمزان غير متطابقين' : ''),
      });
      if (!showFieldErrors(form, errors)) return false;
      try { await setOwnPin(data.pin); return true; } catch (err) { showFieldErrors(form, { pin: err.message }); return false; }
    },
  });
  if (result === 'save') toastSuccess('تم حفظ الرمز السريع');
  if (result === 'remove') {
    if (await confirmDialog({ title: 'إزالة الرمز السريع؟', message: 'ستحتاج إلى كلمة المرور للدخول.', confirmLabel: 'إزالة', danger: true })) {
      try { await setOwnPin(null); toastSuccess('تمت إزالة الرمز السريع'); } catch (err) { toastError(err.message); }
    }
  }
}
