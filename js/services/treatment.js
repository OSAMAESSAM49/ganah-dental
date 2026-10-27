/**
 * Treatment plans and items (Planned → In progress → Done).
 *
 * A patient can have several plans:
 *   active    — the plan being carried out (the first plan is active automatically)
 *   proposal  — an alternative offered to the patient (e.g. economical vs premium)
 *   rejected  — a proposal the patient did not choose (kept for reference)
 *   completed — every item done or cancelled
 * Only items in an active plan can be started or completed.
 *
 * Marking an item Done runs the registered done-handlers (chart update now; stock
 * deduction in phase 7; follow-ups in phase 8). Moving it back undoes their effects.
 */
import { repos } from '../data/index.js';
import { currentUser } from '../core/session.js';
import { CONDITION } from '../core/chart-conditions.js';
import { recordToothEvents, voidEventsForItem } from './chart.js';

export class TreatmentError extends Error {
  constructor(message) { super(message); this.name = 'TreatmentError'; }
}

export const STATUSES = ['planned', 'in_progress', 'done', 'cancelled'];

/* ---------- Money ---------- */

/**
 * Line math in piasters. discountType 'amount' (piasters) or 'percent' (0–100).
 * Exported for tests.
 */
export function itemMath({ unitPrice = 0, qty = 1, discountType = 'amount', discountValue = 0 }) {
  const gross = Math.max(0, Math.round(unitPrice)) * Math.max(1, Math.round(qty));
  const raw = discountType === 'percent' ? Math.round((gross * Math.min(100, Math.max(0, Number(discountValue) || 0))) / 100) : Math.round(Number(discountValue) || 0);
  const discount = Math.min(gross, Math.max(0, raw));
  return { gross, discount, total: gross - discount };
}

/** Totals for a list of items (cancelled items excluded). */
export function planTotals(items) {
  const live = items.filter((i) => i.status !== 'cancelled');
  const sum = (arr, f) => arr.reduce((n, i) => n + f(i), 0);
  const gross = sum(live, (i) => itemMath(i).gross);
  const discount = sum(live, (i) => itemMath(i).discount);
  const done = sum(live.filter((i) => i.status === 'done'), (i) => itemMath(i).total);
  return { count: live.length, gross, discount, net: gross - discount, done, remaining: gross - discount - done };
}

/* ---------- Done handlers (extension point for later phases) ---------- */

/**
 * @typedef {{ key: string,
 *   describe?: (item: object) => (string|null|Promise<string|null>),  // shown in the "mark done" confirmation
 *   onDone?: (item: object, opts?: { consumption?: object[] }) => Promise<void>|void,  // opts from the done dialog
 *   onUndone?: (item: object) => Promise<void>|void }} DoneHandler
 */
/** @type {DoneHandler[]} */
const doneHandlers = [];
export function registerDoneHandler(handler) {
  const i = doneHandlers.findIndex((h) => h.key === handler.key);
  if (i >= 0) doneHandlers[i] = handler; else doneHandlers.push(handler);
}

/** What will happen when this item is marked done (for the confirmation dialog). describe() may be async. */
export const describeDone = async (item) => (await Promise.all(doneHandlers.map((h) => h.describe?.(item)))).filter(Boolean);

// Core handler: update the dental chart.
registerDoneHandler({
  key: 'chart',
  describe(item) {
    const c = CONDITION[item.chartEffect];
    if (!c || !item.teeth?.length) return null;
    return `تحديث خريطة الأسنان: «${c.label}» على ${item.teeth.join('، ')}`;
  },
  async onDone(item) {
    const c = CONDITION[item.chartEffect];
    if (!c || !item.teeth?.length) return;
    const changes = item.teeth.map((tooth) => ({
      tooth, type: 'add', condition: item.chartEffect,
      surfaces: c.surface ? (item.surfaces?.length ? item.surfaces : ['O']) : [],
    }));
    // A completed extraction also clears a pending "needs extraction" mark.
    await recordToothEvents(item.patientId, changes, { source: 'treatment', treatmentItemId: item.id, note: item.procedureName });
  },
  async onUndone(item) { await voidEventsForItem(item.patientId, item.id); },
});

/* ---------- Plans ---------- */

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt);

export async function listPlans(patientId) {
  return (await repos.treatmentPlans.findBy('patientId', patientId)).sort(byOrder);
}

export async function listItems(patientId) {
  return (await repos.treatmentItems.findBy('patientId', patientId)).sort(byOrder);
}

/** Returns the patient's first active plan, creating "الخطة الرئيسية" if there is none. */
export async function ensureActivePlan(patientId) {
  const plans = await listPlans(patientId);
  const active = plans.find((p) => p.status === 'active');
  if (active) return active;
  const own = plans.filter((p) => !isImportedHistory(p));
  return repos.treatmentPlans.create({ patientId, name: own.length ? 'خطة جديدة' : 'الخطة الرئيسية', status: 'active', notes: '', order: own.length });
}

/** The completed "history" plan the Dentolize import adds (not a plan the clinic made). */
export const isImportedHistory = (plan) => String(plan.id).startsWith('dz-plan-');

/**
 * @param {string} patientId
 * @param {{ name: string, status?: 'active'|'proposal', copyFrom?: string }} input
 */
export async function createPlan(patientId, { name, status = 'proposal', copyFrom }) {
  if (!name?.trim()) throw new TreatmentError('اسم الخطة مطلوب');
  const plans = await listPlans(patientId);
  const plan = await repos.treatmentPlans.create({ patientId, name: name.trim(), status, notes: '', order: plans.length });
  if (copyFrom) {
    const items = (await repos.treatmentItems.findBy('planId', copyFrom)).filter((i) => i.status !== 'cancelled').sort(byOrder);
    for (const it of items) {
      const { id, createdAt, updatedAt, createdBy, updatedBy, statusHistory, doneAt, invoiceId, ...rest } = it;
      await repos.treatmentItems.create({ ...rest, planId: plan.id, status: 'planned', sessionsDone: 0, statusHistory: [historyEntry('planned')], doneAt: null, invoiceId: null });
    }
  }
  return plan;
}

export async function updatePlan(id, patch) {
  const clean = {};
  if ('name' in patch) {
    if (!patch.name?.trim()) throw new TreatmentError('اسم الخطة مطلوب');
    clean.name = patch.name.trim();
  }
  if ('notes' in patch) clean.notes = String(patch.notes ?? '').trim();
  return repos.treatmentPlans.update(id, clean);
}

/**
 * Patient chose this plan: it becomes active. Every other open plan that has not been
 * started (no item in progress or done) becomes "rejected", so its items stop showing as
 * planned on the chart. Plans already under way are left alone.
 * @returns {Promise<string[]>} names of the plans marked rejected
 */
export async function choosePlan(id) {
  const plan = await repos.treatmentPlans.require(id);
  await repos.treatmentPlans.update(id, { status: 'active' });
  const rejected = [];
  for (const p of await listPlans(plan.patientId)) {
    if (p.id === id || (p.status !== 'proposal' && p.status !== 'active')) continue;
    const started = (await repos.treatmentItems.findBy('planId', p.id)).some((i) => i.status === 'in_progress' || i.status === 'done');
    if (!started) { await repos.treatmentPlans.update(p.id, { status: 'rejected' }); rejected.push(p.name); }
  }
  return rejected;
}

export async function setPlanStatus(id, status) {
  if (!['active', 'proposal', 'rejected', 'completed'].includes(status)) throw new TreatmentError('حالة غير صحيحة');
  return repos.treatmentPlans.update(id, { status });
}

/** Deletes a plan and its items — only when nothing in it was started. */
export async function deletePlan(id) {
  const items = await repos.treatmentItems.findBy('planId', id);
  if (items.some((i) => i.status === 'in_progress' || i.status === 'done')) {
    throw new TreatmentError('لا يمكن حذف خطة بها بنود بدأت أو انتهت. يمكنك إلغاء البنود المتبقية بدلًا من ذلك.');
  }
  for (const it of items) await repos.treatmentItems.remove(it.id);
  await repos.treatmentPlans.remove(id);
}

/* ---------- Items ---------- */

function historyEntry(status) {
  return { status, at: new Date().toISOString(), by: currentUser()?.displayName ?? null };
}

/**
 * Adds procedure(s) to a plan. Per-tooth procedures become one item per tooth (each can be
 * done separately); others become a single item covering all given teeth.
 * @param {string} planId
 * @param {{ procedure: object, teeth?: number[], surfaces?: string[], unitPrice?: number, notes?: string }} input
 * @returns {Promise<object[]>} created items
 */
/**
 * @param {{ procedure: object, teeth?: number[], surfaces?: string[], unitPrice?: number, notes?: string,
 *           discountType?: 'amount'|'percent', discountValue?: number|number[] }} input
 *   discountValue: piasters (amount) or % — an array gives each created item its own value.
 */
export async function addItems(planId, { procedure, teeth = [], surfaces = [], unitPrice, notes = '', discountType = 'amount', discountValue = 0 }) {
  const plan = await repos.treatmentPlans.require(planId);
  if (procedure.perTooth && !teeth.length) throw new TreatmentError('اختر السن أو الأسنان لهذا الإجراء');
  const existing = await repos.treatmentItems.findBy('planId', planId);
  let order = Math.max(-1, ...existing.map((i) => i.order ?? 0)) + 1;
  const groups = procedure.perTooth ? teeth.map((t) => [t]) : [teeth];
  const created = [];
  for (const [n, group] of groups.entries()) {
    const base = {
      patientId: plan.patientId,
      planId,
      procedureId: procedure.id,
      procedureName: procedure.name,
      categoryId: procedure.categoryId,
      teeth: group,
      surfaces: CONDITION[procedure.chartEffect]?.surface ? surfaces : [],
      chartEffect: procedure.chartEffect ?? '',
      unitPrice: unitPrice ?? procedure.price ?? 0,
      qty: 1,
      discountType: discountType === 'percent' ? 'percent' : 'amount',
      discountValue: Math.max(0, Number(Array.isArray(discountValue) ? discountValue[n] : discountValue) || 0),
      sessionsPlanned: procedure.sessions ?? 1,
      sessionsDone: 0,
      needsLab: !!procedure.needsLab,
      status: 'planned',
      statusHistory: [historyEntry('planned')],
      notes,
      order: order++,
      doneAt: null,
      invoiceId: null,
    };
    created.push(await repos.treatmentItems.create({ ...base, total: itemMath(base).total }));
  }
  return created;
}

/** Edits price/discount/teeth/sessions/notes (not status — use setItemStatus). */
export async function updateItem(id, patch) {
  const item = await repos.treatmentItems.require(id);
  if (item.invoiceId && ('unitPrice' in patch || 'qty' in patch || 'discountValue' in patch || 'discountType' in patch)) {
    throw new TreatmentError('هذا البند تمت فوترته؛ عدّل الفاتورة بدلًا من ذلك.');
  }
  const allowed = ['teeth', 'surfaces', 'unitPrice', 'qty', 'discountType', 'discountValue', 'sessionsPlanned', 'sessionsDone', 'notes', 'doctorId'];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  if ('discountType' in clean && !['amount', 'percent'].includes(clean.discountType)) clean.discountType = 'amount';
  const next = { ...item, ...clean };
  if (next.sessionsDone > next.sessionsPlanned) next.sessionsPlanned = next.sessionsDone;
  return repos.treatmentItems.update(id, { ...clean, sessionsPlanned: next.sessionsPlanned, total: itemMath(next).total });
}

/**
 * Moves an item to a new status, running done-handlers as needed.
 * @param {string} id @param {'planned'|'in_progress'|'done'|'cancelled'} status
 * @param {{ consumption?: Array<{ itemId: string, qty: number }> }} [opts] confirmed stock lines from the done dialog
 */
export async function setItemStatus(id, status, opts = {}) {
  if (!STATUSES.includes(status)) throw new TreatmentError('حالة غير صحيحة');
  const item = await repos.treatmentItems.require(id);
  if (item.status === status) return item;
  const plan = await repos.treatmentPlans.require(item.planId);
  if ((status === 'in_progress' || status === 'done') && plan.status !== 'active' && plan.status !== 'completed') {
    throw new TreatmentError('هذه خطة بديلة لم يعتمدها المريض بعد. اعتمدها أولًا لبدء العلاج.');
  }
  // An invoiced item may still go from "in progress" to "done", but never back or cancelled.
  if (item.invoiceId && (item.status === 'done' || status === 'planned' || status === 'cancelled')) {
    throw new TreatmentError('هذا البند تمت فوترته ولا يمكن تغيير حالته. ألغِ الفاتورة أولًا إذا لزم.');
  }

  const patch = {
    status,
    statusHistory: [...(item.statusHistory ?? []), historyEntry(status)],
    doneAt: status === 'done' ? new Date().toISOString() : null,
  };
  if (status === 'done') patch.sessionsDone = Math.max(item.sessionsDone ?? 0, item.sessionsPlanned ?? 1);
  if (status === 'in_progress' && !item.sessionsDone) patch.sessionsDone = 0;
  const updated = await repos.treatmentItems.update(id, patch);

  if (status === 'done') for (const h of doneHandlers) await h.onDone?.(updated, opts);
  if (item.status === 'done') for (const h of doneHandlers) await h.onUndone?.(updated);
  await refreshPlanCompletion(item.planId);
  return updated;
}

/** Records one more completed session; suggests Done when all sessions are complete. */
export async function addSession(id) {
  const item = await repos.treatmentItems.require(id);
  const sessionsDone = (item.sessionsDone ?? 0) + 1;
  const updated = await updateItem(id, { sessionsDone });
  if (item.status === 'planned') await setItemStatus(id, 'in_progress');
  return { item: updated, complete: sessionsDone >= (updated.sessionsPlanned ?? 1) };
}

/** Planned/cancelled items can be removed; started ones should be cancelled instead. */
export async function deleteItem(id) {
  const item = await repos.treatmentItems.require(id);
  if (item.status === 'in_progress' || item.status === 'done') throw new TreatmentError('لا يمكن حذف بند بدأ أو انتهى. غيّر حالته إلى «ملغي» بدلًا من ذلك.');
  await repos.treatmentItems.remove(id);
  await refreshPlanCompletion(item.planId);
}

/** Reorders an item within its plan/status column. */
export async function moveItem(id, beforeId) {
  const item = await repos.treatmentItems.require(id);
  const siblings = (await repos.treatmentItems.findBy('planId', item.planId)).sort(byOrder).filter((i) => i.id !== id);
  const at = beforeId ? siblings.findIndex((i) => i.id === beforeId) : siblings.length;
  siblings.splice(at < 0 ? siblings.length : at, 0, item);
  for (const [order, it] of siblings.entries()) if (it.order !== order) await repos.treatmentItems.update(it.id, { order });
}

/** Marks an active plan completed when all its items are done/cancelled (and back). */
async function refreshPlanCompletion(planId) {
  const plan = await repos.treatmentPlans.get(planId);
  if (!plan || (plan.status !== 'active' && plan.status !== 'completed')) return;
  const items = await repos.treatmentItems.findBy('planId', planId);
  const finished = items.length > 0 && items.every((i) => i.status === 'done' || i.status === 'cancelled');
  if (finished && plan.status === 'active') await repos.treatmentPlans.update(planId, { status: 'completed' });
  if (!finished && plan.status === 'completed') await repos.treatmentPlans.update(planId, { status: 'active' });
}

/** Open (planned/in-progress) items per tooth — used to mark the chart. */
export function plannedByTooth(items, plans) {
  const live = new Set(plans.filter((p) => p.status === 'active' || p.status === 'proposal').map((p) => p.id));
  const map = new Map();
  for (const it of items) {
    if (!live.has(it.planId) || (it.status !== 'planned' && it.status !== 'in_progress')) continue;
    for (const t of it.teeth ?? []) map.set(t, [...(map.get(t) ?? []), it]);
  }
  return map;
}
