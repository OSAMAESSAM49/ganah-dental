/**
 * Settings → cloud sync: connect this device to the clinic account (Admin), see the sync
 * status, sync now, sign in again after the session expired, or disconnect.
 */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { formatDateTime, digits } from '../../core/format.js';
import { isAdmin } from '../../core/permissions.js';
import { onEvent } from '../../core/bus.js';
import { textField, passwordField, enhancePasswordFields } from '../../components/form.js';
import { confirmDialog } from '../../components/modal.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { syncStatus, syncNow, connectMainDevice, joinCloud, disconnectCloud, reconnectCloud, cloudEnabled } from '../../services/cloud-sync.js';
import { exportBackup } from '../../services/backup.js';

export const SYNC_STATE = {
  off: { label: 'غير مربوط', tone: '', icon: 'cloud-off' },
  syncing: { label: 'جارٍ المزامنة…', tone: 'info', icon: 'refresh-cw' },
  ok: { label: 'متزامن', tone: 'success', icon: 'cloud' },
  offline: { label: 'بدون إنترنت — ستتم المزامنة عند عودته', tone: 'warning', icon: 'cloud-off' },
  error: { label: 'تعذّرت المزامنة', tone: 'danger', icon: 'cloud-off' },
  auth: { label: 'يلزم تسجيل الدخول بحساب العيادة', tone: 'danger', icon: 'cloud-off' },
};

/** Clinic account form (also used by the setup wizard for an extra device). */
export const cloudForm = (submitLabel, id = 'cloud-form') => html`
  <form class="form" id="${id}" novalidate>
    ${textField({ name: 'email', label: 'إيميل حساب العيادة', required: true, ltr: true, inputmode: 'email', autocomplete: 'username' })}
    ${passwordField({ name: 'password', label: 'كلمة سر حساب العيادة', required: true, autocomplete: 'current-password' })}
    <div class="form-actions"><button type="submit" class="btn btn--primary">${ico('cloud', { size: 20 })} ${submitLabel}</button></div>
  </form>`;

/** Reads and validates the clinic account form. @returns {{ email: string, password: string } | null} */
export function readCloudForm(form) {
  const data = formData(form);
  const errors = {};
  if (!/^\S+@\S+\.\S+$/.test(data.email.trim())) errors.email = 'اكتب إيميل صحيح';
  if (!data.password) errors.password = 'اكتب كلمة السر';
  return showFieldErrors(form, errors) ? { email: data.email.trim(), password: data.password } : null;
}

export async function renderTab({ body, signal }) {
  const admin = isAdmin();

  const draw = () => {
    const s = syncStatus();
    const st = SYNC_STATE[s.state] ?? SYNC_STATE.off;
    const on = cloudEnabled();
    render(body, html`
      <div class="bento">
        <section class="card span-7">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico(st.icon, { size: 20 })} المزامنة بين الأجهزة</h2>
            <p class="card__subtitle">كل جهاز يعمل حتى بدون إنترنت، والتعديلات تنتقل لباقي الأجهزة تلقائيًا عند الاتصال</p>
          </div></div>
          <div class="card__body stack">
            ${on ? html`
              <dl class="dl">
                <dt>الحالة</dt><dd><span class="badge badge--dot ${st.tone ? `badge--${st.tone}` : ''}">${st.label}</span></dd>
                <dt>حساب العيادة</dt><dd class="ltr">${s.email || '—'}</dd>
                ${s.clinicName ? html`<dt>العيادة</dt><dd>${s.clinicName}</dd>` : ''}
                <dt>آخر مزامنة</dt><dd>${s.lastSyncAt ? formatDateTime(s.lastSyncAt) : '—'}</dd>
                <dt>تعديلات لم تُرفع بعد</dt><dd>${digits(s.pending)}</dd>
              </dl>
              ${s.error && s.state !== 'auth' ? html`<p class="text-sm" style="color: var(--c-danger)">${s.error}</p>` : ''}
              <div class="row"><button type="button" class="btn btn--primary" data-sync-now ${s.state === 'syncing' ? 'aria-busy="true"' : ''}>${ico('refresh-cw')} مزامنة الآن</button>
                ${admin ? html`<button type="button" class="btn btn--ghost" data-disconnect>${ico('cloud-off')} إلغاء ربط هذا الجهاز</button>` : ''}</div>
              ${s.state === 'auth' ? html`<hr><p>انتهت جلسة حساب العيادة على هذا الجهاز. سجّل الدخول مرة أخرى لاستكمال المزامنة (لن يضيع أي تعديل).</p>${cloudForm('تسجيل الدخول', 'cloud-reconnect')}` : ''}`
            : admin ? html`
              <p>اربط هذا الجهاز بحساب العيادة على السحابة (Supabase). ابدأ بالجهاز الأساسي الذي عليه البيانات، ثم اربط باقي الأجهزة من شاشة الإعداد الأولى بخيار «جهاز إضافي».</p>
              ${cloudForm('ربط هذا الجهاز')}`
            : html`<p class="muted">ربط الجهاز بالسحابة متاح لمدير النظام فقط.</p>`}
          </div>
        </section>
        <aside class="card span-5">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">كيف تعمل المزامنة؟</h2></div></div>
          <div class="card__body">
            <ul class="stack-sm" style="margin:0; padding-inline-start: var(--sp-5)">
              <li>كل تعديل يُحفظ على الجهاز فورًا، ثم يُرفع خلال ثوانٍ عند وجود إنترنت.</li>
              <li>إذا عُدّل نفس السجل على جهازين، يبقى التعديل الأحدث.</li>
              <li>إذا أُنشئ نفس رقم الملف أو الفاتورة على جهازين بدون إنترنت، يأخذ الأحدث رقمًا جديدًا تلقائيًا.</li>
              <li>الصور والأشعة تُرفع أيضًا، والبيانات لا يراها إلا من يدخل بحساب العيادة.</li>
              <li>استمر في أخذ نسخة احتياطية من حين لآخر — المزامنة ليست بديلًا عنها.</li>
            </ul>
          </div>
        </aside>
      </div>`);
    const f = body.querySelector('form');
    if (f) enhancePasswordFields(f, undefined, signal);
  };

  on(body, 'click', '[data-sync-now]', async () => {
    const s = await syncNow();
    if (s.state === 'ok') toastSuccess('تمت المزامنة');
    else if (s.error) toastError(s.error);
  }, { signal });

  on(body, 'click', '[data-disconnect]', async () => {
    if (!(await confirmDialog({ title: 'إلغاء ربط هذا الجهاز؟', message: 'ستبقى البيانات على هذا الجهاز وعلى السحابة، لكن التعديلات الجديدة لن تنتقل بين الأجهزة حتى تربطه مرة أخرى.', confirmLabel: 'إلغاء الربط', danger: true }))) return;
    const res = await disconnectCloud();
    if (!res.ok) {
      // Unlinking would forget edits that never reached the cloud: upload first, or keep a backup.
      const backupFirst = await confirmDialog({
        title: `${digits(res.pending)} تعديل لم يُرفع للسحابة بعد`,
        message: 'إلغاء الربط الآن يمنع وصول هذه التعديلات للأجهزة الأخرى. الأفضل: اتصل بالإنترنت واضغط «مزامنة الآن» ثم ألغِ الربط. أو نزّل نسخة احتياطية فيها كل شيء ثم ألغِ الربط.',
        confirmLabel: 'نسخة احتياطية ثم إلغاء الربط', cancelLabel: 'رجوع', danger: true,
      });
      if (!backupFirst) return;
      await exportBackup();
      await disconnectCloud({ force: true });
    }
    toastSuccess('تم إلغاء الربط');
    draw();
  }, { signal });

  on(body, 'submit', 'form', async (e, form) => {
    e.preventDefault();
    const creds = readCloudForm(/** @type {HTMLFormElement} */ (form));
    if (!creds) return;
    const btn = form.querySelector('[type=submit]');
    btn.setAttribute('aria-busy', 'true');
    const busy = toast('جارٍ الاتصال بالسحابة…', { duration: 0 });
    try {
      if (form.id === 'cloud-reconnect') {
        await reconnectCloud(creds.email, creds.password);
        toastSuccess('تم تسجيل الدخول ومتابعة المزامنة');
      } else {
        const res = await connectMainDevice(creds.email, creds.password);
        if (res.cloudHasData) {
          busy();
          const ok = await confirmDialog({
            title: 'السحابة فيها بيانات بالفعل',
            message: 'تم ربط جهاز آخر قبل هذا الجهاز. هل تريد استبدال بيانات هذا الجهاز ببيانات السحابة؟ ستُنزَّل نسخة احتياطية من بيانات هذا الجهاز أولًا للأمان.',
            confirmLabel: 'استبدال ببيانات السحابة', danger: true,
          });
          if (!ok) return;
          toast('جارٍ تنزيل بيانات العيادة… لا تغلق الصفحة', { duration: 0 });
          await exportBackup();
          await joinCloud(creds.email, creds.password, { signedIn: true });
          location.reload();
          return;
        }
        toastSuccess('تم ربط الجهاز ورفع بياناته');
      }
    } catch (err) {
      console.error(err);
      toastError(err.message || 'تعذّر الاتصال');
    } finally {
      busy();
      btn.removeAttribute('aria-busy');
      draw();
    }
  }, { signal });

  // Redraw on status changes, but never while someone is typing in the sign-in form.
  const off = onEvent('sync:status', () => { if (![...body.querySelectorAll('form input')].some((i) => /** @type {HTMLInputElement} */ (i).value)) draw(); });
  draw();
  return off;
}
