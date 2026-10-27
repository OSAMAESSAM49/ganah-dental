/** Printouts: invoice (A4 or 80mm), payment receipt (A4 or 80mm), daily cash closing. */
import { html } from '../../core/dom.js';
import { formatMoney, formatDate, formatDateTime, digits } from '../../core/format.js';
import { PAYMENT_METHODS } from '../../core/labels.js';
import { getPref, setPref } from '../../core/prefs.js';
import { repos } from '../../data/index.js';
import { getSettings } from '../../data/settings.js';
import { printHTML } from '../../components/print.js';
import { openMenu } from '../../components/menu.js';
import { invoiceState, invoiceInstallments, patientAccount, formatInvoiceNo, formatReceiptNo, dailyClosing } from '../../services/billing.js';

/** Small menu to choose paper size, remembering the last choice. */
export function choosePrintSize(anchor, print) {
  const last = getPref('printSize', 'a4');
  openMenu(anchor, { items: [
    { label: `ورق A4${last === 'a4' ? ' ✓' : ''}`, icon: 'file-text', onSelect: () => { setPref('printSize', 'a4'); print('a4'); } },
    { label: `إيصال حراري 80مم${last === '80mm' ? ' ✓' : ''}`, icon: 'receipt', onSelect: () => { setPref('printSize', '80mm'); print('80mm'); } },
  ] });
}

const methodLabel = (m) => PAYMENT_METHODS[m]?.label ?? m;

/* ---------- Thermal (80mm) building blocks ---------- */
function thermalHeader(title) {
  const c = getSettings('clinic');
  return html`
    <div class="th-head">
      ${c.logo ? html`<img src="${c.logo}" alt="" class="th-logo">` : ''}
      <div class="th-clinic">${c.name}</div>
      <div class="th-small">${c.address}${c.phone ? html` · <span class="ltr">${c.phone}</span>` : ''}</div>
      <div class="th-title">${title}</div>
    </div>`;
}
const row = (k, v, strong = false) => html`<div class="th-row ${strong ? 'th-strong' : ''}"><span>${k}</span><span>${v}</span></div>`;

/* ---------- Invoice ---------- */
export async function printInvoice(invoiceId, size = 'a4') {
  const inv = await repos.invoices.require(invoiceId);
  const payments = (await repos.payments.findBy('invoiceId', inv.id)).filter((p) => !p.voided).sort((a, b) => a.at.localeCompare(b.at));
  const st = invoiceState(inv, payments);
  const patient = await repos.patients.get(inv.patientId, { includeDeleted: true });
  const account = await patientAccount(inv.patientId);
  const inst = invoiceInstallments(inv, st.paid);
  const no = formatInvoiceNo(inv.number);

  if (size === '80mm') {
    printHTML(html`<div class="th">
      ${thermalHeader(`فاتورة ${no}`)}
      ${row('التاريخ', formatDate(inv.date))}
      ${row('المريض', inv.patientName)}
      ${row('رقم الملف', html`<span class="ltr">${patient?.fileNo ?? ''}</span>`)}
      <hr class="th-sep">
      ${inv.lines.map((l) => html`<div class="th-line"><div>${l.description}${l.teeth?.length ? html` <span class="ltr">(${l.teeth.join(',')})</span>` : ''}</div>${row(l.discount ? `خصم ${formatMoney(l.discount)}` : '', formatMoney(l.total))}</div>`)}
      <hr class="th-sep">
      ${row('الإجمالي', formatMoney(st.subtotal))}
      ${st.discount ? row('خصم', formatMoney(st.discount)) : ''}
      ${row('الإجمالي', formatMoney(st.total), true)}
      ${row('المدفوع', formatMoney(st.paid))}
      ${row('المتبقي', formatMoney(st.remaining), true)}
      ${inst.length ? html`<hr class="th-sep"><div class="th-small">الأقساط</div>${inst.map((i) => row(formatDate(i.dueDate), `${formatMoney(i.amount)}${i.status === 'paid' ? ' ✓' : ''}`))}` : ''}
      <hr class="th-sep"><div class="th-center th-small">شكرًا لثقتكم — نتمنى لكم دوام الصحة</div>
    </div>`, { size: '80mm', header: false });
    return;
  }

  printHTML(html`
    <div class="inv-meta">
      <div><strong>رقم الفاتورة:</strong> <span class="ltr">${no}</span></div>
      <div><strong>التاريخ:</strong> ${formatDate(inv.date)}</div>
      <div><strong>المريض:</strong> ${inv.patientName}</div>
      <div><strong>رقم الملف:</strong> <span class="ltr">${patient?.fileNo ?? ''}</span></div>
      ${patient?.phone ? html`<div><strong>الموبايل:</strong> <span class="ltr">${patient.phone}</span></div>` : ''}
    </div>
    <table class="print-table">
      <thead><tr><th>#</th><th>البيان</th><th>الأسنان</th><th class="num">السعر</th><th class="num">الكمية</th><th class="num">الخصم</th><th class="num">الإجمالي</th></tr></thead>
      <tbody>${inv.lines.map((l, i) => html`<tr>
        <td>${digits(i + 1)}</td><td>${l.description}</td><td class="ltr">${l.teeth?.join(', ') || '—'}</td>
        <td class="num">${formatMoney(l.unitPrice)}</td><td class="num">${digits(l.qty)}</td>
        <td class="num">${l.discount ? formatMoney(l.discount) : '—'}</td><td class="num"><strong>${formatMoney(l.total)}</strong></td></tr>`)}</tbody>
    </table>
    <table class="print-table" style="inline-size: 55%; margin-inline-start: auto; margin-block-start: 3mm"><tbody>
      <tr><th>الإجمالي</th><td class="num">${formatMoney(st.subtotal)}</td></tr>
      ${st.discount ? html`<tr><th>خصم${inv.discountType === 'percent' ? ` (${digits(inv.discountValue)}%)` : ''}</th><td class="num">${formatMoney(st.discount)}</td></tr>` : ''}
      <tr><th>الإجمالي</th><td class="num"><strong>${formatMoney(st.total)}</strong></td></tr>
      ${inv.appliedCredit ? html`<tr><th>من الرصيد المقدم</th><td class="num">${formatMoney(inv.appliedCredit)}</td></tr>` : ''}
      <tr><th>المدفوع</th><td class="num">${formatMoney(st.paid)}</td></tr>
      <tr><th>المتبقي على الفاتورة</th><td class="num"><strong>${formatMoney(st.remaining)}</strong></td></tr>
      <tr><th>إجمالي المتبقي على المريض</th><td class="num">${formatMoney(Math.max(0, account.balance))}</td></tr>
    </tbody></table>
    ${payments.length ? html`<h2 class="print-sub">المدفوعات</h2>
      <table class="print-table"><thead><tr><th>الإيصال</th><th>التاريخ</th><th>الطريقة</th><th class="num">المبلغ</th></tr></thead>
      <tbody>${payments.map((p) => html`<tr><td class="ltr">${formatReceiptNo(p.receiptNo)}</td><td>${formatDate(p.date)}</td><td>${methodLabel(p.method)}</td><td class="num">${formatMoney(p.amount)}</td></tr>`)}</tbody></table>` : ''}
    ${inst.length ? html`<h2 class="print-sub">جدول الأقساط</h2>
      <table class="print-table"><thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th class="num">القيمة</th><th>الحالة</th></tr></thead>
      <tbody>${inst.map((i, n) => html`<tr><td>${digits(n + 1)}</td><td>${formatDate(i.dueDate)}</td><td class="num">${formatMoney(i.amount)}</td><td>${{ paid: 'مدفوع', partial: 'مدفوع جزئيًا', due: 'لم يحن', overdue: 'متأخر' }[i.status]}</td></tr>`)}</tbody></table>` : ''}
    ${inv.notes ? html`<p style="margin-block-start: 4mm">${inv.notes}</p>` : ''}
    ${inv.status === 'void' ? html`<p style="margin-block-start: 4mm; color: #C1272D; font-weight: 700">فاتورة مُبطلة: ${inv.voidReason}</p>` : ''}
    <div style="display:flex; justify-content: space-between; margin-block-start: 14mm"><span>توقيع المحاسب: ....................</span><span>ختم العيادة</span></div>`,
  { title: `فاتورة ${no}` });
}

/* ---------- Receipt ---------- */
export async function printReceipt(paymentId, size = 'a4') {
  const p = await repos.payments.require(paymentId);
  const inv = p.invoiceId ? await repos.invoices.get(p.invoiceId) : null;
  const patient = await repos.patients.get(p.patientId, { includeDeleted: true });
  const account = await patientAccount(p.patientId);
  const invState = inv ? invoiceState(inv, await repos.payments.findBy('invoiceId', inv.id)) : null;
  const no = formatReceiptNo(p.receiptNo);

  if (size === '80mm') {
    printHTML(html`<div class="th">
      ${thermalHeader(`إيصال استلام ${no}`)}
      ${row('التاريخ', formatDateTime(p.at))}
      ${row('المريض', p.patientName)}
      ${row('رقم الملف', html`<span class="ltr">${patient?.fileNo ?? ''}</span>`)}
      <hr class="th-sep">
      ${row('المبلغ المستلم', formatMoney(p.amount), true)}
      ${row('طريقة الدفع', methodLabel(p.method))}
      ${row('عن', inv ? `فاتورة ${formatInvoiceNo(inv.number)}` : 'رصيد مقدم')}
      ${invState ? row('المتبقي على الفاتورة', formatMoney(invState.remaining)) : ''}
      ${row('إجمالي المتبقي', formatMoney(Math.max(0, account.balance)), true)}
      ${p.voided ? html`<div class="th-center th-strong">— إيصال مُبطل —</div>` : ''}
      <hr class="th-sep">
      <div class="th-small">المستلم: ${p.userName ?? ''}</div>
      <div class="th-center th-small">شكرًا لكم</div>
    </div>`, { size: '80mm', header: false });
    return;
  }
  printHTML(html`
    <div class="rcpt-box">
      <div class="inv-meta">
        <div><strong>رقم الإيصال:</strong> <span class="ltr">${no}</span></div>
        <div><strong>التاريخ:</strong> ${formatDateTime(p.at)}</div>
      </div>
      <p style="font-size: 13pt; line-height: 2">
        استلمنا من السيد/ة <strong>${p.patientName}</strong> (ملف <span class="ltr">${patient?.fileNo ?? ''}</span>)
        مبلغ <strong>${formatMoney(p.amount)}</strong> (${methodLabel(p.method)})
        ${inv ? html`وذلك سدادًا من فاتورة رقم <span class="ltr">${formatInvoiceNo(inv.number)}</span>.` : 'وذلك رصيدًا مقدمًا لحساب المريض.'}
      </p>
      <table class="print-table" style="inline-size: 60%; margin-block-start: 4mm"><tbody>
        <tr><th>طريقة الدفع</th><td>${methodLabel(p.method)}</td></tr>
        ${invState ? html`<tr><th>المتبقي على الفاتورة</th><td class="num">${formatMoney(invState.remaining)}</td></tr>` : ''}
        <tr><th>إجمالي المتبقي على المريض</th><td class="num">${formatMoney(Math.max(0, account.balance))}</td></tr>
        ${p.note ? html`<tr><th>ملاحظة</th><td>${p.note}</td></tr>` : ''}
      </tbody></table>
      ${p.voided ? html`<p style="color:#C1272D; font-weight:700; margin-block-start: 4mm">إيصال مُبطل: ${p.voidReason}</p>` : ''}
      <div style="display:flex; justify-content: space-between; margin-block-start: 14mm"><span>المستلم: ${p.userName ?? ''}</span><span>التوقيع: ....................</span></div>
    </div>`, { title: 'إيصال استلام نقدية' });
}

/* ---------- Daily closing ---------- */
export async function printClosing(day, size = 'a4') {
  const c = await dailyClosing(day);
  const methods = Object.entries(c.byMethod);
  const users = Object.entries(c.byUser);
  if (size === '80mm') {
    printHTML(html`<div class="th">
      ${thermalHeader(`إقفال يومية ${formatDate(day)}`)}
      ${methods.map(([m, v]) => row(`${methodLabel(m)} (${digits(c.countByMethod[m])})`, formatMoney(v)))}
      <hr class="th-sep">${row('إجمالي المقبوضات', formatMoney(c.total), true)}
      <hr class="th-sep"><div class="th-small">حسب المستخدم</div>${users.map(([u, v]) => row(u, formatMoney(v)))}
      <hr class="th-sep">${row('فواتير اليوم', `${digits(c.invoicesCount)} · ${formatMoney(c.billed)}`)}
      ${c.voided.length ? row('إيصالات مُبطلة', digits(c.voided.length)) : ''}
      <div class="th-small">طُبع: ${formatDateTime(new Date())}</div>
    </div>`, { size: '80mm', header: false });
    return;
  }
  printHTML(html`
    <p><strong>اليوم:</strong> ${formatDate(day)}</p>
    <table class="print-table" style="inline-size: 70%"><thead><tr><th>طريقة الدفع</th><th class="num">عدد الإيصالات</th><th class="num">المبلغ</th></tr></thead>
      <tbody>${methods.map(([m, v]) => html`<tr><td>${methodLabel(m)}</td><td class="num">${digits(c.countByMethod[m])}</td><td class="num">${formatMoney(v)}</td></tr>`)}
      <tr><th>الإجمالي</th><th class="num">${digits(c.payments.length)}</th><th class="num">${formatMoney(c.total)}</th></tr></tbody></table>
    <h2 class="print-sub">حسب المستخدم</h2>
    <table class="print-table" style="inline-size: 70%"><tbody>${users.map(([u, v]) => html`<tr><td>${u}</td><td class="num">${formatMoney(v)}</td></tr>`)}</tbody></table>
    <h2 class="print-sub">تفاصيل الإيصالات</h2>
    <table class="print-table"><thead><tr><th>الإيصال</th><th>الوقت</th><th>المريض</th><th>الطريقة</th><th>المستلم</th><th class="num">المبلغ</th></tr></thead>
      <tbody>${c.payments.map((p) => html`<tr><td class="ltr">${formatReceiptNo(p.receiptNo)}</td><td>${formatDateTime(p.at).split(' ').slice(1).join(' ')}</td><td>${p.patientName}</td><td>${methodLabel(p.method)}</td><td>${p.userName ?? ''}</td><td class="num">${formatMoney(p.amount)}</td></tr>`)}</tbody></table>
    ${c.voided.length ? html`<h2 class="print-sub">إيصالات مُبطلة</h2><table class="print-table"><tbody>${c.voided.map((p) => html`<tr><td class="ltr">${formatReceiptNo(p.receiptNo)}</td><td>${p.patientName}</td><td class="num">${formatMoney(p.amount)}</td><td>${p.voidReason}</td></tr>`)}</tbody></table>` : ''}
    <p style="margin-block-start: 4mm"><strong>فواتير اليوم:</strong> ${digits(c.invoicesCount)} بإجمالي ${formatMoney(c.billed)}</p>
    <div style="display:flex; justify-content: space-between; margin-block-start: 14mm"><span>توقيع المسؤول: ....................</span><span>توقيع المدير: ....................</span></div>`,
  { title: 'إقفال اليومية' });
}

