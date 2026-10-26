/**
 * «استيراد من Dentolize» (Admin only): pick the Excel exports → read → review counts, the
 * money check against Dentolize and who-is-who → import. Sync then uploads it like any
 * other change. The files never leave this device.
 */
import { html, ico } from '../../core/dom.js';
import { digits, formatMoney, todayISO } from '../../core/format.js';
import { normalizeArabic } from '../../core/text.js';
import { currentUser } from '../../core/session.js';
import { openModal } from '../../components/modal.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { listUsers } from '../../services/users.js';
import { exportBackup } from '../../services/backup.js';
import {
  readDentolizeFiles, missingParts, mixedExports, planImport, importContext, applyImport, SHEET_LABELS,
} from '../../services/dentolize-import.js';

/** Names as Dentolize wrote them (doctor / created by) across all sheets. */
function dentolizeNames(sheets) {
  const names = new Set();
  for (const rows of Object.values(sheets)) for (const r of rows) for (const k of ['طبيب', 'تم الإنشاء بواسطة']) if (r[k]) names.add(String(r[k]).trim());
  return [...names].sort();
}

/** Best guess of who a Dentolize name is here. */
function guessUser(name, users, me) {
  const n = normalizeArabic(name).replace(/^(dr|د)\.?\s*/, '');
  const same = users.find((u) => [u.displayName, u.username].some((x) => x && normalizeArabic(x).replace(/^(dr|د)\.?\s*/, '') === n));
  if (same) return same.id;
  if (/^dr\b|^dr\.|^د\./i.test(name)) return users.find((u) => u.isDoctor)?.id ?? me?.id;
  return me?.id;
}

const row = (label, value, note = '') => html`<dt>${label}</dt><dd>${value}${note ? html` <span class="muted text-sm">${note}</span>` : ''}</dd>`;

/** @param {File[]} files */
export async function runDentolizeImport(files) {
  const busy = toast(html`<span data-dz-progress>جارٍ قراءة ${digits(files.length)} ملف…</span>`, { duration: 0 });
  const progress = (text) => { const el = document.querySelector('[data-dz-progress]'); if (el) el.textContent = text; };
  let read;
  try {
    read = await readDentolizeFiles(files, (d, t) => progress(`جارٍ قراءة الملفات… ${digits(d)} من ${digits(t)}`));
  } catch (err) { busy(); console.error(err); toastError('تعذّرت قراءة الملفات. تأكد أنها ملفات Excel مصدّرة من Dentolize.'); return false; }
  const { sheets, parts, unknown } = read;
  if (!Object.keys(sheets).length) { busy(); toastError('لم يُتعرف على أي ملف من Dentolize.'); return false; }

  const me = currentUser();
  const users = (await listUsers()).filter((u) => u.active !== false);
  const names = dentolizeNames(sheets);
  const chosen = Object.fromEntries(names.map((n) => [n, guessUser(n, users, me)]));
  const makeCtx = async () => {
    const byId = new Map(users.map((u) => [u.id, u]));
    const fallback = byId.get(me?.id) ?? null;
    const userFor = (name) => { const u = byId.get(chosen[name]) ?? fallback; return { id: u?.id ?? null, displayName: u?.displayName ?? (name || null) }; };
    const doctorFor = (name) => { const u = byId.get(chosen[name]); return u?.isDoctor ? u.id : users.find((x) => x.isDoctor)?.id ?? null; };
    return importContext({ userFor, doctorFor, today: todayISO() });
  };
  progress('جارٍ تجهيز المراجعة…');
  let plan = planImport(sheets, await makeCtx());
  busy();

  const r = plan.report;
  const missing = missingParts(parts);
  const mixed = mixedExports(parts);
  const mm = r.invoices.mismatches;
  const nothingNew = Object.values(plan.writes).every((w) => !w.length);
  let backupFirst = true;

  const go = await openModal({
    title: 'مراجعة الاستيراد من Dentolize',
    icon: 'database',
    size: 'lg',
    body: html`
      <div class="stack">
        ${mixed.length ? html`<div class="alert alert--danger">${ico('triangle-alert')}<div class="alert__content"><div class="alert__title">ملفات صُدّرت في أوقات مختلفة</div><div class="alert__body">
          Dentolize يرتب السجلات من الأحدث، فلو أُضيفت سجلات بين تصدير ملف وآخر تتزحزح الصفوف: بعضها يتكرر (لا مشكلة) وبعضها يضيع.
          ${mixed.map((m) => html`<div>${SHEET_LABELS[m.type]}: ${m.files.map((f, i) => html`${i ? '، ' : ''}<bdi>${f}</bdi>`)}</div>`)}
          <strong>صدّر كل ملفات هذا النوع مرة أخرى في نفس الوقت.</strong></div></div></div>` : ''}
        ${missing.length ? html`<div class="alert alert--warning">${ico('triangle-alert')}<div class="alert__content"><div class="alert__title">أجزاء ناقصة</div><div class="alert__body">
          ${missing.map((m) => html`<div>${SHEET_LABELS[m.type]}: الصفوف ${digits(m.from)} – ${digits(m.to)}</div>`)}
          يمكنك الاستيراد الآن ثم إضافة الملف الناقص لاحقًا: الاستيراد مرة ثانية لا يكرر شيئًا.</div></div></div>` : ''}
        ${unknown.length ? html`<p class="muted text-sm">ملفات لم يُتعرف عليها وتم تجاهلها: ${unknown.join('، ')}</p>` : ''}

        <dl class="dl">
          ${row('المرضى', html`<strong>${digits(r.patients.added)}</strong> جديد`, [
            r.patients.merged ? `${digits(r.patients.merged)} دُمج مع ملف موجود (نفس الموبايل والاسم)` : '',
            r.patients.nameOnly ? `${digits(r.patients.nameOnly)} بالاسم فقط` : '',
            r.patients.already ? `${digits(r.patients.already)} موجود من قبل` : '',
          ].filter(Boolean).join(' · '))}
          ${row('المواعيد', html`<strong>${digits(r.appointments.added)}</strong>`, [r.appointments.upcoming ? `منها ${digits(r.appointments.upcoming)} قادم` : '', r.appointments.already ? `${digits(r.appointments.already)} موجود/مكرر` : ''].filter(Boolean).join(' · '))}
          ${row('الفواتير', html`<strong>${digits(r.invoices.added)}</strong>`, `${digits(r.invoices.lines)} بند`)}
          ${row('المدفوعات', html`<strong>${digits(r.payments.added)}</strong>`, r.payments.voided ? `${digits(r.payments.voided)} مسترد (يُسجّل ملغى)` : '')}
          ${row('سجل العلاج', html`<strong>${digits(r.treatment.items)}</strong> علاج منتهي`, 'في خطة «سجل سابق (Dentolize)» لكل مريض')}
          ${row('المصروفات', html`<strong>${digits(r.expenses.added)}</strong>`, formatMoney(r.expenses.total))}
        </dl>

        <div class="stack-sm">
          <span class="field__label">مطابقة الحسابات مع Dentolize</span>
          <dl class="dl">
            ${row('إجمالي الفواتير', formatMoney(r.invoices.total), `Dentolize: ${formatMoney(r.invoices.dentolizeTotal)}`)}
            ${row('إجمالي المدفوعات', formatMoney(r.payments.total), r.payments.fromBalance ? `منها ${formatMoney(r.payments.fromBalance)} سداد من رصيد المريض` : '')}
            ${row('المتبقي على المرضى', formatMoney(r.invoices.remaining), `Dentolize: ${formatMoney(r.invoices.dentolizeRemaining)}`)}
          </dl>
          ${mm.length ? html`<p class="muted text-sm">فواتير يختلف متبقيها عن Dentolize (غالبًا دفعة مكررة مسجلة هناك): ${mm.map((m) => `#${m.dz}`).join('، ')}</p>` : html`<p class="text-sm">${ico('check', { size: 14 })} كل الفواتير مطابقة.</p>`}
          ${r.patients.badPhones ? html`<p class="muted text-sm">${digits(r.patients.badPhones)} رقم موبايل غير مكتمل في Dentolize — تم نقله كما هو.</p>` : ''}
          ${r.income.count ? html`<p class="muted text-sm">«الدخل» (${digits(r.income.count)} سجل، ${formatMoney(r.income.total)}) لا يُستورد: لا يوجد قسم إيرادات أخرى في البرنامج.</p>` : ''}
        </div>

        ${names.length ? html`<div class="stack-sm">
          <span class="field__label">من هم في البرنامج؟</span>
          <p class="muted text-sm" style="margin:0">لربط المواعيد بالطبيب، ومعرفة من سجّل الفواتير والمدفوعات.</p>
          ${names.map((n) => html`<label class="row row--between" style="gap: var(--sp-3)">
            <span class="ltr">${n}</span>
            <select class="select" style="max-inline-size: 240px" data-dz-user="${n}">
              ${users.map((u) => html`<option value="${u.id}" ${chosen[n] === u.id ? 'selected' : ''}>${u.displayName}</option>`)}
            </select>
          </label>`)}
        </div>` : ''}

        <label class="check"><input type="checkbox" id="dz-backup" checked> نزّل نسخة احتياطية من البيانات الحالية أولًا (موصى به)</label>
        <p class="muted text-sm">${ico('cloud', { size: 14 })} بعد الاستيراد تُرفع البيانات للسحابة تلقائيًا على دفعات. اترك البرنامج مفتوحًا على هذا الجهاز حتى تظهر «لا توجد تغييرات بانتظار الرفع» في حالة النظام.</p>
      </div>`,
    actions: nothingNew ? [{ label: 'إغلاق', value: null }] : [{ label: 'استيراد', value: 'go', variant: 'primary' }, { label: 'إلغاء', value: null }],
    beforeClose(v, d) {
      if (v !== 'go') return true;
      backupFirst = /** @type {HTMLInputElement} */ (d.querySelector('#dz-backup')).checked;
      for (const s of d.querySelectorAll('[data-dz-user]')) chosen[s.getAttribute('data-dz-user')] = /** @type {HTMLSelectElement} */ (s).value;
      return true;
    },
  });
  if (go !== 'go') return false;

  const work = toast(html`<span data-dz-progress>جارٍ الاستيراد… لا تغلق الصفحة</span>`, { duration: 0 });
  try {
    if (backupFirst) { progress('جارٍ تنزيل نسخة احتياطية…'); await exportBackup(); }
    progress('جارٍ التجهيز…');
    plan = planImport(sheets, await makeCtx()); // with the people chosen above
    await applyImport(plan, (d, t) => progress(`جارٍ الحفظ… ${digits(Math.round((d / t) * 100))}%`));
    work();
    const rr = plan.report;
    toastSuccess(`تم الاستيراد: ${digits(rr.patients.added)} مريض، ${digits(rr.appointments.added)} موعد، ${digits(rr.invoices.added)} فاتورة، ${digits(rr.payments.added)} دفعة`, { duration: 10000 });
    return true;
  } catch (err) {
    work();
    console.error(err);
    toastError(`توقف الاستيراد: ${err.message}. يمكنك إعادة المحاولة: لن يتكرر ما تم حفظه.`);
    return false;
  }
}
