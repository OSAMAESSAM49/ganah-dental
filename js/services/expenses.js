/**
 * Expenses: editable categories, one-time expenses (with optional receipt image), recurring
 * monthly templates that generate an expense each month, and totals.
 *
 * Expense: { categoryId, amount (piasters), date, description, method, source: 'manual'|
 *            'inventory'|'lab'|'recurring', refId, recurringId, receiptMediaId, userName }
 * Recurring templates are materialised when the app is opened (a static app cannot run
 * background jobs): generateRecurringExpenses() creates any missing months up to today.
 */
import { repos } from '../data/index.js';
import { currentUser } from '../core/session.js';
import { todayISO } from '../core/format.js';
import { resizeImage } from '../core/image.js';

export class ExpenseError extends Error {
  constructor(message) { super(message); this.name = 'ExpenseError'; }
}

/* ---------- Categories ---------- */

export async function listCategories({ includeInactive = true } = {}) {
  return (await repos.expenseCategories.list()).filter((c) => includeInactive || c.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function createCategory(name) {
  if (!name?.trim()) throw new ExpenseError('اسم التصنيف مطلوب');
  const cats = await listCategories();
  if (cats.some((c) => c.name === name.trim())) throw new ExpenseError('يوجد تصنيف بنفس الاسم');
  return repos.expenseCategories.create({ name: name.trim(), active: true, order: cats.length });
}

export function updateCategory(id, patch) {
  const clean = {};
  if ('name' in patch) { if (!patch.name?.trim()) throw new ExpenseError('اسم التصنيف مطلوب'); clean.name = patch.name.trim(); }
  if ('active' in patch) clean.active = !!patch.active;
  return repos.expenseCategories.update(id, clean);
}

/* ---------- Expenses ---------- */

/**
 * @param {{ categoryId: string, amount: number, date?: string, description?: string, method?: string,
 *           source?: string, refId?: string|null, recurringId?: string|null, receiptFile?: File|null }} input
 */
export async function createExpense(input) {
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new ExpenseError('أدخل مبلغًا صحيحًا');
  if (!(await repos.expenseCategories.get(input.categoryId))) throw new ExpenseError('اختر التصنيف');
  const receiptMediaId = input.receiptFile ? await saveReceipt(input.receiptFile) : (input.receiptMediaId ?? null);
  return repos.expenses.create({
    categoryId: input.categoryId,
    amount,
    date: input.date || todayISO(),
    description: String(input.description ?? '').trim(),
    method: input.method || 'cash',
    source: input.source || 'manual',
    refId: input.refId ?? null,
    recurringId: input.recurringId ?? null,
    receiptMediaId,
    userName: currentUser()?.displayName ?? null,
  });
}

export async function updateExpense(id, input) {
  const current = await repos.expenses.require(id);
  const patch = {};
  if ('amount' in input) { const a = Math.round(Number(input.amount)); if (!(a > 0)) throw new ExpenseError('أدخل مبلغًا صحيحًا'); patch.amount = a; }
  for (const k of ['categoryId', 'date', 'description', 'method']) if (k in input) patch[k] = input[k];
  if (input.receiptFile) {
    if (current.receiptMediaId) await repos.media.remove(current.receiptMediaId);
    patch.receiptMediaId = await saveReceipt(input.receiptFile);
  }
  return repos.expenses.update(id, patch);
}

export async function deleteExpense(id) {
  const e = await repos.expenses.require(id);
  if (e.receiptMediaId) await repos.media.remove(e.receiptMediaId);
  await repos.expenses.remove(id);
}

async function saveReceipt(file) {
  const { blob, width, height } = await resizeImage(file, { maxSize: 1600, quality: 0.8 });
  const thumb = (await resizeImage(file, { maxSize: 300, quality: 0.7 })).blob;
  const m = await repos.media.create({ patientId: null, kind: 'receipt', tag: '', caption: file.name, takenAt: todayISO(), blob, thumb, width, height, size: blob.size, mime: blob.type, teeth: [] });
  return m.id;
}

export async function listExpenses(fromDay, toDay) {
  return (await repos.expenses.list({ index: 'date', range: { gte: fromDay, lte: toDay } })).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function expensesTotal(fromDay, toDay) {
  return (await listExpenses(fromDay, toDay)).reduce((n, e) => n + e.amount, 0);
}

/** Totals per category id for a period. */
export async function totalsByCategory(fromDay, toDay) {
  const out = {};
  for (const e of await listExpenses(fromDay, toDay)) out[e.categoryId] = (out[e.categoryId] ?? 0) + e.amount;
  return out;
}

/** Finds the expense created for a linked record (lab case, stock batch). */
export async function expenseFor(refId) {
  return (await repos.expenses.findBy('refId', refId))[0] ?? null;
}

/* ---------- Recurring ---------- */

/**
 * @param {{ categoryId: string, amount: number, description: string, dayOfMonth: number, startMonth?: string }} input
 */
export async function createRecurring(input) {
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new ExpenseError('أدخل مبلغًا صحيحًا');
  if (!(await repos.expenseCategories.get(input.categoryId))) throw new ExpenseError('اختر التصنيف');
  const day = Math.min(28, Math.max(1, Math.round(Number(input.dayOfMonth) || 1)));
  const rec = await repos.recurringExpenses.create({
    categoryId: input.categoryId, amount, description: String(input.description ?? '').trim(), dayOfMonth: day,
    startMonth: input.startMonth || todayISO().slice(0, 7), active: true, lastGenerated: null,
  });
  await generateRecurringExpenses();
  return rec;
}

export const updateRecurring = (id, patch) => repos.recurringExpenses.update(id, patch);
export const listRecurring = () => repos.recurringExpenses.list();

/** Months 'YYYY-MM' from a to b inclusive. Exported for tests. */
export function monthsBetween(a, b) {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  while (y < by || (y === by && m <= bm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/**
 * Creates the expense for every month a recurring template is due and has not been
 * generated yet (up to today). Safe to call repeatedly.
 * @returns {Promise<number>} expenses created
 */
export async function generateRecurringExpenses(today = todayISO()) {
  let created = 0;
  for (const r of await repos.recurringExpenses.list()) {
    if (!r.active) continue;
    const from = r.lastGenerated ? monthsBetween(r.lastGenerated, today.slice(0, 7)).slice(1)[0] : r.startMonth;
    if (!from) continue;
    let last = r.lastGenerated;
    for (const month of monthsBetween(from, today.slice(0, 7))) {
      const date = `${month}-${String(r.dayOfMonth).padStart(2, '0')}`;
      if (date > today) break;
      const exists = (await repos.expenses.findBy('refId', `${r.id}:${month}`)).length;
      if (!exists) {
        await repos.expenses.create({
          categoryId: r.categoryId, amount: r.amount, date, description: r.description, method: 'cash',
          source: 'recurring', refId: `${r.id}:${month}`, recurringId: r.id, receiptMediaId: null, userName: 'تلقائي',
        });
        created++;
      }
      last = month;
    }
    if (last !== r.lastGenerated) await repos.recurringExpenses.update(r.id, { lastGenerated: last });
  }
  return created;
}
