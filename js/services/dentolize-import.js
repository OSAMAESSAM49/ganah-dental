/**
 * Import from Dentolize (the clinic's previous system): its Excel exports of patients,
 * appointments, invoices (header row + one row per line), payments and expenses.
 *
 * - Files are recognised by their column headings, not their names. Each export has a
 *   «config» sheet with the total row count; with the «1 - 1000» range in the file name
 *   this tells which parts are missing.
 * - Dentolize times are the clinic's wall-clock time stored as Excel dates (read with getUTC*).
 * - Patients are keyed by the Dentolize file number (#2451). They get new G numbers, keep
 *   the old one in legacyFileNo (searchable), and are merged into an existing patient only
 *   when phone AND name match (families share phones).
 * - Every record id is derived from the Dentolize data (dz-…), so importing again skips
 *   what is already here — e.g. after adding a missing file.
 * - Money: Dentolize amounts are pounds → piasters here.
 *
 * planImport() is pure (tested); readDentolizeFiles() parses, applyImport() writes in bulk.
 */
import { getAdapter, repos } from '../data/index.js';
import { normalizeArabic } from '../core/text.js';
import { normalizeEgyptPhone, isEgyptPhone } from '../core/validate.js';
import { emptyMedical } from '../core/medical.js';
import { buildSearchText, formatFileNo } from './patients.js';
import { invoiceState, invoiceTotals } from './billing.js';
import { logEvent } from './audit.js';

/* ---------- Recognising and reading the files ---------- */

const SIGNATURES = [
  ['invoices', ['Procedure Price', 'رقم الملف']],
  ['payments', ['فاتورة رقم الملف', 'المبلغ']],
  ['appointments', ['ابدأ', 'إنهاء', 'الحالة']],
  ['patients', ['الإسم الأول', 'إسم العائلة']],
  ['expensePayments', ['نوع المصروفات', 'المبلغ']],
  ['expenses', ['mainType', 'المبلغ']],
  ['income', ['وسيلة الدفع', 'إسم', 'المبلغ']],
];

export const SHEET_LABELS = {
  patients: 'المرضى', appointments: 'المواعيد', invoices: 'الفواتير', payments: 'المدفوعات',
  expenses: 'المصروفات', expensePayments: 'مدفوعات المصروفات', income: 'الدخل',
};

/** @param {string[]} headers @returns {string|null} */
export function detectSheet(headers) {
  const set = new Set(headers.filter(Boolean).map(String));
  return SIGNATURES.find(([, need]) => need.every((h) => set.has(h)))?.[0] ?? null;
}

/** Plain value of an ExcelJS cell (rich text, hyperlinks and formulas included). */
function cellValue(v) {
  if (v == null || v instanceof Date || typeof v !== 'object') return v ?? null;
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('result' in v) return v.result ?? null;
  if ('text' in v) return v.text;
  return null;
}

/**
 * Reads the picked .xlsx files.
 * @param {File[]} files
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{ sheets: Record<string, object[]>, parts: object[], unknown: string[] }>}
 */
export async function readDentolizeFiles(files, onProgress) {
  const { loadExcelJS } = await import('../components/export.js');
  const ExcelJS = await loadExcelJS();
  const sheets = {}, parts = [], unknown = [];
  let done = 0;
  for (const file of files) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet('data') ?? wb.worksheets[0];
    const headers = /** @type {any[]} */ (ws.getRow(1).values).map((h) => (h == null ? null : String(cellValue(h)).trim()));
    const type = detectSheet(headers);
    if (!type) { unknown.push(file.name); onProgress?.(++done, files.length); continue; }
    const rows = (sheets[type] ??= []);
    let count = 0;
    ws.eachRow((row, r) => {
      if (r === 1) return;
      const values = /** @type {any[]} */ (row.values);
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = cellValue(values[i]); });
      rows.push(o);
      count++;
    });
    const config = wb.getWorksheet('config');
    let total = null, exportedAt = '';
    config?.eachRow((row) => {
      const v = /** @type {any[]} */ (row.values);
      if (String(v[1]).trim() === 'صفوف') total = Number(v[2]) || null;
      if (String(v[1]).trim() === 'تم الإنشاء في') exportedAt = String(v[2] ?? '').split('·')[0].trim();
    });
    const range = file.name.match(/(\d+)\s*-\s*(\d+)/);
    parts.push({ type, file: file.name, rows: count, total, exportedAt, from: range ? +range[1] : null, to: range ? +range[2] : null });
    onProgress?.(++done, files.length);
  }
  return { sheets, parts, unknown };
}

/** Ranges of an export that were not picked, e.g. [{ type, from: 7001, to: 8000 }]. */
export function missingParts(parts) {
  const out = [];
  const byType = Map.groupBy ? Map.groupBy(parts, (p) => p.type) : parts.reduce((m, p) => m.set(p.type, [...(m.get(p.type) ?? []), p]), new Map());
  for (const [type, list] of byType) {
    const total = Math.max(0, ...list.map((p) => p.total ?? 0));
    const ranges = list.filter((p) => p.from).sort((a, b) => a.from - b.from);
    if (!total || !ranges.length) continue;
    let next = 1;
    for (const p of ranges) {
      if (p.from > next) out.push({ type, from: next, to: p.from - 1 });
      next = Math.max(next, p.to + 1);
    }
    if (next <= total) out.push({ type, from: next, to: total });
  }
  return out;
}

/**
 * Types whose files were exported at different times. Dentolize lists newest first, so a
 * later export shifts every range: some rows end up in two files and others in none.
 */
export function mixedExports(parts) {
  const out = [];
  for (const type of new Set(parts.map((p) => p.type))) {
    const list = parts.filter((p) => p.type === type && p.from);
    if (new Set(list.map((p) => p.total)).size > 1) out.push({ type, files: list.filter((p) => p.total !== list[0].total || p.exportedAt !== list[0].exportedAt).map((p) => p.file), exports: [...new Set(list.map((p) => p.exportedAt))] });
  }
  return out;
}

/* ---------- Small helpers (exported for tests) ---------- */

const str = (v) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' '));
const num = (v) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const yes = (v) => v === true || v === 'true' || v === 'صحيح';
/** Pounds → piasters. */
export const piasters = (v) => Math.round(num(v) * 100);
const pad = (n) => String(n).padStart(2, '0');

/** Dentolize file number «#2451» → «2451». */
export const fileKey = (v) => str(v).replace(/^#/, '').replace(/\D/g, '');

/** Wall-clock date of an Excel date → «2026-10-26». */
export function wallDate(d) {
  return d instanceof Date && !Number.isNaN(+d) ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : '';
}
/** Wall-clock minutes from midnight. */
export const wallMinutes = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

/** Offset (ms) of Africa/Cairo from UTC at instant t. */
function cairoOffset(t) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second) - t;
}
/** Clinic wall-clock time (Cairo) of an Excel date → real ISO instant (for createdAt / at). */
export function wallToISO(d) {
  if (!(d instanceof Date) || Number.isNaN(+d)) return null;
  const guess = d.getTime() - cairoOffset(d.getTime());
  return new Date(d.getTime() - cairoOffset(guess)).toISOString();
}

/** «UL6, UL4» → [26, 24]; «mouth» / «upper» → [] (whole mouth / arch). */
export function parseTeeth(v) {
  const Q = { UR: 1, UL: 2, LL: 3, LR: 4 };
  const out = [];
  for (const m of str(v).toUpperCase().matchAll(/\b(UR|UL|LL|LR)\s*([1-8])\b/g)) out.push(Q[m[1]] * 10 + Number(m[2]));
  return [...new Set(out)];
}

/** Phone as stored here: «+20 1229376504» → «01229376504». */
export const phoneOf = (v) => (str(v) ? normalizeEgyptPhone(str(v)) : '');

const METHODS = { 'نقدي': 'cash', 'محفظة الهاتف المحمول': 'vodafone', 'حوالة بنكية': 'instapay', 'بطاقة': 'card', 'فيزا': 'card', 'انستاباي': 'instapay' };
/** Dentolize payment type → method here («رصيد», paid from the patient's balance, counts as cash). */
export const paymentMethod = (v) => METHODS[str(v)] ?? 'cash';

/**
 * Dentolize appointment status → status here. Past appointments still «محجوز» (never
 * closed in Dentolize) count as attended.
 */
export function appointmentStatus(v, date, today) {
  const s = str(v);
  if (s === 'مكتمل') return 'done';
  if (s === 'لم يتم الحضور') return 'no_show';
  if (s === 'ملغي') return 'cancelled';
  if (date < today) return 'done';
  if (date === today && s === 'تم تسجيل الوصول') return 'arrived';
  if (date === today && s === 'قيد التنفيذ') return 'in_chair';
  return 'booked';
}

/** Short stable hash for ids (FNV-1a, base 36). */
export function hashKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/* ---------- Planning (pure) ---------- */

/**
 * Turns the parsed sheets into records to write.
 * @param {Record<string, object[]>} sheets
 * @param {{ today: string, now?: string, chairId?: string|null,
 *           userFor: (name: string) => { id: string|null, displayName: string|null },
 *           doctorFor: (name: string) => string|null,
 *           existing: Record<string, object[]>, procedures?: object[],
 *           counters: { patientFileNo: number, invoiceNo: number, receiptNo: number } }} ctx
 *   existing: current records of patients, appointments, treatmentPlans, treatmentItems,
 *   invoices, payments, expenseCategories, expenses.
 */
export function planImport(sheets, ctx) {
  const now = ctx.now ?? new Date().toISOString();
  const ex = ctx.existing;
  const ids = Object.fromEntries(Object.entries(ex).map(([s, rows]) => [s, new Set(rows.map((r) => r.id))]));
  const writes = { patients: [], treatmentPlans: [], treatmentItems: [], invoices: [], payments: [], appointments: [], expenseCategories: [], expenses: [] };
  const report = {
    patients: { added: 0, merged: 0, already: 0, nameOnly: 0, badPhones: 0 },
    appointments: { added: 0, already: 0, skipped: 0, upcoming: 0 },
    invoices: { added: 0, already: 0, lines: 0, mismatches: [], dentolizeTotal: 0, total: 0, dentolizeRemaining: 0, remaining: 0 },
    payments: { added: 0, already: 0, onAccount: 0, fromBalance: 0, voided: 0, total: 0, unmatched: 0 },
    expenses: { added: 0, already: 0, total: 0, paidTotal: 0 },
    income: { count: 0, total: 0 },
    treatment: { items: 0 },
  };
  const planned = new Set(); // ids already planned in this run (overlapping files)
  const stamp = (rec, createdISO, by) => ({ ...rec, createdAt: createdISO || now, updatedAt: now, createdBy: by?.id ?? null, updatedBy: by?.id ?? null });

  /* Patients: gathered from every sheet that carries the file number. */
  const pats = new Map();
  const touch = (r) => {
    const key = fileKey(r['رقم ملف المريض']);
    if (!key) return null;
    let p = pats.get(key);
    if (!p) pats.set(key, (p = { key, name: '', phone: '', created: null, dob: null, gender: '', lastStart: '' }));
    p.name ||= str(r['المريض']);
    p.phone ||= str(r['رقم الهاتف']);
    p.created ||= r['تاريخ إنشاء المريض'] instanceof Date ? r['تاريخ إنشاء المريض'] : null;
    p.dob ||= r['تاريخ الميلاد'] instanceof Date ? wallDate(r['تاريخ الميلاد']) : null;
    const g = str(r['الجنس']);
    p.gender ||= g === 'male' ? 'male' : g === 'female' ? 'female' : '';
    return p;
  };
  for (const r of sheets.appointments ?? []) {
    const p = touch(r);
    const d = wallDate(r['ابدأ']);
    if (p && d > p.lastStart) p.lastStart = d;
  }
  for (const r of sheets.invoices ?? []) touch(r);
  for (const r of sheets.payments ?? []) touch(r);

  // The patients sheet only has names: match them (adds the patients without any visit).
  const byName = new Map();
  for (const p of pats.values()) { const n = normalizeArabic(p.name); byName.set(n, [...(byName.get(n) ?? []), p]); }
  const claimed = new Set();
  for (const r of sheets.patients ?? []) {
    const name = str(`${str(r['الإسم الأول'])} ${str(r['إسم العائلة'])}`);
    if (!name) continue;
    const last = wallDate(r['آخر موعد Date']);
    const cands = (byName.get(normalizeArabic(name)) ?? []).filter((p) => !claimed.has(p.key));
    let p = cands.find((c) => last && c.lastStart === last) ?? (cands.length === 1 || !last ? cands[0] : null) ?? cands[0];
    if (!p) {
      const key = `n${hashKey(`${normalizeArabic(name)}|${last}|${str(r['الهاتف الثاني'])}`)}`;
      p = { key, name, phone: '', created: null, dob: null, gender: '', lastStart: last, nameOnly: true };
      pats.set(key, p);
    }
    claimed.add(p.key);
    p.phone2 ||= str(r['الهاتف الثاني']);
    p.address ||= str(r['العنوان']);
    p.notes ||= str(r['تفاصيل']);
  }

  // Resolve to records here: already imported → by legacy number → phone + name → new.
  const byLegacy = new Map(ex.patients.filter((p) => p.legacyFileNo).map((p) => [String(p.legacyFileNo), p]));
  const byPhoneName = new Map();
  for (const p of ex.patients) if (p.phone && !String(p.id).startsWith('dz-')) byPhoneName.set(`${p.phone}|${normalizeArabic(p.name)}`, p);
  const fresh = [];
  for (const p of pats.values()) {
    p.phoneN = phoneOf(p.phone);
    const id = `dz-pat-${p.key}`;
    if (ids.patients.has(id)) { p.id = id; report.patients.already++; continue; }
    const legacy = byLegacy.get(p.key);
    if (legacy) { p.id = legacy.id; report.patients.already++; continue; }
    const match = p.phoneN && byPhoneName.get(`${p.phoneN}|${normalizeArabic(p.name)}`);
    if (match) {
      p.id = match.id;
      const upd = { ...match, legacyFileNo: p.key, updatedAt: now };
      upd.searchText = buildSearchText(upd);
      writes.patients.push(upd);
      report.patients.merged++;
      continue;
    }
    p.id = id;
    fresh.push(p);
  }
  fresh.sort((a, b) => (a.created ? +a.created : Infinity) - (b.created ? +b.created : Infinity) || Number(a.key.replace(/\D/g, '')) - Number(b.key.replace(/\D/g, '')));
  let fileNo = ctx.counters.patientFileNo;
  for (const p of fresh) {
    if (p.phoneN && !isEgyptPhone(p.phoneN)) report.patients.badPhones++;
    const rec = {
      id: p.id,
      name: p.name || 'بدون اسم',
      phone: p.phoneN,
      phone2: phoneOf(p.phone2),
      gender: p.gender,
      dob: p.dob,
      dobEstimated: false,
      address: p.address ?? '',
      occupation: '',
      referralSource: '',
      referralNote: '',
      notes: p.notes ?? '',
      photo: null,
      fileNo: formatFileNo(++fileNo),
      legacyFileNo: p.nameOnly ? '' : p.key,
      medical: emptyMedical(),
      isDemo: false,
    };
    rec.searchText = buildSearchText(rec);
    writes.patients.push(stamp(rec, wallToISO(p.created)));
    report.patients.added++;
    if (p.nameOnly) report.patients.nameOnly++;
  }
  const patientOf = (r) => pats.get(fileKey(r['رقم ملف المريض']));
  const nameOf = new Map([...ex.patients.map((p) => [p.id, p.name]), ...writes.patients.map((p) => [p.id, p.name])]);

  /* Invoices: a numbered header row followed by its line rows. */
  const procByName = new Map((ctx.procedures ?? []).map((p) => [normalizeArabic(p.name), p]));
  const invoices = [];
  let cur = null;
  for (const r of sheets.invoices ?? []) {
    const isHeader = r['#'] != null && str(r['رقم الملف']) !== '';
    if (isHeader) { cur = { row: r, lines: [] }; invoices.push(cur); continue; }
    if (r['#'] != null) { cur = null; continue; } // «Total : 1000» footers
    if (cur && (r['الإجراءات العلاجية'] != null || r['Procedure Price'] != null)) cur.lines.push(r);
  }
  const invByDz = new Map(ex.invoices.filter((i) => String(i.id).startsWith('dz-inv-')).map((i) => [i.id.slice(7), i]));
  const newInvoices = [];
  for (const { row, lines } of invoices) {
    const dz = str(row['رقم الملف']);
    const p = patientOf(row);
    const id = `dz-inv-${dz}`;
    const dentolizeTotal = piasters(row['المجموع']);
    report.invoices.dentolizeTotal += dentolizeTotal;
    report.invoices.dentolizeRemaining += piasters(row['المطلوب دفعه']);
    if (ids.invoices.has(id) || invByDz.has(dz)) { report.invoices.already++; continue; }
    if (!p) continue;
    const created = row['تم الإنشاء'];
    const createdISO = wallToISO(created) ?? now;
    const by = ctx.userFor(str(row['تم الإنشاء بواسطة']));
    const invLines = [];
    lines.forEach((l, i) => {
      const teeth = parseTeeth(l['سن']);
      const where = str(l['سن']).toLowerCase();
      const qty = Math.max(1, Math.round(num(l['Procedure Quantity'])) || 1);
      const unitPrice = piasters(l['Procedure Price']);
      const total = l['Net Price'] != null ? piasters(l['Net Price']) : unitPrice * qty - piasters(l['Procedure Discount']);
      const name = str(l['الإجراءات العلاجية']) || 'إجراء';
      const description = where === 'mouth' ? `${name} (الفم كامل)` : where === 'upper' ? `${name} (الفك العلوي)` : where === 'lower' ? `${name} (الفك السفلي)` : name;
      const itemId = `dz-ti-${dz}-${i}`;
      invLines.push({ treatmentItemId: itemId, description, teeth, qty, unitPrice, discount: Math.max(0, unitPrice * qty - total), total });
      const proc = procByName.get(normalizeArabic(name));
      writes.treatmentItems.push(stamp({
        id: itemId, patientId: p.id, planId: `dz-plan-${p.id}`,
        procedureId: proc?.id ?? null, procedureName: description, categoryId: proc?.categoryId ?? null,
        teeth, surfaces: [], chartEffect: '',
        unitPrice, qty, discountType: 'amount', discountValue: Math.max(0, unitPrice * qty - total),
        sessionsPlanned: 1, sessionsDone: 1, needsLab: false,
        status: 'done', statusHistory: [{ status: 'done', at: createdISO, by: by.displayName }],
        notes: '', order: i, doneAt: createdISO, invoiceId: id, total,
      }, createdISO, by));
      report.treatment.items++;
    });
    const fee = piasters(row['رسوم التشخيص']);
    if (fee > 0) invLines.push({ treatmentItemId: null, description: 'رسوم كشف', teeth: [], qty: 1, unitPrice: fee, discount: 0, total: fee });
    const lineSum = invLines.reduce((n, l) => n + l.total, 0);
    // Dentolize sometimes lowered the total without recording a discount: its total wins.
    const discount = Math.max(piasters(row['خصم']), lineSum - dentolizeTotal);
    // No lines (e.g. an opening-balance invoice) or lines that don't add up: one balancing line.
    const want = dentolizeTotal + discount;
    if (want > lineSum) {
      const ops = str(row['operations']);
      invLines.push({ treatmentItemId: null, description: invLines.length ? 'فرق من Dentolize' : (yes(row['Is Balance Invoice']) ? 'رصيد سابق' : ops || 'فاتورة سابقة'), teeth: [], qty: 1, unitPrice: want - lineSum, discount: 0, total: want - lineSum });
    }
    const notes = [`Dentolize #${dz}`, str(row['تفاصيل'])].filter(Boolean).join(' — ');
    const inv = stamp({
      id, number: 0, patientId: p.id, patientName: nameOf.get(p.id) ?? p.name, date: wallDate(created) || ctx.today,
      lines: invLines, discountType: 'amount', discountValue: discount, appliedCredit: 0,
      installments: [], installmentsBase: 0, notes, status: 'open', voidReason: '',
    }, createdISO, by);
    const { total } = invoiceTotals(inv);
    if (total !== dentolizeTotal) report.invoices.mismatches.push({ dz, kind: 'total', dentolize: dentolizeTotal, here: total });
    inv._dentolizeRemaining = piasters(row['المطلوب دفعه']);
    newInvoices.push(inv);
    invByDz.set(dz, inv);
    report.invoices.lines += invLines.length;
  }
  newInvoices.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let invNo = ctx.counters.invoiceNo;
  for (const inv of newInvoices) inv.number = ++invNo;

  // One completed "history" plan per patient that received imported treatment.
  const planOwners = new Set(writes.treatmentItems.map((i) => i.patientId));
  for (const pid of planOwners) {
    const id = `dz-plan-${pid}`;
    if (!ids.treatmentPlans.has(id)) writes.treatmentPlans.push(stamp({ id, patientId: pid, name: 'سجل سابق (Dentolize)', status: 'completed', notes: 'علاجات مستوردة من Dentolize', order: 99 }));
  }

  /* Payments, oldest first; anything above what an invoice still needs goes on account. */
  const paidSoFar = new Map();
  for (const p of ex.payments) if (p.invoiceId && !p.voided) paidSoFar.set(p.invoiceId, (paidSoFar.get(p.invoiceId) ?? 0) + p.amount);
  const payRows = [...(sheets.payments ?? [])].sort((a, b) => (+a['تم الإنشاء'] || 0) - (+b['تم الإنشاء'] || 0));
  const newPayments = [];
  for (const r of payRows) {
    const p = patientOf(r);
    const amount = piasters(r['المبلغ']);
    const created = r['تم الإنشاء'];
    const createdISO = wallToISO(created) ?? now;
    const dz = fileKey(r['فاتورة رقم الملف']);
    const id = `dz-pay-${dz}-${hashKey(`${createdISO}|${amount}|${str(r['تفاصيل'])}|${str(r['#'])}`)}`;
    if (ids.payments.has(id) || ids.payments.has(`${id}-c`) || planned.has(id)) { report.payments.already++; continue; }
    planned.add(id);
    if (!p || !(amount > 0)) { report.payments.unmatched++; continue; }
    const inv = invByDz.get(dz) ?? null;
    const by = ctx.userFor(str(r['تم الإنشاء بواسطة']));
    const method = paymentMethod(r['النوع']);
    // «رصيد» (settled from the patient's balance in Dentolize): Dentolize counts it as a
    // payment and so do we, so balances and totals match — with a note saying so.
    const fromBalance = str(r['النوع']) === 'رصيد';
    if (fromBalance) report.payments.fromBalance += amount;
    const voided = yes(r['مسترد']);
    const base = {
      receiptNo: 0, patientId: p.id, patientName: nameOf.get(p.id) ?? p.name, method,
      date: wallDate(created) || ctx.today, at: createdISO, userId: by.id, userName: by.displayName,
      note: [`Dentolize ${str(r['فاتورة رقم الملف'])}`, fromBalance ? 'سداد من رصيد المريض في Dentolize' : '', str(r['تفاصيل'])].filter(Boolean).join(' — '),
      voided, voidReason: voided ? 'مسترد في Dentolize' : '',
    };
    let onInvoice = amount;
    if (inv && !voided) {
      const { total } = invoiceTotals(inv);
      const left = Math.max(0, total - (inv.appliedCredit ?? 0) - (paidSoFar.get(inv.id) ?? 0));
      onInvoice = Math.min(amount, left);
    }
    if (!inv) onInvoice = 0;
    if (onInvoice > 0 || voided) {
      newPayments.push(stamp({ id, ...base, invoiceId: inv?.id ?? null, amount: voided ? amount : onInvoice }, createdISO, by));
      if (!voided) paidSoFar.set(inv.id, (paidSoFar.get(inv.id) ?? 0) + onInvoice);
    }
    if (!voided && amount > onInvoice) {
      newPayments.push(stamp({ id: onInvoice > 0 ? `${id}-c` : id, ...base, invoiceId: null, amount: amount - onInvoice, note: `${base.note} — زيادة تحت الحساب` }, createdISO, by));
      report.payments.onAccount += amount - onInvoice;
    }
    if (voided) report.payments.voided++; else report.payments.total += amount;
  }
  let rcNo = ctx.counters.receiptNo;
  for (const p of newPayments) p.receiptNo = ++rcNo;
  report.payments.added = newPayments.length;

  // Invoice status + checks against Dentolize's remaining amount.
  const allPayments = [...ex.payments, ...newPayments];
  const byInvoice = new Map();
  for (const p of allPayments) if (p.invoiceId) byInvoice.set(p.invoiceId, [...(byInvoice.get(p.invoiceId) ?? []), p]);
  for (const inv of newInvoices) {
    const st = invoiceState(inv, byInvoice.get(inv.id) ?? []);
    inv.status = st.status;
    report.invoices.total += st.total;
    report.invoices.remaining += st.remaining;
    if (st.remaining !== inv._dentolizeRemaining) report.invoices.mismatches.push({ dz: inv.notes.match(/#(\d+)/)?.[1], kind: 'remaining', dentolize: inv._dentolizeRemaining, here: st.remaining });
    delete inv._dentolizeRemaining;
  }
  writes.invoices = newInvoices;
  writes.payments = newPayments;
  report.invoices.added = newInvoices.length;

  /* Appointments. */
  const doctorByUser = (name) => ctx.doctorFor(str(name));
  for (const r of sheets.appointments ?? []) {
    const p = patientOf(r);
    const start = r['ابدأ'];
    if (!p || !(start instanceof Date)) { report.appointments.skipped++; continue; }
    const createdISO = wallToISO(r['تم الإنشاء']) ?? now;
    const id = `dz-appt-${p.key}-${hashKey(`${start.toISOString()}|${createdISO}`)}`;
    if (ids.appointments.has(id) || planned.has(id)) { report.appointments.already++; continue; }
    planned.add(id);
    const end = r['إنهاء'] instanceof Date ? r['إنهاء'] : null;
    const date = wallDate(start);
    const status = appointmentStatus(r['الحالة'], date, ctx.today);
    const by = ctx.userFor(str(r['تم الإنشاء بواسطة']));
    const type = str(r['النوع']);
    writes.appointments.push(stamp({
      id, patientId: p.id, patientName: nameOf.get(p.id) ?? p.name, date, startMin: wallMinutes(start),
      duration: Math.min(480, Math.max(5, end ? Math.round((end - start) / 60000) : 30)),
      doctorId: doctorByUser(r['طبيب']), chairId: ctx.chairId ?? null,
      procedureIds: [], procedureNames: [], treatmentItemIds: [],
      reason: type === 'EXAMINATION' ? 'كشف' : type, notes: str(r['تفاصيل']),
      status, statusHistory: [{ status, at: createdISO, by: by.displayName }],
      clinicalNotes: '', reminderSentAt: null, cancelReason: status === 'cancelled' ? str(r['سبب الإلغاء']) : '',
    }, createdISO, by));
    report.appointments.added++;
    if (date >= ctx.today && status === 'booked') report.appointments.upcoming++;
  }

  /* Expenses (their «payments» file repeats the same money — only used as a check). */
  const cats = new Map(ex.expenseCategories.map((c) => [normalizeArabic(c.name), c]));
  let catOrder = ex.expenseCategories.length;
  for (const r of sheets.expenses ?? []) {
    const amount = piasters(r['المبلغ']);
    if (!(amount > 0)) continue;
    const date = wallDate(r['تاريخ']) || wallDate(r['تم الإنشاء']);
    const name = str(r['إسم']);
    const id = `dz-exp-${hashKey(`${name}|${wallToISO(r['تم الإنشاء'])}|${amount}`)}`;
    report.expenses.total += amount;
    if (ids.expenses.has(id) || planned.has(id)) { report.expenses.already++; continue; }
    planned.add(id);
    const catName = str(r['النوع']) || 'مصروفات أخرى';
    let cat = cats.get(normalizeArabic(catName));
    if (!cat) {
      cat = stamp({ id: `dz-expcat-${hashKey(normalizeArabic(catName))}`, name: catName, active: true, order: catOrder++ });
      cats.set(normalizeArabic(catName), cat);
      writes.expenseCategories.push(cat);
    }
    const by = ctx.userFor(str(r['تم الإنشاء بواسطة']));
    writes.expenses.push(stamp({
      id, categoryId: cat.id, amount, date,
      description: [name, str(r['تفاصيل']), str(r['آخر'])].filter(Boolean).join(' — '),
      method: 'cash', source: 'manual', refId: null, recurringId: null, receiptMediaId: null, userName: by.displayName,
    }, wallToISO(r['تم الإنشاء']), by));
    report.expenses.added++;
  }
  for (const r of sheets.expensePayments ?? []) if (!yes(r['مسترد'])) report.expenses.paidTotal += piasters(r['المبلغ']);
  for (const r of sheets.income ?? []) { report.income.count++; report.income.total += piasters(r['المبلغ']); }

  return {
    writes,
    counters: { patientFileNo: fileNo, invoiceNo: invNo, receiptNo: rcNo },
    report,
  };
}

/* ---------- Reading the current data and writing ---------- */

/** Everything planImport() needs from this device. */
export async function importContext({ userFor, doctorFor, today }) {
  const adapter = getAdapter();
  const stores = ['patients', 'appointments', 'treatmentPlans', 'treatmentItems', 'invoices', 'payments', 'expenseCategories', 'expenses'];
  const existing = {};
  for (const s of stores) existing[s] = await adapter.list(s);
  const { activeChairs } = await import('./schedule.js');
  const counters = {};
  for (const c of ['patientFileNo', 'invoiceNo', 'receiptNo']) counters[c] = (await repos.meta.get(`counter.${c}`, 0)) ?? 0;
  return { today, userFor, doctorFor, existing, counters, chairId: activeChairs()[0]?.id ?? null, procedures: await repos.procedures.list() };
}

const WRITE_ORDER = ['patients', 'treatmentPlans', 'treatmentItems', 'invoices', 'payments', 'appointments', 'expenseCategories', 'expenses'];

/**
 * Writes a plan in chunks (tracked for sync; no per-record audit rows), raises the counters
 * and logs one event.
 * @param {ReturnType<typeof planImport>} plan
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function applyImport(plan, onProgress) {
  const adapter = getAdapter();
  const total = WRITE_ORDER.reduce((n, s) => n + plan.writes[s].length, 0);
  let done = 0;
  for (const store of WRITE_ORDER) {
    const rows = plan.writes[store];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await adapter.putMany(store, chunk);
      done += chunk.length;
      onProgress?.(done, total);
    }
  }
  for (const [c, value] of Object.entries(plan.counters)) {
    if (value > ((await repos.meta.get(`counter.${c}`, 0)) ?? 0)) await repos.meta.set(`counter.${c}`, value);
  }
  const r = plan.report;
  await logEvent({
    action: 'dentolize_import', entity: 'import',
    summary: `استيراد من Dentolize: ${r.patients.added} مريض جديد (${r.patients.merged} دُمج)، ${r.appointments.added} موعد، ${r.invoices.added} فاتورة، ${r.payments.added} دفعة، ${r.expenses.added} مصروف`,
  });
  return done;
}
