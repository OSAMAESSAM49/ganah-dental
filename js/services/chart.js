/**
 * Dental chart storage: append-only tooth events (see core/chart-conditions.js).
 * Mistakes are undone by voiding an event, never by deleting it, so history stays honest.
 */
import { getAdapter, repos, } from '../data/index.js';
import { newId } from '../data/repository.js';
import { currentUser } from '../core/session.js';
import { emit } from '../core/bus.js';
import { foldChart } from '../core/chart-conditions.js';
import { toISODate } from '../core/format.js';

export const listToothEvents = (patientId) => repos.toothEvents.findBy('patientId', patientId);

/** Chart state now, or as it was at the end of `untilDay` ('YYYY-MM-DD'). */
export async function getChart(patientId, untilDay) {
  const events = await listToothEvents(patientId);
  const until = untilDay ? new Date(`${untilDay}T23:59:59.999`).toISOString() : undefined;
  return { events, state: foldChart(events, until) };
}

/** Days that have chart changes, newest first ('YYYY-MM-DD'). */
export const historyDays = (events) =>
  [...new Set(events.filter((e) => !e.voided).map((e) => toISODate(e.at)))].sort().reverse();

/**
 * Records several tooth changes at once (one transaction).
 * @param {string} patientId
 * @param {Array<{ tooth: number, type: 'add'|'remove'|'clear', condition?: string, surfaces?: string[] }>} changes
 * @param {{ source?: 'manual'|'treatment', treatmentItemId?: string|null, note?: string, at?: string }} [meta]
 */
export async function recordToothEvents(patientId, changes, meta = {}) {
  if (!changes.length) return [];
  const me = currentUser();
  const t = new Date().toISOString();
  const records = changes.map((c) => ({
    id: newId(),
    patientId,
    tooth: c.tooth,
    type: c.type,
    condition: c.condition ?? null,
    surfaces: c.surfaces ?? [],
    at: meta.at ?? t,
    source: meta.source ?? 'manual',
    treatmentItemId: meta.treatmentItemId ?? null,
    note: meta.note ?? '',
    voided: false,
    userName: me?.displayName ?? null,
    createdAt: t, updatedAt: t, createdBy: me?.id ?? null, updatedBy: me?.id ?? null,
  }));
  await getAdapter().transaction(['toothEvents'], 'readwrite', async (tx) => {
    for (const r of records) await tx.put('toothEvents', r);
  });
  emit('data:changed', { store: 'toothEvents', action: 'create', id: patientId });
  return records;
}

/** Undoes one event (kept in history, marked void). */
export async function voidToothEvent(id) {
  const me = currentUser();
  const e = await repos.toothEvents.update(id, { voided: true, voidedAt: new Date().toISOString(), voidedBy: me?.displayName ?? null });
  emit('data:changed', { store: 'toothEvents', action: 'update', id: e.patientId });
  return e;
}

/** Voids every event a treatment item created (when it is moved back from "done"). */
export async function voidEventsForItem(patientId, itemId) {
  const events = (await listToothEvents(patientId)).filter((e) => e.treatmentItemId === itemId && !e.voided);
  for (const e of events) await repos.toothEvents.update(e.id, { voided: true, voidedAt: new Date().toISOString() });
  if (events.length) emit('data:changed', { store: 'toothEvents', action: 'update', id: patientId });
  return events.length;
}
