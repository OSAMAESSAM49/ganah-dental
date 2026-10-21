/**
 * First-run setup wizard: 1) clinic info  2) Admin account  3) recovery code.
 * Shown only while meta.setupDone is false (the router guard enforces this).
 */
import { html, ico, render, formData, showFieldErrors } from '../../core/dom.js';
import { validate, required, phone as phoneRule } from '../../core/validate.js';
import { navigate } from '../../core/router.js';
import { imageFileToDataURL } from '../../core/image.js';
import { textField, passwordField, enhancePasswordFields } from '../../components/form.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { DEFAULT_CLINIC } from '../../data/settings.js';
import { completeSetup, validatePassword, validatePin, validateUsername, passwordStrength, normalizeUsername } from '../../services/auth.js';
import { authLayout, recoveryCodeBox, printRecoveryCode } from '../auth/shared.js';

const STEPS = ['بيانات العيادة', 'حساب المدير', 'رمز الاسترداد'];

const stepsBar = (current) => html`
  <ol class="steps" aria-label="خطوات الإعداد" style="list-style:none;margin:0;padding:0">
    ${STEPS.map((s, i) => html`<li class="steps__item" data-state="${i < current ? 'done' : i === current ? 'current' : 'todo'}" ${i === current ? html`aria-current="step"` : ''}>${s}</li>`)}
  </ol>`;

export default {
  title: 'إعداد البرنامج',
  async render({ el, signal }) {
    const state = { step: 0, clinic: { ...DEFAULT_CLINIC }, admin: { displayName: '', title: 'د.', username: '', isDoctor: true }, recoveryCode: '' };

    const draw = () => {
      if (state.step === 0) drawClinic();
      else if (state.step === 1) drawAdmin();
      else drawRecovery();
      el.querySelector('input:not([type=hidden]), button')?.focus();
    };

    /* Step 1 — clinic */
    const drawClinic = () => {
      const c = state.clinic;
      render(el, authLayout(html`
        ${stepsBar(0)}
        <div>
          <h1 class="auth__title">أهلًا بك 👋</h1>
          <p class="auth__sub">لنجهّز البرنامج لعيادتك في ثلاث خطوات سريعة. يمكنك تعديل كل شيء لاحقًا من الإعدادات.</p>
        </div>
        <form class="form" id="f-clinic" novalidate>
          ${textField({ name: 'name', label: 'اسم العيادة', value: c.name, required: true })}
          <div class="form-grid">
            ${textField({ name: 'shortName', label: 'الاسم المختصر', value: c.shortName, hint: 'يظهر في القائمة الجانبية' })}
            ${textField({ name: 'phone', label: 'هاتف العيادة', value: c.phone, ltr: true, inputmode: 'tel' })}
          </div>
          ${textField({ name: 'address', label: 'العنوان', value: c.address })}
          <div class="field">
            <span class="field__label">شعار العيادة (اختياري)</span>
            <div class="logo-picker">
              <div class="logo-picker__preview" id="logo-preview">${c.logo ? html`<img src="${c.logo}" alt="الشعار">` : ico('image', { size: 28 })}</div>
              <label class="btn btn--soft btn--sm">${ico('upload', { size: 18 })} اختيار صورة
                <input type="file" accept="image/*" id="logo-input" class="visually-hidden">
              </label>
              ${c.logo ? html`<button type="button" class="btn btn--ghost btn--sm" id="logo-clear">إزالة</button>` : ''}
            </div>
            <span class="field__hint">يظهر على الفواتير والروشتات المطبوعة.</span>
          </div>
          <div class="form-actions"><button class="btn btn--primary btn--block" type="submit">التالي ${ico('arrow-left', { size: 20 })}</button></div>
        </form>`));

      const form = /** @type {HTMLFormElement} */ (el.querySelector('#f-clinic'));
      el.querySelector('#logo-input').addEventListener('change', async (e) => {
        const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
        if (!file) return;
        try {
          state.clinic = { ...state.clinic, ...formData(form), logo: await imageFileToDataURL(file, { maxSize: 400 }) };
          drawClinic();
        } catch { toastError('تعذّرت قراءة الصورة. جرّب صورة PNG أو JPG.'); }
      }, { signal });
      el.querySelector('#logo-clear')?.addEventListener('click', () => { state.clinic = { ...state.clinic, ...formData(form), logo: null }; drawClinic(); }, { signal });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = formData(form);
        const errors = validate(data, {
          name: (v) => required(v, 'اسم العيادة'),
          phone: (v) => phoneRule(v),
        });
        if (!showFieldErrors(form, errors)) return;
        state.clinic = { ...state.clinic, ...data, shortName: data.shortName.trim() || data.name.trim() };
        state.step = 1;
        draw();
      }, { signal });
    };

    /* Step 2 — admin account */
    const drawAdmin = () => {
      const a = state.admin;
      render(el, authLayout(html`
        ${stepsBar(1)}
        <div>
          <h1 class="auth__title">حساب مدير النظام</h1>
          <p class="auth__sub">المدير يضيف الموظفين ويحدد صلاحياتهم. غالبًا هو صاحب العيادة.</p>
        </div>
        <form class="form" id="f-admin" novalidate>
          <div class="form-grid" style="grid-template-columns: 110px 1fr">
            ${textField({ name: 'title', label: 'اللقب', value: a.title, placeholder: 'د.' })}
            ${textField({ name: 'displayName', label: 'الاسم', value: a.displayName, required: true, placeholder: 'مثال: أحمد محمود' })}
          </div>
          ${textField({ name: 'username', label: 'اسم المستخدم (للدخول)', value: a.username, required: true, ltr: true, placeholder: 'admin', hint: 'حروف إنجليزية صغيرة أو أرقام، بدون مسافات', autocomplete: 'username' })}
          ${passwordField({ name: 'password', label: 'كلمة المرور', required: true, meter: true, hint: '8 أحرف على الأقل. الأفضل خليط من حروف وأرقام.' })}
          ${passwordField({ name: 'confirm', label: 'تأكيد كلمة المرور', required: true })}
          ${textField({ name: 'pin', label: 'رمز سريع PIN (اختياري)', ltr: true, inputmode: 'numeric', type: 'password', hint: '4–6 أرقام للتبديل السريع بين المستخدمين على نفس الجهاز', autocomplete: 'off' })}
          <label class="check"><input type="checkbox" name="isDoctor" ${a.isDoctor ? 'checked' : ''}> أنا طبيب معالج أيضًا (يظهر اسمي في المواعيد)</label>
          <div class="form-actions">
            <button class="btn btn--primary grow" type="submit">إنشاء الحساب ${ico('arrow-left', { size: 20 })}</button>
            <button class="btn btn--ghost" type="button" data-back>${ico('arrow-right', { size: 20 })} رجوع</button>
          </div>
        </form>`));

      const form = /** @type {HTMLFormElement} */ (el.querySelector('#f-admin'));
      enhancePasswordFields(form, passwordStrength, signal);
      el.querySelector('[data-back]').addEventListener('click', () => { state.admin = { ...state.admin, ...formData(form) }; state.step = 0; draw(); }, { signal });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = formData(form);
        const errors = validate(data, {
          displayName: (v) => required(v, 'الاسم'),
          username: (v) => validateUsername(v),
          password: (v) => validatePassword(v, data.username),
          confirm: (v) => (v !== data.password ? 'كلمتا المرور غير متطابقتين' : ''),
          pin: (v) => (v ? validatePin(v) : ''),
        });
        if (!showFieldErrors(form, errors)) return;
        const btn = /** @type {HTMLButtonElement} */ (form.querySelector('[type=submit]'));
        btn.setAttribute('aria-busy', 'true');
        try {
          state.admin = { ...state.admin, displayName: data.displayName, title: data.title, username: normalizeUsername(data.username), isDoctor: data.isDoctor };
          const displayName = [data.title.trim(), data.displayName.trim()].filter(Boolean).join(' ');
          const { recoveryCode } = await completeSetup({
            clinic: state.clinic,
            admin: { displayName, title: data.title.trim(), username: data.username, password: data.password, pin: data.pin || undefined, isDoctor: data.isDoctor },
          });
          state.recoveryCode = recoveryCode;
          state.step = 2;
          draw();
        } catch (err) {
          btn.removeAttribute('aria-busy');
          console.error(err);
          toastError(err.message || 'تعذّر إنشاء الحساب');
        }
      }, { signal });
    };

    /* Step 3 — recovery code */
    const drawRecovery = () => {
      render(el, authLayout(html`
        ${stepsBar(2)}
        <div>
          <h1 class="auth__title">احفظ رمز الاسترداد</h1>
          <p class="auth__sub">إذا نسيت كلمة مرور المدير، هذا الرمز هو الطريقة الوحيدة لاستعادة الحساب. لن يظهر مرة أخرى.</p>
        </div>
        ${recoveryCodeBox(state.recoveryCode)}
        <div class="row">
          <button type="button" class="btn grow" data-print>${ico('printer')} طباعة</button>
          <button type="button" class="btn grow" data-copy>${ico('file-text')} نسخ</button>
        </div>
        <div class="alert alert--warning">${ico('triangle-alert')}<div class="alert__content"><div class="alert__body">اطبعه أو اكتبه على ورقة واحفظه في مكان آمن. لا تحفظه على نفس الجهاز.</div></div></div>
        <label class="check"><input type="checkbox" id="saved"> حفظت رمز الاسترداد في مكان آمن</label>
        <button type="button" class="btn btn--primary btn--block" data-finish disabled>ابدأ استخدام البرنامج ${ico('arrow-left', { size: 20 })}</button>`,
      { headline: html`كل شيء <em>جاهز</em> تقريبًا` }));

      const finish = /** @type {HTMLButtonElement} */ (el.querySelector('[data-finish]'));
      el.querySelector('#saved').addEventListener('change', (e) => { finish.disabled = !(/** @type {HTMLInputElement} */ (e.target).checked); }, { signal });
      el.querySelector('[data-print]').addEventListener('click', () => printRecoveryCode(state.recoveryCode), { signal });
      el.querySelector('[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(state.recoveryCode); toastSuccess('تم نسخ الرمز'); }
        catch { toastError('تعذّر النسخ، اكتب الرمز يدويًا'); }
      }, { signal });
      finish.addEventListener('click', () => {
        toastSuccess('مرحبًا بك! ابدأ بإضافة الموظفين من «المستخدمون والصلاحيات».');
        navigate('/', { replace: true });
      }, { signal });
    };

    draw();
  },
};
