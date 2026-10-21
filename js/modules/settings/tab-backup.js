/** Backup (download a JSON file) and restore (replace all data from a file, Admin only). */
import { html, ico, render, on } from '../../core/dom.js';
import { formatDateTime, formatBytes, digits, arabicCount } from '../../core/format.js';
import { can, isAdmin } from '../../core/permissions.js';
import { navigate } from '../../core/router.js';
import { getSettings, updateSettings } from '../../data/settings.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { exportBackup, readBackupFile, restoreBackup, backupStatus } from '../../services/backup.js';
import { logout } from '../../services/auth.js';

const DAYS = { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يومًا' };

export async function renderTab({ body, signal }) {
  const canBackup = can('settings', 'edit');
  const admin = isAdmin();

  const draw = async () => {
    const s = await backupStatus();
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    render(body, html`
      <div class="bento">
        <section class="card ${s.due ? 'card--hero' : ''} span-7">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico('download', { size: 20 })} تنزيل نسخة احتياطية</h2>
            <p class="card__subtitle">${s.lastAt ? html`آخر نسخة: ${formatDateTime(s.lastAt)} (${s.days === 0 ? 'اليوم' : `منذ ${arabicCount(s.days, DAYS)}`})` : 'لم تؤخذ أي نسخة احتياطية بعد.'}</p>
          </div></div>
          <div class="card__body stack">
            <p>ملف واحد فيه كل بيانات البرنامج: المرضى، والصور، والمستخدمين، والإعدادات. احفظه خارج هذا الجهاز (فلاشة، أو Google Drive، أو بريدك).</p>
            ${s.due && s.lastAt ? html`<p class="bold">${ico('triangle-alert', { size: 18 })} مرّ أكثر من ${arabicCount(s.limit, DAYS)} على آخر نسخة.</p>` : ''}
            ${canBackup
              ? html`<button type="button" class="btn ${s.due ? 'btn--accent' : 'btn--primary'}" data-export style="align-self:flex-start">${ico('download')} تنزيل النسخة الآن</button>`
              : html`<p class="muted">تنزيل النسخ الاحتياطية متاح لمن لديه صلاحية تعديل الإعدادات.</p>`}
          </div>
        </section>
        <aside class="card span-5">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">التخزين على هذا الجهاز</h2></div></div>
          <div class="card__body">
            <dl class="dl">
              <dt>المساحة المستخدمة</dt><dd>${formatBytes(usage)}${quota ? html` <span class="muted">من ${formatBytes(quota)}</span>` : ''}</dd>
              <dt>حماية من الحذف التلقائي</dt><dd>${persisted ? html`<span class="badge badge--success">مفعّلة</span>` : html`<span class="badge badge--warning">غير مضمونة</span>`}</dd>
            </dl>
            ${persisted ? '' : html`<p class="muted text-sm" style="margin-block-start: var(--sp-3)">ثبّت البرنامج من زر «تثبيت» في شريط عنوان المتصفح ليصبح التخزين دائمًا.</p>`}
            ${canBackup ? html`
              <hr>
              <label class="field"><span class="field__label">ذكّرني بالنسخ الاحتياطي كل</span>
                <select class="select" id="remind-days">
                  ${[1, 3, 7, 14, 30].map((d) => html`<option value="${d}" ${d === (getSettings('app').backupReminderDays || 7) ? 'selected' : ''}>${arabicCount(d, DAYS)}</option>`)}
                </select>
              </label>` : ''}
          </div>
        </aside>
        <section class="card span-12">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico('upload', { size: 20 })} استرجاع نسخة احتياطية</h2>
            <p class="card__subtitle">يستبدل كل البيانات الحالية على هذا الجهاز ببيانات الملف</p>
          </div></div>
          <div class="card__body stack">
            ${admin ? html`
              <div class="alert alert--warning">${ico('triangle-alert')}<div class="alert__content"><div class="alert__body">الاسترجاع يمسح كل ما على هذا الجهاز الآن ويضع مكانه محتوى الملف. سيتم تنزيل نسخة من البيانات الحالية تلقائيًا قبل الاسترجاع للأمان. دمج بيانات جهازين يأتي في مرحلة لاحقة.</div></div></div>
              <label class="btn" style="align-self:flex-start">${ico('upload')} اختيار ملف النسخة (.json)
                <input type="file" accept="application/json,.json" id="restore-file" class="visually-hidden">
              </label>`
              : html`<p class="muted">الاسترجاع متاح لمدير النظام فقط.</p>`}
          </div>
        </section>
      </div>`);
  };

  on(body, 'click', '[data-export]', async (_, btn) => {
    btn.setAttribute('aria-busy', 'true');
    try {
      const { filename, size } = await exportBackup();
      toastSuccess(`تم تنزيل ${filename} (${formatBytes(size)})`);
      await draw();
    } catch (err) {
      console.error(err);
      toastError('تعذّر إنشاء النسخة الاحتياطية');
      btn.removeAttribute('aria-busy');
    }
  }, { signal });

  body.addEventListener('change', async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.id === 'remind-days') {
      await updateSettings('app', { backupReminderDays: Number(t.value) });
      toastSuccess('تم حفظ موعد التذكير');
      return;
    }
    if (t.id !== 'restore-file') return;
    const file = t.files?.[0];
    t.value = '';
    if (!file) return;
    let parsed;
    try { parsed = await readBackupFile(file); } catch (err) { toastError(err.message); return; }
    await confirmRestore(parsed, file);
  }, { signal });

  await draw();
}

async function confirmRestore({ backup, preview }, file) {
  const c = preview.counts;
  const go = await openModal({
    title: 'مراجعة النسخة قبل الاسترجاع',
    icon: 'database',
    size: 'lg',
    body: html`
      <div class="stack">
        <dl class="dl">
          <dt>الملف</dt><dd class="ltr">${file.name}</dd>
          <dt>العيادة</dt><dd>${preview.clinic || '—'}</dd>
          <dt>تاريخ النسخة</dt><dd>${formatDateTime(preview.exportedAt)}${preview.exportedBy ? html` · ${preview.exportedBy}` : ''}</dd>
          <dt>المرضى</dt><dd>${digits(c.patients)}</dd>
          <dt>الصور والأشعة</dt><dd>${digits(c.media)}</dd>
          <dt>المستخدمون</dt><dd>${digits(c.users)}</dd>
          <dt>الإجراءات</dt><dd>${digits(c.procedures)}</dd>
          <dt>سجل العمليات</dt><dd>${digits(c.auditLog)}</dd>
        </dl>
        ${preview.older ? html`<div class="alert">${ico('info')}<div class="alert__content"><div class="alert__body">النسخة من إصدار أقدم من البرنامج، وسيتم تحديثها تلقائيًا أثناء الاسترجاع.</div></div></div>` : ''}
        <label class="check"><input type="checkbox" id="safety" checked> نزّل نسخة من البيانات الحالية قبل الاسترجاع (موصى به)</label>
      </div>`,
    actions: [{ label: 'متابعة', value: 'next', variant: 'danger' }, { label: 'إلغاء', value: null }],
    beforeClose(v, d) {
      if (v === 'next') confirmRestore.safety = /** @type {HTMLInputElement} */ (d.querySelector('#safety')).checked;
      return true;
    },
  });
  if (go !== 'next') return;

  const ok = await confirmDialog({
    title: 'استبدال كل البيانات؟',
    message: 'سيتم مسح كل البيانات الموجودة على هذا الجهاز الآن واستبدالها بالنسخة. بعد الاسترجاع ستحتاج لتسجيل الدخول بحسابات النسخة.',
    confirmLabel: 'استرجاع الآن', danger: true, requireText: 'استرجاع',
  });
  if (!ok) return;

  const busy = toast('جارٍ الاسترجاع… لا تغلق الصفحة', { duration: 0 });
  try {
    if (confirmRestore.safety) await exportBackup();
    await restoreBackup(backup);
    busy();
    await logout('logout').catch(() => {});
    toastSuccess('تم الاسترجاع بنجاح. سجّل الدخول.');
    setTimeout(() => { navigate('/login', { replace: true }); location.reload(); }, 900);
  } catch (err) {
    busy();
    console.error(err);
    toastError('فشل الاسترجاع ولم يتغير شيء في بياناتك.');
  }
}
confirmRestore.safety = true;
