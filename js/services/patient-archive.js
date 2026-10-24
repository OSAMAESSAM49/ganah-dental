/**
 * Full patient archive (Admin only): every patient with everything recorded about them —
 * profile and medical history, appointments, treatment items, invoices, payments,
 * prescriptions, follow-ups and lab cases — for an Excel workbook or a PDF kept "just in case".
 * Read-only: nothing is changed; the export itself is written to the audit log.
 */
import { repos } from '../data/index.js';
import { isAdmin } from '../core/permissions.js';
import { toISODate } from '../core/format.js';
import { MEDICAL_ITEMS } from '../core/medical.js';
import { invoiceState, invoiceTotals } from './billing.js';
import { itemMath } from './treatment.js';
import { getSchedule } from './schedule.js';
import { logEvent } from './audit.js';
import { ageYears } from './patients.js';

export class ArchiveError extends Error {
  constructor(message) { super(message); this.name = 'ArchiveError'; }
}

const day = (iso) => (iso ? toISODate(new Date(iso)) : '');

/** Medical history as plain text: "حساسية من البنسلين، سكري". Exported for tests. */
export function medicalText(patient) {
  const m = patient.medical ?? {};
  return MEDICAL_ITEMS.filter((it) => m.items?.[it.key] && !(it.female && patient.gender === 'male')).map((it) => it.label).join('، ');
}

/**
 * Collects the archive. Rows of every table carry fileNo + patientName so each sheet reads
 * on its own and can be filtered by patient.
 * @param {{ includeDeleted?: boolean }} [o] include patients moved to the trash
 */
export async function collectArchive({ includeDeleted = false } = {}) {
  if (!isAdmin()) throw new ArchiveError('تصدير بيانات كل المرضى متاح لمدير النظام فقط');
  const [patients, appts, plans, items, invoices, payments, rx, followUps, labs, users, media] = await Promise.all([
    repos.patients.list({ includeDeleted }), repos.appointments.list({ includeDeleted: true }), repos.treatmentPlans.list(),
    repos.treatmentItems.list(), repos.invoices.list(), repos.payments.list(), repos.prescriptions.list(),
    repos.followUps.list(), repos.labCases.list(), repos.users.list({ includeDeleted: true }), repos.media.list(),
  ]);
  const byId = new Map(patients.map((p) => [p.id, p]));
  const userName = new Map(users.map((u) => [u.id, u.displayName]));
  const chairName = new Map(getSchedule().chairs.map((c) => [c.id, c.name]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const own = (r) => byId.has(r.patientId);
  const tag = (r) => ({ ...r, fileNo: byId.get(r.patientId).fileNo, patientName: byId.get(r.patientId).name });
  const sortBy = (k) => (a, b) => (a.fileNo ?? '').localeCompare(b.fileNo ?? '') || String(a[k] ?? '').localeCompare(String(b[k] ?? ''));

  const paymentsByInvoice = new Map();
  for (const p of payments) if (p.invoiceId) paymentsByInvoice.set(p.invoiceId, [...(paymentsByInvoice.get(p.invoiceId) ?? []), p]);

  const out = {
    appointments: appts.filter((a) => own(a) && !a.deletedAt).map((a) => ({
      ...tag(a), doctor: userName.get(a.doctorId) ?? '', chair: chairName.get(a.chairId) ?? '',
    })).sort(sortBy('date')),
    treatments: items.filter(own).map((i) => {
      const m = itemMath(i);
      const plan = planById.get(i.planId);
      return {
        ...tag(i), planName: plan?.name ?? '', planStatus: plan?.status ?? '', gross: m.gross, discount: m.discount, total: m.total,
        doneDay: day(i.doneAt), doctor: (i.doctorId && userName.get(i.doctorId)) || [...(i.statusHistory ?? [])].reverse().find((h) => h.status === 'done')?.by || '',
        invoiceNo: i.invoiceId ? invById.get(i.invoiceId)?.number ?? '' : '',
      };
    }).sort(sortBy('createdAt')),
    invoices: invoices.filter(own).map((inv) => ({ ...tag(inv), ...invoiceState(inv, paymentsByInvoice.get(inv.id) ?? []), lines: inv.lines ?? [] })).sort(sortBy('date')),
    payments: payments.filter(own).map((p) => ({ ...tag(p), invoiceNo: p.invoiceId ? invById.get(p.invoiceId)?.number ?? '' : '' })).sort(sortBy('date')),
    prescriptions: rx.filter((r) => own(r) && !r.deletedAt).map(tag).sort(sortBy('date')),
    followUps: followUps.filter(own).map(tag).sort(sortBy('dueDate')),
    labCases: labs.filter((c) => own(c) && !c.deletedAt).map(tag).sort(sortBy('sentAt')),
  };

  // One summary row per patient (with totals) for the first sheet and the PDF headers.
  const count = (list) => { const m = new Map(); for (const r of list) m.set(r.patientId, (m.get(r.patientId) ?? 0) + 1); return m; };
  const apptCount = count(out.appointments), photoCount = count(media);
  const billed = new Map(), paid = new Map(), lastVisit = new Map();
  for (const inv of out.invoices) if (inv.status !== 'void') billed.set(inv.patientId, (billed.get(inv.patientId) ?? 0) + invoiceTotals(inv).total);
  for (const p of out.payments) if (!p.voided) paid.set(p.patientId, (paid.get(p.patientId) ?? 0) + p.amount);
  for (const a of out.appointments) if (a.status === 'done' && a.date > (lastVisit.get(a.patientId) ?? '')) lastVisit.set(a.patientId, a.date);

  out.patients = patients.map((p) => ({
    ...p,
    age: ageYears(p),
    medicalText: medicalText(p),
    registered: day(p.createdAt),
    appointmentsCount: apptCount.get(p.id) ?? 0,
    photosCount: photoCount.get(p.id) ?? 0,
    lastVisit: lastVisit.get(p.id) ?? '',
    billed: billed.get(p.id) ?? 0,
    paid: paid.get(p.id) ?? 0,
    balance: (billed.get(p.id) ?? 0) - (paid.get(p.id) ?? 0),
  })).sort((a, b) => (a.fileNo ?? '').localeCompare(b.fileNo ?? ''));
  out.generatedAt = new Date().toISOString();
  return out;
}

/** Records who exported the archive and in what form. */
export const logArchiveExport = (format, patients) => logEvent({ action: 'patients_export', entity: 'patients', summary: `تصدير بيانات ${patients} مريض كاملة (${format})` });
