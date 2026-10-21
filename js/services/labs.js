/**
 * Lab cases: work sent to a dental lab (crowns, bridges, veneers, dentures…).
 * Flow: sent → received → try_in → cemented (or cancelled). Each step stamps a date.
 * The lab cost is recorded as an expense in the "lab" category and kept in sync.
 */
import { repos } from '../data/index.js';
import { todayISO } from '../core/format.js';
import { createExpense, expenseFor, deleteExpense } from './expenses.js';
import { LAB_WORK_TYPES } from '../core/labels.js';

export class LabError extends Error {
  constructor(message) { super(message); this.name = 'LabError'; }
}

export const LAB_FLOW = ['sent', 'received', 'try_in', 'cemented'];
const STAMP = { received: 'receivedAt', try_in: 'tryInAt', cemented: 'cementedAt' };

export const isOverdue = (c, today = todayISO()) => c.status === 'sent' && !!c.expectedAt && c.expectedAt < today;

export async function listLabCases({ includeDeleted = false } = {}) {
  return (await repos.labCases.list({ includeDeleted })).sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
}
export const labCasesForPatient = async (patientId) => (await repos.labCases.findBy('patientId', patientId)).sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));

/** Lab names used before (datalist). */
export async function knownLabs() {
  return [...new Set((await repos.labCases.list({ includeDeleted: true })).map((c) => c.labName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
}

function clean(input) {
  if (!input.patientId) throw new LabError('اختر المريض');
  if (!String(input.labName ?? '').trim()) throw new LabError('اكتب اسم المعمل');
  return {
    patientId: input.patientId,
    patientName: input.patientName ?? '',
    treatmentItemId: input.treatmentItemId || null,
    labName: String(input.labName).trim(),
    workType: LAB_WORK_TYPES[input.workType] ? input.workType : 'other',
    teeth: input.teeth ?? [],
    shade: String(input.shade ?? '').trim(),
    material: String(input.material ?? '').trim(),
    sentAt: input.sentAt || todayISO(),
    expectedAt: input.expectedAt || null,
    cost: Math.max(0, Math.round(Number(input.cost) || 0)),
    notes: String(input.notes ?? '').trim(),
  };
}

async function syncExpense(c, { recordCost }) {
  const existing = await expenseFor(c.id);
  const description = `معمل ${c.labName}: ${LAB_WORK_TYPES[c.workType]} — ${c.patientName}${c.teeth?.length ? ` (${c.teeth.join(',')})` : ''}`;
  if (!recordCost || !c.cost || c.status === 'cancelled') {
    if (existing) await deleteExpense(existing.id);
    return;
  }
  if (existing) {
    if (existing.amount !== c.cost || existing.description !== description) await repos.expenses.update(existing.id, { amount: c.cost, description });
  } else {
    await createExpense({ categoryId: 'lab', amount: c.cost, date: c.sentAt, description, source: 'lab', refId: c.id });
  }
}

/** @param {object} input @param {{ recordCost?: boolean }} [opts] */
export async function createLabCase(input, { recordCost = true } = {}) {
  const c = await repos.labCases.create({ ...clean(input), status: 'sent', receivedAt: null, tryInAt: null, cementedAt: null, recordCost });
  await syncExpense(c, { recordCost });
  return c;
}

export async function updateLabCase(id, input, { recordCost } = {}) {
  const current = await repos.labCases.require(id);
  const rc = recordCost ?? current.recordCost ?? true;
  const c = await repos.labCases.update(id, { ...clean({ ...current, ...input }), recordCost: rc });
  await syncExpense(c, { recordCost: rc });
  return c;
}

/** Moves the case to a status, stamping its date (moving back clears later stamps). */
export async function setLabStatus(id, status, date = todayISO()) {
  const c = await repos.labCases.require(id);
  if (status === 'cancelled') {
    const u = await repos.labCases.update(id, { status });
    await syncExpense(u, { recordCost: c.recordCost ?? true });
    return u;
  }
  const idx = LAB_FLOW.indexOf(status);
  if (idx < 0) throw new LabError('حالة غير صحيحة');
  const patch = { status };
  LAB_FLOW.forEach((s, i) => { if (STAMP[s]) patch[STAMP[s]] = i <= idx ? (c[STAMP[s]] ?? date) : null; });
  const u = await repos.labCases.update(id, patch);
  if (c.status === 'cancelled') await syncExpense(u, { recordCost: c.recordCost ?? true });
  return u;
}

export async function deleteLabCase(id) {
  const existing = await expenseFor(id);
  if (existing) await deleteExpense(existing.id);
  await repos.labCases.remove(id);
}

/** Cases still at the lab past their expected date. */
export async function overdueLabCases(today = todayISO()) {
  return (await listLabCases()).filter((c) => isOverdue(c, today));
}
