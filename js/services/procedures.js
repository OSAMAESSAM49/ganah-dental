/**
 * Procedures catalog: categories and procedures with prices (piasters), duration, sessions,
 * per-tooth and lab flags. Order is explicit (`order` field) so the clinic controls it.
 * Procedures used by treatment plans cannot be deleted — only deactivated (phase 4+).
 */
import { getAdapter, repos } from '../data/index.js';
import { CONDITION, inferChartEffect } from '../core/chart-conditions.js';
import { FOLLOWUP_TYPES } from '../core/labels.js';

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'ar');

export class CatalogError extends Error {
  constructor(message) { super(message); this.name = 'CatalogError'; }
}

/** Categories (ordered) each with their procedures (ordered). */
export async function loadCatalog({ includeInactive = true } = {}) {
  const [cats, procs] = await Promise.all([repos.procedureCategories.list(), repos.procedures.list()]);
  return cats.sort(byOrder)
    .filter((c) => includeInactive || c.active)
    .map((c) => ({
      ...c,
      procedures: procs.filter((p) => p.categoryId === c.id && (includeInactive || p.active)).sort(byOrder),
    }));
}

/** Active procedures, flat, for pickers (treatment plans, appointments…). */
export async function activeProcedures() {
  return (await loadCatalog({ includeInactive: false })).flatMap((c) => c.procedures.map((p) => ({ ...p, categoryName: c.name })));
}

/** Active procedures that still have no price. */
export async function unpricedCount() {
  return (await repos.procedures.list()).filter((p) => p.active && !p.price).length;
}

/* ---------- Categories ---------- */

export async function createCategory(name) {
  if (!name?.trim()) throw new CatalogError('اسم التصنيف مطلوب');
  const cats = await repos.procedureCategories.list();
  if (cats.some((c) => c.name.trim() === name.trim())) throw new CatalogError('يوجد تصنيف بنفس الاسم');
  const order = Math.max(-1, ...cats.map((c) => c.order ?? 0)) + 1;
  return repos.procedureCategories.create({ name: name.trim(), icon: 'clipboard-list', order, active: true });
}

export function updateCategory(id, patch) {
  const clean = {};
  if ('name' in patch) {
    if (!patch.name?.trim()) throw new CatalogError('اسم التصنيف مطلوب');
    clean.name = patch.name.trim();
  }
  if ('active' in patch) clean.active = !!patch.active;
  return repos.procedureCategories.update(id, clean);
}

export async function deleteCategory(id) {
  const procs = await repos.procedures.findBy('categoryId', id);
  if (procs.length) throw new CatalogError('لا يمكن حذف تصنيف يحتوي على إجراءات. انقلها أو احذفها أولًا.');
  await repos.procedureCategories.remove(id);
}

/* ---------- Procedures ---------- */

function cleanProcedure(input) {
  const int = (v, min, max, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    name: String(input.name ?? '').trim(),
    nameEn: String(input.nameEn ?? '').trim(), // shown on English screens
    categoryId: input.categoryId,
    price: Math.max(0, Math.round(Number(input.price) || 0)),
    durationMin: int(input.durationMin, 5, 480, 30),
    sessions: int(input.sessions, 1, 20, 1),
    perTooth: !!input.perTooth && !input.oncePerCase,
    oncePerCase: !!input.oncePerCase, // one charge however many teeth (braces, full arch)
    needsLab: !!input.needsLab,
    notes: String(input.notes ?? '').trim(),
    recipe: (Array.isArray(input.recipe) ? input.recipe : [])
      .filter((r) => r?.itemId && Number(r.qty) > 0)
      .map((r) => ({ itemId: r.itemId, qty: Math.round(Number(r.qty) * 1000) / 1000, per: r.per === 'session' ? 'session' : 'completion' })),
    chartEffect: input.chartEffect === undefined ? inferChartEffect(input.name) : (CONDITION[input.chartEffect] ? input.chartEffect : ''),
    instructionTemplateId: input.instructionTemplateId || null,
    followUpSchedule: (Array.isArray(input.followUpSchedule) ? input.followUpSchedule : [])
      .filter((s) => FOLLOWUP_TYPES[s?.type] && Number.isFinite(Number(s.offsetDays)))
      .map((s) => ({ offsetDays: int(s.offsetDays, 0, 730, 1), type: s.type, note: String(s.note ?? '').trim() }))
      .sort((a, b) => a.offsetDays - b.offsetDays),
  };
}

/** @param {object} input price in piasters */
export async function createProcedure(input) {
  const data = cleanProcedure(input);
  if (!data.name) throw new CatalogError('اسم الإجراء مطلوب');
  if (!(await repos.procedureCategories.get(data.categoryId))) throw new CatalogError('اختر تصنيفًا');
  const siblings = await repos.procedures.findBy('categoryId', data.categoryId);
  if (siblings.some((p) => p.name === data.name)) throw new CatalogError('يوجد إجراء بنفس الاسم في هذا التصنيف');
  const order = Math.max(-1, ...siblings.map((p) => p.order ?? 0)) + 1;
  return repos.procedures.create({ ...data, active: true, order });
}

export async function updateProcedure(id, input) {
  const current = await repos.procedures.require(id);
  const data = cleanProcedure({ ...current, ...input });
  if (!data.name) throw new CatalogError('اسم الإجراء مطلوب');
  const patch = { ...data };
  if ('active' in input) patch.active = !!input.active;
  if (data.categoryId !== current.categoryId) {
    const siblings = await repos.procedures.findBy('categoryId', data.categoryId);
    patch.order = Math.max(-1, ...siblings.map((p) => p.order ?? 0)) + 1;
  }
  return repos.procedures.update(id, patch);
}

/** True when any stored record references the procedure (checked as stores appear). */
export async function isProcedureUsed(id) {
  const stores = getAdapter().storeNames();
  if (stores.includes('treatmentItems')) {
    const items = await getAdapter().list('treatmentItems', { index: 'procedureId', range: { eq: id }, limit: 1 });
    if (items.length) return true;
  }
  return false;
}

export async function deleteProcedure(id) {
  if (await isProcedureUsed(id)) throw new CatalogError('هذا الإجراء مستخدم في خطط علاج. يمكنك إيقافه بدلًا من حذفه.');
  await repos.procedures.remove(id);
}

/**
 * Moves an item one step up/down within its list and renumbers orders.
 * @param {'procedures'|'procedureCategories'} store @param {string} id @param {-1|1} dir
 */
export async function move(store, id, dir) {
  const repo = repos[store];
  const item = await repo.require(id);
  const list = (store === 'procedures' ? await repo.findBy('categoryId', item.categoryId) : await repo.list()).sort(byOrder);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (const [order, x] of list.entries()) {
    if (x.order !== order) await repo.update(x.id, { order });
  }
}
