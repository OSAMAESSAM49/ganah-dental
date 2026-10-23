/**
 * Dashboard for one day (today by default; ?day=YYYY-MM-DD moves backwards or forwards
 * without limit): the day's appointments and patient flow, collections, net, new patients,
 * the day's invoices with what still needs collecting, plus things that need attention now,
 * the 12-month cash chart and system status.
 * Each card shows only when the user may view its module and the Admin has not hidden it
 * for that user (core/dashboard-cards.js).
 */
import { html, ico, render, on } from '../../core/dom.js';
import { formatBytes, formatMoney, digits, todayISO, toISODate, parseDateInput } from '../../core/format.js';
import { getAdapter, repos } from '../../data/index.js';
import { getSettings } from '../../data/settings.js';
import { emptyState } from '../../components/states.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { can } from '../../core/permissions.js';
import { currentUser } from '../../core/session.js';
import { cardVisible } from '../../core/dashboard-cards.js';
import { backupStatus } from '../../services/backup.js';
import { paymentsBetween, dayBilling, formatInvoiceNo } from '../../services/billing.js';
import { expensesTotal } from '../../services/expenses.js';
import { collectAlerts } from '../../services/alerts.js';
import { financialReport, presetRange, change } from '../../services/reports.js';
import { cloudEnabled } from '../../services/cloud-sync.js';
import { mountChart, wireCharts } from '../../components/chart.js';
import { allPatients } from '../../services/patients.js';
import { listDay, setAppointmentStatus, NEXT_STEPS } from '../../services/appointments.js';
import { openAppointmentForm } from '../appointments/appt-form.js';
import { openAppointmentDetails } from '../appointments/appt-details.js';
import { APPT_STATUS } from '../../core/labels.js';
import { medicalAlerts } from '../../core/medical.js';
import { formatClock, MONTHS, addDays, dayLabel } from '../../core/time.js';
import { href, navigate } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { toastSuccess, toastError } from '../../components/toast.js';

const QUICK = { arrived: 'وصل', in_chair: 'على الكرسي', done: 'انتهى' };
const INV_STATUS = { paid: ['مدفوعة', 'success'], partial: ['مدفوعة جزئيًا', 'warning'], open: ['غير مدفوعة', 'danger'] };

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'نهارك سعيد';
  return 'مساء الخير';
}

async function systemStatus() {
  const storage = navigator.storage;
  const persisted = (await storage?.persisted?.()) ?? false;
  const { usage, quota } = (await storage?.estimate?.()) ?? {};
  return { dbVersion: getAdapter().version, persisted, usage, quota, offline: !!navigator.serviceWorker?.controller };
}

/** "▲ 12%" pill vs the same weekday of the previous week; up is good unless invert. */
function deltaPill(prev, cur, { invert = false } = {}) {
  const c = change(prev, cur);
  if (c === null) return '';
  const pct = Math.round(Math.abs(c) * 100);
  const title = 'مقارنة بنفس اليوم من الأسبوع السابق';
  if (pct === 0) return html`<span class="delta delta--flat" title="${title}">= 0%</span>`;
  const up = c > 0;
  return html`<span class="delta ${up !== invert ? 'delta--up' : 'delta--down'}" title="${title}">${up ? '▲' : '▼'} ${digits(pct)}%</span>`;
}

const alertItem = ({ icon, tone, title, sub, link }) => html`
  <a class="dash-alert" href="${link}"><span class="dash-alert__icon dash-alert__icon--${tone}">${ico(icon, { size: 20 })}</span>
    <span class="dash-alert__text"><strong>${title}</strong><span class="muted text-sm">${sub}</span></span></a>`;

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

const money = (v) => html`${formatMoney(v, { currency: false })}<small>ج.م</small>`;
const sum = (rows) => rows.reduce((n, p) => n + p.amount, 0);
const localDay = (iso) => toISODate(new Date(iso));

/** "اليوم" · "أمس" · "غدًا" · "الخميس 15 أكتوبر" */
function dayWord(day, today) {
  if (day === today) return 'اليوم';
  if (day === addDays(today, -1)) return 'أمس';
  if (day === addDays(today, 1)) return 'غدًا';
  return dayLabel(day, { year: day.slice(0, 4) !== today.slice(0, 4) });
}

export default {
  title: 'الرئيسية',
  async render({ el, query, signal }) {
    const today = todayISO();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(query.day ?? '') ? query.day : today;
    const word = dayWord(day, today);
    const dayHref = (d) => (d === today ? '#/' : href('/', {}, { day: d }));
    const clinic = getSettings('clinic');
    let me = null;
    const show = (key) => cardVisible(key, me);
    const weekAgo = addDays(day, -7);
    let filter = 'all';

    /* ---------- data ---------- */
    const load = async () => {
      // Fresh copy: the Admin may have changed this user's cards (possibly on another device).
      me = currentUser() ? await repos.users.get(currentUser().id) : null;
      const d = {};
      if (show('appointments') || show('patientsList')) {
        d.appts = (await listDay(day)).filter((a) => a.status !== 'cancelled');
        d.patientsById = new Map((await allPatients()).map((p) => [p.id, p]));
      }
      if (show('collections') || show('net')) {
        const [cur, prev, exp, expPrev] = await Promise.all([paymentsBetween(day, day), paymentsBetween(weekAgo, weekAgo), expensesTotal(day, day), expensesTotal(weekAgo, weekAgo)]);
        d.collections = sum(cur); d.collectionsPrev = sum(prev); d.paymentsCount = cur.length;
        d.expenses = exp; d.net = d.collections - exp; d.netPrev = d.collectionsPrev - expPrev;
      }
      if (show('newPatients')) {
        const all = await allPatients();
        d.newPatients = all.filter((p) => localDay(p.createdAt) === day).length;
        d.newPrev = all.filter((p) => localDay(p.createdAt) === weekAgo).length;
      }
      if (show('invoices')) d.billing = await dayBilling(day);
      if (show('alerts')) d.alerts = await collectAlerts(can('settings', 'edit') ? await backupStatus() : null);
      if (show('trend')) d.trend = (await financialReport(...presetRange('last12', today))).series;
      if (show('system')) d.system = await systemStatus();
      return d;
    };

    /* ---------- cards ---------- */
    const invoicesCard = (b) => {
      const outstanding = b.invoices.reduce((n, i) => n + i.remaining, 0) + b.uninvoiced.reduce((n, g) => n + g.value, 0);
      const canCollect = can('billing', 'create');
      return html`<section class="card span-4" aria-labelledby="inv-title">
        <div class="card__header">
          <div class="card__heading">
            <h2 class="card__title" id="inv-title">فواتير ${word} ${b.due ? html`<span class="count-badge" aria-label="${digits(b.due)} بانتظار الدفع">${digits(b.due)}</span>` : ''}</h2>
            <p class="card__subtitle">${b.due ? html`مطلوب تحصيل <strong>${formatMoney(outstanding)}</strong>` : b.invoices.length ? 'كل فواتير اليوم مدفوعة' : 'لا توجد فواتير'}</p>
          </div>
          ${can('billing') ? html`<a class="round-btn" href="#/billing" aria-label="الحسابات والفواتير">${ico('arrow-up-left', { size: 18 })}</a>` : ''}
        </div>
        <div class="card__body">${b.uninvoiced.length || b.invoices.length ? html`<ul class="inv-list">
          ${b.uninvoiced.map((g) => html`<li class="inv-row inv-row--new">
            <span class="inv-row__main"><a href="${href('/patients/:id', { id: g.patientId }, { tab: 'payments' })}" class="bold">${g.patientName}</a>
              <span class="muted text-sm">${ico('stethoscope', { size: 14 })} حساب جديد بدون فاتورة: ${g.items.map((i) => i.procedureName).join('، ')}</span></span>
            <span class="inv-row__end"><strong>${formatMoney(g.value)}</strong>
              ${canCollect ? html`<button type="button" class="btn btn--accent btn--sm" data-new-inv="${g.patientId}">إصدار فاتورة</button>` : html`<span class="badge badge--danger">بانتظار الفاتورة</span>`}</span>
          </li>`)}
          ${b.invoices.map((i) => html`<li class="inv-row">
            <span class="inv-row__main"><a href="${href('/patients/:id', { id: i.invoice.patientId }, { tab: 'payments' })}" class="bold">${i.invoice.patientName}</a>
              <span class="muted text-sm"><span class="ltr">${formatInvoiceNo(i.invoice.number)}</span> · ${formatMoney(i.total)}</span></span>
            <span class="inv-row__end">
              <span class="badge badge--dot badge--${INV_STATUS[i.status]?.[1] ?? ''}">${INV_STATUS[i.status]?.[0] ?? i.status}</span>
              ${i.remaining > 0 && canCollect ? html`<button type="button" class="btn btn--soft btn--sm" data-collect="${i.invoice.id}" data-patient="${i.invoice.patientId}">تحصيل ${formatMoney(i.remaining)}</button>` : ''}</span>
          </li>`)}
        </ul>` : emptyState({ icon: 'receipt', title: `لا توجد فواتير ${word}`, hint: 'عند انتهاء علاج يظهر هنا حساب المريض حتى تُصدر فاتورته ويُحصَّل.' })}</div>
      </section>`;
    };

    const paint = (d) => {
      render(el, html`
        <header class="page-header">
          <div class="page-header__text">
            <h1 class="page-header__title">${greeting()}، ${currentUser()?.displayName ?? ''} 👋</h1>
            <p class="page-header__sub">${clinic.name}</p>
          </div>
          <div class="page-header__actions">
            ${can('appointments', 'create') ? html`<button type="button" class="btn btn--dark" data-book>${ico('plus')} موعد جديد</button>` : ''}
            ${can('patients', 'create') ? html`<a class="btn" href="#/patients/new">${ico('user-plus')} مريض جديد</a>` : ''}
          </div>
        </header>

        <nav class="day-nav" aria-label="اختيار اليوم">
          <a class="round-btn" href="${dayHref(addDays(day, -1))}" aria-label="اليوم السابق" title="اليوم السابق">${ico('chevron-right', { size: 20 })}</a>
          <div class="day-nav__label">
            <strong>${dayLabel(day, { year: true })}</strong>
            <span class="muted text-sm">${day === today ? 'اليوم' : word === 'أمس' || word === 'غدًا' ? word : day < today ? 'يوم سابق' : 'يوم قادم'}</span>
          </div>
          <a class="round-btn" href="${dayHref(addDays(day, 1))}" aria-label="اليوم التالي" title="اليوم التالي">${ico('chevron-left', { size: 20 })}</a>
          <form class="day-nav__pick" id="day-pick" novalidate>${dateField({ name: 'goto', label: 'اذهب إلى يوم', value: day })}</form>
          ${day !== today ? html`<a class="btn btn--primary btn--sm" href="#/">${ico('calendar-check', { size: 18 })} اليوم</a>` : ''}
        </nav>

        <div class="bento">
          ${show('appointments') ? html`<article class="card card--hero span-3">
            <div class="kpi">
              <div class="kpi__head">
                <span class="kpi__icon">${ico('calendar-check', { size: 22 })}</span>
                <span class="kpi__label">مواعيد ${word}</span>
                <a class="round-btn round-btn--on-hero" href="${href('/appointments', {}, { view: 'day', date: day })}" aria-label="فتح المواعيد">${ico('arrow-up-left', { size: 18 })}</a>
              </div>
              <div class="kpi__value">${digits(d.appts.length)}</div>
              <div class="kpi__foot">${d.appts.some((a) => a.status === 'arrived') ? html`<span class="delta delta--up">${digits(d.appts.filter((a) => a.status === 'arrived').length)} في الانتظار</span>` : ''}<span class="kpi__meta">${d.appts.filter((a) => a.status === 'done').length ? `انتهى ${digits(d.appts.filter((a) => a.status === 'done').length)}` : 'اضغط للتقويم'}</span></div>
            </div>
          </article>` : ''}
          ${show('collections') ? kpi({ icon: 'banknote', tone: 'lime', label: `مدفوعات ${word}`, value: money(d.collections), meta: html`${deltaPill(d.collectionsPrev, d.collections)}<span class="kpi__meta">${digits(d.paymentsCount)} عملية دفع · <a href="#/billing?tab=closing">إقفال اليومية</a></span>` }) : ''}
          ${show('net') ? kpi({ icon: 'trending-up', tone: 'success', label: `صافي ${word}`, value: money(d.net), meta: html`${deltaPill(d.netPrev, d.net)}<span class="kpi__meta">مصروفات ${formatMoney(d.expenses)} · <a href="#/reports">تقارير الشهر</a></span>` }) : ''}
          ${show('newPatients') ? kpi({ icon: 'user-round', tone: 'info', label: `مرضى جدد ${word}`, value: digits(d.newPatients), meta: html`${deltaPill(d.newPrev, d.newPatients)}<span class="kpi__meta"><a href="#/patients">عرض المرضى</a></span>` }) : ''}

          ${show('patientsList') ? html`<section class="card ${show('invoices') ? 'span-8' : 'span-12'}" aria-labelledby="today-title">
            <div class="card__header">
              <div class="card__heading"><h2 class="card__title" id="today-title">مرضى ${word}</h2></div>
              <select class="select input--pill today-filter" id="today-filter" aria-label="تصفية مرضى ${word}"></select>
            </div>
            <div class="card__body" id="today-list"></div>
          </section>` : ''}
          ${show('invoices') ? invoicesCard(d.billing) : ''}

          ${show('alerts') ? html`<section class="card span-4" aria-labelledby="alerts-title">
            <div class="card__header"><div class="card__heading"><h2 class="card__title" id="alerts-title">يحتاج انتباهك</h2>
              <p class="card__subtitle">${d.alerts.length ? `${digits(d.alerts.length)} تنبيه الآن` : 'لا شيء عاجل'}</p></div></div>
            <div class="card__body">${d.alerts.length ? html`<div class="stack-sm">${d.alerts.map(alertItem)}</div>` : emptyState({ icon: 'circle-check', title: 'كل شيء تمام', hint: 'لا متابعات متأخرة ولا أقساط ولا نواقص في المخزون.' })}</div>
          </section>` : ''}

          ${show('trend') ? html`<section class="card ${show('alerts') ? 'span-8' : 'span-12'}" aria-labelledby="trend-title">
            <div class="card__header"><div class="card__heading"><h2 class="card__title" id="trend-title">المقبوضات والمصروفات — آخر 12 شهرًا</h2>
              <p class="card__subtitle">مرّر على العمود لرؤية القيم · <a href="#/reports?tab=finance&preset=last12">التقرير الكامل</a></p></div></div>
            <div class="card__body"><div class="chart-box" id="trend-chart"></div></div>
          </section>` : ''}

          ${show('system') ? html`<aside class="card card--inverse span-12" aria-labelledby="status-title">
            <div class="card__header"><div class="card__heading">
              <h2 class="card__title" id="status-title">حالة النظام</h2>
              <p class="card__subtitle">${cloudEnabled() ? 'البيانات على هذا الجهاز ومتزامنة مع السحابة' : 'البيانات محفوظة على هذا الجهاز فقط'}</p>
            </div></div>
            <div class="card__body">
              <ul class="list sys-list">
                <li class="list__item">${ico('database', { size: 20 })}<div class="list__main"><span class="list__title">قاعدة البيانات</span><span class="list__meta muted">إصدار المخطط ${digits(d.system.dbVersion)}</span></div><span class="badge badge--success">تعمل</span></li>
                <li class="list__item">${ico('lock', { size: 20 })}<div class="list__main"><span class="list__title">تخزين دائم</span><span class="list__meta muted">${d.system.persisted ? 'المتصفح لن يحذف البيانات تلقائيًا' : 'ثبّت التطبيق لضمان عدم حذف البيانات'}</span></div><span class="badge ${d.system.persisted ? 'badge--success' : 'badge--warning'}">${d.system.persisted ? 'مفعّل' : 'غير مضمون'}</span></li>
                <li class="list__item">${ico('download', { size: 20 })}<div class="list__main"><span class="list__title">العمل بدون إنترنت</span><span class="list__meta muted">${d.system.offline ? 'كل ملفات التطبيق محفوظة على الجهاز' : 'سيكون جاهزًا بعد إعادة التحميل'}</span></div><span class="badge ${d.system.offline ? 'badge--success' : 'badge--info'}">${d.system.offline ? 'جاهز' : 'يُجهَّز'}</span></li>
                <li class="list__item">${ico('save', { size: 20 })}<div class="list__main"><span class="list__title">المساحة المستخدمة</span><span class="list__meta muted">${d.system.quota ? `من ${formatBytes(d.system.quota)} متاحة` : 'غير معروفة'}</span></div><span class="bold">${formatBytes(d.system.usage)}</span></li>
              </ul>
            </div>
          </aside>` : ''}
        </div>`);

      enhanceDateFields(el.querySelector('#day-pick'), signal);
      if (show('trend')) {
        const t = d.trend;
        const monthName = (k) => MONTHS[Number(k.slice(5, 7)) - 1];
        mountChart(el.querySelector('#trend-chart'), {
          labels: t.map((x) => monthName(x.key)), tipLabels: t.map((x) => `${monthName(x.key)} ${digits(x.key.slice(0, 4))}`),
          series: [{ name: 'المقبوضات', values: t.map((x) => x.income) }, { name: 'المصروفات', values: t.map((x) => x.expenses) }],
          format: (v) => formatMoney(v), tick: (v) => { const p = v / 100; return p >= 1e3 ? `${digits(+(p / 1e3).toFixed(1))}K` : digits(Math.round(p)); },
          label: 'المقبوضات والمصروفات آخر 12 شهرًا', height: 220,
        }, signal);
      }
      if (show('patientsList')) drawList(d);
    };

    const drawList = (d) => {
      const all = d.appts;
      const groups = [['all', 'الكل', all], ['arrived', 'في الانتظار', all.filter((a) => a.status === 'arrived')], ['in_chair', 'على الكرسي', all.filter((a) => a.status === 'in_chair')], ['booked', 'لم يصل بعد', all.filter((a) => a.status === 'booked')]];
      render(el.querySelector('#today-filter'), html`${groups.map(([k, label, list]) => html`<option value="${k}" ${filter === k ? 'selected' : ''}>${label} (${digits(list.length)})</option>`)}`);
      const list = groups.find(([k]) => k === filter)[2];
      render(el.querySelector('#today-list'), list.length ? html`<ul class="list">${list.map((a) => {
        const st = APPT_STATUS[a.status];
        const p = d.patientsById.get(a.patientId);
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
      })}</ul>` : emptyState({ icon: 'calendar-days', title: filter === 'all' ? `لا توجد مواعيد ${word}` : 'لا أحد في هذه الحالة الآن', hint: filter === 'all' ? 'احجز موعدًا من زر «موعد جديد» أو من صفحة المواعيد.' : '' }));
    };

    let data = await load();
    paint(data);
    wireCharts(el, signal);

    on(el, 'change', '#day-pick input', (_, input) => {
      const d = parseDateInput(/** @type {HTMLInputElement} */ (input).value);
      if (d && d !== day) navigate(d === today ? '/' : `/?day=${d}`);
    }, { signal });
    on(el, 'submit', '#day-pick', (e) => e.preventDefault(), { signal });
    on(el, 'change', '#today-filter', (_, sel) => { filter = /** @type {HTMLSelectElement} */ (sel).value; drawList(data); }, { signal });
    on(el, 'click', '[data-book]', () => openAppointmentForm(day >= today ? { date: day } : {}), { signal });
    on(el, 'click', '[data-appt]', (_, b) => { const a = data.appts.find((x) => x.id === b.dataset.appt); if (a) openAppointmentDetails(a); }, { signal });
    on(el, 'click', '[data-quick]', async (_, b) => {
      const a = data.appts.find((x) => x.id === b.dataset.id);
      try { await setAppointmentStatus(a.id, b.dataset.quick); toastSuccess(`${a.patientName}: ${APPT_STATUS[b.dataset.quick].label}`); } catch (err) { toastError(err.message); }
    }, { signal });
    on(el, 'click', '[data-new-inv]', async (_, b) => { const { openInvoiceDialog } = await import('../billing/dialogs.js'); openInvoiceDialog(b.dataset.newInv); }, { signal });
    on(el, 'click', '[data-collect]', async (_, b) => { const { openPaymentDialog } = await import('../billing/dialogs.js'); openPaymentDialog({ patientId: b.dataset.patient, invoiceId: b.dataset.collect }); }, { signal });

    // Live: changes made here or synced from other devices (a doctor finishing a treatment,
    // reception collecting a payment…) update the cards within a moment.
    const RELEVANT = new Set(['appointments', 'invoices', 'payments', 'treatmentItems', 'patients', 'expenses', 'followUps', 'inventoryItems', 'labCases', 'users']);
    let timer = 0;
    const refresh = async () => {
      if (signal.aborted) return;
      // Never repaint under an open dialog: try again once it is closed.
      if (document.querySelector('dialog[open]')) { timer = setTimeout(refresh, 800); return; }
      data = await load();
      if (!signal.aborted) paint(data);
    };
    const off = onEvent('data:changed', ({ store }) => {
      if (!RELEVANT.has(store)) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    });
    return () => { off(); clearTimeout(timer); };
  },
};
