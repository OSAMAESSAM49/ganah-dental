/**
 * Living style guide: every component in every state, plus the theme and digit settings.
 * Used to review the design system and its components.
 */
import { html, ico, on, render, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, formatDate, formatTime, formatAge, formatPercent, digits, setDigitStyle, getDigitStyle, toPiasters } from '../../core/format.js';
import { getTheme, setTheme, THEME_LABELS } from '../../core/theme.js';
import { validate, phone, required, toWhatsAppNumber } from '../../core/validate.js';
import { updateSettings } from '../../data/settings.js';
import { textField, selectField, textareaField, segmentedField } from '../../components/form.js';
import { emptyState, loadingState } from '../../components/states.js';
import { mountTable } from '../../components/table.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast, toastSuccess, toastError, toastWarning } from '../../components/toast.js';
import { brandMark } from '../../components/brand.js';

const SWATCHES = [
  ['بنفسجي أساسي', '#4A0CD3'], ['بنفسجي ثانوي', '#7D39EB'], ['ليموني', '#C6FF33'],
  ['أسود', '#000000'], ['أبيض', '#FFFFFF'], ['نجاح', 'var(--c-success)'],
  ['تحذير', 'var(--c-warning)'], ['خطر', 'var(--c-danger)'], ['معلومة', 'var(--c-info)'],
];

/** Illustrative rows only — not real patients. */
const DEMO_ROWS = [
  { file: 'G-00012', name: 'مريم عبد الرحمن', phone: '01012345678', last: '2026-10-19', balance: 150000, status: 'done' },
  { file: 'G-00007', name: 'أحمد السيد', phone: '01122334455', last: '2026-10-21', balance: 0, status: 'waiting' },
  { file: 'G-00031', name: 'سارة محمود', phone: '01234567890', last: '2026-09-30', balance: 42500, status: 'chair' },
  { file: 'G-00004', name: 'يوسف إبراهيم', phone: '01555666777', last: '2026-08-14', balance: 0, status: 'noshow' },
];
const STATUS = {
  waiting: ['في الانتظار', 'warning'], chair: ['على الكرسي', 'primary'],
  done: ['انتهى', 'success'], noshow: ['لم يحضر', 'danger'],
};

const section = (title, body, sub) => html`
  <section class="section">
    <div class="section__title"><h2>${title}</h2>${sub ? html`<p class="muted text-sm">${sub}</p>` : ''}</div>
    ${body}
  </section>`;

export default {
  title: 'دليل التصميم',
  async render({ el, signal }) {
    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">دليل التصميم</h1>
          <p class="page-header__sub">كل مكوّنات الواجهة في مكان واحد — للمراجعة قبل بناء الشاشات</p>
        </div>
        <div class="page-header__actions">${brandMark({ size: 52 })}${brandMark({ size: 52, variant: 'white' })}${brandMark({ size: 52, variant: 'lime' })}</div>
      </header>

      ${section('المظهر والأرقام', html`
        <div class="card"><div class="card__body row" style="gap: var(--sp-8); align-items: flex-start">
          <form id="sg-prefs" class="row" style="gap: var(--sp-8); align-items: flex-start">
            ${segmentedField({ name: 'theme', label: 'المظهر', value: getTheme(), options: [
              { value: 'auto', label: THEME_LABELS.auto, icon: ico('monitor', { size: 18 }) },
              { value: 'light', label: THEME_LABELS.light, icon: ico('sun', { size: 18 }) },
              { value: 'dark', label: THEME_LABELS.dark, icon: ico('moon', { size: 18 }) },
            ] })}
            ${segmentedField({ name: 'digits', label: 'شكل الأرقام', value: getDigitStyle(), options: [
              { value: 'western', label: 'غربية 123' }, { value: 'arabic', label: 'عربية ١٢٣' },
            ] })}
          </form>
          <dl class="dl" id="sg-formats"></dl>
        </div></div>`)}

      ${section('الألوان', html`
        <div class="grid grid--4">${SWATCHES.map(([name, c]) => html`
          <div class="swatch"><div class="swatch__chip" style="background:${c}"></div><span class="swatch__name">${name}</span><span class="swatch__hex">${c.startsWith('#') ? c : ''}</span></div>`)}
        </div>`, 'الليموني يُستخدم دائمًا خلف نص أسود فقط — لا يُقرأ على الأبيض.')}

      ${section('الخطوط', html`
        <div class="card"><div class="card__body stack">
          <p class="page-header__title">عنوان الصفحة الرئيسي</p>
          <h2>عنوان قسم</h2>
          <h3>عنوان بطاقة</h3>
          <p>نص أساسي بحجم كبير وواضح لموظفي الاستقبال: تم حجز موعد المريض يوم ${formatDate('2026-10-22')} الساعة ${formatTime('2026-10-22T17:30:00')}.</p>
          <p class="muted">نص ثانوي للشرح والتلميحات.</p>
          <p class="text-sm subtle">الخط: ثمانية (إن كان مثبتًا على الجهاز) ثم IBM Plex Sans Arabic.</p>
        </div></div>`)}

      ${section('الأزرار', html`
        <div class="card"><div class="card__body stack">
          <div class="row">
            <button class="btn btn--primary">${ico('plus')} موعد جديد</button>
            <button class="btn btn--dark">${ico('calendar-check')} حجز</button>
            <button class="btn btn--accent">${ico('check')} تم الدفع</button>
            <button class="btn">${ico('printer')} طباعة</button>
            <button class="btn btn--soft">${ico('download')} تصدير Excel</button>
            <button class="btn btn--ghost">إلغاء</button>
            <button class="btn btn--danger">${ico('trash-2')} حذف</button>
            <button class="btn btn--whatsapp">${ico('message-circle')} واتساب</button>
          </div>
          <div class="row">
            <button class="btn btn--primary btn--sm">صغير</button>
            <button class="btn btn--primary" aria-busy="true"><span>جارٍ الحفظ</span></button>
            <button class="btn btn--primary" disabled>معطّل</button>
            <button class="btn btn--icon" aria-label="تعديل">${ico('pencil')}</button>
            <a class="round-btn" href="#/styleguide" aria-label="فتح">${ico('arrow-up-left', { size: 18 })}</a>
            <a class="round-btn round-btn--dark" href="#/styleguide" aria-label="فتح">${ico('arrow-up-left', { size: 18 })}</a>
            <button class="icon-btn" aria-label="تنبيهات">${ico('bell')}<span class="icon-btn__badge"></span></button>
          </div>
          <div class="chips" role="group" aria-label="مثال تصفية">
            <button class="chip" aria-pressed="true" data-chip>كل الفواتير <span class="chip__count">${digits(12)}</span></button>
            <button class="chip" aria-pressed="false" data-chip>غير مدفوعة <span class="chip__count">${digits(5)}</span></button>
            <button class="chip" aria-pressed="false" data-chip>أقساط متأخرة</button>
          </div>
        </div></div>`)}

      ${section('البطاقات والمؤشرات', html`
        <div class="bento">
          <article class="card card--hero span-3"><div class="kpi">
            <div class="kpi__head"><span class="kpi__icon">${ico('banknote', { size: 22 })}</span><span class="kpi__label">إيراد الشهر</span>
              <a class="round-btn round-btn--on-hero" href="#/styleguide" aria-label="التفاصيل">${ico('arrow-up-left', { size: 18 })}</a></div>
            <div class="kpi__value">${formatMoney(8450000, { currency: false })}<small>ج.م</small></div>
            <div class="kpi__foot"><span class="delta delta--up">${ico('trending-up', { size: 14 })} ${formatPercent(12.4)}</span><span class="kpi__meta">مقارنة بالشهر الماضي</span></div>
          </div></article>
          <article class="card span-3"><div class="kpi">
            <div class="kpi__head"><span class="kpi__icon kpi__icon--lime">${ico('calendar-check', { size: 22 })}</span><span class="kpi__label">مواعيد اليوم</span></div>
            <div class="kpi__value">${digits(18)}</div>
            <div class="kpi__foot"><span class="delta delta--up">+${digits(3)}</span><span class="kpi__meta">عن أمس</span></div>
          </div></article>
          <article class="card span-3"><div class="kpi">
            <div class="kpi__head"><span class="kpi__icon kpi__icon--danger">${ico('wallet', { size: 22 })}</span><span class="kpi__label">مصروفات الشهر</span></div>
            <div class="kpi__value">${formatMoney(2130000, { currency: false })}<small>ج.م</small></div>
            <div class="kpi__foot"><span class="delta delta--down">${ico('trending-down', { size: 14 })} ${formatPercent(4.2)}</span><span class="kpi__meta">مقارنة بالشهر الماضي</span></div>
          </div></article>
          <article class="card span-3"><div class="kpi">
            <div class="kpi__head"><span class="kpi__icon kpi__icon--info">${ico('user-plus', { size: 22 })}</span><span class="kpi__label">مرضى جدد</span></div>
            <div class="kpi__value">${digits(35)}</div>
            <div class="kpi__foot"><span class="delta delta--flat">${digits(0)}%</span><span class="kpi__meta">هذا الشهر</span></div>
          </div></article>

          <article class="card span-7">
            <div class="card__header"><div class="card__heading"><h3 class="card__title">قائمة داخل بطاقة</h3><p class="card__subtitle">مثل مرضى اليوم والمتابعات</p></div>
              <a class="round-btn" href="#/styleguide" aria-label="عرض الكل">${ico('arrow-up-left', { size: 18 })}</a></div>
            <div class="card__body"><ul class="list">
              ${DEMO_ROWS.slice(0, 3).map((r) => html`
                <li class="list__item">
                  <span class="avatar">${r.name[0]}</span>
                  <div class="list__main"><span class="list__title">${r.name}</span><span class="list__meta">كشف + تنظيف جير · ${formatTime('2026-10-21T16:00:00')}</span></div>
                  <span class="badge badge--dot badge--${STATUS[r.status][1]}">${STATUS[r.status][0]}</span>
                </li>`)}
            </ul></div>
          </article>
          <article class="card card--inverse span-5">
            <div class="card__header"><div class="card__heading"><h3 class="card__title">بطاقة داكنة</h3><p class="card__subtitle">للملخصات والتنبيهات المهمة</p></div></div>
            <div class="card__body stack">
              <div class="row row--between"><span>خطة العلاج المكتملة</span><strong>${digits(19)}/${digits(31)}</strong></div>
              <div class="progress progress--lime"><div class="progress__bar" style="inline-size:61%"></div></div>
              <div class="avatar-stack"><span class="avatar avatar--lime">م</span><span class="avatar">س</span><span class="avatar">أ</span></div>
            </div>
          </article>
        </div>`)}

      ${section('الشارات والتنبيهات', html`
        <div class="stack">
          <div class="row">
            <span class="badge">محايد</span><span class="badge badge--primary">مخطط</span><span class="badge badge--accent">جديد</span>
            <span class="badge badge--dark">مسودة</span><span class="badge badge--dot badge--success">مدفوع</span>
            <span class="badge badge--dot badge--warning">جزئي</span><span class="badge badge--dot badge--danger">متأخر</span>
            <span class="badge badge--info">معمل</span>
          </div>
          <div class="alert alert--critical" role="alert">${ico('triangle-alert', { size: 24 })}
            <div class="alert__content"><div class="alert__title">تنبيه طبي حرج</div><div class="alert__body">حساسية من البنسلين · يتناول أدوية سيولة (مثال توضيحي)</div></div></div>
          <div class="alert alert--warning">${ico('triangle-alert')}<div class="alert__content"><div class="alert__title">لم تُؤخذ نسخة احتياطية منذ ${digits(9)} أيام</div><div class="alert__body">يُنصح بأخذ نسخة الآن.</div></div></div>
          <div class="alert alert--success">${ico('circle-check')}<div class="alert__content"><div class="alert__body">تم حفظ بيانات المريض.</div></div></div>
          <div class="alert">${ico('info')}<div class="alert__content"><div class="alert__body">البيانات محفوظة على هذا الجهاز فقط.</div></div></div>
        </div>`)}

      ${section('النماذج', html`
        <form class="card" id="sg-form" novalidate><div class="card__body form">
          <div class="form-grid">
            ${textField({ name: 'name', label: 'اسم المريض', required: true, placeholder: 'الاسم الرباعي' })}
            ${textField({ name: 'phone', label: 'الموبايل', required: true, ltr: true, inputmode: 'tel', placeholder: '01012345678', hint: 'يقبل الأرقام العربية والغربية' })}
            ${textField({ name: 'amount', label: 'المبلغ (ج.م)', ltr: true, inputmode: 'decimal', placeholder: '0' })}
            ${selectField({ name: 'source', label: 'كيف عرفنا؟', placeholder: 'اختر…', options: [
              { value: 'facebook', label: 'فيسبوك' }, { value: 'instagram', label: 'إنستجرام' }, { value: 'friend', label: 'صديق' }, { value: 'other', label: 'أخرى' },
            ] })}
          </div>
          ${textareaField({ name: 'notes', label: 'ملاحظات', placeholder: 'أي ملاحظات للطبيب…' })}
          <div class="row">
            <label class="check"><input type="checkbox" name="diabetes"> سكري</label>
            <label class="check"><input type="checkbox" name="pressure"> ضغط</label>
            <label class="switch"><input type="checkbox" name="reminder" checked><span class="switch__track"></span> تذكير واتساب</label>
          </div>
          <div class="form-actions">
            <button class="btn btn--primary" type="submit">${ico('save')} حفظ (تجربة التحقق)</button>
            <button class="btn btn--ghost" type="reset">مسح</button>
          </div>
        </div></form>`)}

      ${section('الجداول', html`<div id="sg-table"></div>`, 'بيانات توضيحية فقط. على الموبايل يتحول الجدول إلى بطاقات.')}

      ${section('التبويبات', html`
        <div role="tablist" class="tabs" aria-label="ملف المريض">
          ${['نظرة عامة', 'خريطة الأسنان', 'خطة العلاج', 'الزيارات', 'المدفوعات', 'الصور والأشعة'].map((t, i) =>
            html`<button role="tab" class="tab" aria-selected="${String(i === 0)}" data-tab>${t}</button>`)}
        </div>`)}

      ${section('الحالات', html`
        <div class="grid grid--3">
          <div class="card">${emptyState({ icon: 'users', title: 'لا يوجد مرضى بعد', hint: 'ابدأ بإضافة أول مريض، أو جرّب البيانات التجريبية من الإعدادات.', actions: html`<button class="btn btn--primary">${ico('user-plus')} إضافة مريض</button>` })}</div>
          <div class="card">${loadingState()}</div>
          <div class="card"><div class="card__body stack"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--text" style="inline-size:70%"></span><span class="skeleton skeleton--block"></span></div></div>
        </div>`)}

      ${section('النوافذ والإشعارات', html`
        <div class="card"><div class="card__body row">
          <button class="btn" data-demo="modal">${ico('info')} نافذة</button>
          <button class="btn btn--danger" data-demo="confirm">${ico('trash-2')} تأكيد حذف</button>
          <button class="btn btn--danger" data-demo="confirm-text">${ico('triangle-alert')} تأكيد بكتابة كلمة</button>
          <button class="btn btn--accent" data-demo="ok">${ico('circle-check')} إشعار نجاح</button>
          <button class="btn" data-demo="err">${ico('circle-x')} إشعار خطأ</button>
          <button class="btn" data-demo="warn">${ico('triangle-alert')} إشعار تحذير</button>
          <button class="btn" data-demo="undo">${ico('refresh-cw')} إشعار مع تراجع</button>
        </div></div>`)}
    `);

    // Live formatting samples (react to the digit setting)
    const drawFormats = () => render(el.querySelector('#sg-formats'), html`
      <dt>مبلغ</dt><dd>${formatMoney(125050)}</dd>
      <dt>تاريخ</dt><dd>${formatDate(new Date())}</dd>
      <dt>وقت</dt><dd>${formatTime(new Date())}</dd>
      <dt>عمر</dt><dd>${formatAge('1990-03-15')} · ${formatAge('2025-02-10')}</dd>
      <dt>نسبة</dt><dd>${formatPercent(87.86)}</dd>`);
    drawFormats();

    const table = mountTable(el.querySelector('#sg-table'), {
      signal,
      caption: 'مثال جدول المرضى',
      sort: { key: 'last', dir: 'desc' },
      columns: [
        { key: 'file', label: 'رقم الملف', sortable: true, render: (r) => html`<span class="ltr num">${digits(r.file)}</span>` },
        { key: 'name', label: 'المريض', sortable: true, render: (r) => html`<span class="cell-person"><span class="avatar">${r.name[0]}</span><span class="cell-person__text"><strong>${r.name}</strong><span class="cell-person__sub ltr">${digits(r.phone)}</span></span></span>` },
        { key: 'last', label: 'آخر زيارة', sortable: true, render: (r) => formatDate(r.last) },
        { key: 'status', label: 'الحالة', render: (r) => html`<span class="badge badge--dot badge--${STATUS[r.status][1]}">${STATUS[r.status][0]}</span>` },
        { key: 'balance', label: 'المتبقي', sortable: true, num: true, render: (r) => (r.balance ? html`<strong>${formatMoney(r.balance)}</strong>` : html`<span class="muted">${formatMoney(0)}</span>`) },
        { key: 'actions', label: 'إجراءات', render: (r) => html`<div class="table__actions">
            <a class="btn btn--whatsapp btn--icon btn--sm" href="https://wa.me/${toWhatsAppNumber(r.phone)}" target="_blank" rel="noopener" aria-label="واتساب ${r.name}">${ico('message-circle', { size: 18 })}</a>
            <button class="btn btn--icon btn--sm" aria-label="تعديل ${r.name}">${ico('pencil', { size: 18 })}</button></div>` },
      ],
      rows: DEMO_ROWS,
    });

    on(el, 'change', '#sg-prefs input', async (_, input) => {
      if (input.name === 'theme') setTheme(input.value);
      if (input.name === 'digits') {
        setDigitStyle(input.value);
        await updateSettings('app', { digitStyle: input.value });
        drawFormats();
        table.update([...DEMO_ROWS]);
        toastSuccess('تم تغيير شكل الأرقام');
      }
    }, { signal });

    on(el, 'click', '[data-chip]', (_, chip) => {
      chip.parentElement.querySelectorAll('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    }, { signal });

    on(el, 'click', '[data-tab]', (_, tab) => {
      tab.parentElement.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    }, { signal });

    on(el, 'keydown', '[role="tablist"]', (e, list) => {
      const k = /** @type {KeyboardEvent} */ (e).key;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const i = tabs.indexOf(document.activeElement);
      // RTL: ArrowLeft moves forward
      const next = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : (i + (k === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
      e.preventDefault();
    }, { signal });

    const form = /** @type {HTMLFormElement} */ (el.querySelector('#sg-form'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = formData(form);
      const errors = validate(data, {
        name: (v) => required(v, 'اسم المريض'),
        phone: (v) => phone(v, { required: true, mobileOnly: true }),
        amount: (v) => (v && Number.isNaN(toPiasters(v)) ? 'أدخل مبلغًا صحيحًا' : ''),
      });
      if (showFieldErrors(form, errors)) toastSuccess(`البيانات صحيحة${data.amount ? ` · المبلغ ${formatMoney(toPiasters(data.amount))}` : ''}`);
      else toastError('راجع الحقول المظللة بالأحمر');
    }, { signal });
    form.addEventListener('reset', () => setTimeout(() => showFieldErrors(form, {}), 0), { signal });

    on(el, 'click', '[data-demo]', async (_, btn) => {
      switch (btn.dataset.demo) {
        case 'modal':
          await openModal({ title: 'نافذة توضيحية', icon: 'info', body: 'النوافذ تُغلق بزر Esc أو بالضغط خارجها، والتركيز يبقى داخلها.', actions: [{ label: 'تمام', value: true, variant: 'primary' }] });
          break;
        case 'confirm': {
          const ok = await confirmDialog({ title: 'حذف الموعد؟', message: 'سيتم حذف موعد أحمد السيد يوم الخميس. يمكن استعادته من سلة المحذوفات.', confirmLabel: 'حذف', danger: true });
          ok ? toastSuccess('تم الحذف (تجربة)') : toast('تم الإلغاء');
          break;
        }
        case 'confirm-text': {
          const ok = await confirmDialog({ title: 'مسح كل البيانات؟', message: 'هذا الإجراء لا يمكن التراجع عنه. خذ نسخة احتياطية أولًا.', confirmLabel: 'مسح نهائي', danger: true, requireText: 'مسح' });
          ok ? toastSuccess('تم التأكيد (تجربة — لم يُحذف شيء)') : toast('تم الإلغاء');
          break;
        }
        case 'ok': toastSuccess('تم حفظ الدفعة بنجاح'); break;
        case 'err': toastError('تعذّر الحفظ: رقم الموبايل غير صحيح'); break;
        case 'warn': toastWarning('الكمية في المخزون أقل من الحد الأدنى'); break;
        case 'undo': toast('تم نقل المريض إلى سلة المحذوفات', { action: { label: 'تراجع', onClick: () => toastSuccess('تمت الاستعادة') } }); break;
      }
    }, { signal });
  },
};
