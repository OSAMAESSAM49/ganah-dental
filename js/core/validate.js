/**
 * Input validation. Validators return an Arabic error message, or '' when valid,
 * so they plug directly into showFieldErrors().
 */
import { normalizeDigits } from './text.js';

/**
 * Normalizes an Egyptian phone number to its local form ("01012345678", "0502345678").
 * Accepts spaces, dashes, Arabic digits and +20 / 0020 / 20 prefixes.
 * @returns {string} digits only (may still be invalid — check with isEgyptPhone)
 */
export function normalizeEgyptPhone(input) {
  let d = normalizeDigits(input).replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length >= 11) d = d.slice(2);
  if (d && !d.startsWith('0')) d = '0' + d;
  return d;
}

/** Mobile: 010 / 011 / 012 / 015 + 8 digits. */
export const isEgyptMobile = (input) => /^01[0125]\d{8}$/.test(normalizeEgyptPhone(input));

/** Landline: 02/03 (Cairo/Alex) or 0XX governorate code, 9–10 digits total. */
export function isEgyptLandline(input) {
  const d = normalizeEgyptPhone(input);
  return /^0[2-9]\d{7,8}$/.test(d);
}

export const isEgyptPhone = (input) => isEgyptMobile(input) || isEgyptLandline(input);

/** International number for wa.me links ("201012345678"), or null if not a mobile. */
export function toWhatsAppNumber(input) {
  const d = normalizeEgyptPhone(input);
  return /^01[0125]\d{8}$/.test(d) ? '2' + d : null;
}

/* ---------- Field validators ---------- */

export const required = (value, label = 'هذا الحقل') =>
  (value == null || String(value).trim() === '' ? `${label} مطلوب` : '');

export function phone(value, { required: req = false, mobileOnly = false } = {}) {
  if (!String(value ?? '').trim()) return req ? 'رقم الهاتف مطلوب' : '';
  if (mobileOnly) return isEgyptMobile(value) ? '' : 'رقم موبايل غير صحيح (مثال: 01012345678)';
  return isEgyptPhone(value) ? '' : 'رقم هاتف غير صحيح (مثال: 01012345678)';
}

export const minLength = (value, n, label = 'القيمة') =>
  (String(value ?? '').length < n ? `${label} يجب أن تكون ${n} أحرف على الأقل` : '');

/**
 * Runs a map of validators against data and returns only failing fields.
 * @param {Record<string, unknown>} data
 * @param {Record<string, (v: unknown, data: Record<string, unknown>) => string>} schema
 * @returns {Record<string, string>}
 */
export function validate(data, schema) {
  const errors = {};
  for (const [name, check] of Object.entries(schema)) {
    const msg = check(data[name], data);
    if (msg) errors[name] = msg;
  }
  return errors;
}
