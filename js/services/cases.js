/**
 * Orthodontic and implant case files. One record per case (its plan, and for implant cases
 * the implants placed) and one record per follow-up visit, so two devices adding visits to
 * the same case never overwrite each other. Implant cases can keep follow-ups in «المتابعات»
 * for suture removal and the prosthesis date (linked by caseId, moved when the date changes).
 */
import { repos } from '../data/index.js';
import { todayISO } from '../core/format.js';
import { addDays } from '../core/time.js';

export const CASE_TYPES = {
  ortho: { label: 'تقويم', title: 'ملف التقويم' },
  implant: { label: 'زراعة', title: 'ملف الزراعة' },
};
export const CASE_STATUS = {
  active: { label: 'جارٍ', tone: 'primary' },
  retention: { label: 'مرحلة التثبيت', tone: 'info' },
  finished: { label: 'انتهى العلاج', tone: 'success' },
  stopped: { label: 'توقف العلاج', tone: '' },
};
export const isOpen = (c) => c.status === 'active' || c.status === 'retention';

export class CaseError extends Error {
  constructor(message) { super(message); this.name = 'CaseError'; }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (ISO.test(v ?? '') ? v : '');

/** Open cases first, then newest. */
export async function listCases(patientId) {
  const rows = await repos.cases.findBy('patientId', patientId);
  return rows.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (b.startDate || '').localeCompare(a.startDate || ''));
}

export const getCase = (id) => repos.cases.require(id);

/** @param {string} patientId @param {'ortho'|'implant'} type @param {object} [plan] */
export async function createCase(patientId, type, plan = {}) {
  if (!CASE_TYPES[type]) throw new CaseError('نوع الحالة غير معروف');
  const { startDate, ...rest } = plan;
  const c = await repos.cases.create({
    patientId, type, status: 'active', startDate: day(startDate) || todayISO(), endDate: '',
    plan: rest, implants: [],
  });
  await syncReminders(c);
  return c;
}

/** @param {string} id @param {{ status?, startDate?, endDate?, plan?, implants? }} patch */
export async function updateCase(id, patch) {
  const cur = await repos.cases.require(id);
  const next = {};
  if (patch.status !== undefined) {
    if (!CASE_STATUS[patch.status]) throw new CaseError('حالة غير معروفة');
    next.status = patch.status;
  }
  if (patch.startDate !== undefined) next.startDate = day(patch.startDate) || cur.startDate;
  if (patch.endDate !== undefined) next.endDate = day(patch.endDate);
  if (patch.plan !== undefined) next.plan = { ...patch.plan };
  if (patch.implants !== undefined) next.implants = patch.implants.map((x) => ({ ...x, id: x.id || crypto.randomUUID() }));
  const c = await repos.cases.update(id, next);
  await syncReminders(c);
  return c;
}

/** Deletes the case, its visits and its pending reminders. */
export async function deleteCase(id) {
  const c = await repos.cases.require(id);
  for (const v of await repos.caseVisits.findBy('caseId', id)) await repos.caseVisits.remove(v.id);
  for (const f of await caseReminders(c)) if (f.status === 'pending') await repos.followUps.remove(f.id);
  await repos.cases.remove(id);
}

/* ---------- Visits ---------- */

/** Newest first. */
export async function listVisits(caseId) {
  const rows = await repos.caseVisits.findBy('caseId', caseId);
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** Creates (no id) or updates a visit. @param {{ id?, date, data }} visit */
export async function saveVisit(caseId, { id, date, data }) {
  if (!ISO.test(date ?? '')) throw new CaseError('اختر تاريخ الزيارة');
  if (id) return repos.caseVisits.update(id, { date, data: { ...data } });
  const c = await repos.cases.require(caseId);
  return repos.caseVisits.create({ caseId, patientId: c.patientId, date, data: { ...data } });
}

export const deleteVisit = (id) => repos.caseVisits.remove(id);

/** Open cases of a patient with their visit count (for the patient header). */
export async function openCasesSummary(patientId) {
  const open = (await listCases(patientId)).filter(isOpen);
  return Promise.all(open.map(async (c) => ({ ...c, visits: (await repos.caseVisits.findBy('caseId', c.id)).length })));
}

/* ---------- Implant reminders ---------- */

/** Suggested dates: sutures 10 days after surgery; prosthesis 3 months (lower) or 5 (upper). */
export function suggestedDates(surgeryDate, upper) {
  if (!ISO.test(surgeryDate ?? '')) return { sutureDate: '', loadingDate: '' };
  return { sutureDate: addDays(surgeryDate, 10), loadingDate: addDays(surgeryDate, upper ? 150 : 90) };
}

const caseReminders = async (c) => (await repos.followUps.findBy('patientId', c.patientId)).filter((f) => f.caseId === c.id);

/** Keeps the case's pending follow-ups in step with its dates (done ones are left alone). */
async function syncReminders(c) {
  if (c.type !== 'implant') return;
  const p = c.plan ?? {};
  const wanted = p.reminders === false || !isOpen(c) ? [] : [
    day(p.sutureDate) && { key: 'sutures', dueDate: p.sutureDate, note: 'فك الخيط بعد الزراعة' },
    day(p.loadingDate) && { key: 'prosthesis', dueDate: p.loadingDate, note: 'موعد تركيب التركيبة على الزرعة' },
  ].filter(Boolean);
  const existing = await caseReminders(c);
  for (const f of existing) {
    if (f.status !== 'pending') continue;
    const w = wanted.find((x) => x.key === f.caseReminder);
    if (!w) await repos.followUps.remove(f.id);
    else if (w.dueDate !== f.dueDate) await repos.followUps.update(f.id, { dueDate: w.dueDate });
  }
  const patient = await repos.patients.get(c.patientId, { includeDeleted: true });
  for (const w of wanted) {
    if (existing.some((f) => f.caseReminder === w.key)) continue;
    await repos.followUps.create({
      patientId: c.patientId, patientName: patient?.name ?? '', treatmentItemId: null, caseId: c.id, caseReminder: w.key,
      procedureName: 'زراعة', type: 'check', note: w.note, dueDate: w.dueDate,
      status: 'pending', doneAt: null, doneBy: null, outcome: '', sentAt: null,
    });
  }
}
