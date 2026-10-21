/** Security settings: idle auto-logout, recovery code, and an honest note on limits. */
import { html, ico, render, on } from '../../core/dom.js';
import { digits } from '../../core/format.js';
import { getSettings, updateSettings } from '../../data/settings.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toastSuccess } from '../../components/toast.js';
import { regenerateRecoveryCode } from '../../services/auth.js';
import { recoveryCodeBox, printRecoveryCode } from '../auth/shared.js';

const IDLE_OPTIONS = [0, 5, 10, 15, 30, 60];

export async function renderTab({ body, actions, signal }) {
  render(actions, '');
  const app = getSettings('app');
  render(body, html`
    <div class="bento">
      <section class="card span-7">
        <div class="card__header"><div class="card__heading"><h2 class="card__title">الحماية أثناء العمل</h2></div></div>
        <div class="card__body">
          <div class="setting-row">
            <div class="setting-row__text">
              <span class="setting-row__title">القفل التلقائي عند عدم النشاط</span>
              <span class="setting-row__hint">إذا تُرك الجهاز بدون استخدام، يُقفل البرنامج ويطلب الدخول مرة أخرى.</span>
            </div>
            <select class="select" id="idle" style="inline-size: 200px" aria-label="مدة القفل التلقائي">
              ${IDLE_OPTIONS.map((m) => html`<option value="${m}" ${m === app.idleLogoutMinutes ? 'selected' : ''}>${m === 0 ? 'معطّل' : `بعد ${digits(m)} دقيقة`}</option>`)}
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-row__text">
              <span class="setting-row__title">رمز استرداد حساب المدير</span>
              <span class="setting-row__hint">أنشئ رمزًا جديدًا إذا فقدت الورقة أو شككت أن أحدًا رآها. الرمز القديم يتوقف فورًا.</span>
            </div>
            <button type="button" class="btn" data-regen>${ico('refresh-cw')} رمز جديد</button>
          </div>
        </div>
      </section>
      <aside class="card card--inverse span-5">
        <div class="card__header"><div class="card__heading"><h2 class="card__title">${ico('info', { size: 20 })} حدود الحماية</h2></div></div>
        <div class="card__body stack text-sm">
          <p>تسجيل الدخول والصلاحيات هنا ينظّمان عمل الموظفين على هذا الجهاز: كل موظف يرى ما يخصه فقط، وكل عملية مسجّلة باسم من قام بها.</p>
          <p>لكنها ليست حماية أمنية كاملة: البيانات محفوظة داخل المتصفح، ومن يملك الجهاز وخبرة تقنية يستطيع الوصول إليها.</p>
          <p>للحماية الحقيقية: اقفل جهاز الكمبيوتر بكلمة مرور ويندوز، ولا تترك المتصفح مفتوحًا لغير الموظفين، وخذ نسخًا احتياطية. الحماية الكاملة تحتاج لاحقًا إلى خادم (Supabase أو Firebase).</p>
        </div>
      </aside>
    </div>`);

  body.querySelector('#idle').addEventListener('change', async (e) => {
    const minutes = Number(/** @type {HTMLSelectElement} */ (e.target).value);
    await updateSettings('app', { idleLogoutMinutes: minutes });
    toastSuccess(minutes ? `سيُقفل البرنامج بعد ${digits(minutes)} دقيقة من عدم النشاط` : 'تم تعطيل القفل التلقائي');
  }, { signal });

  on(body, 'click', '[data-regen]', async () => {
    const ok = await confirmDialog({ title: 'إنشاء رمز استرداد جديد؟', message: 'الرمز القديم سيتوقف عن العمل فورًا. تأكد من حفظ الرمز الجديد.', confirmLabel: 'إنشاء رمز جديد' });
    if (!ok) return;
    const { recoveryCode } = await regenerateRecoveryCode();
    await openModal({
      title: 'رمز الاسترداد الجديد',
      icon: 'key-round',
      dismissible: false,
      body: html`<div class="stack">
        <p>احفظه في مكان آمن. لن يظهر مرة أخرى.</p>
        ${recoveryCodeBox(recoveryCode)}
        <button type="button" class="btn" data-print-code>${ico('printer')} طباعة</button>
      </div>`,
      actions: [{ label: 'حفظته', value: true, variant: 'primary' }],
      onOpen(d) { d.querySelector('[data-print-code]').addEventListener('click', () => printRecoveryCode(recoveryCode)); },
    });
    toastSuccess('تم تفعيل الرمز الجديد');
  }, { signal });
}
