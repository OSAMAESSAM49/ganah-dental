/**
 * Calendar & clock helpers. Appointments store a local calendar day ('YYYY-MM-DD') plus
 * minutes from midnight, so there are no time-zone surprises.
 * The week starts on Saturday (Egypt).
 */
import { digits, toDate, toISODate } from './format.js';

export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
/** Display order Saturday → Friday as JS weekday numbers. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const pad = (n) => String(n).padStart(2, '0');

/** 990 → "16:30" (24h, Western digits — for storage/inputs). */
export const toHM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** "16:30" → 990; null when invalid. */
export function parseHM(text) {
  const m = String(text ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h <= 23 && mm <= 59 ? h * 60 + mm : null;
}

/** 990 → "4:30 م" (12-hour, digit style applied). */
export function formatClock(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${digits(`${h12}:${pad(m)}`)} ${h < 12 ? 'ص' : 'م'}`;
}

/** "4:30 – 5:15 م" style range. */
export function formatRange(start, duration) {
  return `${formatClock(start)} – ${formatClock(start + duration)}`;
}

/** Minutes since midnight now. */
export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole days from a to b (b − a); negative when b is earlier. */
export const daysBetween = (a, b) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);

export const weekday = (iso) => toDate(iso).getDay();
export const weekdayName = (iso) => WEEKDAYS[weekday(iso)];

/** Saturday on or before the date. */
export function startOfWeek(iso) {
  const wd = weekday(iso);
  return addDays(iso, -((wd + 1) % 7));
}

/** The 7 days (Sat → Fri) of the week containing iso. */
export const weekDays = (iso) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(iso), i));

/** 6×7 grid of days covering the month of iso (starts on Saturday). */
export function monthGrid(iso) {
  const d = toDate(iso);
  const first = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const sameMonth = (a, b) => a.slice(0, 7) === b.slice(0, 7);
export const monthLabel = (iso) => { const d = toDate(iso); return `${MONTHS[d.getMonth()]} ${digits(d.getFullYear())}`; };

/** "الخميس 22 أكتوبر" */
export function dayLabel(iso, { year = false } = {}) {
  const d = toDate(iso);
  return `${WEEKDAYS[d.getDay()]} ${digits(d.getDate())} ${MONTHS[d.getMonth()]}${year ? ` ${digits(d.getFullYear())}` : ''}`;
}

/** Do [aStart, aStart+aDur) and [bStart, bStart+bDur) overlap? */
export const overlaps = (aStart, aDur, bStart, bDur) => aStart < bStart + bDur && bStart < aStart + aDur;
