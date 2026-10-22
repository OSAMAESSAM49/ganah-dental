/**
 * Patients: file numbers, search, create/update, medical history, soft delete.
 * Keeps an in-memory list for instant search; invalidated whenever patients change.
 */
import { repos, nextCounter } from '../data/index.js';
import { onEvent } from '../core/bus.js';
import { currentUser } from '../core/session.js';
import { normalizeArabic, normalizeDigits } from '../core/text.js';
import { normalizeEgyptPhone } from '../core/validate.js';
import { toDate, toISODate } from '../core/format.js';
import { emptyMedical } from '../core/medical.js';
import { ownsOrAdmin } from '../core/permissions.js';

export const FILE_PREFIX = 'G-';

/** 7 → "G-00007". Exported for tests. */
export const formatFileNo = (n) => `${FILE_PREFIX}${String(n).padStart(5, '0')}`;

/** Text used for search: name, phones, file number (normalized). Exported for tests. */
export function buildSearchText(p) {
  const fileDigits = String(p.fileNo ?? '').replace(/\D/g, '');
  return normalizeArabic([p.name, p.phone, p.phone2, p.fileNo, fileDigits, String(Number(fileDigits) || '')].filter(Boolean).join(' '));
}

/** Estimated DOB (1 January) from an age in years. */
export function dobFromAge(age, on = new Date()) {
  const years = Number(normalizeDigits(age));
  if (!Number.isFinite(years) || years < 0 || years > 120) return null;
  return toISODate(new Date(on.getFullYear() - Math.floor(years), 0, 1));
}

let cache = null;
onEvent('data:changed', ({ store }) => { if (store === 'patients') cache = null; });

/** All (non-deleted) patients, cached. */
export async function allPatients({ includeDeleted = false } = {}) {
  if (includeDeleted) return repos.patients.list({ includeDeleted: true });
  cache ??= await repos.patients.list();
  return cache;
}

export const getPatient = (id) => repos.patients.get(id, { includeDeleted: true });

/**
 * Ranked search by name, phone or file number. Exact file number / phone matches first,
 * then names that start with the query, then anything containing it.
 * @returns {Promise<object[]>}
 */
export async function searchPatients(query, { limit = 50, list } = {}) {
  const q = normalizeArabic(query);
  const rows = list ?? (await allPatients());
  if (!q) return rows.slice(0, limit);
  const qDigits = q.replace(/\D/g, '');
  const scored = [];
  for (const p of rows) {
    const text = p.searchText ?? buildSearchText(p);
    if (!text.includes(q) && !(qDigits.length >= 3 && text.includes(qDigits))) continue;
    let score = 3;
    const name = normalizeArabic(p.name);
    if (qDigits && (String(Number(String(p.fileNo).replace(/\D/g, ''))) === qDigits || normalizeEgyptPhone(p.phone) === normalizeEgyptPhone(q))) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(' ').some((w) => w.startsWith(q))) score = 2;
    scored.push({ p, score });
  }
  scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name, 'ar'));
  return scored.slice(0, limit).map((s) => s.p);
}

/** Other patients that share a phone number (families often do). */
export async function findByPhone(phone, exceptId) {
  const n = normalizeEgyptPhone(phone);
  if (!n) return [];
  return (await allPatients()).filter((p) => p.id !== exceptId && (p.phone === n || p.phone2 === n));
}

/** Cleans form input into a patient record shape. */
function clean(input) {
  const out = {
    name: String(input.name ?? '').trim().replace(/\s+/g, ' '),
    phone: input.phone ? normalizeEgyptPhone(input.phone) : '',
    phone2: input.phone2 ? normalizeEgyptPhone(input.phone2) : '',
    gender: input.gender === 'female' ? 'female' : input.gender === 'male' ? 'male' : '',
    dob: input.dob || null,
    dobEstimated: !!input.dobEstimated,
    address: String(input.address ?? '').trim(),
    occupation: String(input.occupation ?? '').trim(),
    referralSource: input.referralSource || '',
    referralNote: String(input.referralNote ?? '').trim(),
    notes: String(input.notes ?? '').trim(),
  };
  if ('photo' in input) out.photo = input.photo || null;
  return out;
}

/** @returns {Promise<object>} the new patient */
export async function createPatient(input) {
  const data = clean(input);
  if (!data.name) throw new Error('اسم المريض مطلوب');
  const n = await nextCounter('patientFileNo');
  const fileNo = formatFileNo(n);
  const record = {
    ...data,
    fileNo,
    photo: data.photo ?? null,
    medical: { ...emptyMedical(), ...(input.medical ?? {}) },
    isDemo: !!input.isDemo,
  };
  record.searchText = buildSearchText(record);
  return repos.patients.create(record);
}

export async function updatePatient(id, input) {
  const current = await repos.patients.require(id);
  await assertCanChange(current, 'تعديل');
  const data = clean({ ...current, ...input });
  if (!data.name) throw new Error('اسم المريض مطلوب');
  return repos.patients.update(id, { ...data, searchText: buildSearchText({ ...current, ...data }) });
}

/** Saves the medical history checklist. */
export async function updateMedical(id, medical) {
  const current = await repos.patients.require(id);
  const me = currentUser();
  return repos.patients.update(id, {
    medical: {
      ...emptyMedical(),
      ...current.medical,
      items: Object.fromEntries(Object.entries(medical.items ?? {}).filter(([, v]) => v)),
      allergyOther: String(medical.allergyOther ?? '').trim(),
      medications: String(medical.medications ?? '').trim(),
      notes: String(medical.notes ?? '').trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: me?.displayName ?? null,
    },
  });
}

/** Patients who have invoices: only the Admin or whoever registered them may edit or delete. */
async function assertCanChange(patient, verb) {
  if (ownsOrAdmin(patient)) return;
  const { hasInvoices } = await import('./billing.js');
  if (await hasInvoices(patient.id)) throw new Error(`${verb} بيانات مريض عليه فواتير متاح لمدير النظام أو لمن سجّله فقط`);
}

/** Whether the signed-in user may edit / delete this patient (for hiding buttons). */
export async function canChangePatient(patient) {
  try { await assertCanChange(patient, 'تعديل'); return true; } catch { return false; }
}

export async function deletePatient(id) {
  const current = await repos.patients.require(id);
  await assertCanChange(current, 'حذف');
  return repos.patients.remove(id);
}
export const restorePatient = (id) => repos.patients.restore(id);

/** Number of patients registered in the current month. */
export async function newPatientsThisMonth(on = new Date()) {
  const start = new Date(on.getFullYear(), on.getMonth(), 1).toISOString();
  return (await allPatients()).filter((p) => p.createdAt >= start).length;
}

/** Age in whole years (for filters/sorting). */
export function ageYears(p, on = new Date()) {
  const d = toDate(p.dob);
  if (!d) return null;
  let y = on.getFullYear() - d.getFullYear();
  if (on.getMonth() < d.getMonth() || (on.getMonth() === d.getMonth() && on.getDate() < d.getDate())) y--;
  return y;
}
