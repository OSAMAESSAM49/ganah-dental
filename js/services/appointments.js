/**
 * Appointments: booking, conflict detection, the arrival flow and WhatsApp reminders.
 * Record: { patientId, patientName, date 'YYYY-MM-DD', startMin, duration, doctorId, chairId,
 *           procedureIds[], procedureNames[], treatmentItemIds[], reason, notes, status,
 *           statusHistory[], clinicalNotes, reminderSentAt, cancelReason }
 */
import { repos } from '../data/index.js';
import { currentUser } from '../core/session.js';
import { onEvent } from '../core/bus.js';
import { overlaps, addDays, formatClock, weekdayName, nowMinutes } from '../core/time.js';
import { formatDate, todayISO, digits } from '../core/format.js';
import { toWhatsAppNumber } from '../core/validate.js';
import { getSettings } from '../data/settings.js';
import { getSchedule, hoursFor, slotsFor } from './schedule.js';

export class AppointmentError extends Error {
  constructor(message) { super(message); this.name = 'AppointmentError'; }
}

/** Statuses that occupy the chair/doctor (block other bookings). */
export const BLOCKING = new Set(['booked', 'arrived', 'in_chair', 'done']);

/** Natural next steps of the arrival flow (for buttons). */
export const NEXT_STEPS = {
  booked: ['arrived', 'no_show', 'cancelled'],
  arrived: ['in_chair', 'no_show', 'cancelled'],
  in_chair: ['done'],
  done: [],
  no_show: [],
  cancelled: [],
};
/** Where "undo" goes back to. */
export const PREVIOUS = { arrived: 'booked', in_chair: 'arrived', done: 'in_chair', no_show: 'booked', cancelled: 'booked' };

const byTime = (a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin;

/* ---------- Queries ---------- */

/** Appointments between two days (inclusive), sorted by time. */
export async function listRange(fromDay, toDay) {
  const rows = await repos.appointments.list({ index: 'date', range: { gte: fromDay, lte: toDay } });
  return rows.sort(byTime);
}
export const listDay = (day) => listRange(day, day);
export async function listForPatient(patientId) {
  return (await repos.appointments.findBy('patientId', patientId)).sort(byTime);
}

/** The patient's next upcoming (booked) appointment, if any. */
export async function nextAppointment(patientId) {
  const today = todayISO(), now = nowMinutes();
  return (await listForPatient(patientId)).find((a) => a.status === 'booked' && (a.date > today || (a.date === today && a.startMin + a.duration > now))) ?? null;
}

/* ---------- Conflicts ---------- */

/**
 * Other appointments that clash with a proposed one (same day, overlapping time, and the
 * same chair, doctor or patient). Pure — exported for tests.
 * @returns {{ appt: object, reasons: ('chair'|'doctor'|'patient')[] }[]}
 */
export function findConflicts(candidate, dayAppointments) {
  const out = [];
  for (const a of dayAppointments) {
    if (a.id === candidate.id || a.deletedAt || !BLOCKING.has(a.status) || a.date !== candidate.date) continue;
    if (!overlaps(candidate.startMin, candidate.duration, a.startMin, a.duration)) continue;
    const reasons = [];
    if (candidate.chairId && a.chairId === candidate.chairId) reasons.push('chair');
    if (candidate.doctorId && a.doctorId === candidate.doctorId) reasons.push('doctor');
    if (candidate.patientId && a.patientId === candidate.patientId) reasons.push('patient');
    if (reasons.length) out.push({ appt: a, reasons });
  }
  return out;
}

/** Is the slot inside working hours? */
export function withinHours(candidate) {
  const h = hoursFor(candidate.date);
  return !!h?.open && candidate.startMin >= h.from && candidate.startMin + candidate.duration <= h.to;
}

/**
 * Next free start time on the same day (same chair and doctor), at or after `from`.
 * @returns {number|null}
 */
export function nextFreeSlot(candidate, dayAppointments, from = candidate.startMin) {
  for (const m of slotsFor(candidate.date, { duration: candidate.duration })) {
    if (m < from) continue;
    if (candidate.date === todayISO() && m < nowMinutes()) continue;
    if (!findConflicts({ ...candidate, startMin: m }, dayAppointments).length) return m;
  }
  return null;
}

/* ---------- Writes ---------- */

function historyEntry(status) {
  return { status, at: new Date().toISOString(), by: currentUser()?.displayName ?? null };
}

function clean(input) {
  const duration = Math.round(Number(input.duration) || getSchedule().defaultDuration);
  const startMin = Math.round(Number(input.startMin));
  if (!input.patientId) throw new AppointmentError('اختر المريض');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) throw new AppointmentError('اختر التاريخ');
  if (!Number.isFinite(startMin) || startMin < 0 || startMin >= 24 * 60) throw new AppointmentError('اختر الوقت');
  if (duration < 5 || duration > 8 * 60) throw new AppointmentError('مدة غير صحيحة');
  return {
    patientId: input.patientId,
    patientName: input.patientName ?? '',
    date: input.date,
    startMin,
    duration,
    doctorId: input.doctorId || null,
    chairId: input.chairId || null,
    procedureIds: input.procedureIds ?? [],
    procedureNames: input.procedureNames ?? [],
    treatmentItemIds: input.treatmentItemIds ?? [],
    reason: String(input.reason ?? '').trim(),
    notes: String(input.notes ?? '').trim(),
  };
}

/** @param {object} input @param {{ allowConflicts?: boolean }} [opts] */
export async function createAppointment(input, { allowConflicts = false } = {}) {
  const data = clean(input);
  if (!allowConflicts && findConflicts(data, await listDay(data.date)).length) throw new AppointmentError('يوجد تعارض مع موعد آخر');
  return repos.appointments.create({
    ...data,
    status: 'booked',
    statusHistory: [historyEntry('booked')],
    clinicalNotes: '',
    reminderSentAt: null,
    cancelReason: '',
  });
}

export async function updateAppointment(id, input, { allowConflicts = false } = {}) {
  const current = await repos.appointments.require(id);
  const data = clean({ ...current, ...input });
  if (!allowConflicts && findConflicts({ ...data, id }, await listDay(data.date)).length) throw new AppointmentError('يوجد تعارض مع موعد آخر');
  const moved = data.date !== current.date || data.startMin !== current.startMin;
  return repos.appointments.update(id, { ...data, ...(moved ? { reminderSentAt: null } : {}) });
}

/**
 * Moves through the arrival flow and stamps the time.
 * @param {string} id @param {string} status @param {{ reason?: string }} [opts]
 */
export async function setAppointmentStatus(id, status, { reason } = {}) {
  const a = await repos.appointments.require(id);
  if (a.status === status) return a;
  const patch = { status, statusHistory: [...(a.statusHistory ?? []), historyEntry(status)] };
  const t = new Date().toISOString();
  if (status === 'arrived') patch.arrivedAt = t;
  if (status === 'in_chair') patch.startedAt = t;
  if (status === 'done') patch.finishedAt = t;
  if (status === 'cancelled') patch.cancelReason = String(reason ?? '').trim();
  return repos.appointments.update(id, patch);
}

export const saveClinicalNotes = (id, clinicalNotes) => repos.appointments.update(id, { clinicalNotes: String(clinicalNotes ?? '').trim() });
export const deleteAppointment = (id) => repos.appointments.remove(id);

/* ---------- Reminders ---------- */

/**
 * Fills the reminder template. Placeholders: {الاسم} {العيادة} {اليوم} {التاريخ} {الوقت}
 * {الطبيب} {هاتف_العيادة}. Exported for tests.
 */
export function reminderMessage(appt, { template, clinic, doctorName = '' }) {
  const first = String(appt.patientName ?? '').trim().split(/\s+/)[0] ?? '';
  const values = {
    'الاسم': first,
    'الاسم_الكامل': appt.patientName ?? '',
    'العيادة': clinic.name,
    'اليوم': weekdayName(appt.date),
    'التاريخ': formatDate(appt.date),
    'الوقت': formatClock(appt.startMin),
    'الطبيب': doctorName,
    'هاتف_العيادة': digits(clinic.phone ?? ''),
  };
  return template.replace(/\{([^}]+)\}/g, (m, key) => values[key] ?? m);
}

/** wa.me link with the message pre-filled, or null when the patient has no mobile number. */
export function whatsappLink(phone, message) {
  const n = toWhatsAppNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
}

/** Tomorrow's appointments that still need a reminder (booked only). */
export async function tomorrowsReminders(from = todayISO()) {
  const day = addDays(from, 1);
  return (await listDay(day)).filter((a) => a.status === 'booked');
}

export const markReminded = (id) => repos.appointments.update(id, { reminderSentAt: new Date().toISOString() });

/** Builds message + link for each appointment (needs patients for phone numbers). */
export async function buildReminders(appts) {
  const { reminderTemplate } = getSchedule();
  const clinic = getSettings('clinic');
  const users = Object.fromEntries((await repos.users.list({ includeDeleted: true })).map((u) => [u.id, u.displayName]));
  const out = [];
  for (const a of appts) {
    const patient = await repos.patients.get(a.patientId, { includeDeleted: true });
    const message = reminderMessage({ ...a, patientName: patient?.name ?? a.patientName }, { template: reminderTemplate, clinic, doctorName: users[a.doctorId] ?? '' });
    out.push({ appt: a, patient, message, link: whatsappLink(patient?.phone, message) });
  }
  return out;
}

/* ---------- Cache for dashboard badge ---------- */
let todayCache = null;
onEvent('data:changed', ({ store }) => { if (store === 'appointments') todayCache = null; });
export async function todaysAppointments() {
  const day = todayISO();
  if (todayCache?.day !== day) todayCache = { day, rows: await listDay(day) };
  return todayCache.rows;
}
