/**
 * Arabic / English. The app is written in Arabic; English comes from a dictionary
 * (js/i18n/en.js: Arabic text → English) applied where screens are built:
 *   - the fixed text of every html`` template (cached per template, so it costs nothing after
 *     the first time), including attributes like placeholder / title / aria-label;
 *   - plain strings shown on screen (labels, toast messages, titles) — whole runs of Arabic
 *     text are looked up, so a patient's name or a note is left exactly as typed.
 * A "run" is a stretch of Arabic text between markup, digits and values: the same rule is used
 * by tools/extract-i18n.mjs to list what needs translating, so keys always match.
 *
 * Prints and WhatsApp texts stay Arabic: build them inside inArabic(() => …).
 */
import { getPref, setPref } from './prefs.js';

export const LANGS = { ar: { label: 'العربية', short: 'ع', dir: 'rtl' }, en: { label: 'English', short: 'EN', dir: 'ltr' } };

let current = getPref('lang', 'ar') === 'en' ? 'en' : 'ar';
let forcedArabic = 0;
/** @type {Map<string, string>} */
let dict = new Map();
/** Extra entries from the clinic's own data (English names of procedures, categories…). */
const extra = new Map();
const missing = new Set();

/** Current language ('ar' inside inArabic). */
export const lang = () => (forcedArabic ? 'ar' : current);
export const isEnglish = () => lang() === 'en';

/** Applies lang/dir to the page (call before the first render). */
export function applyLanguage() {
  document.documentElement.lang = current;
  document.documentElement.dir = LANGS[current].dir;
  if (current === 'en') { const splash = document.querySelector('#boot span'); if (splash) splash.textContent = 'Loading…'; }
}

/** Loads the English dictionary when needed. */
export async function loadLanguage() {
  applyLanguage();
  if (current !== 'en') return;
  const { default: en } = await import('../i18n/en.js');
  dict = new Map(Object.entries(en).filter(([, v]) => v));
}

/** Remembers the language on this device; the caller reloads the app to apply it. */
export function rememberLanguage(l) { setPref('lang', l === 'en' ? 'en' : 'ar'); }

/** Data translations (e.g. procedure → its English name), refreshed by their owners. */
export function setDataTranslations(group, entries) {
  for (const k of [...extra.keys()]) if (k.startsWith(`${group}\u0000`)) extra.delete(k);
  for (const [ar, en] of entries) if (ar && en) extra.set(`${group}\u0000${normalizeKey(ar)}`, en);
  dataLookup = null;
}
let dataLookup = null;
function fromData(key) {
  if (!extra.size) return undefined;
  dataLookup ??= new Map([...extra].map(([k, v]) => [k.split('\u0000')[1], v]));
  return dataLookup.get(key);
}

/** Runs `fn` with Arabic forced (prints, WhatsApp texts). Synchronous work only. */
export function inArabic(fn) {
  forcedArabic++;
  try { return fn(); } finally { forcedArabic--; }
}

/**
 * Same for work that awaits (a print that loads its data first). Screens drawn meanwhile
 * would also come out Arabic, so keep it to short jobs.
 */
export async function inArabicAsync(fn) {
  forcedArabic++;
  try { return await fn(); } finally { forcedArabic--; }
}

/** Untranslated keys seen on screen in English (for finishing the dictionary). */
export const missingKeys = () => [...missing];

/* ---------- Runs ---------- */

const AR_LETTER = /[ء-يٱ-ۓۺ-ۿ]/;
// Things that end a run: markup, quotes, entities, digits, braces (values are {n} tokens).
const STOP = /[<>"'`=&{}0-9٠-٩۰-۹\n\r\t]/;
// Attributes whose values are data, never text (data-label is shown: phone table headings).
const DATA_ATTR = /(?:^|[\s<])(value|name|id|class|for|href|src|type|role|style|autocomplete|inputmode|pattern|min|max|step|form|list|accept|data-(?!label\b)[\w-]+)\s*=\s*"[^"]*$/i;

export const normalizeKey = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Translatable runs in a text where values appear as {0}, {1}…
 * @returns {Array<{ start: number, end: number, key: string }>} key = normalized text
 */
export function findRuns(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    // a run is a stretch without STOP characters, except {n} value tokens inside it
    let start = i, j = i;
    while (j < n) {
      const tok = /^\{\d+\}/.exec(text.slice(j, j + 6));
      if (tok) { j += tok[0].length; continue; }
      if (STOP.test(text[j])) break;
      j++;
    }
    if (j > start) {
      let seg = text.slice(start, j);
      // value tokens at the edges are not part of the sentence
      const lead = /^(?:\s*\{\d+\}\s*)+/.exec(seg)?.[0].length ?? 0;
      const tail = /(?:\s*\{\d+\}\s*)+$/.exec(seg)?.[0].length ?? 0;
      let s = start + lead, e = j - tail;
      seg = text.slice(s, e);
      const m1 = /^[\s .,:;!?()\[\]\-–—…·•|/*+%#×@«»"،؛]+/.exec(seg)?.[0].length ?? 0;
      const m2 = /[\s .,:;!?()\[\]\-–—…·•|/*+%#×@«»"،؛]+$/.exec(seg.slice(m1))?.[0].length ?? 0;
      s += m1; e -= m2;
      if (e > s && AR_LETTER.test(text.slice(s, e)) && !DATA_ATTR.test(text.slice(Math.max(0, s - 200), s))) {
        out.push({ start: s, end: e, key: normalizeKey(text.slice(s, e)) });
      }
    }
    i = j + 1;
  }
  return out;
}

/** Arabic punctuation → English (only on text that is all UI, never on what someone typed). */
const PUNCT = { '،': ',', '؛': ';', '؟': '?', '«': '“', '»': '”' };
const polish = (s) => s.replace(/[،؛؟«»]/g, (c) => PUNCT[c]);
/** A sentence that starts with a translated word starts with a capital. */
function cased(en, before) {
  const prev = before.replace(/\s+$/, '');
  return !prev || /[>.!?:"\n]$/.test(prev) ? en.charAt(0).toUpperCase() + en.slice(1) : en;
}

/** English for a key (with {n} tokens), or undefined. */
function lookup(key) {
  const hit = dict.get(key) ?? fromData(key);
  if (hit === undefined) missing.add(key);
  return hit;
}

/** Translates every run in a text (no values in it). */
export function translateText(text) {
  if (lang() !== 'en' || typeof text !== 'string' || !AR_LETTER.test(text)) return text;
  const runs = findRuns(text);
  if (!runs.length) return text;
  let out = '', at = 0;
  for (const r of runs) {
    const en = lookup(r.key);
    if (en === undefined || /\{\d+\}/.test(en)) continue;
    out += text.slice(at, r.start) + cased(en, text.slice(0, r.start));
    at = r.end;
  }
  out += text.slice(at);
  return AR_LETTER.test(out) ? out : polish(out);
}

/** Short name for code: t('حفظ') → 'Save' in English. */
export const t = (text) => translateText(text);

/**
 * Tagged template for sentences with values: tr`تم تسجيل ${amount}` → 'Recorded 500 EGP'.
 * The dictionary key is the text with {0}, {1}… in place of the values.
 */
export function tr(strings, ...values) {
  const { parts, order } = translateTemplate(strings);
  let out = parts[0];
  // values that are UI words themselves («اليوم») get translated too; names stay as they are
  for (let i = 0; i < order.length; i++) {
    const v = values[order[i]];
    out += (typeof v === 'string' ? translateText(v) : String(v ?? '')) + parts[i + 1];
  }
  return out;
}

/* ---------- Templates ---------- */

const cache = new WeakMap();

/**
 * English version of a template's fixed parts, keeping each value where the translation puts
 * it. @returns {{ parts: string[], order: number[] }}
 */
export function translateTemplate(strings) {
  const identity = { parts: strings, order: strings.slice(1).map((_, i) => i) };
  if (lang() !== 'en') return identity;
  const hit = cache.get(strings);
  if (hit) return hit;
  let full = strings[0];
  for (let i = 1; i < strings.length; i++) full += `{${i - 1}}` + strings[i];
  let result = identity;
  if (AR_LETTER.test(full)) {
    let out = '', at = 0;
    for (const r of findRuns(full)) {
      const en = lookup(r.key);
      if (en === undefined) continue;
      // the translation must keep exactly the values the run had
      const need = (r.key.match(/\{\d+\}/g) ?? []).sort().join();
      const got = (en.match(/\{\d+\}/g) ?? []).sort().join();
      if (need !== got) continue;
      out += full.slice(at, r.start) + cased(en, full.slice(0, r.start));
      at = r.end;
    }
    out = polish(out + full.slice(at)); // a template's own text is all UI
    const parts = [], order = [];
    let last = 0;
    for (const m of out.matchAll(/\{(\d+)\}/g)) {
      parts.push(out.slice(last, m.index));
      order.push(Number(m[1]));
      last = m.index + m[0].length;
    }
    parts.push(out.slice(last));
    if (order.length === strings.length - 1) result = { parts, order };
  }
  cache.set(strings, result);
  return result;
}

/** Is the text right before a value inside a data attribute (value="…", data-x="…")? */
export const inDataAttribute = (before) => DATA_ATTR.test(before.slice(-200));
