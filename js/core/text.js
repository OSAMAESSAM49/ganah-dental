/** Arabic text helpers: digit conversion and search normalization. */

const AR_INDIC_ZERO = 0x0660; // ٠
const PERSIAN_ZERO = 0x06F0;  // ۰

/**
 * Converts Arabic-Indic / Persian digits and Arabic separators to their Western forms.
 * Use on every numeric input before parsing.
 * @param {unknown} value @returns {string}
 */
export function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - AR_INDIC_ZERO))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/٫/g, '.')   // Arabic decimal separator ٫
    .replace(/٬/g, ',');  // Arabic thousands separator ٬
}

/** Converts Western digits to Arabic-Indic. @param {unknown} value @returns {string} */
export function toArabicDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, (d) => String.fromCharCode(AR_INDIC_ZERO + Number(d)));
}

/**
 * Normalizes Arabic text for searching: strips diacritics and tatweel, unifies alef/yaa/taa
 * marbuta forms, Western digits, lower-case, single spaces. "أحمد" and "احمد" match.
 * @param {unknown} value @returns {string}
 */
export function normalizeArabic(value) {
  return normalizeDigits(value)
    .toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭ]/g, '') // tashkeel & Quranic marks
    .replace(/ـ/g, '')                            // tatweel ـ
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Initials for avatars: first letter of the first two words. */
export function initials(name) {
  return String(name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join(' ');
}
