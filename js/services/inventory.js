/**
 * Inventory: items, batches (expiry + cost), movements, recipes and automatic consumption.
 *
 * Quantities are numbers in the item's unit (decimals allowed: 0.3 g). Costs are piasters
 * per unit. item.qty and item.costPerUnit are caches recomputed from movements/batches.
 * Consumption takes from the batch that expires first (FEFO). If stock runs short the rest
 * is recorded without a batch, so the item shows a negative balance to correct by stocktake.
 *
 * Registers a treatment done-handler: completing a treatment item deducts its procedure's
 * recipe (quantities confirmed/edited by the user); moving it back returns the materials.
 */
import { repos } from '../data/index.js';
import { currentUser } from '../core/session.js';
import { todayISO } from '../core/format.js';
import { addDays } from '../core/time.js';
import { UNITS } from '../core/labels.js';
import { normalizeArabic } from '../core/text.js';
import { registerDoneHandler } from './treatment.js';
import { createExpense } from './expenses.js';

export class InventoryError extends Error {
  constructor(message) { super(message); this.name = 'InventoryError'; }
}

export const EXPIRY_WARNING_DAYS = 60;
export const round3 = (n) => Math.round(n * 1000) / 1000;
export const unitLabel = (u) => UNITS[u] ?? u ?? '';

/* ---------- Items ---------- */

/** Items with derived stock status: 'ok' | 'low' | 'out' | 'negative'. */
export async function listItems({ includeInactive = false } = {}) {
  const rows = await repos.inventoryItems.list();
  return rows.filter((i) => includeInactive || i.active !== false)
    .map((i) => ({ ...i, status: stockStatus(i) }))
    .sort((a, b) => a.category.localeCompare(b.category, 'ar') || a.name.localeCompare(b.name, 'ar'));
}

export function stockStatus(item) {
  if (item.qty < 0) return 'negative';
  if (item.qty === 0) return 'out';
  if (item.minQty && item.qty <= item.minQty) return 'low';
  return 'ok';
}

function cleanItem(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new InventoryError('اسم الصنف مطلوب');
  return {
    name,
    category: String(input.category ?? '').trim() || 'عام',
    unit: input.unit || 'piece',
    minQty: Math.max(0, Number(input.minQty) || 0),
    supplier: String(input.supplier ?? '').trim(),
    notes: String(input.notes ?? '').trim(),
  };
}

export async function createItem(input) {
  const data = cleanItem(input);
  const dup = (await repos.inventoryItems.list()).find((i) => normalizeArabic(i.name) === normalizeArabic(data.name));
  if (dup) throw new InventoryError('يوجد صنف بنفس الاسم');
  return repos.inventoryItems.create({ ...data, qty: 0, costPerUnit: 0, active: true });
}

export async function updateItem(id, input) {
  const current = await repos.inventoryItems.require(id);
  const patch = cleanItem({ ...current, ...input });
  if ('active' in input) patch.active = !!input.active;
  return repos.inventoryItems.update(id, patch);
}

export const deleteItem = (id) => repos.inventoryItems.remove(id);

/* ---------- Batches & movements ---------- */

/** Batches with stock, earliest expiry first (no expiry last). */
export async function batchesFor(itemId, { withEmpty = false } = {}) {
  const rows = await repos.stockBatches.findBy('itemId', itemId);
  return rows.filter((b) => withEmpty || b.qty > 0)
    .sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999') || a.receivedAt.localeCompare(b.receivedAt));
}

export async function movementsFor(itemId) {
  return (await repos.stockMovements.findBy('itemId', itemId)).sort((a, b) => b.at.localeCompare(a.at));
}

export async function movementsBetween(fromDay, toDay) {
  return (await repos.stockMovements.list({ index: 'date', range: { gte: fromDay, lte: toDay } })).sort((a, b) => b.at.localeCompare(a.at));
}

function movement(item, data) {
  const me = currentUser();
  const t = new Date().toISOString();
  return repos.stockMovements.create({
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    batchId: null,
    unitCost: 0,
    reason: '',
    treatmentItemId: null,
    procedureName: '',
    patientId: null,
    patientName: '',
    expenseId: null,
    ...data,
    qty: round3(data.qty),
    cost: Math.round(Math.abs(data.qty) * (data.unitCost ?? 0)),
    date: data.date ?? todayISO(),
    at: t,
    userName: me?.displayName ?? null,
  });
}

/** Recomputes cached qty (Σ movements) and weighted-average unit cost of remaining batches. */
export async function recomputeItem(itemId) {
  const [moves, batches, item] = await Promise.all([repos.stockMovements.findBy('itemId', itemId), batchesFor(itemId), repos.inventoryItems.get(itemId, { includeDeleted: true })]);
  if (!item) return null;
  const qty = round3(moves.reduce((n, m) => n + m.qty, 0));
  const inStock = batches.reduce((n, b) => n + b.qty, 0);
  let costPerUnit = item.costPerUnit;
  if (inStock > 0) costPerUnit = Math.round((batches.reduce((n, b) => n + b.qty * b.unitCost, 0) / inStock) * 100) / 100;
  else {
    const lastBuy = moves.filter((m) => m.type === 'purchase').sort((a, b) => b.at.localeCompare(a.at))[0];
    if (lastBuy) costPerUnit = lastBuy.unitCost;
  }
  if (qty === item.qty && costPerUnit === item.costPerUnit) return item;
  return repos.inventoryItems.update(itemId, { qty, costPerUnit });
}

/**
 * Receives a purchase into a new batch, optionally recording an expense.
 * @param {{ itemId: string, qty: number, unitCost: number, batchNo?: string, expiry?: string|null,
 *           supplier?: string, date?: string, createExpense?: boolean, note?: string }} input unitCost in piasters
 */
export async function receiveStock(input) {
  const item = await repos.inventoryItems.require(input.itemId);
  const qty = round3(Number(input.qty));
  const unitCost = Math.max(0, Number(input.unitCost) || 0);
  if (!(qty > 0)) throw new InventoryError('أدخل كمية صحيحة');
  const date = input.date || todayISO();
  const batch = await repos.stockBatches.create({
    itemId: item.id, batchNo: String(input.batchNo ?? '').trim(), expiry: input.expiry || null,
    qty, initialQty: qty, unitCost, supplier: String(input.supplier ?? '').trim(), receivedAt: date,
  });
  let expenseId = null;
  const total = Math.round(qty * unitCost);
  if (input.createExpense && total > 0) {
    const exp = await createExpense({
      categoryId: 'materials', amount: total, date,
      description: `شراء ${item.name} (${qty} ${unitLabel(item.unit)})${input.supplier ? ` من ${input.supplier}` : ''}`,
      source: 'inventory', refId: batch.id,
    });
    expenseId = exp.id;
  }
  await movement(item, { type: 'purchase', qty, unitCost, batchId: batch.id, date, reason: input.note ?? '', expenseId });
  if (input.supplier && !item.supplier) await repos.inventoryItems.update(item.id, { supplier: input.supplier.trim() });
  return recomputeItem(item.id);
}

/** Takes qty out FEFO; returns the movements created. */
async function takeOut(item, qty, data) {
  let left = round3(qty);
  const created = [];
  for (const b of await batchesFor(item.id)) {
    if (left <= 0) break;
    const take = round3(Math.min(b.qty, left));
    await repos.stockBatches.update(b.id, { qty: round3(b.qty - take) });
    created.push(await movement(item, { ...data, qty: -take, unitCost: b.unitCost, batchId: b.id }));
    left = round3(left - take);
  }
  if (left > 0) created.push(await movement(item, { ...data, qty: -left, unitCost: item.costPerUnit, batchId: null }));
  return created;
}

/**
 * Manual correction. delta > 0 adds (to a new "adjustment" batch), delta < 0 removes FEFO
 * (or from the chosen batch).
 */
export async function adjustStock({ itemId, delta, reason, batchId, expiry }) {
  if (!reason?.trim()) throw new InventoryError('اختر سبب التسوية');
  const item = await repos.inventoryItems.require(itemId);
  const d = round3(Number(delta));
  if (!d) throw new InventoryError('أدخل الكمية');
  if (d > 0) {
    const batch = await repos.stockBatches.create({ itemId, batchNo: 'تسوية', expiry: expiry || null, qty: d, initialQty: d, unitCost: item.costPerUnit, supplier: '', receivedAt: todayISO() });
    await movement(item, { type: 'adjust_in', qty: d, unitCost: item.costPerUnit, batchId: batch.id, reason: reason.trim() });
  } else if (batchId) {
    const b = await repos.stockBatches.require(batchId);
    const take = Math.min(b.qty, -d);
    await repos.stockBatches.update(b.id, { qty: round3(b.qty - take) });
    await movement(item, { type: 'adjust_out', qty: -take, unitCost: b.unitCost, batchId: b.id, reason: reason.trim() });
    if (-d > take) await movement(item, { type: 'adjust_out', qty: -(round3(-d - take)), unitCost: item.costPerUnit, reason: reason.trim() });
  } else {
    await takeOut(item, -d, { type: 'adjust_out', reason: reason.trim() });
  }
  return recomputeItem(itemId);
}

/* ---------- Recipes & consumption ---------- */

/** Estimated material cost of a recipe (piasters), using current average costs. */
export function recipeCost(recipe = [], itemsById) {
  return Math.round(recipe.reduce((n, r) => n + (itemsById.get(r.itemId)?.costPerUnit ?? 0) * r.qty, 0));
}

/**
 * Default consumption for a treatment item: recipe qty × units (teeth/qty), session lines
 * × sessions done. Used to pre-fill the "mark done" dialog.
 * @returns {Promise<Array<{ itemId, name, unit, qty, available }>>}
 */
export async function stockPreview(treatmentItem) {
  const proc = treatmentItem.procedureId ? await repos.procedures.get(treatmentItem.procedureId) : null;
  if (!proc?.recipe?.length) return [];
  const units = Math.max(1, treatmentItem.qty ?? 1);
  const sessions = Math.max(1, treatmentItem.sessionsDone || treatmentItem.sessionsPlanned || 1);
  const out = [];
  for (const r of proc.recipe) {
    const item = await repos.inventoryItems.get(r.itemId);
    if (!item || item.active === false) continue;
    out.push({ itemId: item.id, name: item.name, unit: item.unit, qty: round3(r.qty * units * (r.per === 'session' ? sessions : 1)), available: item.qty });
  }
  return out;
}

/** Deducts the given lines for a completed treatment item. */
export async function consumeForTreatment(treatmentItem, lines) {
  const patient = await repos.patients.get(treatmentItem.patientId, { includeDeleted: true });
  for (const l of lines) {
    if (!(l.qty > 0)) continue;
    const item = await repos.inventoryItems.get(l.itemId);
    if (!item) continue;
    await takeOut(item, l.qty, {
      type: 'consume', treatmentItemId: treatmentItem.id, procedureName: treatmentItem.procedureName,
      patientId: treatmentItem.patientId, patientName: patient?.name ?? '',
    });
    await recomputeItem(item.id);
  }
}

/** Reverses every consumption of a treatment item back into the same batches. */
export async function returnForTreatment(treatmentItem) {
  const moves = (await repos.stockMovements.findBy('treatmentItemId', treatmentItem.id)).filter((m) => m.type === 'consume' && !m.returned);
  const touched = new Set();
  for (const m of moves) {
    const item = await repos.inventoryItems.get(m.itemId, { includeDeleted: true });
    if (!item) continue;
    if (m.batchId) {
      const b = await repos.stockBatches.get(m.batchId);
      if (b) await repos.stockBatches.update(b.id, { qty: round3(b.qty - m.qty) });
    }
    await movement(item, { type: 'return', qty: -m.qty, unitCost: m.unitCost, batchId: m.batchId, treatmentItemId: treatmentItem.id, procedureName: treatmentItem.procedureName, patientId: m.patientId, patientName: m.patientName, reason: 'إرجاع البند من «تم»' });
    await repos.stockMovements.update(m.id, { returned: true });
    touched.add(m.itemId);
  }
  for (const id of touched) await recomputeItem(id);
}

/** Actual material cost recorded for a treatment item (consumption − returns). */
export async function actualMaterialCost(treatmentItemId) {
  const moves = await repos.stockMovements.findBy('treatmentItemId', treatmentItemId);
  return moves.reduce((n, m) => n + (m.type === 'consume' ? m.cost : m.type === 'return' ? -m.cost : 0), 0);
}

registerDoneHandler({
  key: 'stock',
  describe: () => null, // the done dialog shows editable stock lines itself (stockPreview)
  async onDone(item, opts) {
    const lines = opts?.consumption ?? await stockPreview(item);
    await consumeForTreatment(item, lines);
  },
  async onUndone(item) { await returnForTreatment(item); },
});

/* ---------- Alerts & shopping list ---------- */

/** Low/out-of-stock items and batches expiring soon or already expired. */
export async function inventoryAlerts(today = todayISO()) {
  const items = await listItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const soon = addDays(today, EXPIRY_WARNING_DAYS);
  const batches = (await repos.stockBatches.list()).filter((b) => b.qty > 0 && b.expiry && byId.has(b.itemId));
  return {
    low: items.filter((i) => i.status !== 'ok'),
    expired: batches.filter((b) => b.expiry < today).map((b) => ({ ...b, item: byId.get(b.itemId) })),
    expiring: batches.filter((b) => b.expiry >= today && b.expiry <= soon).map((b) => ({ ...b, item: byId.get(b.itemId) })).sort((a, b) => a.expiry.localeCompare(b.expiry)),
  };
}

/** Items to buy: at/below minimum, with a suggested quantity (back to 2× minimum). */
export async function shoppingList() {
  return (await listItems()).filter((i) => i.minQty > 0 && i.qty <= i.minQty)
    .map((i) => ({ ...i, suggested: round3(Math.max(i.minQty, i.minQty * 2 - Math.max(0, i.qty))) }));
}

/** Known suppliers and categories (for datalists). */
export async function inventoryHints() {
  const items = await repos.inventoryItems.list();
  const batches = await repos.stockBatches.list();
  return {
    categories: [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')),
    suppliers: [...new Set([...items.map((i) => i.supplier), ...batches.map((b) => b.supplier)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')),
  };
}
