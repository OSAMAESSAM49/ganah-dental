/**
 * Login / lock / user-switch screen.
 * Query: ?user=<id> preselects a user (lock screen), ?reason=idle shows why, ?next=<path>.
 */
import { html, ico, render, formData, showFieldErrors } from '../../core/dom.js';
import { initials } from '../../core/text.js';
import { navigate } from '../../core/router.js';
import { digits } from '../../core/format.js';
import { passwordField, textField, enhancePasswordFields, selectField } from '../../components/form.js';
import { openModal } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import { repos } from '../../data/index.js';
import {
  login, loginWithPin, listLoginUsers, listAdmins, verifyRecoveryCode, recoverWithCode,
  validatePassword, passwordStrength,
} from '../../services/auth.js';
import { openChangePasswordDialog } from '../account/dialogs.js';
import { authLayout, recoveryCodeBox, printRecoveryCode } from '../auth/shared.js';

const MAX_TILES = 12;

/** Where to go after signing in (only internal paths). */
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/');

async function afterLogin(user, next) {
  if (user.mustChangePassword) await openChangePasswordDialog({ forced: true });
  toastSuccess(`أهلًا ${user.displayName}`);
  navigate(safeNext(next), { replace: true });
}

export default {
  title: 'تسجيل الدخول',
  async render({ el, query, signal }) {
    const users = await listLoginUsers();
    const roles = Object.fromEntries((await repos.roles.list()).map((r) => [r.id, r.name]));
    const state = {
      selected: users.find((u) => u.id === query.user) ?? null,
      mode: 'password', // 'password' | 'pin'
      pin: '',
    };
    if (state.selected?.hasPin) state.mode = 'pin';
    const showTiles = users.length > 0 && users.length <= MAX_TILES;

    const tiles = () => html`
      <div class="user-tiles" role="group" aria-label="اختر حسابك">
        ${users.map((u) => html`
          <button type="button" class="user-tile" data-user="${u.id}" aria-pressed="${String(state.selected?.id === u.id)}">
            <span class="avatar avatar--c-${u.color || 'violet'}">${initials(u.displayName.replace(/^د\.\s*/, ''))}</span>
            <span class="user-tile__name">${u.displayName}</span>
            <span class="user-tile__role">${roles[u.roleId] ?? ''}</span>
          </button>`)}
      </div>`;

    const passwordForm = () => html`
      <form class="form" id="f-login" novalidate>
        ${state.selected
          ? html`<input type="hidden" name="username" value="${state.selected.username}">`
          : textField({ name: 'username', label: 'اسم المستخدم', required: true, ltr: true, autocomplete: 'username' })}
        ${passwordField({ name: 'password', label: 'كلمة المرور', required: true, autocomplete: 'current-password' })}
        <span class="field__error" data-error-for="form" role="alert"></span>
        <button class="btn btn--primary btn--block" type="submit">${ico('lock', { size: 20 })} دخول</button>
        ${state.selected?.hasPin ? html`<button type="button" class="btn btn--ghost btn--block" data-mode="pin">الدخول بالرمز السريع</button>` : ''}
      </form>`;

    const pinForm = () => html`
      <div class="stack" id="pin-box" tabindex="-1" aria-label="أدخل الرمز السريع">
        <div class="pin-dots" aria-live="polite" aria-label="عدد الأرقام المدخلة ${digits(state.pin.length)}">
          ${[0, 1, 2, 3, 4, 5].map((i) => html`<span ${i < state.pin.length ? html`data-on` : ''}></span>`)}
        </div>
        <span class="field__error" data-error-for="form" role="alert" style="text-align:center"></span>
        <div class="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" data-digit="${n}">${digits(n)}</button>`)}
          <button type="button" data-pin-back aria-label="مسح رقم">${ico('arrow-right', { size: 22 })}</button>
          <button type="button" data-digit="0">${digits(0)}</button>
          <button type="button" data-pin-go aria-label="دخول" style="background: var(--c-primary); color: #fff">${ico('check', { size: 24 })}</button>
        </div>
        <button type="button" class="btn btn--ghost btn--block" data-mode="password">استخدم كلمة المرور بدلًا من ذلك</button>
      </div>`;

    const draw = () => {
      const notice = query.reason === 'idle'
        ? html`<div class="alert">${ico('clock')}<div class="alert__content"><div class="alert__body">تم قفل البرنامج تلقائيًا لعدم النشاط. سجّل الدخول للمتابعة.</div></div></div>`
        : '';
      render(el, authLayout(html`
        <div>
          <h1 class="auth__title">${state.selected ? html`أهلًا، ${state.selected.displayName}` : 'تسجيل الدخول'}</h1>
          <p class="auth__sub">${state.selected ? (state.mode === 'pin' ? 'أدخل رمزك السريع' : 'أدخل كلمة المرور') : 'اختر حسابك أو اكتب اسم المستخدم'}</p>
        </div>
        ${notice}
        ${users.length === 0 ? emptyState({ icon: 'users', title: 'لا توجد حسابات مفعّلة', hint: 'استخدم رمز الاسترداد لاستعادة حساب المدير.' }) : ''}
        ${showTiles ? tiles() : ''}
        ${state.mode === 'pin' && state.selected ? pinForm() : passwordForm()}
        <div class="auth__footer">
          ${state.selected && showTiles ? html`<button type="button" class="link-btn" data-other>مستخدم آخر</button>` : html`<span></span>`}
          <button type="button" class="link-btn" data-forgot>نسيت كلمة مرور المدير؟</button>
        </div>`));
      const form = el.querySelector('#f-login');
      if (form) {
        enhancePasswordFields(/** @type {HTMLElement} */ (form), null, signal);
        /** @type {HTMLInputElement} */ (form.querySelector(state.selected ? '[name="password"]' : '[name="username"]'))?.focus();
      } else {
        /** @type {HTMLElement} */ (el.querySelector('#pin-box'))?.focus();
      }
    };

    const setError = (msg) => {
      const box = el.querySelector('[data-error-for="form"]');
      if (box) box.textContent = msg;
    };

    const submitPin = async () => {
      if (state.pin.length < 4) { setError('الرمز من 4 إلى 6 أرقام'); return; }
      try {
        const user = await loginWithPin(state.selected.id, state.pin);
        await afterLogin(user, query.next);
      } catch (err) {
        state.pin = '';
        draw();
        setError(err.message);
      }
    };

    const pressDigit = (d) => {
      if (state.pin.length >= 6) return;
      state.pin += d;
      draw();
      if (state.pin.length === 6) submitPin();
    };

    el.addEventListener('click', async (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      const tile = t.closest('[data-user]');
      if (tile) {
        state.selected = users.find((u) => u.id === tile.dataset.user);
        state.mode = state.selected.hasPin ? 'pin' : 'password';
        state.pin = '';
        draw();
        return;
      }
      const mode = t.closest('[data-mode]');
      if (mode) { state.mode = mode.dataset.mode; state.pin = ''; draw(); return; }
      if (t.closest('[data-other]')) { state.selected = null; state.mode = 'password'; draw(); return; }
      const digit = t.closest('[data-digit]');
      if (digit) { pressDigit(digit.dataset.digit); return; }
      if (t.closest('[data-pin-back]')) { state.pin = state.pin.slice(0, -1); draw(); return; }
      if (t.closest('[data-pin-go]')) { submitPin(); return; }
      if (t.closest('[data-forgot]')) recoveryFlow();
    }, { signal });

    el.addEventListener('keydown', (e) => {
      if (state.mode !== 'pin' || !state.selected || /** @type {HTMLElement} */ (e.target).matches('input')) return;
      const k = e.key.replace(/[٠-٩]/, (d) => String(d.charCodeAt(0) - 0x0660));
      if (/^\d$/.test(k)) { e.preventDefault(); pressDigit(k); }
      else if (k === 'Backspace') { e.preventDefault(); state.pin = state.pin.slice(0, -1); draw(); }
      else if (k === 'Enter') { e.preventDefault(); submitPin(); }
    }, { signal });

    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = /** @type {HTMLFormElement} */ (e.target);
      const data = formData(form);
      const errors = { username: data.username ? '' : 'اسم المستخدم مطلوب', password: data.password ? '' : 'كلمة المرور مطلوبة' };
      if (!showFieldErrors(form, Object.fromEntries(Object.entries(errors).filter(([, v]) => v)))) return;
      const btn = form.querySelector('[type=submit]');
      btn.setAttribute('aria-busy', 'true');
      try {
        const user = await login(data.username, data.password);
        await afterLogin(user, query.next);
      } catch (err) {
        btn.removeAttribute('aria-busy');
        showFieldErrors(form, { password: err.message });
        const pw = /** @type {HTMLInputElement} */ (form.querySelector('[name=password]'));
        pw.value = '';
        pw.focus();
      }
    }, { signal });

    draw();
  },
};

/** "Forgot admin password" — recovery code → choose admin → new password → new code. */
async function recoveryFlow() {
  let code = '';
  const ok = await openModal({
    title: 'استعادة حساب المدير',
    icon: 'key-round',
    body: html`
      <form class="form" novalidate>
        <p class="muted">أدخل رمز الاسترداد الذي حصلت عليه عند إعداد البرنامج (أو آخر رمز جديد).</p>
        ${textField({ name: 'code', label: 'رمز الاسترداد', ltr: true, required: true, placeholder: 'XXXX-XXXX-XXXX-XXXX' })}
      </form>`,
    actions: [{ label: 'متابعة', value: 'next', variant: 'primary' }, { label: 'إغلاق', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      f.addEventListener('submit', (e) => { e.preventDefault(); close('next'); });
      f.querySelector('input').focus();
    },
    async beforeClose(v, d) {
      if (v !== 'next') return true;
      const f = d.querySelector('form');
      code = formData(f).code;
      if (await verifyRecoveryCode(code)) return true;
      showFieldErrors(f, { code: 'رمز الاسترداد غير صحيح' });
      return false;
    },
  });
  if (ok !== 'next') return;

  const admins = await listAdmins();
  const all = admins.length ? admins : (await repos.users.list()).filter((u) => u.roleId === 'admin');
  let issued = '';
  const done = await openModal({
    title: 'كلمة مرور جديدة للمدير',
    icon: 'key-round',
    body: html`
      <form class="form" novalidate>
        ${selectField({ name: 'userId', label: 'حساب المدير', options: all.map((u) => ({ value: u.id, label: `${u.displayName} (${u.username})` })), value: all[0]?.id, required: true })}
        ${passwordField({ name: 'password', label: 'كلمة المرور الجديدة', required: true, meter: true })}
        ${passwordField({ name: 'confirm', label: 'تأكيد كلمة المرور', required: true })}
      </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إغلاق', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      enhancePasswordFields(f, passwordStrength);
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const user = all.find((u) => u.id === data.userId);
      const errors = {};
      const pwErr = validatePassword(data.password, user?.username);
      if (pwErr) errors.password = pwErr;
      if (data.confirm !== data.password) errors.confirm = 'كلمتا المرور غير متطابقتين';
      if (!showFieldErrors(f, errors)) return false;
      try {
        ({ recoveryCode: issued } = await recoverWithCode(code, data.userId, data.password));
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (done !== 'save') return;

  await openModal({
    title: 'رمز استرداد جديد',
    icon: 'circle-check',
    dismissible: false,
    body: html`
      <div class="stack">
        <p>تم تغيير كلمة المرور. الرمز القديم لم يعد يعمل — احفظ الرمز الجديد:</p>
        ${recoveryCodeBox(issued)}
        <button type="button" class="btn" data-print-code>${ico('printer')} طباعة الرمز</button>
      </div>`,
    actions: [{ label: 'حفظته، تابع لتسجيل الدخول', value: true, variant: 'primary' }],
    onOpen(d) { d.querySelector('[data-print-code]').addEventListener('click', () => printRecoveryCode(issued)); },
  });
  toastSuccess('سجّل الدخول بكلمة المرور الجديدة');
}
