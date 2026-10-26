/**
 * Billing: invoices, payments, installments, patient balance and ledger, daily cash closing.
 *
 * Invoice: { number, patientId, patientName, date, lines[], discountType, discountValue,
 *            appliedCredit, installments[{ id, dueDate, amount }], notes, status, voidReason }
 *   line: { treatmentItemId?, description, teeth[], qty, unitPrice, discount, total }  (piasters)
 * Payment: { receiptNo, patientId, invoiceId|null, amount, method, date, at, userName, note,
 *            voided, voidReason }
 *
 * Rules:
 *   - Invoices are never edited or deleted after creation; they are voided with a reason.
 *   - A payment without an invoice is an advance (credit on the patient's account).
 *     Credit can be applied to a later invoice (appliedCredit).
 *   - Patient balance = Σ invoice totals − Σ payments (non-void).
 *   - Installments are covered in due-date order by the invoice's paid amount.
 */
import { repos, nextCounter } from '../data/index.js';
import { newId } from '../data/repository.js';
import { currentUser } from '../core/session.js';
import { ownsOrAdmin } from '../core/permissions.js';
import { todayISO, toISODate } from '../core/format.js';
import { itemMath } from './treatment.js';
import { logEvent } from './audit.js';

export class BillingError extends Error {
  constructor(message) { super(message); this.name = 'BillingError'; }
}

export const formatInvoiceNo = (n) => `INV-${String(n).padStart(5, '0')}`;
export const formatReceiptNo = (n) => `RC-${String(n).padStart(5, '0')}`;

/* ---------- Pure math (exported for tests) ---------- */

/** Invoice-level totals from its lines and discount. */
export function invoiceTotals(inv) {
  const subtotal = (inv.lines ?? []).reduce((n, l) => n + l.total, 0);
  const raw = inv.discountType === 'percent'
    ? Math.round((subtotal * Math.min(100, Math.max(0, Number(inv.discountValue) || 0))) / 100)
    : Math.round(Number(inv.discountValue) || 0);
  const discount = Math.min(subtotal, Math.max(0, raw));
  return { subtotal, discount, total: subtotal - discount };
}

/** Status of an invoice given its (non-void) linked payments. */
export function invoiceState(inv, payments) {
  const { subtotal, discount, total } = invoiceTotals(inv);
  const paid = payments.filter((p) => p.invoiceId === inv.id && !p.voided).reduce((n, p) => n + p.amount, 0) + (inv.appliedCredit ?? 0);
  const remaining = Math.max(0, total - paid);
  let status = 'open';
  if (inv.status === 'void') status = 'void';
  else if (total === 0 || paid >= total) status = 'paid';
  else if (paid > 0) status = 'partial';
  return { subtotal, discount, total, paid, remaining, status };
}

/**
 * Covers installments in due-date order with the paid amount.
 * @returns {Array<{ id, dueDate, amount, covered, status: 'paid'|'partial'|'due'|'overdue' }>}
 */
export function installmentsState(installments = [], paid, today = todayISO()) {
  let left = paid;
  return [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((i) => {
    const covered = Math.min(i.amount, Math.max(0, left));
    left -= covered;
    const status = covered >= i.amount ? 'paid' : i.dueDate < today ? 'overdue' : covered > 0 ? 'partial' : 'due';
    return { ...i, covered, status };
  });
}

/**
 * Installment state for an invoice: money paid outside the schedule (deposit at creation,
 * applied credit, or amounts paid before a re-plan) is excluded via installmentsBase.
 */
export function invoiceInstallments(inv, paid, today) {
  return installmentsState(inv.installments, Math.max(0, paid - (inv.installmentsBase ?? 0)), today);
}

/**
 * Splits an amount into n monthly installments starting at startDate. The last one absorbs
 * rounding. Amounts are rounded to whole pounds.
 */
export function splitInstallments(amount, n, startDate, everyMonths = 1) {
  const count = Math.max(1, Math.min(36, Math.round(n)));
  const base = Math.floor(amount / count / 100) * 100;
  const [y, m, d] = startDate.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const due = new Date(y, m - 1 + i * everyMonths, 1);
    const lastDay = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
    due.setDate(Math.min(d, lastDay));
    return { id: newId(), dueDate: toISODate(due), amount: i === count - 1 ? amount - base * (count - 1) : base };
  });
}

/** Turns a done treatment item into an invoice line. */
export function lineFromItem(item) {
  const m = itemMath(item);
  return {
    treatmentItemId: item.id,
    description: item.procedureName,
    teeth: item.teeth ?? [],
    qty: item.qty ?? 1,
    unitPrice: item.unitPrice ?? 0,
    discount: m.discount,
    total: m.total,
  };
}

/* ---------- Queries ---------- */

/** Treatment is billable from the moment it starts (in progress) — not only once done. */
export const isBillable = (i) => (i.status === 'in_progress' || i.status === 'done') && !i.invoiceId;

/** When an item's charge landed: the day it was started (or completed, if it never was "in progress"). */
export function chargeAt(item) {
  const started = (item.statusHistory ?? []).find((h) => h.status === 'in_progress')?.at;
  return started ?? item.doneAt ?? item.updatedAt ?? '';
}

export async function uninvoicedItems(patientId) {
  return (await repos.treatmentItems.findBy('patientId', patientId))
    .filter(isBillable)
    .sort((a, b) => chargeAt(a).localeCompare(chargeAt(b)));
}

/** Everything about one patient's money: invoices with state, payments, totals, ledger. */
export async function patientAccount(patientId) {
  const [invoices, payments] = await Promise.all([repos.invoices.findBy('patientId', patientId), repos.payments.findBy('patientId', patientId)]);
  const inv = invoices.map((i) => ({ ...i, ...invoiceState(i, payments) })).sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  const livePayments = payments.filter((p) => !p.voided);
  const billed = inv.filter((i) => i.status !== 'void').reduce((n, i) => n + i.total, 0);
  const paid = livePayments.reduce((n, p) => n + p.amount, 0);
  const unlinked = livePayments.filter((p) => !p.invoiceId || inv.find((i) => i.id === p.invoiceId)?.status === 'void').reduce((n, p) => n + p.amount, 0);
  const applied = inv.filter((i) => i.status !== 'void').reduce((n, i) => n + (i.appliedCredit ?? 0), 0);
  const credit = Math.max(0, unlinked - applied);

  // Ledger: debits (invoices) and credits (payments) in time order with running balance
  const events = [
    ...inv.filter((i) => i.status !== 'void').map((i) => ({ kind: 'invoice', at: i.createdAt, date: i.date, ref: formatInvoiceNo(i.number), description: i.lines.map((l) => l.description).join('، '), debit: i.total, credit: 0, id: i.id })),
    ...livePayments.map((p) => ({ kind: 'payment', at: p.at, date: p.date, ref: formatReceiptNo(p.receiptNo), description: p.invoiceId ? `سداد ${formatInvoiceNo(inv.find((i) => i.id === p.invoiceId)?.number ?? 0)}` : 'دفعة تحت الحساب', debit: 0, credit: p.amount, method: p.method, id: p.id })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  let running = 0;
  const ledger = events.map((e) => { running += e.debit - e.credit; return { ...e, balance: running }; });

  return { invoices: inv, payments: payments.sort((a, b) => b.at.localeCompare(a.at)), billed, paid, balance: billed - paid, credit, ledger };
}

/* ---------- Writes ---------- */

/**
 * Creates an invoice from done treatment items (+ optional extra lines) and optionally
 * records a payment now and/or an installment plan.
 * @param {{ patientId: string, itemIds?: string[], extraLines?: { description: string, amount: number }[],
 *           discountType?: 'amount'|'percent', discountValue?: number, date?: string, notes?: string,
 *           applyCredit?: boolean, payNow?: { amount: number, method: string }|null,
 *           installments?: { dueDate: string, amount: number }[] }} input
 */
export async function createInvoice(input) {
  const patient = await repos.patients.require(input.patientId);
  const items = [];
  for (const id of input.itemIds ?? []) {
    const it = await repos.treatmentItems.require(id);
    if (it.patientId !== patient.id) throw new BillingError('بند لا يخص هذا المريض');
    if (it.invoiceId) throw new BillingError(`«${it.procedureName}» تمت فوترته بالفعل`);
    if (it.status !== 'done' && it.status !== 'in_progress') throw new BillingError(`«${it.procedureName}» لم يبدأ بعد`);
    items.push(it);
  }
  const lines = [
    ...items.map(lineFromItem),
    ...(input.extraLines ?? []).filter((l) => l.description?.trim() && l.amount > 0).map((l) => ({
      treatmentItemId: null, description: l.description.trim(), teeth: [], qty: 1, unitPrice: l.amount, discount: 0, total: l.amount,
    })),
  ];
  if (!lines.length) throw new BillingError('اختر بندًا واحدًا على الأقل');

  const draft = { lines, discountType: input.discountType === 'percent' ? 'percent' : 'amount', discountValue: Math.max(0, Number(input.discountValue) || 0) };
  const { total } = invoiceTotals(draft);

  let appliedCredit = 0;
  if (input.applyCredit) appliedCredit = Math.min(total, (await patientAccount(patient.id)).credit);
  const payNow = input.payNow && input.payNow.amount > 0 ? input.payNow : null;
  if (payNow && payNow.amount > total - appliedCredit) throw new BillingError('المبلغ المدفوع أكبر من المتبقي على الفاتورة');
  const installments = (input.installments ?? []).filter((i) => i.amount > 0).map((i) => ({ id: i.id ?? newId(), dueDate: i.dueDate, amount: Math.round(i.amount) }));
  if (installments.length) {
    const scheduled = installments.reduce((n, i) => n + i.amount, 0);
    const toSchedule = total - appliedCredit - (payNow?.amount ?? 0);
    if (scheduled !== toSchedule) throw new BillingError('مجموع الأقساط لا يساوي المبلغ المتبقي');
  }

  const number = await nextCounter('invoiceNo');
  const invoice = await repos.invoices.create({
    number,
    patientId: patient.id,
    patientName: patient.name,
    date: input.date || todayISO(),
    ...draft,
    appliedCredit,
    installments,
    installmentsBase: installments.length ? appliedCredit + (payNow?.amount ?? 0) : 0,
    notes: String(input.notes ?? '').trim(),
    status: 'open',
    voidReason: '',
  });
  for (const it of items) await repos.treatmentItems.update(it.id, { invoiceId: invoice.id });
  let payment = null;
  if (payNow) payment = await recordPayment({ patientId: patient.id, invoiceId: invoice.id, amount: payNow.amount, method: payNow.method, date: invoice.date });
  else await refreshInvoiceStatus(invoice.id);
  return { invoice: await repos.invoices.get(invoice.id), payment };
}

/** Stores the derived status (open/partial/paid) so lists can filter by it. */
export async function refreshInvoiceStatus(invoiceId) {
  const inv = await repos.invoices.get(invoiceId);
  if (!inv || inv.status === 'void') return inv;
  const payments = await repos.payments.findBy('invoiceId', invoiceId);
  const { status } = invoiceState(inv, payments);
  return status === inv.status ? inv : repos.invoices.update(invoiceId, { status });
}

/**
 * @param {{ patientId: string, invoiceId?: string|null, amount: number, method: string, date?: string, note?: string }} input
 */
export async function recordPayment(input) {
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new BillingError('أدخل مبلغًا صحيحًا');
  if (!['cash', 'card', 'vodafone', 'instapay'].includes(input.method)) throw new BillingError('اختر طريقة الدفع');
  const patient = await repos.patients.require(input.patientId);
  if (input.invoiceId) {
    const inv = await repos.invoices.require(input.invoiceId);
    if (inv.status === 'void') throw new BillingError('لا يمكن السداد على فاتورة ملغاة');
    const { remaining } = invoiceState(inv, await repos.payments.findBy('invoiceId', inv.id));
    if (amount > remaining) throw new BillingError(`المتبقي على الفاتورة أقل من المبلغ`);
  }
  const me = currentUser();
  const receiptNo = await nextCounter('receiptNo');
  const payment = await repos.payments.create({
    receiptNo,
    patientId: patient.id,
    patientName: patient.name,
    invoiceId: input.invoiceId || null,
    amount,
    method: input.method,
    date: input.date || todayISO(),
    at: new Date().toISOString(),
    userId: me?.id ?? null,
    userName: me?.displayName ?? null,
    note: String(input.note ?? '').trim(),
    voided: false,
    voidReason: '',
  });
  if (payment.invoiceId) await refreshInvoiceStatus(payment.invoiceId);
  return payment;
}

export async function voidPayment(id, reason) {
  if (!reason?.trim()) throw new BillingError('اكتب سبب الإلغاء');
  const p = await repos.payments.require(id);
  if (p.voided) return p;
  if (!ownsOrAdmin(p)) throw new BillingError('إلغاء الإيصال متاح لمدير النظام أو لمن سجّله فقط');
  const me = currentUser();
  const updated = await repos.payments.update(id, { voided: true, voidReason: reason.trim(), voidedAt: new Date().toISOString(), voidedBy: me?.displayName ?? null });
  if (p.invoiceId) await refreshInvoiceStatus(p.invoiceId);
  return updated;
}

/**
 * Voids an invoice: its treatment items become billable again and payments made on it
 * stay as credit on the patient's account.
 */
export async function voidInvoice(id, reason) {
  if (!reason?.trim()) throw new BillingError('اكتب سبب الإلغاء');
  const inv = await repos.invoices.require(id);
  if (inv.status === 'void') return inv;
  if (!ownsOrAdmin(inv)) throw new BillingError('إلغاء الفاتورة متاح لمدير النظام أو لمن أصدرها فقط');
  const me = currentUser();
  for (const l of inv.lines) if (l.treatmentItemId) await repos.treatmentItems.update(l.treatmentItemId, { invoiceId: null });
  const payments = (await repos.payments.findBy('invoiceId', id)).filter((p) => !p.voided);
  for (const p of payments) await repos.payments.update(p.id, { invoiceId: null, note: `${p.note ? `${p.note} · ` : ''}كانت على ${formatInvoiceNo(inv.number)} الملغاة` });
  return repos.invoices.update(id, { status: 'void', appliedCredit: 0, voidReason: reason.trim(), voidedAt: new Date().toISOString(), voidedBy: me?.displayName ?? null });
}

/** Replaces the installment plan of an invoice (must sum to what is left to pay). */
export async function setInstallments(invoiceId, installments) {
  const inv = await repos.invoices.require(invoiceId);
  if (!ownsOrAdmin(inv)) throw new BillingError('تعديل الفاتورة متاح لمدير النظام أو لمن أصدرها فقط');
  const state = invoiceState(inv, await repos.payments.findBy('invoiceId', invoiceId));
  const covered = invoiceInstallments(inv, state.paid).filter((i) => i.covered > 0);
  const clean = installments.filter((i) => i.amount > 0).map((i) => ({ id: i.id ?? newId(), dueDate: i.dueDate, amount: Math.round(i.amount) }));
  const scheduledNew = clean.reduce((n, i) => n + i.amount, 0);
  if (clean.length && scheduledNew !== state.remaining) throw new BillingError('مجموع الأقساط يجب أن يساوي المتبقي على الفاتورة');
  const keep = covered.map(({ id, dueDate, covered: amount }) => ({ id, dueDate, amount }));
  const keptSum = keep.reduce((n, i) => n + i.amount, 0);
  await logEvent({ action: 'update', entity: 'invoices', entityId: invoiceId, summary: `تعديل أقساط ${formatInvoiceNo(inv.number)}` });
  return repos.invoices.update(invoiceId, { installments: [...keep, ...clean], installmentsBase: state.paid - keptSum });
}

/* ---------- One day's billing (dashboard card) ---------- */

/**
 * What needs collecting for a day: invoices dated that day with what is left on each, and
 * patients whose treatment was started (or completed) that day but has no invoice yet.
 * `due` counts both (the number shown on the card).
 */
export async function dayBilling(day) {
  const invoices = [];
  for (const inv of await repos.invoices.list({ index: 'date', range: { eq: day } })) {
    if (inv.status === 'void') continue;
    invoices.push({ invoice: inv, ...invoiceState(inv, await repos.payments.findBy('invoiceId', inv.id)) });
  }
  const byPatient = new Map();
  for (const it of await repos.treatmentItems.list()) {
    if (!isBillable(it) || !chargeAt(it) || toISODate(new Date(chargeAt(it))) !== day) continue;
    const g = byPatient.get(it.patientId) ?? { patientId: it.patientId, items: [], value: 0 };
    g.items.push(it);
    g.value += itemMath(it).total;
    byPatient.set(it.patientId, g);
  }
  const uninvoiced = [];
  for (const g of byPatient.values()) {
    const p = await repos.patients.get(g.patientId, { includeDeleted: true });
    if (p && !p.deletedAt) uninvoiced.push({ ...g, patientName: p.name });
  }
  invoices.sort((a, b) => b.invoice.number - a.invoice.number);
  return { invoices, uninvoiced, due: uninvoiced.length + invoices.filter((i) => i.remaining > 0).length };
}

/** True when the patient has at least one invoice that is not void. */
export async function hasInvoices(patientId) {
  return (await repos.invoices.findBy('patientId', patientId)).some((i) => i.status !== 'void');
}

/* ---------- Clinic-wide reports ---------- */

/** Non-void payments between two days. */
export async function paymentsBetween(fromDay, toDay) {
  return (await repos.payments.list({ index: 'date', range: { gte: fromDay, lte: toDay } })).filter((p) => !p.voided);
}

export async function revenueBetween(fromDay, toDay) {
  return (await paymentsBetween(fromDay, toDay)).reduce((n, p) => n + p.amount, 0);
}

/** End-of-day summary per payment method and per user. */
export async function dailyClosing(day) {
  const all = await repos.payments.list({ index: 'date', range: { eq: day } });
  const live = all.filter((p) => !p.voided);
  const sumBy = (key) => live.reduce((m, p) => { const k = p[key] ?? '—'; m[k] = (m[k] ?? 0) + p.amount; return m; }, {});
  const countBy = (key) => live.reduce((m, p) => { const k = p[key] ?? '—'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const invoices = (await repos.invoices.list({ index: 'date', range: { eq: day } })).filter((i) => i.status !== 'void');
  return {
    day,
    payments: live.sort((a, b) => a.at.localeCompare(b.at)),
    voided: all.filter((p) => p.voided),
    total: live.reduce((n, p) => n + p.amount, 0),
    byMethod: sumBy('method'),
    countByMethod: countBy('method'),
    byUser: sumBy('userName'),
    invoicesCount: invoices.length,
    billed: invoices.reduce((n, i) => n + invoiceTotals(i).total, 0),
  };
}

/** Every patient with a positive balance, and the total outstanding. */
export async function outstandingBalances() {
  const [invoices, payments] = await Promise.all([repos.invoices.list(), repos.payments.list()]);
  const byPatient = new Map();
  for (const i of invoices) {
    if (i.status === 'void') continue;
    const r = byPatient.get(i.patientId) ?? { patientId: i.patientId, patientName: i.patientName, billed: 0, paid: 0 };
    r.billed += invoiceTotals(i).total;
    byPatient.set(i.patientId, r);
  }
  for (const p of payments) {
    if (p.voided) continue;
    const r = byPatient.get(p.patientId) ?? { patientId: p.patientId, patientName: p.patientName, billed: 0, paid: 0 };
    r.paid += p.amount;
    byPatient.set(p.patientId, r);
  }
  const rows = [...byPatient.values()].map((r) => ({ ...r, balance: r.billed - r.paid })).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
  return { rows, total: rows.reduce((n, r) => n + r.balance, 0) };
}

/** Installments across all open invoices with their state (for the installments tab and alerts). */
export async function allInstallments(today = todayISO()) {
  const invoices = (await repos.invoices.list()).filter((i) => i.status !== 'void' && i.status !== 'paid' && i.installments?.length);
  const out = [];
  for (const inv of invoices) {
    const state = invoiceState(inv, await repos.payments.findBy('invoiceId', inv.id));
    for (const ins of invoiceInstallments(inv, state.paid, today)) {
      if (ins.status !== 'paid') out.push({ ...ins, invoice: inv, remainingOnInstallment: ins.amount - ins.covered });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
