/**
 * Lists every piece of Arabic UI text in js/ and keeps js/i18n/en.js in step:
 *   node tools/extract-i18n.mjs            → adds new keys (empty English) and reports counts
 *   node tools/extract-i18n.mjs --check    → exits 1 when keys are missing or untranslated
 *   node tools/extract-i18n.mjs --codemod  → wraps UI sentences that mix text and values
 *                                            (`تم ${x}` → tr`تم ${x}`) so they can be translated
 * Keys are found with the same rule the app uses at run time (core/i18n.js findRuns).
 */
import fs from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRuns } from '../js/core/i18n.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DICT = join(ROOT, 'js', 'i18n', 'en.js');
// Arabic here is data, not screen text: column names, matching rules, letter tables.
const SKIP = ['js/i18n/', 'js/core/i18n.js', 'js/core/text.js', 'js/services/dentolize-import.js', 'js/modules/styleguide/'];
// Folders whose sentences show on screen (the codemod only touches these).
const UI = ['js/modules/', 'js/components/', 'js/core/shell.js', 'js/core/nav.js', 'js/core/labels.js', 'js/app.js'];
const AR = /[ء-ي]/;

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));

/**
 * Minimal JS scanner: string literals and template literals (with nesting), skipping comments
 * and regular expressions. @returns {Array<object>}
 */
function scan(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const prevSignificant = (k) => { while (k >= 0 && /\s/.test(src[k])) k--; return k; };
  const regexAllowed = (k) => {
    const p = prevSignificant(k - 1);
    if (p < 0) return true;
    const c = src[p];
    if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true;
    const word = /[A-Za-z_$]+$/.exec(src.slice(Math.max(0, p - 10), p + 1))?.[0];
    return ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new'].includes(word);
  };
  function template(start) {
    // src[start] === '`'; returns end index (after closing `)
    const strings = [], exprs = [];
    let k = start + 1, buf = '', segStart = k;
    const spans = [];
    while (k < n) {
      const c = src[k];
      if (c === '\\') { buf += src[k] + src[k + 1]; k += 2; continue; }
      if (c === '`') { strings.push(buf); spans.push([segStart, k]); k++; break; }
      if (c === '$' && src[k + 1] === '{') {
        strings.push(buf); spans.push([segStart, k]); buf = '';
        k = code(k + 2, '}');
        exprs.push(null);
        segStart = k;
        continue;
      }
      buf += c; k++;
    }
    // tag = identifier right before the backtick
    const tag = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, start - 30), start))?.[1] ?? null;
    const untagged = !tag || ['return', 'typeof', 'case', 'in', 'of', 'await', 'yield'].includes(tag);
    out.push({ type: 'template', start, end: k, tag: untagged ? null : tag, strings, spans, values: strings.length - 1 });
    return k;
  }
  function code(k, until) {
    let depth = 0;
    while (k < n) {
      const c = src[k];
      if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) return n; continue; }
      if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k + 2) + 2; continue; }
      if (c === "'" || c === '"') { k = str(k); continue; }
      if (c === '`') { k = template(k); continue; }
      if (c === '/' && regexAllowed(k)) { k = regex(k); continue; }
      if (until) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return k + 1; depth--; }
      }
      k++;
    }
    return k;
  }
  function str(k) {
    const q = src[k];
    let j = k + 1, val = '';
    while (j < n && src[j] !== q) { if (src[j] === '\\') { val += src[j + 1]; j += 2; continue; } if (src[j] === '\n') break; val += src[j]; j++; }
    out.push({ type: 'string', start: k, end: j + 1, value: val });
    return j + 1;
  }
  function regex(k) {
    let j = k + 1, cls = false;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '[') cls = true; else if (c === ']') cls = false;
      else if (c === '/' && !cls) break;
      else if (c === '\n') return k + 1; // not a regex after all
      j++;
    }
    j++;
    while (/[a-z]/i.test(src[j] ?? '')) j++;
    return j;
  }
  code(0, null);
  return out;
}

const keyText = (strings) => strings.reduce((acc, s, i) => acc + (i ? `{${i - 1}}` : '') + s, '');

const files = walk(join(ROOT, 'js')).map((f) => relative(ROOT, f).split(sep).join('/')).filter((f) => !SKIP.some((s) => f.startsWith(s)));
const keys = new Map(); // key → Set(files)
const add = (k, f) => { if (!keys.has(k)) keys.set(k, new Set()); keys.get(k).add(f); };
let codemodEdits = 0;
for (const f of files) {
  let src = fs.readFileSync(join(ROOT, f), 'utf8');
  if (!AR.test(src)) continue;
  const items = scan(src);
  if (process.argv.includes('--codemod') && UI.some((u) => f.startsWith(u))) {
    // untagged templates with Arabic text and values → tr`…` (from the end so offsets stay valid)
    const targets = items.filter((it) => it.type === 'template' && !it.tag && it.values > 0 && AR.test(it.strings.join('')))
      .filter((it) => !/\bhtml\s*$/.test(src.slice(Math.max(0, it.start - 6), it.start)))
      .sort((a, b) => b.start - a.start);
    for (const it of targets) { src = src.slice(0, it.start) + 'tr' + src.slice(it.start); codemodEdits++; }
    if (targets.length) {
      if (!/import \{[^}]*\btr\b[^}]*\} from '[./]*\/?(?:core\/)?i18n\.js'/.test(src)) {
        const rel = relative(join(ROOT, f, '..'), join(ROOT, 'js', 'core', 'i18n.js')).split(sep).join('/');
        const spec = rel.startsWith('.') ? rel : `./${rel}`;
        // after the last import line
        const lines = src.split('\n');
        let last = -1;
        lines.forEach((l, idx) => { if (/^import .* from '.*';$/.test(l)) last = idx; });
        lines.splice(last + 1, 0, `import { tr } from '${spec}';`);
        src = lines.join('\n');
      }
      fs.writeFileSync(join(ROOT, f), src);
    }
  }
  for (const it of scan(src)) {
    if (it.type === 'string') { if (AR.test(it.value)) for (const r of findRuns(it.value)) add(r.key, f); continue; }
    if (!AR.test(it.strings.join(''))) continue;
    if (it.tag === 'html' || it.tag === 'tr') { for (const r of findRuns(keyText(it.strings))) add(r.key, f); continue; }
    // untagged: values break the text at run time, so each fixed part stands alone
    for (const s of it.strings) for (const r of findRuns(s)) add(r.key, f);
  }
}

// Merge into the dictionary, keeping translations already written.
let existing = {};
if (fs.existsSync(DICT)) existing = (await import(`file://${DICT.replace(/\\/g, '/')}?${Date.now()}`)).default;
const merged = {};
for (const k of [...keys.keys()].sort((a, b) => a.localeCompare(b, 'ar'))) merged[k] = existing[k] ?? '';
const unused = Object.keys(existing).filter((k) => !keys.has(k) && existing[k]);
for (const k of unused) merged[k] = existing[k]; // keep: may come from data (catalog names)
const untranslated = Object.entries(merged).filter(([, v]) => !v).map(([k]) => k);
// a run ends before a closing bracket, so the English must leave the same brackets open
const open = (x) => x.split('(').length - x.split(')').length;
for (const [k, v] of Object.entries(merged)) if (v && open(k) !== open(v)) console.warn(`brackets differ: ${k} → ${v}`);

if (process.argv.includes('--check')) {
  console.log(`${keys.size} keys · ${untranslated.length} untranslated`);
  process.exit(untranslated.length ? 1 : 0);
}
const body = Object.entries(merged).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
fs.mkdirSync(join(ROOT, 'js', 'i18n'), { recursive: true });
fs.writeFileSync(DICT, `/* English for the Arabic UI text. Keys come from tools/extract-i18n.mjs (same rule as\n * core/i18n.js); {0}, {1}… are values and may move. Empty = not translated yet (stays Arabic). */\nexport default {\n${body}\n};\n`);
console.log(`${keys.size} keys · ${untranslated.length} untranslated · ${unused.length} kept from data${codemodEdits ? ` · ${codemodEdits} sentences wrapped in tr` : ''}`);
