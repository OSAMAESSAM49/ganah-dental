/**
 * Reports: finance, treatments, patients, appointments, receivables and inventory for a
 * chosen period, with charts, tables, and Excel / PDF export of exactly what is shown.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { formatMoney, formatDate, formatPercent, digits, todayISO, parseDateInput, toISODate } from '../../core/format.js';
import { MONTHS, dayLabel, WEEKDAYS } from '../../core/time.js';
import { PAYMENT_METHODS, REFERRAL_SOURCES, GENDER_LABELS, APPT_STATUS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { href, navigate } from '../../core/router.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { emptyState, loadingState } from '../../components/states.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { mountChart, wireCharts, barList } from '../../components/chart.js';
import { exportExcel, printReport, cellText } from '../../components/export.js';
import { unitLabel } from '../../services/inventory.js';
import { tr, inArabic, inArabicAsync } from '../../core/i18n.js';
import {
  presetRange, financialReport, treatmentsReport, patientsReport, appointmentsReport, receivablesReport, inventoryReport,
} from '../../services/reports.js';

const TABS = [
  ['finance', 'المالية', 'banknote'], ['treatments', 'العلاجات', 'tooth'], ['patients', 'المرضى', 'users'],
  ['appointments', 'المواعيد', 'calendar-days'], ['receivables', 'المستحقات', 'wallet'], ['inventory', 'المخزون', 'package'],
];
const PRESETS = { month: 'هذا الشهر', lastMonth: 'الشهر الماضي', last30: 'آخر 30 يومًا', quarter: 'هذا الربع', year: 'هذه السنة', last12: 'آخر 12 شهرًا' };

const money = (v) => formatMoney(v);
const bucketLabel = (unit, key) => (unit === 'day' ? `${digits(Number(key.slice(8)))}/${digits(Number(key.slice(5, 7)))}` : MONTHS[Number(key.slice(5, 7)) - 1]);
const bucketTip = (unit, key) => (unit === 'day' ? dayLabel(key) : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${digits(key.slice(0, 4))}`);
const bucketSheetLabel = (unit, key) => (unit === 'day' ? formatDate(key) : bucketTip(unit, key));

const stat = (label, value, meta = '', hero = false) => html`
  <div class="stat ${hero ? 'stat--hero' : ''}"><span class="stat__label">${label}</span><span class="stat__value">${value}</span>${meta ? html`<span class="stat__meta">${meta}</span>` : ''}</div>`;
const moneyValue = (v) => html`${formatMoney(v, { currency: false })}<small>ج.م</small>`;

/** On-screen table for a column spec shared with the Excel/PDF export. */
const table = ({ columns, rows, totals }) => (rows.length ? html`
  <div class="table-wrap"><table class="table table--stack">
    <thead><tr>${columns.map((c) => html`<th class="${['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}">${c.header}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${columns.map((c) => html`<td data-label="${c.header}" class="${['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}">${c.link ? html`<a href="${c.link(r)}">${cellText(c, r)}</a>` : cellText(c, r)}</td>`)}</tr>`)}
      ${totals ? html`<tr class="table__total">${columns.map((c) => html`<td data-label="${c.header}" class="${['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}"><strong>${(c.value ? c.value(totals) : totals[c.key]) === undefined ? '' : cellText(c, totals)}</strong></td>`)}</tr>` : ''}
    </tbody></table></div>` : html`<p class="muted">لا توجد بيانات في هذه الفترة.</p>`);

const card = (title, body, { span = 12, sub = '' } = {}) => html`
  <section class="card span-${span}"><div class="card__header"><div class="card__heading"><h2 class="card__title">${title}</h2>${sub ? html`<p class="card__subtitle">${sub}</p>` : ''}</div></div>
    <div class="card__body">${body}</div></section>`;

const patientLink = (r) => href('/patients/:id', { id: r.patientId });

/* ---------- Tab builders: each returns { view, charts, export } ---------- */

async function financeTab(from, to) {
  const r = await financialReport(from, to);
  const methods = { header: 'طريقة الدفع', key: 'label' };
  const sections = [
    { name: 'حسب الفترة', heading: r.unit === 'day' ? 'الإيراد والمصروفات حسب اليوم' : 'الإيراد والمصروفات حسب الشهر', columns: [{ header: r.unit === 'day' ? 'اليوم' : 'الشهر', key: 'label' }, { header: 'المقبوضات', key: 'income', type: 'money' }, { header: 'المصروفات', key: 'expenses', type: 'money' }, { header: 'الصافي', key: 'net', type: 'money' }],
      rows: r.series.map((s) => ({ ...s, label: bucketSheetLabel(r.unit, s.key) })), totals: { label: 'الإجمالي', income: r.collections, expenses: r.expenses, net: r.net } },
    { name: 'طرق الدفع', heading: 'المقبوضات حسب طريقة الدفع', columns: [methods, { header: 'المبلغ', key: 'amount', type: 'money' }, { header: 'النسبة', key: 'share', type: 'percent' }],
      rows: r.byMethod.map((m) => ({ label: PAYMENT_METHODS[m.method]?.label ?? m.method, amount: m.amount, share: r.collections ? m.amount / r.collections : 0 })), totals: { label: 'الإجمالي', amount: r.collections } },
    { name: 'المصروفات', heading: 'المصروفات حسب التصنيف', columns: [{ header: 'التصنيف', key: 'name' }, { header: 'المبلغ', key: 'amount', type: 'money' }, { header: 'النسبة', key: 'share', type: 'percent' }],
      rows: r.byCategory.map((c) => ({ ...c, share: r.expenses ? c.amount / r.expenses : 0 })), totals: { name: 'الإجمالي', amount: r.expenses } },
    { name: 'حسب الموظف', heading: 'المقبوضات حسب الموظف', columns: [{ header: 'الموظف', key: 'name' }, { header: 'المبلغ', key: 'amount', type: 'money' }], rows: r.byUser },
    { name: 'المدفوعات', heading: 'تفاصيل المدفوعات', detail: true, columns: [{ header: 'التاريخ', key: 'date', type: 'date' }, { header: 'رقم الإيصال', key: 'receiptNo', value: (p) => `RC-${String(p.receiptNo).padStart(5, '0')}` }, { header: 'المريض', key: 'patientName', link: patientLink }, { header: 'الطريقة', key: 'method', value: (p) => PAYMENT_METHODS[p.method]?.label ?? p.method }, { header: 'المبلغ', key: 'amount', type: 'money' }, { header: 'بواسطة', key: 'userName' }],
      rows: r.payments, totals: { patientName: 'الإجمالي', amount: r.collections } },
    { name: 'تفاصيل المصروفات', heading: 'تفاصيل المصروفات', detail: true, columns: [{ header: 'التاريخ', key: 'date', type: 'date' }, { header: 'التصنيف', key: 'categoryName' }, { header: 'البيان', key: 'description' }, { header: 'المبلغ', key: 'amount', type: 'money' }],
      rows: r.expenseRows, totals: { description: 'الإجمالي', amount: r.expenses } },
  ];
  const margin = r.collections ? r.net / r.collections : null;
  return {
    summary: [['المقبوضات', money(r.collections)], ['المصروفات', money(r.expenses)], ['صافي الربح', money(r.net)], ['قيمة الفواتير', money(r.billed)]],
    view: html`
      <div class="stat-grid">
        ${stat('المقبوضات', moneyValue(r.collections), tr`${digits(r.paymentsCount)} عملية دفع`, true)}
        ${stat('المصروفات', moneyValue(r.expenses), 'شاملة المعامل والمشتريات المسجلة')}
        ${stat('صافي الربح', moneyValue(r.net), margin === null ? '' : tr`هامش ${formatPercent(margin * 100, { decimals: 1 })} من المقبوضات`)}
        ${stat('قيمة الفواتير', moneyValue(r.billed), tr`${digits(r.invoicesCount)} فاتورة${r.discounts ? tr` · خصومات ${formatMoney(r.discounts)}` : ''}`)}
      </div>
      <div class="bento">
        ${card(r.unit === 'day' ? 'المقبوضات والمصروفات يوميًا' : 'المقبوضات والمصروفات شهريًا', html`<div class="chart-box" data-chart-slot="cash"></div>`, { sub: 'مرّر على العمود لرؤية القيم' })}
        ${card('طرق الدفع', r.byMethod.length ? barList(sections[1].rows.map((m) => ({ label: m.label, value: m.amount, text: `${money(m.amount)} · ${formatPercent(m.share * 100, { decimals: 0 })}` }))) : html`<p class="muted">لا توجد مدفوعات.</p>`, { span: 6 })}
        ${card('المصروفات حسب التصنيف', r.byCategory.length ? barList(r.byCategory.map((c) => ({ label: c.name, value: c.amount, text: money(c.amount) }))) : html`<p class="muted">لا توجد مصروفات.</p>`, { span: 6 })}
        ${card(sections[0].heading, table(sections[0]))}
        ${card(sections[4].heading, table(sections[4]))}
      </div>`,
    charts: { cash: { labels: r.series.map((s) => bucketLabel(r.unit, s.key)), tipLabels: r.series.map((s) => bucketTip(r.unit, s.key)), series: [{ name: 'المقبوضات', values: r.series.map((s) => s.income) }, { name: 'المصروفات', values: r.series.map((s) => s.expenses) }], format: money, tick: (v) => compactMoney(v), label: 'المقبوضات والمصروفات' } },
    sections,
  };
}

const compactMoney = (piasters) => {
  const v = piasters / 100;
  return v >= 1e6 ? `${digits(+(v / 1e6).toFixed(1))}M` : v >= 1e3 ? `${digits(+(v / 1e3).toFixed(1))}K` : digits(Math.round(v));
};

async function treatmentsTab(from, to) {
  const r = await treatmentsReport(from, to);
  const groupCols = (first) => [{ header: first, key: 'name' }, { header: 'العدد', key: 'count', type: 'number' }, { header: 'القيمة', key: 'value', type: 'money' }, { header: 'تكلفة الخامات', key: 'materials', type: 'money' }, { header: 'الربح التقريبي', key: 'margin', type: 'money' }];
  const totals = { name: 'الإجمالي', count: r.count, value: r.value, materials: r.materials, margin: r.margin };
  const sections = [
    { name: 'حسب الإجراء', heading: 'العلاجات المنتهية حسب الإجراء', columns: groupCols('الإجراء'), rows: r.byProcedure, totals },
    { name: 'حسب الطبيب', heading: 'حسب الطبيب', columns: groupCols('الطبيب'), rows: r.byDoctor, totals },
    { name: 'حسب التصنيف', heading: 'حسب التصنيف', columns: groupCols('التصنيف'), rows: r.byCategory, totals },
    { name: 'التفاصيل', heading: 'كل البنود المنتهية', detail: true, columns: [{ header: 'التاريخ', key: 'day', type: 'date' }, { header: 'الإجراء', key: 'procedureName', link: patientLink }, { header: 'الأسنان', key: 'teeth', value: (x) => x.teeth?.join(', ') || '' }, { header: 'الطبيب', key: 'doctor' }, { header: 'القيمة', key: 'value', type: 'money' }, { header: 'الخامات', key: 'materials', type: 'money' }, { header: 'مُفوتر', key: 'invoiced', value: (x) => (x.invoiced ? 'نعم' : 'لا') }],
      rows: r.rows, totals: { procedureName: 'الإجمالي', value: r.value, materials: r.materials } },
  ];
  return {
    summary: [['عدد العلاجات', digits(r.count)], ['قيمة العمل المنجز', money(r.value)], ['تكلفة الخامات', money(r.materials)]],
    view: html`
      <div class="stat-grid">
        ${stat('قيمة العمل المنجز', moneyValue(r.value), tr`${digits(r.count)} بند منتهٍ`, true)}
        ${stat('تكلفة الخامات الفعلية', moneyValue(r.materials), 'من خصم المخزون عند «تم»')}
        ${stat('الربح التقريبي', moneyValue(r.margin), 'القيمة ناقص الخامات (بدون المصروفات الثابتة)')}
        ${stat('لم تُفوتر بعد', moneyValue(r.uninvoiced), r.uninvoiced ? html`<a href="#/billing">إنشاء الفواتير</a>` : 'كل البنود مفوترة')}
      </div>
      <div class="bento">
        ${card('أكثر الإجراءات قيمة', r.byProcedure.length ? barList(r.byProcedure.slice(0, 10).map((g) => ({ label: g.name, sub: `× ${digits(g.count)}`, value: g.value, text: money(g.value) }))) : html`<p class="muted">لا توجد علاجات منتهية في هذه الفترة.</p>`, { span: 7 })}
        ${card('حسب الطبيب', r.byDoctor.length ? barList(r.byDoctor.map((g) => ({ label: g.name, sub: `× ${digits(g.count)}`, value: g.value, text: money(g.value) }))) : html`<p class="muted">—</p>`, { span: 5 })}
        ${card(sections[0].heading, table(sections[0]))}
        ${card(sections[2].heading, table(sections[2]))}
      </div>`,
    charts: {},
    sections,
  };
}

async function patientsTab(from, to) {
  const r = await patientsReport(from, to);
  const sections = [
    { name: 'المرضى الجدد', heading: 'المرضى الجدد', detail: true, columns: [{ header: 'تاريخ التسجيل', key: 'createdAt', type: 'date', value: (p) => toISODate(new Date(p.createdAt)) }, { header: 'رقم الملف', key: 'fileNo' }, { header: 'الاسم', key: 'name', link: (p) => href('/patients/:id', { id: p.id }) }, { header: 'الموبايل', key: 'phone' }, { header: 'مصدر المعرفة', key: 'referralSource', value: (p) => REFERRAL_SOURCES[p.referralSource] ?? '' }],
      rows: r.newPatients },
    { name: 'مصدر المعرفة', heading: 'كيف عرفوا العيادة', columns: [{ header: 'المصدر', key: 'label' }, { header: 'العدد', key: 'count', type: 'number' }], rows: r.bySource.map((s) => ({ label: REFERRAL_SOURCES[s.key] ?? 'غير مسجل', count: s.count })) },
    { name: 'الفئات العمرية', heading: 'الفئات العمرية', columns: [{ header: 'الفئة', key: 'key' }, { header: 'العدد', key: 'count', type: 'number' }], rows: r.byAge },
    { name: 'النوع', heading: 'النوع', columns: [{ header: 'النوع', key: 'label' }, { header: 'العدد', key: 'count', type: 'number' }], rows: r.byGender.map((g) => ({ label: GENDER_LABELS[g.key] ?? 'غير مسجل', count: g.count })) },
  ];
  return {
    summary: [['مرضى جدد', digits(r.newCount)], ['مرضى تمت زيارتهم', digits(r.activeCount)], ['إجمالي الملفات', digits(r.total)]],
    view: html`
      <div class="stat-grid">
        ${stat('مرضى جدد', digits(r.newCount), 'سُجّلت ملفاتهم في الفترة', true)}
        ${stat('مرضى تمت زيارتهم', digits(r.activeCount), 'زيارة منتهية أو علاج منتهٍ')}
        ${stat('إجمالي الملفات', digits(r.total))}
      </div>
      <div class="bento">
        ${card(r.unit === 'day' ? 'المرضى الجدد يوميًا' : 'المرضى الجدد شهريًا', html`<div class="chart-box" data-chart-slot="new"></div>`)}
        ${card('كيف عرفوا العيادة', sections[1].rows.length ? barList(sections[1].rows.map((s) => ({ label: s.label, value: s.count }))) : html`<p class="muted">—</p>`, { span: 6 })}
        ${card('الفئات العمرية', sections[2].rows.length ? barList(sections[2].rows.map((s) => ({ label: s.key, value: s.count }))) : html`<p class="muted">—</p>`, { span: 6 })}
        ${card(sections[0].heading, table(sections[0]))}
      </div>`,
    charts: { new: { labels: r.series.map((s) => bucketLabel(r.unit, s.key)), tipLabels: r.series.map((s) => bucketTip(r.unit, s.key)), series: [{ name: 'مرضى جدد', values: r.series.map((s) => s.count) }], label: 'المرضى الجدد' } },
    sections,
  };
}

async function appointmentsTab(from, to) {
  const r = await appointmentsReport(from, to);
  const sections = [
    { name: 'حسب الحالة', heading: 'المواعيد حسب الحالة', columns: [{ header: 'الحالة', key: 'label' }, { header: 'العدد', key: 'count', type: 'number' }], rows: r.byStatus.map((s) => ({ label: APPT_STATUS[s.status]?.label ?? s.status, count: s.count })) },
    { name: 'حسب الطبيب', heading: 'حسب الطبيب', columns: [{ header: 'الطبيب', key: 'name' }, { header: 'المواعيد', key: 'total', type: 'number' }, { header: 'انتهى', key: 'done', type: 'number' }, { header: 'لم يحضر', key: 'noShow', type: 'number' }, { header: 'ساعات العمل', key: 'hours', type: 'number', value: (d) => Math.round((d.minutes / 60) * 10) / 10 }], rows: r.byDoctor },
    { name: 'حسب اليوم', heading: 'حسب أيام الأسبوع', columns: [{ header: 'اليوم', key: 'label' }, { header: 'المواعيد', key: 'count', type: 'number' }], rows: r.byWeekday.map((w) => ({ label: WEEKDAYS[w.wd], count: w.count })) },
  ];
  return {
    summary: [['المواعيد', digits(r.total)], ['انتهى', digits(r.done)], ['نسبة عدم الحضور', formatPercent(r.noShowRate * 100)]],
    view: html`
      <div class="stat-grid">
        ${stat('المواعيد', digits(r.total), tr`${digits(r.cancelled)} ملغي غير محسوب`, true)}
        ${stat('زيارات منتهية', digits(r.done))}
        ${stat('نسبة عدم الحضور', formatPercent(r.noShowRate * 100), tr`${digits(r.noShow)} موعد`)}
        ${stat('المتابعات', `${digits(r.followUps.done)} / ${digits(r.followUps.total)}`, r.followUps.pending ? tr`${digits(r.followUps.pending)} لم تتم بعد` : 'تمت كلها')}
      </div>
      <div class="bento">
        ${card(r.unit === 'day' ? 'المواعيد يوميًا' : 'المواعيد شهريًا', html`<div class="chart-box" data-chart-slot="appts"></div>`)}
        ${card('أيام الأسبوع الأكثر ازدحامًا', barList(sections[2].rows.map((w) => ({ label: w.label, value: w.count }))), { span: 6 })}
        ${card('حسب الحالة', sections[0].rows.length ? barList(sections[0].rows.map((s) => ({ label: s.label, value: s.count }))) : html`<p class="muted">—</p>`, { span: 6 })}
        ${card(sections[1].heading, table(sections[1]))}
      </div>`,
    charts: { appts: { labels: r.series.map((s) => bucketLabel(r.unit, s.key)), tipLabels: r.series.map((s) => bucketTip(r.unit, s.key)), series: [{ name: 'المواعيد', values: r.series.map((s) => s.count) }], label: 'المواعيد' } },
    sections,
  };
}

async function receivablesTab() {
  const r = await receivablesReport();
  const instCols = [{ header: 'الاستحقاق', key: 'dueDate', type: 'date' }, { header: 'المريض', key: 'patientName', value: (i) => i.invoice.patientName, link: (i) => href('/patients/:id', { id: i.invoice.patientId }, { tab: 'payments' }) }, { header: 'الفاتورة', key: 'inv', value: (i) => `INV-${String(i.invoice.number).padStart(5, '0')}` }, { header: 'المتبقي من القسط', key: 'remainingOnInstallment', type: 'money' }];
  const sections = [
    { name: 'الأرصدة', heading: 'الأرصدة المستحقة على المرضى', columns: [{ header: 'المريض', key: 'patientName', link: (x) => href('/patients/:id', { id: x.patientId }, { tab: 'payments' }) }, { header: 'إجمالي الفواتير', key: 'billed', type: 'money' }, { header: 'المدفوع', key: 'paid', type: 'money' }, { header: 'المتبقي', key: 'balance', type: 'money' }], rows: r.balances, totals: { patientName: 'الإجمالي', balance: r.total } },
    { name: 'أقساط متأخرة', heading: 'أقساط متأخرة', columns: instCols, rows: r.overdue, totals: { dueDate: undefined, patientName: 'الإجمالي', remainingOnInstallment: r.overdueTotal } },
    { name: 'أقساط 30 يوم', heading: 'أقساط مستحقة خلال 30 يومًا', columns: instCols, rows: r.upcoming30, totals: { remainingOnInstallment: r.upcomingTotal } },
  ];
  return {
    summary: [['إجمالي المستحق', money(r.total)], ['أقساط متأخرة', money(r.overdueTotal)]],
    view: html`
      <div class="stat-grid">
        ${stat('إجمالي المستحق', moneyValue(r.total), tr`على ${digits(r.balances.length)} مريض`, true)}
        ${stat('أقساط متأخرة', moneyValue(r.overdueTotal), tr`${digits(r.overdue.length)} قسط`)}
        ${stat('مستحق خلال 30 يومًا', moneyValue(r.upcomingTotal), tr`${digits(r.upcoming30.length)} قسط`)}
      </div>
      <div class="bento">${sections.map((s) => card(s.heading, table(s)))}</div>`,
    charts: {},
    sections,
    noPeriod: true,
  };
}

async function inventoryTab(from, to) {
  const r = await inventoryReport(from, to);
  const sections = [
    { name: 'الاستهلاك', heading: 'استهلاك ومشتريات الخامات', columns: [{ header: 'الصنف', key: 'name' }, { header: 'الكمية المستهلكة', key: 'consumed', value: (x) => `${x.consumedQty} ${unitLabel(x.unit)}` }, { header: 'تكلفة المستهلك', key: 'consumedCost', type: 'money' }, { header: 'الكمية المشتراة', key: 'purchased', value: (x) => (x.purchasedQty ? `${x.purchasedQty} ${unitLabel(x.unit)}` : '') }, { header: 'قيمة المشتريات', key: 'purchasedCost', type: 'money' }],
      rows: r.rows, totals: { name: 'الإجمالي', consumedCost: r.consumedCost, purchasedCost: r.purchasedCost } },
  ];
  return {
    summary: [['تكلفة الخامات المستهلكة', money(r.consumedCost)], ['المشتريات', money(r.purchasedCost)], ['قيمة المخزون الحالي', money(r.stockValue)]],
    view: html`
      <div class="stat-grid">
        ${stat('تكلفة الخامات المستهلكة', moneyValue(r.consumedCost), '', true)}
        ${stat('المشتريات', moneyValue(r.purchasedCost))}
        ${stat('قيمة المخزون الحالي', moneyValue(r.stockValue), r.lowCount ? html`<a href="#/inventory?tab=alerts">${digits(r.lowCount)} صنف يحتاج شراء</a>` : '')}
      </div>
      <div class="bento">
        ${card('أكثر الخامات تكلفة', r.rows.some((x) => x.consumedCost > 0) ? barList(r.rows.filter((x) => x.consumedCost > 0).slice(0, 10).map((x) => ({ label: x.name, value: x.consumedCost, text: money(x.consumedCost) }))) : html`<p class="muted">لا يوجد استهلاك مسجل في هذه الفترة.</p>`)}
        ${card(sections[0].heading, table(sections[0]))}
      </div>`,
    charts: {},
    sections,
  };
}

const BUILDERS = { finance: financeTab, treatments: treatmentsTab, patients: patientsTab, appointments: appointmentsTab, receivables: receivablesTab, inventory: inventoryTab };

export default {
  title: 'التقارير',
  async render({ el, query, signal }) {
    const tab = BUILDERS[query.tab] ? query.tab : 'finance';
    const preset = PRESETS[query.preset] ? query.preset : (query.from && query.to ? '' : 'month');
    const [from, to] = preset ? presetRange(preset) : [query.from, query.to];
    const canExport = can('reports', 'export');
    const periodText = from === to ? formatDate(from) : tr`من ${formatDate(from)} إلى ${formatDate(to)}`;
    const qs = (extra) => ({ tab, ...(preset ? { preset } : { from, to }), ...extra });

    render(el, html`
      <header class="page-header">
        <div class="page-header__text"><h1 class="page-header__title">التقارير</h1><p class="page-header__sub" id="rp-period">${periodText}</p></div>
        <div class="page-header__actions">${canExport ? html`
          <button type="button" class="btn" data-pdf>${ico('printer')} PDF / طباعة</button>
          <button type="button" class="btn btn--primary" data-xlsx>${ico('file-spreadsheet')} Excel</button>` : ''}</div>
      </header>
      <nav class="tabs" aria-label="أنواع التقارير">
        ${TABS.map(([k, label, icon]) => html`<a class="tab" href="${href('/reports', {}, { ...qs(), tab: k })}" aria-selected="${String(k === tab)}">${ico(icon, { size: 18 })} ${label}</a>`)}
      </nav>
      ${tab === 'receivables' ? html`<p class="muted" style="margin-block-end: var(--sp-4)">${ico('info', { size: 16 })} المستحقات تُحسب حتى اليوم، ولا تتأثر بالفترة.</p>` : html`
        <form class="period-bar" id="rp-form" novalidate>
          <div class="chips">${Object.entries(PRESETS).map(([k, label]) => html`<a class="chip" href="${href('/reports', {}, { tab, preset: k })}" aria-pressed="${String(k === preset)}">${label}</a>`)}</div>
          ${dateField({ name: 'from', label: 'من', value: from })}
          ${dateField({ name: 'to', label: 'إلى', value: to })}
          <button type="submit" class="btn btn--soft">${ico('filter', { size: 18 })} عرض</button>
        </form>`}
      <div id="rp-body">${loadingState('جارٍ تجهيز التقرير…')}</div>`);
    const form = el.querySelector('#rp-form');
    if (form) enhanceDateFields(form, signal);

    on(el, 'submit', '#rp-form', (e, f) => {
      e.preventDefault();
      const a = parseDateInput(/** @type {HTMLInputElement} */ (f.querySelector('[name=from]')).value);
      const b = parseDateInput(/** @type {HTMLInputElement} */ (f.querySelector('[name=to]')).value);
      if (!a || !b) { toastError('تاريخ غير صحيح'); return; }
      if (a > b) { toastError('تاريخ البداية بعد تاريخ النهاية'); return; }
      navigate(`/reports?${new URLSearchParams({ tab, from: a, to: b })}`);
    }, { signal });

    let built;
    try { built = await BUILDERS[tab](from, to); } catch (err) {
      render(el.querySelector('#rp-body'), html`<div class="card">${emptyState({ icon: 'triangle-alert', title: 'تعذّر تجهيز التقرير', hint: err.message })}</div>`);
      return;
    }
    if (signal.aborted) return;
    const body = el.querySelector('#rp-body');
    render(body, built.view);
    for (const [slot, opts] of Object.entries(built.charts)) {
      const box = body.querySelector(`[data-chart-slot="${slot}"]`);
      if (box) mountChart(box, opts, signal);
    }
    wireCharts(body, signal);

    const tabLabel = TABS.find(([k]) => k === tab)[1];
    const sub = built.noPeriod ? tr`حتى ${formatDate(todayISO())}` : periodText;
    on(el, 'click', '[data-xlsx]', async (_, b) => {
      b.disabled = true;
      try {
        await inArabicAsync(() => exportExcel({ fileName: `ganah-report-${tab}-${from}_${to}`, title: tr`تقرير ${tabLabel}`, subtitle: built.noPeriod ? tr`حتى ${formatDate(todayISO())}` : periodText, sheets: built.sections.map((s) => ({ name: s.name, columns: s.columns, rows: s.rows, totals: s.totals })) }));
        toastSuccess('تم تنزيل ملف Excel');
      } catch (err) { toastError(err.message); } finally { b.disabled = false; }
    }, { signal });
    on(el, 'click', '[data-pdf]', () => inArabic(() => printReport({ title: tr`تقرير ${tabLabel}`, subtitle: built.noPeriod ? tr`حتى ${formatDate(todayISO())}` : periodText, summary: built.summary, sections: built.sections })), { signal });
  },
};
