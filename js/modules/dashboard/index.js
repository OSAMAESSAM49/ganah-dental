/**
 * Dashboard. Phase 1: layout skeleton in the final visual style + system status.
 * Real KPIs, today's appointments, charts and alerts arrive in phase 9.
 */
import { html, ico, render } from '../../core/dom.js';
import { formatBytes, formatDate, formatMoney, formatPercent, digits } from '../../core/format.js';
import { getAdapter } from '../../data/index.js';
import { getSettings } from '../../data/settings.js';
import { emptyState } from '../../components/states.js';
import { can } from '../../core/permissions.js';
import { currentUser } from '../../core/session.js';

const BUILD_PHASE = 1;
const TOTAL_PHASES = 10;

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'نهارك سعيد';
  return 'مساء الخير';
}

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

async function systemStatus() {
  const storage = navigator.storage;
  const persisted = (await storage?.persisted?.()) ?? false;
  const { usage, quota } = (await storage?.estimate?.()) ?? {};
  return {
    dbVersion: getAdapter().version,
    persisted,
    usage, quota,
    offline: !!navigator.serviceWorker?.controller,
  };
}

const kpi = ({ icon, tone = '', label, value, meta }) => html`
  <article class="card span-3">
    <div class="kpi">
      <div class="kpi__head">
        <span class="kpi__icon ${tone ? `kpi__icon--${tone}` : ''}">${ico(icon, { size: 22 })}</span>
        <span class="kpi__label">${label}</span>
      </div>
      <div class="kpi__value">${value}</div>
      <div class="kpi__foot"><span class="kpi__meta">${meta}</span></div>
    </div>
  </article>`;

export default {
  title: 'الرئيسية',
  async render({ el }) {
    const clinic = getSettings('clinic');
    const today = new Date();
    const s = await systemStatus();
    const pct = Math.round((BUILD_PHASE / TOTAL_PHASES) * 100);

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">${greeting(today)}، ${currentUser()?.displayName ?? ""} 👋</h1>
          <p class="page-header__sub">${WEEKDAYS[today.getDay()]} ${formatDate(today)} · ${clinic.name}</p>
        </div>
        <div class="page-header__actions">
          <a class="btn btn--dark" href="#/appointments">${ico('plus')} موعد جديد</a>
          <a class="btn" href="#/patients">${ico('user-plus')} مريض جديد</a>
        </div>
      </header>

      <div class="bento">
        <article class="card card--hero span-3">
          <div class="kpi">
            <div class="kpi__head">
              <span class="kpi__icon">${ico('calendar-check', { size: 22 })}</span>
              <span class="kpi__label">مواعيد اليوم</span>
              <a class="round-btn round-btn--on-hero" href="#/appointments" aria-label="فتح المواعيد">${ico('arrow-up-left', { size: 18 })}</a>
            </div>
            <div class="kpi__value">${digits(0)}</div>
            <div class="kpi__foot"><span class="delta delta--up">${digits('+0')}</span><span class="kpi__meta">تظهر بعد إضافة المواعيد</span></div>
          </div>
        </article>
        ${can('billing') && kpi({ icon: 'banknote', tone: 'lime', label: 'إيراد اليوم', value: html`${formatMoney(0, { currency: false })}<small>ج.م</small>`, meta: 'من المدفوعات المسجلة اليوم' })}
        ${can('patients') && kpi({ icon: 'user-round', tone: 'info', label: 'مرضى جدد هذا الشهر', value: digits(0), meta: 'من ملفات المرضى' })}
        ${can('billing') && kpi({ icon: 'wallet', tone: 'warning', label: 'أرصدة مستحقة', value: html`${formatMoney(0, { currency: false })}<small>ج.م</small>`, meta: 'على المرضى إجمالًا' })}

        <section class="card span-8" aria-labelledby="today-title">
          <div class="card__header">
            <div class="card__heading">
              <h2 class="card__title" id="today-title">مرضى اليوم</h2>
              <p class="card__subtitle">الانتظار · على الكرسي · انتهى · لم يحضر</p>
            </div>
            <div class="chips" role="group" aria-label="تصفية">
              <button type="button" class="chip" aria-pressed="true">الكل <span class="chip__count">${digits(0)}</span></button>
              <button type="button" class="chip" aria-pressed="false">في الانتظار</button>
              <button type="button" class="chip" aria-pressed="false">على الكرسي</button>
            </div>
          </div>
          <div class="card__body">
            ${emptyState({
              icon: 'calendar-days',
              title: 'لا توجد مواعيد اليوم',
              hint: 'عند حجز المواعيد ستظهر هنا مع حالة كل مريض وأزرار سريعة لتسجيل الحضور.',
            })}
          </div>
        </section>

        <aside class="card card--inverse span-4" aria-labelledby="status-title">
          <div class="card__header">
            <div class="card__heading">
              <h2 class="card__title" id="status-title">حالة النظام</h2>
              <p class="card__subtitle">مرحلة البناء ${digits(BUILD_PHASE)} من ${digits(TOTAL_PHASES)}</p>
            </div>
            <span class="badge badge--accent">${formatPercent(pct, { decimals: 0 })}</span>
          </div>
          <div class="card__body stack">
            <div class="progress progress--lime" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="تقدم البناء">
              <div class="progress__bar" style="inline-size: ${pct}%"></div>
            </div>
            <ul class="list">
              <li class="list__item" style="background: rgb(127 127 127 / 12%)">
                ${ico('database', { size: 20 })}
                <div class="list__main"><span class="list__title">قاعدة البيانات</span><span class="list__meta muted">إصدار المخطط ${digits(s.dbVersion)}</span></div>
                <span class="badge badge--success">تعمل</span>
              </li>
              <li class="list__item" style="background: rgb(127 127 127 / 12%)">
                ${ico('lock', { size: 20 })}
                <div class="list__main"><span class="list__title">تخزين دائم</span><span class="list__meta muted">${s.persisted ? 'المتصفح لن يحذف البيانات تلقائيًا' : 'ثبّت التطبيق لضمان عدم حذف البيانات'}</span></div>
                <span class="badge ${s.persisted ? 'badge--success' : 'badge--warning'}">${s.persisted ? 'مفعّل' : 'غير مضمون'}</span>
              </li>
              <li class="list__item" style="background: rgb(127 127 127 / 12%)">
                ${ico('download', { size: 20 })}
                <div class="list__main"><span class="list__title">العمل بدون إنترنت</span><span class="list__meta muted">${s.offline ? 'كل ملفات التطبيق محفوظة على الجهاز' : 'سيكون جاهزًا بعد إعادة التحميل'}</span></div>
                <span class="badge ${s.offline ? 'badge--success' : 'badge--info'}">${s.offline ? 'جاهز' : 'يُجهَّز'}</span>
              </li>
              <li class="list__item" style="background: rgb(127 127 127 / 12%)">
                ${ico('save', { size: 20 })}
                <div class="list__main"><span class="list__title">المساحة المستخدمة</span><span class="list__meta muted">${s.quota ? `من ${formatBytes(s.quota)} متاحة` : 'غير معروفة'}</span></div>
                <span class="bold">${formatBytes(s.usage)}</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    `);
  },
};
