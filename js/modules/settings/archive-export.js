/**
 * Builds the full patient archive as one Excel workbook (a sheet per kind of record, every
 * row tagged with the file number) or one printable PDF (a section per patient).
 * The same column definitions feed both.
 */
import { html } from '../../core/dom.js';
import { formatDate, formatDateTime, formatMoney, digits, todayISO } from '../../core/format.js';
import { formatClock } from '../../core/time.js';
import {
  GENDER_LABELS, REFERRAL_SOURCES, APPT_STATUS, TREATMENT_STATUS, PLAN_STATUS, INVOICE_STATUS, PAYMENT_METHODS,
  FOLLOWUP_TYPES, FOLLOWUP_STATUS, LAB_STATUS, LAB_WORK_TYPES,
} from '../../core/labels.js';
import { getSettings } from '../../data/settings.js';
import { exportExcel, printTable } from '../../components/export.js';
import { printHTML } from '../../components/print.js';
import { formatInvoiceNo, formatReceiptNo } from '../../services/billing.js';
import { formatRxNo } from '../../services/prescriptions.js';
import { collectArchive, logArchiveExport } from '../../services/patient-archive.js';

const who = [{ header: 'رقم الملف', key: 'fileNo', width: 12 }, { header: 'المريض', key: 'patientName', width: 24 }];
const lbl = (map) => (k) => map[k]?.label ?? map[k] ?? k ?? '';

const COLS = {
  patients: [
    { header: 'رقم الملف', key: 'fileNo', width: 12 }, { header: 'الاسم', key: 'name', width: 26 },
    { header: 'الموبايل', key: 'phone', width: 14 }, { header: 'موبايل آخر', key: 'phone2', width: 14 },
    { header: 'النوع', key: 'g', value: (p) => GENDER_LABELS[p.gender] ?? '' }, { header: 'العمر', key: 'age', type: 'number', width: 7 },
    { header: 'تاريخ الميلاد', key: 'dob', type: 'date' }, { header: 'العنوان', key: 'address' }, { header: 'المهنة', key: 'occupation' },
    { header: 'مصدر المعرفة', key: 'src', value: (p) => REFERRAL_SOURCES[p.referralSource] ?? '' },
    { header: 'التاريخ الطبي', key: 'medicalText', width: 34 }, { header: 'حساسية أخرى', key: 'ao', value: (p) => p.medical?.allergyOther ?? '' },
    { header: 'أدوية يتناولها', key: 'meds', value: (p) => p.medical?.medications ?? '' }, { header: 'ملاحظات طبية', key: 'mn', value: (p) => p.medical?.notes ?? '' },
    { header: 'ملاحظات', key: 'notes' }, { header: 'عدد المواعيد', key: 'appointmentsCount', type: 'number', width: 9 },
    { header: 'آخر زيارة', key: 'lastVisit', type: 'date' }, { header: 'إجمالي الفواتير', key: 'billed', type: 'money' },
    { header: 'المدفوع', key: 'paid', type: 'money' }, { header: 'المتبقي', key: 'balance', type: 'money' },
    { header: 'صور وأشعة', key: 'photosCount', type: 'number', width: 9 }, { header: 'تاريخ التسجيل', key: 'registered', type: 'date' },
    { header: 'ملاحظة', key: 'flag', value: (p) => [p.deletedAt ? 'محذوف' : '', p.isDemo ? 'تجريبي' : ''].filter(Boolean).join('، ') },
  ],
  appointments: [
    ...who, { header: 'التاريخ', key: 'date', type: 'date' }, { header: 'الوقت', key: 't', value: (a) => formatClock(a.startMin), width: 9 },
    { header: 'المدة (دقيقة)', key: 'duration', type: 'number', width: 9 }, { header: 'الطبيب', key: 'doctor' }, { header: 'الكرسي', key: 'chair', width: 10 },
    { header: 'الإجراءات', key: 'pr', width: 28, value: (a) => (a.procedureNames ?? []).join('، ') }, { header: 'الحالة', key: 's', value: (a) => lbl(APPT_STATUS)(a.status) },
    { header: 'سبب الزيارة', key: 'reason' }, { header: 'ملاحظات الحجز', key: 'notes' }, { header: 'ملاحظات الطبيب', key: 'clinicalNotes', width: 30 },
    { header: 'سبب الإلغاء', key: 'cancelReason' },
  ],
  treatments: [
    ...who, { header: 'الخطة', key: 'planName' }, { header: 'حالة الخطة', key: 'ps', value: (i) => lbl(PLAN_STATUS)(i.planStatus) },
    { header: 'الإجراء', key: 'procedureName', width: 24 }, { header: 'الأسنان', key: 'th', value: (i) => (i.teeth ?? []).join(', '), width: 12 },
    { header: 'الأسطح', key: 'sf', value: (i) => (i.surfaces ?? []).join(''), width: 8 }, { header: 'السعر', key: 'gross', type: 'money' },
    { header: 'الخصم', key: 'discount', type: 'money' }, { header: 'الإجمالي', key: 'total', type: 'money' },
    { header: 'الحالة', key: 'st', value: (i) => lbl(TREATMENT_STATUS)(i.status) }, { header: 'الجلسات', key: 'ss', value: (i) => `${i.sessionsDone ?? 0}/${i.sessionsPlanned ?? 1}`, width: 8 },
    { header: 'تاريخ الانتهاء', key: 'doneDay', type: 'date' }, { header: 'الطبيب', key: 'doctor' },
    { header: 'الفاتورة', key: 'inv', value: (i) => (i.invoiceNo ? formatInvoiceNo(i.invoiceNo) : ''), width: 12 }, { header: 'ملاحظات', key: 'notes' },
  ],
  invoices: [
    { header: 'رقم الفاتورة', key: 'no', value: (i) => formatInvoiceNo(i.number), width: 12 }, { header: 'التاريخ', key: 'date', type: 'date' }, ...who,
    { header: 'البنود', key: 'ln', width: 36, value: (i) => i.lines.map((l) => l.description).join('، ') },
    { header: 'قبل الخصم', key: 'subtotal', type: 'money' }, { header: 'الخصم', key: 'discount', type: 'money' }, { header: 'الإجمالي', key: 'total', type: 'money' },
    { header: 'المدفوع', key: 'paid', type: 'money' }, { header: 'المتبقي', key: 'remaining', type: 'money' },
    { header: 'الحالة', key: 'st', value: (i) => lbl(INVOICE_STATUS)(i.status) }, { header: 'سبب الإلغاء', key: 'voidReason' }, { header: 'ملاحظات', key: 'notes' },
  ],
  payments: [
    { header: 'رقم الإيصال', key: 'no', value: (p) => formatReceiptNo(p.receiptNo), width: 12 }, { header: 'التاريخ', key: 'date', type: 'date' }, ...who,
    { header: 'الفاتورة', key: 'inv', value: (p) => (p.invoiceNo ? formatInvoiceNo(p.invoiceNo) : 'تحت الحساب'), width: 12 },
    { header: 'المبلغ', key: 'amount', type: 'money' }, { header: 'الطريقة', key: 'm', value: (p) => lbl(PAYMENT_METHODS)(p.method) },
    { header: 'بواسطة', key: 'userName' }, { header: 'ملاحظة', key: 'note' }, { header: 'الحالة', key: 'v', value: (p) => (p.voided ? `ملغي: ${p.voidReason ?? ''}` : 'ساري') },
  ],
  prescriptions: [
    { header: 'رقم الروشتة', key: 'no', value: (r) => formatRxNo(r.number), width: 11 }, { header: 'التاريخ', key: 'date', type: 'date' }, ...who,
    { header: 'الطبيب', key: 'doctorName' }, { header: 'الأدوية', key: 'dr', width: 50, value: (r) => (r.lines ?? []).map((l) => [l.name, l.dose, l.duration].filter(Boolean).join(' — ')).join(' | ') },
    { header: 'تعليمات', key: 'notes' },
  ],
  followUps: [
    ...who, { header: 'التاريخ', key: 'dueDate', type: 'date' }, { header: 'النوع', key: 't', value: (f) => lbl(FOLLOWUP_TYPES)(f.type) },
    { header: 'الإجراء', key: 'procedureName' }, { header: 'ملاحظة', key: 'note' }, { header: 'الحالة', key: 's', value: (f) => lbl(FOLLOWUP_STATUS)(f.status) },
    { header: 'النتيجة', key: 'outcome', width: 26 },
  ],
  labCases: [
    ...who, { header: 'تاريخ الإرسال', key: 'sentAt', type: 'date' }, { header: 'المعمل', key: 'labName' }, { header: 'العمل', key: 'w', value: (c) => LAB_WORK_TYPES[c.workType] ?? '' },
    { header: 'الأسنان', key: 'th', value: (c) => (c.teeth ?? []).join(', ') }, { header: 'اللون', key: 'shade', width: 8 }, { header: 'الخامة', key: 'material' },
    { header: 'المرحلة', key: 's', value: (c) => lbl(LAB_STATUS)(c.status) }, { header: 'الاستلام المتوقع', key: 'expectedAt', type: 'date' }, { header: 'التكلفة', key: 'cost', type: 'money' },
  ],
};

const SHEETS = [
  ['patients', 'المرضى'], ['appointments', 'المواعيد'], ['treatments', 'العلاجات'], ['invoices', 'الفواتير'],
  ['payments', 'المدفوعات'], ['prescriptions', 'الروشتات'], ['followUps', 'المتابعات'], ['labCases', 'حالات المعمل'],
];

/** Local date and time for file names: 2026-10-24_2110 */
const stamp = () => { const d = new Date(); return `${todayISO()}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; };

/** @param {{ includeDeleted?: boolean }} o */
export async function exportArchiveExcel(o = {}) {
  const a = await collectArchive(o);
  await exportExcel({
    fileName: `ganah-all-patients-${stamp()}`,
    title: 'بيانات كل المرضى',
    subtitle: `${digits(a.patients.length)} مريض · ${formatDateTime(a.generatedAt)}`,
    sheets: SHEETS.map(([key, name]) => ({ name, columns: COLS[key], rows: a[key] })),
  });
  await logArchiveExport('Excel', a.patients.length);
  return a.patients.length;
}

/**
 * Columns for a table inside one patient's section: no file number / patient name, and no
 * column that is empty in every row (keeps the PDF readable).
 */
const own = (cols, rows) => cols.filter((c) => c.key !== 'fileNo' && c.key !== 'patientName' && rows.some((r) => {
  const v = c.value ? c.value(r) : r[c.key];
  return v !== '' && v != null && !(Array.isArray(v) && !v.length);
}));

function patientSection(p, a) {
  const of = (key) => a[key].filter((r) => r.patientId === p.id);
  const sections = [['appointments', 'المواعيد'], ['treatments', 'العلاجات'], ['invoices', 'الفواتير'], ['payments', 'المدفوعات'], ['prescriptions', 'الروشتات'], ['followUps', 'المتابعات'], ['labCases', 'حالات المعمل']];
  const m = p.medical ?? {};
  return html`<section class="arch-patient">
    <h2 class="arch-patient__name">${p.name} <span class="ltr">${digits(p.fileNo)}</span>${p.deletedAt ? ' (محذوف)' : ''}${p.isDemo ? ' (تجريبي)' : ''}</h2>
    <div class="inv-meta">
      ${p.phone ? html`<span>الموبايل: <strong class="ltr">${digits(p.phone)}</strong></span>` : ''}
      ${p.phone2 ? html`<span>موبايل آخر: <span class="ltr">${digits(p.phone2)}</span></span>` : ''}
      ${p.gender ? html`<span>${GENDER_LABELS[p.gender]}</span>` : ''}
      ${p.age != null ? html`<span>العمر: ${digits(p.age)}</span>` : ''}
      ${p.address ? html`<span>العنوان: ${p.address}</span>` : ''}
      ${REFERRAL_SOURCES[p.referralSource] ? html`<span>المصدر: ${REFERRAL_SOURCES[p.referralSource]}</span>` : ''}
      <span>التسجيل: ${formatDate(p.registered)}</span>
    </div>
    <p class="arch-med"><strong>التاريخ الطبي:</strong> ${p.medicalText || 'لا يوجد'}${m.allergyOther ? ` · حساسية أخرى: ${m.allergyOther}` : ''}${m.medications ? ` · الأدوية: ${m.medications}` : ''}${m.notes ? ` · ${m.notes}` : ''}</p>
    ${p.notes ? html`<p class="arch-med"><strong>ملاحظات:</strong> ${p.notes}</p>` : ''}
    <p class="arch-med"><strong>الحساب:</strong> الفواتير ${formatMoney(p.billed)} · المدفوع ${formatMoney(p.paid)} · <strong>المتبقي ${formatMoney(p.balance)}</strong></p>
    ${sections.map(([key, heading]) => {
      const rows = of(key);
      return rows.length ? html`<h3 class="print-sub">${heading} (${digits(rows.length)})</h3>${printTable({ columns: own(COLS[key], rows), rows })}` : '';
    })}
  </section>`;
}

/** Opens the print dialog with every patient (choose "Save as PDF"). */
export async function printArchive(o = {}) {
  const a = await collectArchive(o);
  const clinic = getSettings('clinic');
  printHTML(html`
    <div class="arch-cover">
      <p>${clinic.name}</p>
      <p>${digits(a.patients.length)} مريض · ${digits(a.appointments.length)} موعد · ${digits(a.invoices.length)} فاتورة · ${digits(a.payments.length)} دفعة</p>
      <p>استُخرج في ${formatDateTime(a.generatedAt)} — بيانات طبية سرية، احفظ هذا الملف في مكان آمن.</p>
    </div>
    ${a.patients.map((p) => patientSection(p, a))}`, { size: 'a4', title: 'بيانات كل المرضى' });
  await logArchiveExport('PDF', a.patients.length);
  return a.patients.length;
}
