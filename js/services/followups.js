/**
 * Follow-ups & post-op messages.
 *   - Each procedure links to an instruction template and a follow-up schedule
 *     [{ offsetDays, type: 'call'|'check'|'recall', note }].
 *   - Completing a treatment item creates its follow-ups (done-handler); moving it back
 *     removes the ones still pending.
 *   - Messages are sent by hand through wa.me links (automatic sending needs a backend).
 */
import { repos } from '../data/index.js';
import { getSettings, updateSettings } from '../data/settings.js';
import { currentUser } from '../core/session.js';
import { todayISO, digits } from '../core/format.js';
import { addDays } from '../core/time.js';
import { FOLLOWUP_TYPES } from '../core/labels.js';
import { registerDoneHandler } from './treatment.js';
import { whatsappLink } from './appointments.js';

export class FollowUpError extends Error {
  constructor(message) { super(message); this.name = 'FollowUpError'; }
}

/* ---------- Message templates ---------- */

export const DEFAULT_MESSAGES = {
  instructions: 'مرحبًا {الاسم} 🌿\nهذه تعليمات ما بعد {الإجراء} من {العيادة}:\n\n{التعليمات}\n\nللاستفسار: {هاتف_العيادة}',
  call: 'مرحبًا {الاسم}، نطمئن عليك بعد {الإجراء} في {العيادة}. كيف حالك اليوم؟ إذا كان عندك أي ألم أو استفسار تواصل معنا على {هاتف_العيادة}.',
  check: 'مرحبًا {الاسم}، حان موعد فحص المتابعة بعد {الإجراء}. يسعدنا حجز موعد مناسب لك في {العيادة} — اتصل بنا على {هاتف_العيادة}.',
  recall: 'مرحبًا {الاسم} 😊، مرّ وقت على آخر {الإجراء} في {العيادة}. نذكّرك بموعد الفحص الدوري للحفاظ على صحة أسنانك. للحجز: {هاتف_العيادة}.',
};

export const getMessages = () => ({ ...DEFAULT_MESSAGES, ...(getSettings('messages') ?? {}) });
export const saveMessages = (patch) => updateSettings('messages', { ...getMessages(), ...patch });

/** Fills {placeholders}. Exported for tests. */
export function fillMessage(template, values) {
  return String(template).replace(/\{([^}]+)\}/g, (m, k) => values[k] ?? m);
}

function baseValues(patient, procedureName) {
  const clinic = getSettings('clinic');
  return {
    'الاسم': String(patient?.name ?? '').trim().split(/\s+/)[0] ?? '',
    'الاسم_الكامل': patient?.name ?? '',
    'الإجراء': procedureName ?? 'الزيارة',
    'العيادة': clinic.name,
    'هاتف_العيادة': digits(clinic.phone ?? ''),
  };
}

/* ---------- Instruction templates ---------- */

export async function listTemplates({ includeInactive = false } = {}) {
  return (await repos.instructionTemplates.list()).filter((t) => includeInactive || t.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export async function saveTemplate(id, { name, body }) {
  if (!name?.trim()) throw new FollowUpError('اسم القالب مطلوب');
  if (!body?.trim()) throw new FollowUpError('نص التعليمات مطلوب');
  return id ? repos.instructionTemplates.update(id, { name: name.trim(), body: body.trim() }) : repos.instructionTemplates.create({ name: name.trim(), body: body.trim(), active: true });
}

export const setTemplateActive = (id, active) => repos.instructionTemplates.update(id, { active });

/** The instruction template text for a procedure (or null). */
export async function instructionsForProcedure(procedureId) {
  const proc = procedureId ? await repos.procedures.get(procedureId) : null;
  const tpl = proc?.instructionTemplateId ? await repos.instructionTemplates.get(proc.instructionTemplateId) : null;
  return tpl?.active === false ? null : tpl;
}

/**
 * WhatsApp message with post-op instructions for a treatment item.
 * @returns {Promise<{ text: string, link: string|null, template: object, patient: object } | null>}
 */
export async function instructionsMessage(treatmentItem) {
  const tpl = await instructionsForProcedure(treatmentItem.procedureId);
  if (!tpl) return null;
  const patient = await repos.patients.get(treatmentItem.patientId, { includeDeleted: true });
  const text = fillMessage(getMessages().instructions, { ...baseValues(patient, treatmentItem.procedureName), 'التعليمات': tpl.body });
  return { text, link: whatsappLink(patient?.phone, text), template: tpl, patient };
}

/** WhatsApp message for a follow-up (call / check / recall). */
export async function followUpMessage(fu) {
  const patient = await repos.patients.get(fu.patientId, { includeDeleted: true });
  const msgs = getMessages();
  let instructions = '';
  if (fu.type === 'call' && fu.treatmentItemId) {
    const item = await repos.treatmentItems.get(fu.treatmentItemId);
    instructions = item ? (await instructionsForProcedure(item.procedureId))?.body ?? '' : '';
  }
  const text = fillMessage(msgs[fu.type] ?? msgs.call, { ...baseValues(patient, fu.procedureName), 'التعليمات': instructions });
  return { text, link: whatsappLink(patient?.phone, text), patient };
}

/* ---------- Follow-ups ---------- */

/** Builds follow-ups for a completed item from a schedule. Pure — exported for tests. */
export function buildFollowUps(item, schedule, doneDay, patientName = '') {
  return (schedule ?? []).filter((s) => FOLLOWUP_TYPES[s.type] && s.offsetDays >= 0).map((s) => ({
    patientId: item.patientId,
    patientName,
    treatmentItemId: item.id,
    procedureName: item.procedureName,
    type: s.type,
    note: s.note ?? '',
    dueDate: addDays(doneDay, Math.round(s.offsetDays)),
    status: 'pending',
    doneAt: null,
    doneBy: null,
    outcome: '',
    sentAt: null,
  }));
}

export async function scheduleForItem(item) {
  const proc = item.procedureId ? await repos.procedures.get(item.procedureId) : null;
  if (!proc?.followUpSchedule?.length) return [];
  const patient = await repos.patients.get(item.patientId, { includeDeleted: true });
  const created = [];
  for (const f of buildFollowUps(item, proc.followUpSchedule, todayISO(), patient?.name)) created.push(await repos.followUps.create(f));
  return created;
}

/** Removes pending follow-ups of an item (when it is moved back from "done"). */
export async function cancelForItem(itemId) {
  for (const f of await repos.followUps.findBy('treatmentItemId', itemId)) {
    if (f.status === 'pending') await repos.followUps.remove(f.id);
  }
}

registerDoneHandler({
  key: 'followups',
  async describe(item) {
    const proc = item.procedureId ? await repos.procedures.get(item.procedureId) : null;
    return proc?.followUpSchedule?.length ? `جدولة المتابعة: ${describeSchedule(proc.followUpSchedule)}` : null;
  },
  onDone: (item) => scheduleForItem(item),
  onUndone: (item) => cancelForItem(item.id),
});

/** Human text of a procedure's schedule: "اتصال بعد يوم، فحص بعد 7 أيام". */
export function describeSchedule(schedule = []) {
  const when = (d) => (d === 0 ? 'اليوم' : d === 1 ? 'بعد يوم' : d === 2 ? 'بعد يومين' : d % 30 === 0 && d >= 30 ? `بعد ${digits(d / 30)} ${d / 30 <= 10 ? (d / 30 === 1 ? 'شهر' : 'أشهر') : 'شهرًا'}` : `بعد ${digits(d)} ${d <= 10 ? 'أيام' : 'يومًا'}`);
  return schedule.map((s) => `${FOLLOWUP_TYPES[s.type]?.short ?? s.type} ${when(s.offsetDays)}`).join('، ');
}

/** @param {{ patientId, patientName?, type, dueDate, note?, procedureName? }} input */
export async function createFollowUp(input) {
  if (!input.patientId) throw new FollowUpError('اختر المريض');
  if (!FOLLOWUP_TYPES[input.type]) throw new FollowUpError('اختر نوع المتابعة');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate ?? '')) throw new FollowUpError('اختر التاريخ');
  return repos.followUps.create({
    patientId: input.patientId, patientName: input.patientName ?? '', treatmentItemId: null,
    procedureName: input.procedureName ?? '', type: input.type, note: String(input.note ?? '').trim(),
    dueDate: input.dueDate, status: 'pending', doneAt: null, doneBy: null, outcome: '', sentAt: null,
  });
}

export async function completeFollowUp(id, outcome = '') {
  return repos.followUps.update(id, { status: 'done', doneAt: new Date().toISOString(), doneBy: currentUser()?.displayName ?? null, outcome: String(outcome).trim() });
}
export const reopenFollowUp = (id) => repos.followUps.update(id, { status: 'pending', doneAt: null, doneBy: null });
export const skipFollowUp = (id) => repos.followUps.update(id, { status: 'skipped', doneAt: new Date().toISOString(), doneBy: currentUser()?.displayName ?? null });
export const snoozeFollowUp = async (id, days) => { const f = await repos.followUps.require(id); return repos.followUps.update(id, { dueDate: addDays(f.dueDate < todayISO() ? todayISO() : f.dueDate, days) }); };
export const markFollowUpSent = (id) => repos.followUps.update(id, { sentAt: new Date().toISOString() });

export async function listFollowUps() {
  return (await repos.followUps.list()).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
export const followUpsForPatient = async (patientId) => (await repos.followUps.findBy('patientId', patientId)).sort((a, b) => b.dueDate.localeCompare(a.dueDate));

/** Counts for badges: due today and overdue (pending). */
export async function followUpCounts(today = todayISO()) {
  const pending = (await repos.followUps.list({ index: 'dueDate', range: { lte: today } })).filter((f) => f.status === 'pending');
  return { today: pending.filter((f) => f.dueDate === today).length, overdue: pending.filter((f) => f.dueDate < today).length };
}
