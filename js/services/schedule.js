/**
 * Clinic schedule settings: chairs, working hours per weekday, slot step, default duration,
 * and the WhatsApp reminder template. Stored under settings key 'schedule'.
 */
import { repos } from '../data/index.js';
import { getSettings, updateSettings } from '../data/settings.js';
import { newId } from '../data/repository.js';
import { weekday } from '../core/time.js';

/** Default: Saturday–Thursday 2:00 PM – 10:00 PM, Friday closed, one chair. */
export const DEFAULT_SCHEDULE = {
  chairs: [{ id: 'chair-1', name: 'الكرسي 1', active: true }],
  hours: {
    0: { open: true, from: 14 * 60, to: 22 * 60 },
    1: { open: true, from: 14 * 60, to: 22 * 60 },
    2: { open: true, from: 14 * 60, to: 22 * 60 },
    3: { open: true, from: 14 * 60, to: 22 * 60 },
    4: { open: true, from: 14 * 60, to: 22 * 60 },
    5: { open: false, from: 14 * 60, to: 22 * 60 },
    6: { open: true, from: 14 * 60, to: 22 * 60 },
  },
  slotMin: 15,
  defaultDuration: 30,
  reminderTemplate: 'مرحبًا {الاسم} 👋\nنذكّرك بموعدك في {العيادة} يوم {اليوم} {التاريخ} الساعة {الوقت}.\nللتأجيل أو الاعتذار يرجى الاتصال على {هاتف_العيادة}.\nنتمنى لك يومًا سعيدًا 🌿',
};

/** Current schedule merged over the defaults. */
export function getSchedule() {
  const s = getSettings('schedule') ?? {};
  return {
    ...DEFAULT_SCHEDULE,
    ...s,
    hours: { ...DEFAULT_SCHEDULE.hours, ...(s.hours ?? {}) },
    chairs: s.chairs?.length ? s.chairs : DEFAULT_SCHEDULE.chairs,
  };
}

export const activeChairs = () => getSchedule().chairs.filter((c) => c.active !== false);

export function saveSchedule(patch) {
  return updateSettings('schedule', { ...getSchedule(), ...patch });
}

export async function addChair(name) {
  const s = getSchedule();
  return saveSchedule({ chairs: [...s.chairs, { id: newId(), name: name.trim() || `الكرسي ${s.chairs.length + 1}`, active: true }] });
}

/** Working hours for a date: { open, from, to } in minutes. */
export const hoursFor = (iso) => getSchedule().hours[weekday(iso)];

/** Start times (minutes) bookable on a date, every slotMin within working hours. */
export function slotsFor(iso, { duration = 0 } = {}) {
  const { slotMin } = getSchedule();
  const h = hoursFor(iso);
  if (!h?.open) return [];
  const out = [];
  for (let m = h.from; m + Math.max(duration, slotMin) <= h.to; m += slotMin) out.push(m);
  return out;
}

/** Visible hour range for calendars: earliest open → latest close across the week. */
export function calendarRange() {
  const hours = Object.values(getSchedule().hours).filter((h) => h.open);
  if (!hours.length) return { from: 9 * 60, to: 21 * 60 };
  return { from: Math.min(...hours.map((h) => h.from)), to: Math.max(...hours.map((h) => h.to)) };
}

/** Doctors who can be booked (active users marked "doctor"). */
export async function listDoctors() {
  const users = (await repos.users.list()).filter((u) => u.active);
  return users.filter((u) => u.isDoctor).map(({ id, displayName, color }) => ({ id, displayName, color }));
}
