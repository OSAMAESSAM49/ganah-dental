/**
 * Prescriptions: medicines list, prescription templates, and prescriptions (numbered Rx-0001).
 * Drug names are kept in English; directions are Arabic. Each medicine carries risk `groups`
 * that are checked against the patient's medical history before saving/printing.
 */
import { repos, nextCounter } from '../data/index.js';
import { currentUser } from '../core/session.js';
import { todayISO } from '../core/format.js';
import { MED_FORMS } from '../core/labels.js';

export class RxError extends Error {
  constructor(message) { super(message); this.name = 'RxError'; }
}

export const formatRxNo = (n) => `Rx-${String(n).padStart(4, '0')}`;

/** "د. أحمد" — a doctor's name as printed on the prescription. */
export function doctorLabel(u) {
  if (!u) return '';
  const name = String(u.displayName ?? '').trim(), title = String(u.title ?? '').trim();
  return title && !name.startsWith(title) ? `${title} ${name}` : name;
}

/* ---------- Medicines ---------- */

const byName = (a, b) => a.name.localeCompare(b.name, 'en');

export async function listMedicines({ includeInactive = false } = {}) {
  return (await repos.medicines.list()).filter((m) => includeInactive || m.active !== false).sort(byName);
}

const GROUPS = ['penicillin', 'nsaid', 'pregnancy'];

/** @param {{ name, form, category, dose, duration, notes?, groups? }} input */
export async function saveMedicine(id, input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new RxError('اسم الدواء مطلوب');
  if (!MED_FORMS[input.form]) throw new RxError('اختر الشكل الدوائي');
  const dupe = (await repos.medicines.list()).find((m) => m.id !== id && m.name.toLowerCase() === name.toLowerCase());
  if (dupe) throw new RxError('يوجد دواء بنفس الاسم');
  const clean = {
    name, form: input.form, category: input.category || 'other',
    dose: String(input.dose ?? '').trim(), duration: String(input.duration ?? '').trim(),
    notes: String(input.notes ?? '').trim(), groups: (input.groups ?? []).filter((g) => GROUPS.includes(g)),
  };
  return id ? repos.medicines.update(id, clean) : repos.medicines.create({ ...clean, active: true });
}

export const setMedicineActive = (id, active) => repos.medicines.update(id, { active });

/* ---------- Templates ---------- */

export async function listRxTemplates({ includeInactive = false } = {}) {
  return (await repos.rxTemplates.list()).filter((t) => includeInactive || t.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

const cleanLine = (l) => ({
  medicineId: l.medicineId ?? null,
  name: String(l.name ?? '').trim(),
  form: l.form ?? '',
  dose: String(l.dose ?? '').trim(),
  duration: String(l.duration ?? '').trim(),
  notes: String(l.notes ?? '').trim(),
});

export async function saveRxTemplate(id, { name, lines }) {
  if (!name?.trim()) throw new RxError('اسم القالب مطلوب');
  const clean = (lines ?? []).map(cleanLine).filter((l) => l.name);
  if (!clean.length) throw new RxError('أضف دواءً واحدًا على الأقل');
  return id ? repos.rxTemplates.update(id, { name: name.trim(), lines: clean }) : repos.rxTemplates.create({ name: name.trim(), lines: clean, active: true });
}

export const setRxTemplateActive = (id, active) => repos.rxTemplates.update(id, { active });

/** A prescription line from a medicine record. */
export const lineFromMedicine = (m) => cleanLine({ medicineId: m.id, name: m.name, form: m.form, dose: m.dose, duration: m.duration, notes: m.notes });

/* ---------- Safety ---------- */

/**
 * Safety net for medicines typed by hand (not picked from the list): common generic and
 * Egyptian brand names that belong to a risk group.
 */
const NAME_GROUPS = {
  penicillin: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'flucloxacillin', 'clavulan', 'augmentin', 'amoxil', 'hibiotic', 'megamox', 'e-mox', 'emox', 'curam', 'flumox', 'unasyn', 'ampiclox'],
  nsaid: ['ibuprofen', 'brufen', 'diclofenac', 'cataflam', 'voltaren', 'olfen', 'rheumafen', 'ketoprofen', 'profenid', 'ketorolac', 'ketolac', 'naproxen', 'celecoxib', 'celebrex', 'mefenamic', 'ponstan', 'aspirin', 'aspocid', 'meloxicam', 'mobic', 'piroxicam', 'feldene', 'etoricoxib', 'arcoxia', 'nimesulide', 'sulide'],
};

/** Risk groups of a prescription line: from the medicine list, else guessed from its name. */
function lineGroups(line, medicines) {
  const known = medicines.get(line.medicineId)?.groups;
  if (known?.length) return known;
  const name = String(line.name ?? '').toLowerCase();
  const first = name.split(/[\s(]+/)[0];
  const same = first.length > 3 ? [...medicines.values()].find((m) => m.groups?.length && String(m.name).toLowerCase().split(/[\s(]+/)[0] === first) : null;
  const groups = new Set(same?.groups ?? []);
  for (const [group, words] of Object.entries(NAME_GROUPS)) if (words.some((w) => name.includes(w))) groups.add(group);
  return [...groups];
}

/**
 * Warnings for the chosen medicines against the patient's medical history.
 * Pure — `medicines` is a Map id → medicine (for groups); exported for tests.
 * @returns {Array<{ level: 'critical'|'caution', text: string, line: string }>}
 */
export function rxWarnings(patient, lines, medicines) {
  const has = (k) => !!patient?.medical?.items?.[k] && !(patient.gender === 'male' && (k === 'pregnancy' || k === 'breastfeeding'));
  const otherAllergy = String(patient?.medical?.allergyOther ?? '').trim().toLowerCase();
  const out = [];
  for (const l of lines) {
    const groups = lineGroups(l, medicines);
    const add = (level, text) => out.push({ level, text, line: l.name });
    if (groups.includes('penicillin') && has('allergyPenicillin')) add('critical', 'المريض لديه حساسية من البنسلين');
    if (groups.includes('nsaid')) {
      if (has('allergyNsaids')) add('critical', 'المريض لديه حساسية من المسكنات (NSAIDs)');
      if (has('anticoagulants')) add('critical', 'يتناول أدوية سيولة — المسكنات المضادة للالتهاب تزيد خطر النزيف');
      if (has('bleedingDisorder')) add('critical', 'اضطراب في تجلط الدم');
      if (has('kidneyDisease')) add('caution', 'أمراض الكلى — راجع الجرعة أو استخدم بديلًا');
      if (has('pregnancy')) add('critical', 'حمل — تجنّب المسكنات المضادة للالتهاب');
    }
    if (groups.includes('pregnancy') && has('pregnancy')) add('critical', 'حمل — راجع أمان الدواء');
    if (groups.includes('pregnancy') && has('breastfeeding')) add('caution', 'رضاعة طبيعية — راجع أمان الدواء');
    // Free-text "other allergy": match the first word of the drug name (e.g. "Ibuprofen").
    const first = l.name.split(/[\s(]+/)[0].toLowerCase();
    if (otherAllergy && first.length > 3 && otherAllergy.includes(first)) add('critical', `مسجّل حساسية: ${patient.medical.allergyOther}`);
  }
  return out;
}

/* ---------- Prescriptions ---------- */

/**
 * @param {{ patientId, date?, lines, notes?, doctorName?, treatmentItemId? }} input
 */
export async function createPrescription(input) {
  const patient = await repos.patients.require(input.patientId);
  const lines = (input.lines ?? []).map(cleanLine).filter((l) => l.name);
  if (!lines.length) throw new RxError('أضف دواءً واحدًا على الأقل');
  const user = currentUser();
  const number = await nextCounter('rxNo');
  return repos.prescriptions.create({
    number, patientId: patient.id, patientName: patient.name,
    date: input.date || todayISO(), lines, notes: String(input.notes ?? '').trim(),
    doctorName: String(input.doctorName ?? (user?.isDoctor ? doctorLabel(user) : '')).trim(),
    treatmentItemId: input.treatmentItemId ?? null,
  });
}

export async function updatePrescription(id, input) {
  const lines = (input.lines ?? []).map(cleanLine).filter((l) => l.name);
  if (!lines.length) throw new RxError('أضف دواءً واحدًا على الأقل');
  return repos.prescriptions.update(id, { lines, notes: String(input.notes ?? '').trim(), doctorName: String(input.doctorName ?? '').trim(), date: input.date });
}

export const deletePrescription = (id) => repos.prescriptions.remove(id);

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.number - a.number;
export const prescriptionsForPatient = async (patientId) => (await repos.prescriptions.findBy('patientId', patientId)).sort(newestFirst);
export const listPrescriptions = async () => (await repos.prescriptions.list()).sort(newestFirst);
