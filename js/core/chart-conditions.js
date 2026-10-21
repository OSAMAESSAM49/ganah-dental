/**
 * Dental chart conditions and the event-sourced chart model.
 *
 * The chart is never stored as a snapshot. Every change is an event in `toothEvents`:
 *   { tooth, type: 'add'|'remove'|'clear', condition?, surfaces?, at, voided? }
 * The chart on any date = foldChart(events up to that date). This gives chart history for
 * free and lets treatment items undo their own changes by voiding their events.
 */

/**
 * @typedef {{ key: string, label: string, short: string, color: string, surface?: boolean, whole?: boolean }} Condition
 * surface: applies to individual surfaces (M O D B L) · whole: drawn over the whole tooth
 */
/** @type {Condition[]} */
export const CONDITIONS = [
  { key: 'caries', label: 'تسوس', short: 'تسوس', color: '#E0312B', surface: true },
  { key: 'filled', label: 'حشو', short: 'حشو', color: '#2563EB', surface: true },
  { key: 'temporary', label: 'حشو مؤقت', short: 'مؤقت', color: '#D97706', surface: true },
  { key: 'sealant', label: 'سيلانت', short: 'سيلانت', color: '#16A34A', surface: true },
  { key: 'rct', label: 'حشو عصب', short: 'عصب', color: '#9333EA' },
  { key: 'crown', label: 'تاج (كراون)', short: 'تاج', color: '#CA8A04', whole: true },
  { key: 'veneer', label: 'فينير', short: 'فينير', color: '#DB2777' },
  { key: 'bridge', label: 'كوبري', short: 'كوبري', color: '#0D9488', whole: true },
  { key: 'implant', label: 'زراعة', short: 'زراعة', color: '#475569', whole: true },
  { key: 'fractured', label: 'كسر', short: 'كسر', color: '#EA580C' },
  { key: 'extract', label: 'يحتاج خلع', short: 'خلع', color: '#B91C1C', whole: true },
  { key: 'missing', label: 'مفقود', short: 'مفقود', color: '#94A3B8', whole: true },
];

export const CONDITION = Object.fromEntries(CONDITIONS.map((c) => [c.key, c]));

/** Conditions that a restoration on the same surface replaces. */
const REPLACES_ON_SURFACE = { filled: ['caries', 'temporary'], temporary: ['caries', 'filled'], sealant: [], caries: [] };

/**
 * Applies events in time order and returns the chart state.
 * @param {Array<{ tooth: number, type: string, condition?: string, surfaces?: string[], at: string, createdAt?: string, voided?: boolean }>} events
 * @param {string} [until] ISO timestamp; events after it are ignored (chart history)
 * @returns {Map<number, Record<string, { surfaces: string[] }>>} tooth → conditions
 */
export function foldChart(events, until) {
  const sorted = events
    .filter((e) => !e.voided && (!until || e.at <= until))
    .sort((a, b) => a.at.localeCompare(b.at) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  /** @type {Map<number, Record<string, { surfaces: string[] }>>} */
  const state = new Map();
  for (const e of sorted) {
    const tooth = state.get(e.tooth) ?? {};
    applyEvent(tooth, e);
    if (Object.keys(tooth).length) state.set(e.tooth, tooth); else state.delete(e.tooth);
  }
  return state;
}

function applyEvent(tooth, e) {
  if (e.type === 'clear') { for (const k of Object.keys(tooth)) delete tooth[k]; return; }
  const def = CONDITION[e.condition];
  if (!def) return;
  const surfaces = def.surface ? [...new Set(e.surfaces ?? [])] : [];

  if (e.type === 'remove') {
    if (!tooth[e.condition]) return;
    if (def.surface && surfaces.length) {
      tooth[e.condition].surfaces = tooth[e.condition].surfaces.filter((s) => !surfaces.includes(s));
      if (!tooth[e.condition].surfaces.length) delete tooth[e.condition];
    } else delete tooth[e.condition];
    return;
  }

  // type === 'add'
  if (e.condition === 'missing') {
    for (const k of Object.keys(tooth)) if (k !== 'bridge') delete tooth[k]; // a pontic keeps its bridge
  }
  if (e.condition === 'implant') {
    for (const k of ['missing', 'extract', 'caries', 'filled', 'temporary', 'rct', 'fractured', 'sealant']) delete tooth[k];
  }
  if (def.surface) {
    if (!surfaces.length) return;
    for (const other of REPLACES_ON_SURFACE[e.condition] ?? []) {
      if (!tooth[other]) continue;
      tooth[other].surfaces = tooth[other].surfaces.filter((s) => !surfaces.includes(s));
      if (!tooth[other].surfaces.length) delete tooth[other];
    }
    const cur = tooth[e.condition]?.surfaces ?? [];
    tooth[e.condition] = { surfaces: [...new Set([...cur, ...surfaces])] };
  } else {
    tooth[e.condition] = { surfaces: [] };
  }
}

/** Conditions on a tooth, in display order. */
export const toothConditions = (state, tooth) => {
  const t = state.get(tooth) ?? {};
  return CONDITIONS.filter((c) => t[c.key]).map((c) => ({ ...c, surfaces: t[c.key].surfaces }));
};

/**
 * Chart effect of a procedure when its treatment item is done (used for seeded/new
 * procedures until the clinic sets it explicitly).
 * @returns {string} condition key or '' for none
 */
export function inferChartEffect(name = '') {
  const n = String(name);
  if (/عصب|بلبوتومي/.test(n)) return 'rct';
  if (/حشو مؤقت/.test(n)) return 'temporary';
  if (/حشو/.test(n)) return 'filled';
  if (/فينير/.test(n)) return 'veneer';
  if (/كوبري/.test(n)) return 'bridge';
  if (/كراون|تاج/.test(n)) return 'crown';
  if (/خلع/.test(n)) return 'missing';
  if (/زراعة|زرع/.test(n)) return 'implant';
  if (/سيلانت/.test(n)) return 'sealant';
  return '';
}
