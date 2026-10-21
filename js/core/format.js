/**
 * Display formatting for numbers, money (EGP), dates (DD/MM/YYYY) and ages.
 * Storage conventions (see docs/PLAN.md):
 *   - money: integer piasters (1 ج.م = 100 piasters)
 *   - dates: 'YYYY-MM-DD' strings (local calendar day); timestamps: ISO 8601 strings
 * The digit style (Arabic-Indic or Western) is a clinic setting applied at display time only.
 */
import { normalizeDigits, toArabicDigits } from './text.js';

export const CURRENCY = 'ج.م';

/** @type {'western'|'arabic'} */
let digitStyle = 'western';
const nfCache = new Map();

/** @param {'western'|'arabic'} style */
export function setDigitStyle(style) {
  digitStyle = style === 'arabic' ? 'arabic' : 'western';
  nfCache.clear();
}
export const getDigitStyle = () => digitStyle;

/** Applies the current digit style to a string that contains Western digits. */
export function digits(value) {
  const s = String(value ?? '');
  return digitStyle === 'arabic' ? toArabicDigits(s) : s;
}

function nf(minFrac, maxFrac) {
  const key = `${digitStyle}|${minFrac}|${maxFrac}`;
  if (!nfCache.has(key)) {
    nfCache.set(key, new Intl.NumberFormat(digitStyle === 'arabic' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    }));
  }
  return nfCache.get(key);
}

/** @param {number} n @param {{ decimals?: number }} [opts] */
export function formatNumber(n, { decimals = 2 } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return nf(0, decimals).format(Number(n));
}

/**
 * Formats integer piasters as Egyptian pounds: 125050 → "1,250.50 ج.م".
 * Decimals are shown only when there are piasters.
 * @param {number} piasters @param {{ currency?: boolean }} [opts]
 */
export function formatMoney(piasters, { currency = true } = {}) {
  if (piasters == null || Number.isNaN(Number(piasters))) return '—';
  const p = Math.round(Number(piasters));
  const frac = p % 100 === 0 ? 0 : 2;
  const text = nf(frac, frac).format(p / 100);
  return currency ? `${text} ${CURRENCY}` : text;
}

/**
 * Parses user input in pounds ("1,250.5", "١٢٥٠٫٥") into integer piasters.
 * @returns {number} piasters, or NaN when the input is not a valid amount.
 */
export function toPiasters(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : NaN;
  const s = normalizeDigits(input).replace(/[,\s]/g, '').replace(CURRENCY, '').trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** Piasters → plain pounds string for <input> values ("1250.5"). */
export function piastersToInput(piasters) {
  if (piasters == null || Number.isNaN(Number(piasters))) return '';
  return String(Math.round(Number(piasters)) / 100);
}

/** @param {number} value 0..100 */
export function formatPercent(value, { decimals = 1 } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${nf(0, decimals).format(Number(value))}${digitStyle === 'arabic' ? '٪' : '%'}`;
}

/** 1536 → "1.5 ك.ب" (storage usage, file sizes). */
export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '—';
  const units = ['بايت', 'ك.ب', 'م.ب', 'ج.ب'];
  let v = Number(bytes), i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${formatNumber(v, { decimals: i === 0 ? 0 : 1 })} ${units[i]}`;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Converts a Date | 'YYYY-MM-DD' | ISO timestamp | epoch ms to a Date.
 * 'YYYY-MM-DD' is treated as a local calendar day (no UTC shift).
 * @returns {Date|null}
 */
export function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local calendar day as 'YYYY-MM-DD'. */
export function toISODate(value = new Date()) {
  const d = toDate(value);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}
export const todayISO = () => toISODate(new Date());

/** → "21/10/2026" (digit style applied). */
export function formatDate(value) {
  const d = toDate(value);
  return d ? digits(`${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`) : '—';
}

/** → "3:05 م" (12-hour clock with ص/م, as used in Egypt). */
export function formatTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return digits(`${h12}:${pad(d.getMinutes())}`) + (h < 12 ? ' ص' : ' م');
}

export const formatDateTime = (value) => (toDate(value) ? `${formatDate(value)} ${formatTime(value)}` : '—');

/**
 * Parses "DD/MM/YYYY" (also D/M/YYYY, '-' or '.' separators, Arabic digits) → 'YYYY-MM-DD'.
 * @returns {string|null} null when invalid (e.g. 31/02/2026)
 */
export function parseDateInput(input) {
  const m = normalizeDigits(input).trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m.map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return toISODate(d);
}

/**
 * Picks the correct Arabic plural form for a count.
 * @param {number} n
 * @param {{ one: string, two: string, few: string, many: string }} forms
 *   e.g. { one: 'سنة', two: 'سنتان', few: 'سنوات', many: 'سنة' }
 */
export function arabicCount(n, forms) {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${digits(n)} ${forms.few}`;
  return `${digits(n)} ${forms.many}`;
}

/** Exact age in whole years and months on the given day. */
export function ageFromDOB(dob, on = new Date()) {
  const b = toDate(dob), ref = toDate(on);
  if (!b || !ref || b > ref) return null;
  let months = (ref.getFullYear() - b.getFullYear()) * 12 + (ref.getMonth() - b.getMonth());
  if (ref.getDate() < b.getDate()) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** "34 سنة", "سنتان", "8 أشهر" — months shown only for children under 3. */
export function formatAge(dob, on) {
  const age = ageFromDOB(dob, on);
  if (!age) return '—';
  const YEARS = { one: 'سنة', two: 'سنتان', few: 'سنوات', many: 'سنة' };
  const MONTHS = { one: 'شهر', two: 'شهران', few: 'أشهر', many: 'شهرًا' };
  if (age.years === 0) return age.months === 0 ? 'أقل من شهر' : arabicCount(age.months, MONTHS);
  if (age.years < 3 && age.months > 0) return `${arabicCount(age.years, YEARS)} و${arabicCount(age.months, MONTHS)}`;
  return arabicCount(age.years, YEARS);
}
