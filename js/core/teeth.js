/**
 * FDI tooth notation helpers.
 *   Permanent: quadrants 1–4, teeth 1–8 (11–48).  Primary: quadrants 5–8, teeth 1–5 (51–85).
 *   Quadrant 1/5 = upper right, 2/6 = upper left, 3/7 = lower left, 4/8 = lower right
 *   (the PATIENT's right/left). Charts are drawn facing the patient: the patient's right is
 *   on the viewer's left, regardless of the UI's RTL direction.
 *
 * Surfaces are stored with canonical codes M, D, O, B, L. Display labels adapt per tooth:
 * O → I (incisal) and B → F (facial) on anterior teeth; L → P (palatal) on upper teeth.
 */
import { t as translate } from './i18n.js';

export const SURFACES = /** @type {const} */ (['M', 'O', 'D', 'B', 'L']);

/** Rows as drawn left → right on screen. */
export const ROWS = {
  adultUpper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  adultLower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
  primaryUpper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  primaryLower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
};

export const DENTITIONS = {
  adult: { label: 'دائمة', rows: ['adultUpper', 'adultLower'] },
  primary: { label: 'لبنية', rows: ['primaryUpper', 'primaryLower'] },
  mixed: { label: 'مختلطة', rows: ['adultUpper', 'primaryUpper', 'primaryLower', 'adultLower'] },
};

export const ALL_TEETH = [...ROWS.adultUpper, ...ROWS.adultLower, ...ROWS.primaryUpper, ...ROWS.primaryLower];

export const quadrant = (t) => Math.floor(t / 10);
export const position = (t) => t % 10;
export const isPrimary = (t) => quadrant(t) >= 5;
export const isUpper = (t) => [1, 2, 5, 6].includes(quadrant(t));
/** Incisors and canines. */
export const isAnterior = (t) => position(t) <= 3;
/** On screen, is this tooth left of the midline? (patient's right side) */
export const isScreenLeft = (t) => [1, 4, 5, 8].includes(quadrant(t));

export function isValidTooth(t) {
  const q = quadrant(t), p = position(t);
  if (q >= 1 && q <= 4) return p >= 1 && p <= 8;
  if (q >= 5 && q <= 8) return p >= 1 && p <= 5;
  return false;
}

const PERMANENT_NAMES = ['', 'قاطع أوسط', 'قاطع جانبي', 'ناب', 'ضاحك أول', 'ضاحك ثانٍ', 'ضرس أول', 'ضرس ثانٍ', 'ضرس العقل'];
const PRIMARY_NAMES = ['', 'قاطع أوسط لبني', 'قاطع جانبي لبني', 'ناب لبني', 'ضرس لبني أول', 'ضرس لبني ثانٍ'];
const QUADRANT_NAMES = { 1: 'علوي أيمن', 2: 'علوي أيسر', 3: 'سفلي أيسر', 4: 'سفلي أيمن' };

/** "16 — ضرس أول علوي أيمن" */
export function toothName(t) {
  const base = isPrimary(t) ? PRIMARY_NAMES[position(t)] : PERMANENT_NAMES[position(t)];
  const q = QUADRANT_NAMES[((quadrant(t) - 1) % 4) + 1];
  return `${translate(base)} ${translate(q).toLowerCase()}`; // English: «First molar upper right»
}

const SURFACE_LABELS = {
  M: { code: 'M', ar: 'أنسي' },
  D: { code: 'D', ar: 'وحشي' },
  O: { code: 'O', ar: 'إطباقي' },
  I: { code: 'I', ar: 'قاطع' },
  B: { code: 'B', ar: 'خدّي' },
  F: { code: 'F', ar: 'شفوي' },
  L: { code: 'L', ar: 'لساني' },
  P: { code: 'P', ar: 'حنكي' },
};

/** Display code + Arabic name of a canonical surface on a given tooth. */
export function surfaceLabel(tooth, s) {
  let key = s;
  if (s === 'O' && isAnterior(tooth)) key = 'I';
  if (s === 'B' && isAnterior(tooth)) key = 'F';
  if (s === 'L' && isUpper(tooth)) key = 'P';
  return SURFACE_LABELS[key];
}

/** "MOD" style compact string, in canonical order M O D B L, adapted per tooth. */
export const surfacesText = (tooth, surfaces = []) =>
  SURFACES.filter((s) => surfaces.includes(s)).map((s) => surfaceLabel(tooth, s).code).join('');

/**
 * Parses "16, 17 24-26" style input into a sorted list of valid FDI numbers.
 * Ranges only within a quadrant. Exported for tests.
 */
export function parseTeeth(text) {
  const out = new Set();
  const norm = String(text ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  for (const part of norm.split(/[,،\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d{2})-(\d{2})$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
      if (quadrant(a) !== quadrant(b)) continue;
      for (let t = a; t <= b; t++) if (isValidTooth(t)) out.add(t);
    } else if (/^\d{2}$/.test(part) && isValidTooth(Number(part))) {
      out.add(Number(part));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Display order for a list of teeth (screen order, upper first). */
export function sortTeeth(teeth) {
  const order = [...ROWS.adultUpper, ...ROWS.primaryUpper, ...ROWS.primaryLower, ...ROWS.adultLower];
  return [...teeth].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
