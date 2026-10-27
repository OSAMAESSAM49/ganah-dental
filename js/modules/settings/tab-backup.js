/**
 * Backup (download a .zip with data + images), restore (replace all data, Admin only),
 * merge-import from another device (Admin only), and demo data.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { formatDateTime, formatBytes, digits, arabicCount } from '../../core/format.js';
import { can, isAdmin } from '../../core/permissions.js';
import { navigate } from '../../core/router.js';
import { getSettings, updateSettings } from '../../data/settings.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { ENTITY_LABELS } from '../../core/labels.js';
import { exportBackup, readBackupFile, restoreBackup, prepareMerge, applyMerge, backupStatus } from '../../services/backup.js';
import { logout } from '../../services/auth.js';
import { demoStatus, createDemoData, removeDemoData } from '../../services/demo.js';

const DAYS = { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يومًا' };
const ACCEPT = '.zip,.json,application/zip,application/json';

export async function renderTab({ body, signal }) {
  const canBackup = can('settings', 'edit');
  const admin = isAdmin();

  const draw = async () => {
    const s = await backupStatus();
    const demo = admin ? await demoStatus() : null;
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
            <p>ملف مضغوط واحد (.zip) فيه كل بيانات البرنامج: المرضى، والصور والأشعة، والحسابات، والمستخدمين، والإعدادات. احفظه خارج هذا الجهاز (فلاشة، أو Google Drive، أو بريدك).</p>
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
        <section class="card span-6">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico('refresh-cw', { size: 20 })} دمج بيانات جهاز آخر</h2>
            <p class="card__subtitle">يضيف بيانات نسخة من جهاز آخر إلى بيانات هذا الجهاز</p>
          </div></div>
          <div class="card__body stack">
            ${admin ? html`
              <p class="text-sm">مثال: جهاز الاستقبال وجهاز الطبيب. خذ نسخة من الجهاز الآخر ثم ادمجها هنا. السجل الموجود على الجهازين يبقى منه الأحدث تعديلًا، والسجلات الجديدة تُضاف، ورقم الملف أو الفاتورة المكرر يُعطى رقمًا جديدًا. حسابات المستخدمين وإعدادات هذا الجهاز لا تتغير.</p>
              <label class="btn" style="align-self:flex-start">${ico('upload')} اختيار نسخة للدمج
                <input type="file" accept="${ACCEPT}" id="merge-file" class="visually-hidden">
              </label>`
              : html`<p class="muted">الدمج متاح لمدير النظام فقط.</p>`}
          </div>
        </section>
        <section class="card span-6">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico('upload', { size: 20 })} استرجاع نسخة احتياطية</h2>
            <p class="card__subtitle">يستبدل كل البيانات الحالية على هذا الجهاز ببيانات الملف</p>
          </div></div>
          <div class="card__body stack">
            ${admin ? html`
              <div class="alert alert--warning">${ico('triangle-alert')}<div class="alert__content"><div class="alert__body">الاسترجاع يمسح كل ما على هذا الجهاز الآن ويضع مكانه محتوى الملف. يُنزَّل قبله نسخة من البيانات الحالية للأمان.</div></div></div>
              <label class="btn" style="align-self:flex-start">${ico('upload')} اختيار ملف النسخة (.zip أو .json)
                <input type="file" accept="${ACCEPT}" id="restore-file" class="visually-hidden">
              </label>`
              : html`<p class="muted">الاسترجاع متاح لمدير النظام فقط.</p>`}
          </div>
        </section>
        ${admin ? html`<section class="card span-12">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico('file-spreadsheet', { size: 20 })} تصدير بيانات كل المرضى</h2>
            <p class="card__subtitle">ملف واحد فيه كل ما سُجّل عن كل مريض، للاحتفاظ به للظروف (لمدير النظام فقط)</p>
          </div></div>
          <div class="card__body stack">
            <p>يشمل: بيانات المريض والتاريخ الطبي، والمواعيد بكل تفاصيلها وملاحظات الطبيب، والعلاجات وخطط العلاج، والفواتير والمدفوعات والأرصدة، والروشتات والمتابعات وحالات المعمل.</p>
            <ul class="stack-sm" style="margin:0; padding-inline-start: var(--sp-5)">
              <li><strong>Excel:</strong> ورقة لكل نوع (المرضى، المواعيد، العلاجات، الفواتير…)، وفي كل صف رقم الملف واسم المريض للبحث والتصفية.</li>
              <li><strong>PDF:</strong> صفحة أو أكثر لكل مريض فيها كل بياناته. تفتح نافذة الطباعة، فاختر «حفظ بتنسيق PDF».</li>
            </ul>
            <label class="check"><input type="checkbox" id="arch-deleted"> تضمين المرضى المحذوفين</label>
            <div class="row">
              <button type="button" class="btn btn--primary" data-arch="xlsx">${ico('file-spreadsheet')} تنزيل Excel</button>
              <button type="button" class="btn" data-arch="pdf">${ico('printer')} PDF / طباعة</button>
            </div>
            <p class="muted text-sm">${ico('lock', { size: 14 })} الملف فيه بيانات طبية ومالية سرية: احفظه في مكان آمن ولا ترسله لأحد. كل تصدير يُسجَّل في سجل العمليات.</p>
          </div>
        </section>` : ''}
        ${admin ? html`<section class="card span-12">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico('upload', { size: 20 })} استيراد من Dentolize</h2>
            <p class="card__subtitle">نقل المرضى والمواعيد والفواتير والمدفوعات والمصروفات من البرنامج القديم (لمدير النظام فقط)</p>
          </div></div>
          <div class="card__body stack">
            <ol class="stack-sm" style="margin:0; padding-inline-start: var(--sp-5)">
              <li>من Dentolize صدّر كل ملفات Excel (المرضى، المواعيد، الفواتير، المدفوعات، المصروفات) <strong>في نفس الوقت</strong>، ويُفضّل بعد آخر يوم عمل عليه.</li>
              <li>اختر كل الملفات مرة واحدة. ستظهر مراجعة بالأعداد ومطابقة الحسابات قبل أي حفظ.</li>
              <li>الاستيراد مرة ثانية آمن: ما تم نقله من قبل لا يتكرر.</li>
            </ol>
            <label class="btn btn--primary" style="align-self: flex-start">${ico('file-spreadsheet')} اختيار ملفات Dentolize
              <input type="file" id="dz-files" accept=".xlsx" multiple hidden>
            </label>
            <p class="muted text-sm">${ico('lock', { size: 14 })} الملفات تُقرأ على هذا الجهاز فقط ولا تُرفع لأي مكان غير قاعدة بيانات العيادة.</p>
          </div>
        </section>` : ''}
        ${admin ? html`<section class="card span-12">
          <div class="card__header"><div class="card__heading">
            <h2 class="card__title">${ico('sparkles', { size: 20 })} بيانات تجريبية</h2>
            <p class="card__subtitle">لتجربة البرنامج وتدريب الفريق قبل إدخال المرضى الحقيقيين</p>
          </div></div>
          <div class="card__body stack">
            ${demo.patients ? html`
              <p>يوجد الآن ${digits(demo.patients)} مريض تجريبي (عليهم شارة «بيانات تجريبية»). حذفها يزيل كل ما يخصهم: المواعيد والخطط والفواتير والمدفوعات والمتابعات والروشتات، ومصروفات وخامات التجربة، ويعيد ترقيم الملفات والفواتير ليبدأ بعد آخر رقم حقيقي.</p>
              <button type="button" class="btn btn--danger" data-demo-remove style="align-self:flex-start">${ico('trash-2')} حذف البيانات التجريبية</button>`
              : html`
              <p>يضيف ٣٦ مريضًا وهميًا بمواعيد وخطط علاج وفواتير ومدفوعات ومصروفات ومتابعات على مدار الأشهر الستة الماضية، لترى الصفحة الرئيسية والتقارير وهي ممتلئة. كل ما يُضاف يحمل علامة «تجريبي» ويمكن حذفه بالكامل بضغطة.</p>
              <button type="button" class="btn" data-demo-add style="align-self:flex-start">${ico('sparkles')} إضافة بيانات تجريبية</button>`}
          </div>
        </section>` : ''}
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

  on(body, 'click', '[data-arch]', async (_, btn) => {
    const includeDeleted = /** @type {HTMLInputElement} */ (body.querySelector('#arch-deleted')).checked;
    btn.setAttribute('aria-busy', 'true');
    const busy = toast('جارٍ تجهيز بيانات كل المرضى…', { duration: 0 });
    try {
      const { exportArchiveExcel, printArchive } = await import('./archive-export.js');
      const n = btn.dataset.arch === 'xlsx' ? await exportArchiveExcel({ includeDeleted }) : await printArchive({ includeDeleted });
      busy();
      toastSuccess(btn.dataset.arch === 'xlsx' ? `تم تنزيل ملف Excel لـ ${digits(n)} مريض` : `جاهز للطباعة: ${digits(n)} مريض — اختر «حفظ بتنسيق PDF»`);
    } catch (err) { busy(); console.error(err); toastError(err.message || 'تعذّر التصدير'); }
    finally { btn.removeAttribute('aria-busy'); }
  }, { signal });

  on(body, 'click', '[data-demo-add]', async (_, btn) => {
    if (!(await confirmDialog({ title: 'إضافة بيانات تجريبية؟', message: 'ستظهر في كل الصفحات والتقارير مع شارة «بيانات تجريبية». احذفها قبل البدء بالعمل الحقيقي.', confirmLabel: 'إضافة' }))) return;
    btn.setAttribute('aria-busy', 'true');
    const busy = toast('جارٍ إنشاء البيانات التجريبية…', { duration: 0 });
    try { const n = await createDemoData(); toastSuccess(`تمت إضافة ${digits(n)} مريض تجريبي`); } catch (err) { console.error(err); toastError(err.message); }
    busy();
    await draw();
  }, { signal });

  on(body, 'click', '[data-demo-remove]', async (_, btn) => {
    if (!(await confirmDialog({ title: 'حذف كل البيانات التجريبية؟', message: 'لن تتأثر بيانات المرضى الحقيقيين.', confirmLabel: 'حذف', danger: true }))) return;
    btn.setAttribute('aria-busy', 'true');
    try { await removeDemoData(); toastSuccess('تم حذف البيانات التجريبية'); } catch (err) { console.error(err); toastError(err.message); }
    await draw();
  }, { signal });

  body.addEventListener('change', async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.id === 'remind-days') {
      await updateSettings('app', { backupReminderDays: Number(t.value) });
      toastSuccess('تم حفظ موعد التذكير');
      return;
    }
    if (t.id === 'dz-files') {
      const files = [...(t.files ?? [])];
      t.value = '';
      if (!files.length) return;
      const { runDentolizeImport } = await import('./dentolize-import.js');
      if (await runDentolizeImport(files)) await draw();
      return;
    }
    if (t.id !== 'restore-file' && t.id !== 'merge-file') return;
    const file = t.files?.[0];
    t.value = '';
    if (!file) return;
    let parsed;
    try { parsed = await readBackupFile(file); } catch (err) { toastError(err.message); return; }
    if (t.id === 'restore-file') await confirmRestore(parsed, file);
    else if (await confirmMerge(parsed, file)) await draw();
  }, { signal });

  await draw();
}

const previewList = (preview, file) => html`
  <dl class="dl">
    <dt>الملف</dt><dd class="ltr">${file.name} <span class="muted">(${formatBytes(file.size)})</span></dd>
    <dt>العيادة</dt><dd>${preview.clinic || '—'}</dd>
    <dt>تاريخ النسخة</dt><dd>${formatDateTime(preview.exportedAt)}${preview.exportedBy ? html` · ${preview.exportedBy}` : ''}</dd>
    <dt>المرضى</dt><dd>${digits(preview.counts.patients)}</dd>
    <dt>المواعيد</dt><dd>${digits(preview.counts.appointments)}</dd>
    <dt>الفواتير</dt><dd>${digits(preview.counts.invoices)}</dd>
    <dt>الصور والأشعة</dt><dd>${digits(preview.counts.media)}</dd>
    <dt>المستخدمون</dt><dd>${digits(preview.counts.users)}</dd>
  </dl>`;

async function confirmRestore(parsed, file) {
  const { preview } = parsed;
  let safety = true;
  const go = await openModal({
    title: 'مراجعة النسخة قبل الاسترجاع',
    icon: 'database',
    size: 'lg',
    body: html`
      <div class="stack">
        ${previewList(preview, file)}
        ${preview.older ? html`<div class="alert">${ico('info')}<div class="alert__content"><div class="alert__body">النسخة من إصدار أقدم من البرنامج، وسيتم تحديثها تلقائيًا أثناء الاسترجاع.</div></div></div>` : ''}
        <label class="check"><input type="checkbox" id="safety" checked> نزّل نسخة من البيانات الحالية قبل الاسترجاع (موصى به)</label>
      </div>`,
    actions: [{ label: 'متابعة', value: 'next', variant: 'danger' }, { label: 'إغلاق', value: null }],
    beforeClose(v, d) {
      if (v === 'next') safety = /** @type {HTMLInputElement} */ (d.querySelector('#safety')).checked;
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
    if (safety) await exportBackup();
    await restoreBackup(parsed);
    busy();
    await logout('logout').catch(() => {});
    toastSuccess('تم الاسترجاع بنجاح. سجّل الدخول.');
    setTimeout(() => { navigate('/login', { replace: true }); location.reload(); }, 900);
  } catch (err) {
    busy();
    console.error(err);
    toastError(err.message?.startsWith('الملف') ? err.message : 'فشل الاسترجاع ولم يتغير شيء في بياناتك.');
  }
}

/** @returns {Promise<boolean>} merged */
async function confirmMerge(parsed, file) {
  let prepared;
  try { prepared = await prepareMerge(parsed); } catch (err) { toastError(err.message); return false; }
  const rows = Object.entries(prepared.plan.summary).filter(([, s]) => s.added || s.updated || s.renumbered)
    .sort(([, a], [, b]) => (b.added + b.updated) - (a.added + a.updated));
  let safety = true;
  const go = await openModal({
    title: 'مراجعة الدمج',
    icon: 'refresh-cw',
    size: 'lg',
    body: html`
      <div class="stack">
        ${previewList(parsed.preview, file)}
        ${rows.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>البيانات</th><th class="num">جديد</th><th class="num">تحديث</th><th class="num">رقم جديد</th></tr></thead>
          <tbody>${rows.map(([store, s]) => html`<tr><td>${ENTITY_LABELS[store] ?? store}</td><td class="num">${digits(s.added)}</td><td class="num">${digits(s.updated)}</td><td class="num">${s.renumbered ? digits(s.renumbered) : '—'}</td></tr>`)}</tbody>
        </table></div>` : html`<p class="muted">لا يوجد في النسخة شيء جديد أو أحدث مما على هذا الجهاز.</p>`}
        <label class="check"><input type="checkbox" id="safety" checked> نزّل نسخة من البيانات الحالية قبل الدمج (موصى به)</label>
      </div>`,
    actions: rows.length ? [{ label: 'دمج الآن', value: 'go', variant: 'primary' }, { label: 'إغلاق', value: null }] : [{ label: 'إغلاق', value: null }],
    beforeClose(v, d) {
      if (v === 'go') safety = /** @type {HTMLInputElement} */ (d.querySelector('#safety')).checked;
      return true;
    },
  });
  if (go !== 'go') return false;
  const busy = toast('جارٍ الدمج… لا تغلق الصفحة', { duration: 0 });
  try {
    if (safety) await exportBackup();
    await applyMerge(prepared);
    busy();
    toastSuccess('تم دمج البيانات');
    return true;
  } catch (err) {
    busy();
    console.error(err);
    toastError('فشل الدمج ولم يتغير شيء في بياناتك.');
    return false;
  }
}
