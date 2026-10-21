/**
 * Dashboard. Phase 1: layout skeleton in the final visual style + system status.
 * Real KPIs, today's appointments, charts and alerts arrive in phase 9.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { formatBytes, formatDate, formatMoney, formatPercent, digits, todayISO } from '../../core/format.js';
import { getAdapter } from '../../data/index.js';
import { getSettings } from '../../data/settings.js';
import { emptyState } from '../../components/states.js';
import { can } from '../../core/permissions.js';
import { currentUser } from '../../core/session.js';
import { newPatientsThisMonth } from '../../services/patients.js';
import { backupStatus } from '../../services/backup.js';
import { revenueBetween, outstandingBalances } from '../../services/billing.js';
import { allPatients } from '../../services/patients.js';
import { todaysAppointments, setAppointmentStatus, NEXT_STEPS } from '../../services/appointments.js';
import { openAppointmentForm } from '../appointments/appt-form.js';
import { openAppointmentDetails } from '../appointments/appt-details.js';
import { APPT_STATUS } from '../../core/labels.js';
import { medicalAlerts } from '../../core/medical.js';
import { formatClock } from '../../core/time.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { toastSuccess, toastError } from '../../components/toast.js';

const QUICK = { arrived: 'وصل', in_chair: 'على الكرسي', done: 'انتهى' };

const BUILD_PHASE = 6;
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
  async render({ el, signal }) {
    const clinic = getSettings('clinic');
    const today = new Date();
    const s = await systemStatus();
    const newPatients = can('patients') ? await newPatientsThisMonth() : 0;
    const backup = can('settings', 'edit') ? await backupStatus() : null;
    const pct = Math.round((BUILD_PHASE / TOTAL_PHASES) * 100);
    const showMoney = can('billing');
    const [todayRevenue, monthRevenue, outstanding] = showMoney
      ? await Promise.all([revenueBetween(todayISO(), todayISO()), revenueBetween(`${todayISO().slice(0, 7)}-01`, todayISO()), outstandingBalances()])
      : [0, 0, { total: 0, rows: [] }];
    const showAppts = can('appointments');
    const todays = showAppts ? (await todaysAppointments()).filter((a) => a.status !== 'cancelled') : [];
    const waiting = todays.filter((a) => a.status === 'arrived').length;
    const patientsById = showAppts ? new Map((await allPatients()).map((p) => [p.id, p])) : new Map();
    let filter = 'all';

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">${greeting(today)}، ${currentUser()?.displayName ?? ""} 👋</h1>
          <p class="page-header__sub">${WEEKDAYS[today.getDay()]} ${formatDate(today)} · ${clinic.name}</p>
        </div>
        <div class="page-header__actions">
          ${can('appointments', 'create') ? html`<button type="button" class="btn btn--dark" data-book>${ico('plus')} موعد جديد</button>` : ''}
          ${can('patients', 'create') ? html`<a class="btn" href="#/patients/new">${ico('user-plus')} مريض جديد</a>` : ''}
        </div>
      </header>

      ${backup?.due ? html`<div class="alert alert--warning" style="margin-block-end: var(--sp-5)">${ico('database')}<div class="alert__content"><div class="alert__title">حان وقت النسخ الاحتياطي</div><div class="alert__body">${backup.lastAt ? `آخر نسخة منذ ${digits(backup.days)} يوم.` : 'لم تؤخذ أي نسخة احتياطية بعد.'} البيانات محفوظة على هذا الجهاز فقط.</div></div><a class="btn btn--accent btn--sm" href="#/settings?tab=backup">خذ نسخة الآن</a></div>` : ''}
      <div class="bento">
        ${showAppts ? html`<article class="card card--hero span-3">
          <div class="kpi">
            <div class="kpi__head">
              <span class="kpi__icon">${ico('calendar-check', { size: 22 })}</span>
              <span class="kpi__label">مواعيد اليوم</span>
              <a class="round-btn round-btn--on-hero" href="#/appointments" aria-label="فتح المواعيد">${ico('arrow-up-left', { size: 18 })}</a>
            </div>
            <div class="kpi__value">${digits(todays.length)}</div>
            <div class="kpi__foot">${waiting ? html`<span class="delta delta--up">${digits(waiting)} في الانتظار</span>` : ''}<span class="kpi__meta">${todays.filter((a) => a.status === 'done').length ? `انتهى ${digits(todays.filter((a) => a.status === 'done').length)}` : 'اضغط للتقويم'}</span></div>
          </div>
        </article>` : ''}
        ${showMoney && kpi({ icon: 'banknote', tone: 'lime', label: 'إيراد اليوم', value: html`${formatMoney(todayRevenue, { currency: false })}<small>ج.م</small>`, meta: html`الشهر: ${formatMoney(monthRevenue)} · <a href="#/billing?tab=closing">إقفال اليومية</a>` })}
        ${can('patients') && kpi({ icon: 'user-round', tone: 'info', label: 'مرضى جدد هذا الشهر', value: digits(newPatients), meta: html`<a href="#/patients">عرض المرضى</a>` })}
        ${showMoney && kpi({ icon: 'wallet', tone: 'warning', label: 'أرصدة مستحقة', value: html`${formatMoney(outstanding.total, { currency: false })}<small>ج.م</small>`, meta: html`على ${digits(outstanding.rows.length)} مريض · <a href="#/billing?tab=balances">التفاصيل</a>` })}

        ${showAppts ? html`<section class="card span-8" aria-labelledby="today-title">
          <div class="card__header">
            <div class="card__heading">
              <h2 class="card__title" id="today-title">مرضى اليوم</h2>
              <p class="card__subtitle">سجّل الوصول والدخول للكرسي والانتهاء بضغطة واحدة</p>
            </div>
            <div class="chips" role="group" aria-label="تصفية" id="today-filter"></div>
          </div>
          <div class="card__body" id="today-list"></div>
        </section>` : ''}

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

    if (!showAppts) return;
    const drawToday = () => {
      const groups = [['all', 'الكل', todays], ['arrived', 'في الانتظار', todays.filter((a) => a.status === 'arrived')], ['in_chair', 'على الكرسي', todays.filter((a) => a.status === 'in_chair')], ['booked', 'لم يصل بعد', todays.filter((a) => a.status === 'booked')]];
      render(el.querySelector('#today-filter'), html`${groups.map(([k, label, list]) => html`<button type="button" class="chip" data-tfilter="${k}" aria-pressed="${String(filter === k)}">${label} <span class="chip__count">${digits(list.length)}</span></button>`)}`);
      const list = groups.find(([k]) => k === filter)[2];
      render(el.querySelector('#today-list'), list.length ? html`<ul class="list">${list.map((a) => {
        const st = APPT_STATUS[a.status];
        const p = patientsById.get(a.patientId);
        return html`<li class="today-item" style="--st:${st.color}">
          <span class="today-item__time">${formatClock(a.startMin)}</span>
          <span class="today-item__main"><a href="${href('/patients/:id', { id: a.patientId })}" class="bold">${a.patientName}</a>
            <span class="muted text-sm">${a.procedureNames?.length ? a.procedureNames.join('، ') : 'زيارة'}</span></span>
          ${p && medicalAlerts(p).critical.length ? html`<span class="badge badge--danger" title="${medicalAlerts(p).critical.join('، ')}">${ico('triangle-alert', { size: 14 })} تنبيه</span>` : ''}
          <span class="badge badge--dot badge--${st.tone}">${st.label}</span>
          <span class="today-item__actions">
            ${can('appointments', 'edit') ? NEXT_STEPS[a.status].filter((x) => QUICK[x]).map((x) => html`<button type="button" class="btn btn--sm ${x === 'done' ? 'btn--accent' : 'btn--soft'}" data-quick="${x}" data-id="${a.id}">${QUICK[x]}</button>`) : ''}
            <button type="button" class="btn btn--ghost btn--icon btn--sm" data-appt="${a.id}" aria-label="تفاصيل">${ico('eye', { size: 18 })}</button>
          </span>
        </li>`;
      })}</ul>` : emptyState({ icon: 'calendar-days', title: filter === 'all' ? 'لا توجد مواعيد اليوم' : 'لا أحد في هذه الحالة الآن', hint: filter === 'all' ? 'احجز موعدًا من زر «موعد جديد» أو من صفحة المواعيد.' : '' }));
    };
    drawToday();

    on(el, 'click', '[data-tfilter]', (_, b) => { filter = b.dataset.tfilter; drawToday(); }, { signal });
    on(el, 'click', '[data-book]', () => openAppointmentForm({}), { signal });
    on(el, 'click', '[data-appt]', (_, b) => { const a = todays.find((x) => x.id === b.dataset.appt); if (a) openAppointmentDetails(a); }, { signal });
    on(el, 'click', '[data-quick]', async (_, b) => {
      const a = todays.find((x) => x.id === b.dataset.id);
      try { await setAppointmentStatus(a.id, b.dataset.quick); toastSuccess(`${a.patientName}: ${APPT_STATUS[b.dataset.quick].label}`); } catch (err) { toastError(err.message); }
    }, { signal });
    return onEvent('data:changed', async ({ store }) => {
      if (store !== 'appointments') return;
      todays.splice(0, todays.length, ...(await todaysAppointments()).filter((a) => a.status !== 'cancelled'));
      drawToday();
    });
  },
};
