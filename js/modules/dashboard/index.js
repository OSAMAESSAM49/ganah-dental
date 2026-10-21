/**
 * Dashboard: today's appointments and patient flow, headline KPIs compared with the same
 * days of last month, everything that needs attention (alerts), 12-month cash chart and
 * system status. Each block only appears for users allowed to see its module.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { formatBytes, formatDate, formatMoney, digits, todayISO } from '../../core/format.js';
import { getAdapter } from '../../data/index.js';
import { getSettings } from '../../data/settings.js';
import { emptyState } from '../../components/states.js';
import { can } from '../../core/permissions.js';
import { currentUser } from '../../core/session.js';
import { newPatientsThisMonth } from '../../services/patients.js';
import { backupStatus } from '../../services/backup.js';
import { followUpCounts } from '../../services/followups.js';
import { outstandingBalances, allInstallments } from '../../services/billing.js';
import { inventoryAlerts } from '../../services/inventory.js';
import { overdueLabCases } from '../../services/labs.js';
import { dashboardKpis, change } from '../../services/reports.js';
import { mountChart, wireCharts } from '../../components/chart.js';
import { allPatients } from '../../services/patients.js';
import { todaysAppointments, setAppointmentStatus, tomorrowsReminders, NEXT_STEPS } from '../../services/appointments.js';
import { openAppointmentForm } from '../appointments/appt-form.js';
import { openAppointmentDetails } from '../appointments/appt-details.js';
import { APPT_STATUS } from '../../core/labels.js';
import { medicalAlerts } from '../../core/medical.js';
import { formatClock, MONTHS } from '../../core/time.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { toastSuccess, toastError } from '../../components/toast.js';

const QUICK = { arrived: 'وصل', in_chair: 'على الكرسي', done: 'انتهى' };


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

/** "▲ 12%" pill vs the same days of last month; up is good unless invert. */
function deltaPill(prev, cur, { invert = false } = {}) {
  const c = change(prev, cur);
  if (c === null) return '';
  const pct = Math.round(Math.abs(c) * 100);
  const title = 'مقارنة بنفس الفترة من الشهر الماضي';
  if (pct === 0) return html`<span class="delta delta--flat" title="${title}">= 0%</span>`;
  const up = c > 0;
  return html`<span class="delta ${up !== invert ? 'delta--up' : 'delta--down'}" title="${title}">${up ? '▲' : '▼'} ${digits(pct)}%</span>`;
}

const alertItem = ({ icon, tone, title, sub, link }) => html`
  <a class="dash-alert" href="${link}"><span class="dash-alert__icon dash-alert__icon--${tone}">${ico(icon, { size: 20 })}</span>
    <span class="dash-alert__text"><strong>${title}</strong><span class="muted text-sm">${sub}</span></span></a>`;

/** Everything that needs attention now, most urgent first. */
async function collectAlerts(backup) {
  const out = [];
  if (backup?.due) out.push({ icon: 'database', tone: 'warning', title: 'حان وقت النسخ الاحتياطي', sub: backup.lastAt ? `آخر نسخة منذ ${digits(backup.days)} يوم` : 'لم تؤخذ أي نسخة بعد', link: '#/settings?tab=backup' });
  if (can('followups')) {
    const fu = await followUpCounts();
    if (fu.overdue) out.push({ icon: 'bell', tone: 'danger', title: `${digits(fu.overdue)} متابعة متأخرة`, sub: 'اتصالات وفحوص بعد العلاج', link: '#/followups?filter=overdue' });
    if (fu.today) out.push({ icon: 'bell', tone: 'info', title: `${digits(fu.today)} متابعة اليوم`, sub: 'رسالة واتساب جاهزة لكل مريض', link: '#/followups?filter=today' });
  }
  if (can('billing')) {
    const overdue = (await allInstallments()).filter((i) => i.status === 'overdue');
    if (overdue.length) out.push({ icon: 'wallet', tone: 'danger', title: `${digits(overdue.length)} قسط متأخر`, sub: formatMoney(overdue.reduce((n, i) => n + i.remainingOnInstallment, 0)), link: '#/billing?tab=installments' });
  }
  if (can('appointments')) {
    const pending = (await tomorrowsReminders()).filter((a) => !a.reminderSentAt);
    if (pending.length) out.push({ icon: 'message-circle', tone: 'info', title: `${digits(pending.length)} تذكير لمواعيد الغد`, sub: 'لم تُرسل بعد', link: '#/appointments' });
  }
  if (can('labs')) {
    const late = await overdueLabCases();
    if (late.length) out.push({ icon: 'flask-conical', tone: 'warning', title: `${digits(late.length)} حالة معمل متأخرة`, sub: late.slice(0, 2).map((c) => c.patientName).join('، '), link: '#/labs?filter=overdue' });
  }
  if (can('inventory')) {
    const inv = await inventoryAlerts();
    if (inv.expired.length) out.push({ icon: 'triangle-alert', tone: 'danger', title: `${digits(inv.expired.length)} تشغيلة منتهية الصلاحية`, sub: 'استبعدها من الاستخدام', link: '#/inventory?tab=alerts' });
    if (inv.low.length) out.push({ icon: 'package', tone: 'warning', title: `${digits(inv.low.length)} صنف يحتاج شراء`, sub: inv.low.slice(0, 2).map((i) => i.name).join('، '), link: '#/inventory?tab=shopping' });
    if (inv.expiring.length) out.push({ icon: 'clock', tone: 'warning', title: `${digits(inv.expiring.length)} تشغيلة تنتهي قريبًا`, sub: 'خلال 60 يومًا', link: '#/inventory?tab=alerts' });
  }
  return out;
}

const kpi = ({ icon, tone = '', label, value, meta }) => html`
  <article class="card span-3">
    <div class="kpi">
      <div class="kpi__head">
        <span class="kpi__icon ${tone ? `kpi__icon--${tone}` : ''}">${ico(icon, { size: 22 })}</span>
        <span class="kpi__label">${label}</span>
      </div>
      <div class="kpi__value">${value}</div>
      <div class="kpi__foot">${meta}</div>
    </div>
  </article>`;

export default {
  title: 'الرئيسية',
  async render({ el, signal }) {
    const clinic = getSettings('clinic');
    const today = new Date();
    const s = await systemStatus();
    const backup = can('settings', 'edit') ? await backupStatus() : null;
    const showMoney = can('billing');
    const [kpis, outstanding] = showMoney ? await Promise.all([dashboardKpis(), outstandingBalances()]) : [null, { total: 0, rows: [] }];
    const newPatients = can('patients') ? await newPatientsThisMonth() : 0;
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate()));
    const newPrev = can('patients') ? (await allPatients()).filter((p) => { const d = new Date(p.createdAt); return d.getFullYear() === prevMonth.getFullYear() && d.getMonth() === prevMonth.getMonth() && d.getDate() <= prevMonth.getDate(); }).length : 0;
    const alerts = await collectAlerts(backup);
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
        ${showMoney && kpi({ icon: 'banknote', tone: 'lime', label: 'مقبوضات الشهر', value: html`${formatMoney(kpis.current.collections, { currency: false })}<small>ج.م</small>`, meta: html`${deltaPill(kpis.previous.collections, kpis.current.collections)}<span class="kpi__meta">اليوم: ${formatMoney(kpis.current.series.find((x) => x.key === todayISO())?.income ?? 0)} · <a href="#/billing?tab=closing">إقفال اليومية</a></span>` })}
        ${showMoney && kpi({ icon: 'trending-up', tone: 'success', label: 'صافي الشهر', value: html`${formatMoney(kpis.current.net, { currency: false })}<small>ج.م</small>`, meta: html`${deltaPill(kpis.previous.net, kpis.current.net)}<span class="kpi__meta">مصروفات ${formatMoney(kpis.current.expenses)} · مستحق ${formatMoney(outstanding.total)}</span>` })}
        ${can('patients') && kpi({ icon: 'user-round', tone: 'info', label: 'مرضى جدد هذا الشهر', value: digits(newPatients), meta: html`${deltaPill(newPrev, newPatients)}<span class="kpi__meta"><a href="#/patients">عرض المرضى</a></span>` })}

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

        <section class="card span-4" aria-labelledby="alerts-title">
          <div class="card__header"><div class="card__heading"><h2 class="card__title" id="alerts-title">يحتاج انتباهك</h2>
            <p class="card__subtitle">${alerts.length ? `${digits(alerts.length)} تنبيه` : 'لا شيء عاجل'}</p></div></div>
          <div class="card__body">${alerts.length ? html`<div class="stack-sm">${alerts.map(alertItem)}</div>` : emptyState({ icon: 'circle-check', title: 'كل شيء تمام', hint: 'لا متابعات متأخرة ولا أقساط ولا نواقص في المخزون.' })}</div>
        </section>

        ${showMoney ? html`<section class="card span-8" aria-labelledby="trend-title">
          <div class="card__header"><div class="card__heading"><h2 class="card__title" id="trend-title">المقبوضات والمصروفات — آخر 12 شهرًا</h2>
            <p class="card__subtitle">مرّر على العمود لرؤية القيم · <a href="#/reports?tab=finance&preset=last12">التقرير الكامل</a></p></div></div>
          <div class="card__body"><div class="chart-box" id="trend-chart"></div></div>
        </section>` : ''}

        <aside class="card card--inverse ${showMoney ? 'span-4' : 'span-12'}" aria-labelledby="status-title">
          <div class="card__header">
            <div class="card__heading">
              <h2 class="card__title" id="status-title">حالة النظام</h2>
              <p class="card__subtitle">البيانات محفوظة على هذا الجهاز فقط</p>
            </div>
          </div>
          <div class="card__body stack">
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

    if (showMoney) {
      const t = kpis.trend;
      const monthName = (k) => MONTHS[Number(k.slice(5, 7)) - 1];
      mountChart(el.querySelector('#trend-chart'), {
        labels: t.map((x) => monthName(x.key)), tipLabels: t.map((x) => `${monthName(x.key)} ${digits(x.key.slice(0, 4))}`),
        series: [{ name: 'المقبوضات', values: t.map((x) => x.income) }, { name: 'المصروفات', values: t.map((x) => x.expenses) }],
        format: (v) => formatMoney(v), tick: (v) => { const p = v / 100; return p >= 1e3 ? `${digits(+(p / 1e3).toFixed(1))}K` : digits(Math.round(p)); },
        label: 'المقبوضات والمصروفات آخر 12 شهرًا', height: 220,
      }, signal);
      wireCharts(el, signal);
    }

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
