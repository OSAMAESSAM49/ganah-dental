/**
 * Interactive odontogram (SVG, FDI). Two looks, chosen per device («شكل خريطة الأسنان»):
 *   - pictures (default): real tooth pictures, buccal + occlusal (components/odontogram-art.js)
 *   - squares: each tooth = a 5-surface box (M O D B L) plus a root strip for root-level
 *     conditions (RCT, implant). Drawn facing the patient: the patient's
 * right is on the viewer's left. Upper roots point up, lower roots point down.
 *
 * Markup only — the chart tab wires clicks/keys through data-tooth / data-surface.
 */
import { html, raw } from '../core/dom.js';
import { ROWS, DENTITIONS, isUpper, isScreenLeft, position, isPrimary, toothName, surfacesText } from '../core/teeth.js';
import { CONDITION, toothConditions } from '../core/chart-conditions.js';
import { getPref } from '../core/prefs.js';
import { artOdontogram, bracesMarkup } from './odontogram-art.js';
import { tr } from '../core/i18n.js';

/** Quick selection: the whole mouth or one arch of the shown dentition, skipping missing teeth. */
export function archTeeth(dentition, arch, state) {
  return DENTITIONS[dentition].rows
    .filter((k) => arch === 'all' || k.endsWith(arch === 'upper' ? 'Upper' : 'Lower'))
    .flatMap((k) => ROWS[k])
    .filter((t) => !state?.get(t)?.missing);
}

/** The buttons for archTeeth(); screens handle clicks on [data-select-arch]. */
export const archButtons = () => html`
  <div class="chips odo-quick" role="group" aria-label="تحديد سريع">
    <button type="button" class="chip" data-select-arch="all">كل الأسنان</button>
    <button type="button" class="chip" data-select-arch="upper">الفك العلوي</button>
    <button type="button" class="chip" data-select-arch="lower">الفك السفلي</button>
  </div>`;

/** «صور» (pictures) or «مربعات» (squares), per device. */
export const CHART_STYLES = { art: 'صور الأسنان', boxes: 'مربعات' };
export const chartStyle = () => (getPref('chartStyle', 'art') === 'boxes' ? 'boxes' : 'art');

const CELL = 54;          // horizontal space per tooth
const BOX = 44;           // surface box size
const MID_GAP = 20;       // gap at the midline
const ROW_H = 82;
const PAD = 14;
const IN = 14;            // inner (occlusal) square offset inside the box
const SURFACE_PRIORITY = ['caries', 'temporary', 'filled', 'sealant'];

/** Polygon points for each screen region of the box. */
const REGION = {
  top: `0,0 ${BOX},0 ${BOX - IN},${IN} ${IN},${IN}`,
  bottom: `0,${BOX} ${BOX},${BOX} ${BOX - IN},${BOX - IN} ${IN},${BOX - IN}`,
  left: `0,0 ${IN},${IN} ${IN},${BOX - IN} 0,${BOX}`,
  right: `${BOX},0 ${BOX},${BOX} ${BOX - IN},${BOX - IN} ${BOX - IN},${IN}`,
};

/** Which canonical surface sits in each screen region for a tooth. Exported for tests. */
export function regionSurfaces(tooth) {
  const up = isUpper(tooth);
  const left = isScreenLeft(tooth); // mesial faces the midline
  return {
    center: 'O',
    top: up ? 'B' : 'L',
    bottom: up ? 'L' : 'B',
    left: left ? 'D' : 'M',
    right: left ? 'M' : 'D',
  };
}

function rootCount(tooth) {
  const p = position(tooth);
  if (isPrimary(tooth)) return p >= 4 ? (isUpper(tooth) ? 3 : 2) : 1;
  if (p >= 6) return isUpper(tooth) ? 3 : 2;
  if (p === 4 && isUpper(tooth)) return 2;
  return 1;
}

function surfaceColor(conds, surface) {
  for (const key of SURFACE_PRIORITY) {
    if (conds[key]?.surfaces.includes(surface)) return CONDITION[key].color;
  }
  return null;
}

/** Screen x of each tooth in a row (index → x of the cell's left edge). */
function rowPositions(teeth, midX) {
  const half = teeth.length / 2;
  return teeth.map((_, i) => (i < half
    ? midX - MID_GAP / 2 - (half - i) * CELL
    : midX + MID_GAP / 2 + (i - half) * CELL));
}

function drawTooth(t, cx, y, { state, planned, selected, selectedSurfaces, readonly }) {
  const conds = Object.fromEntries(toothConditions(state, t).map((c) => [c.key, c]));
  const up = isUpper(t);
  const bx = cx + (CELL - BOX) / 2;
  const boxY = up ? y + 36 : y;
  const rootY = up ? y + 15 : y + BOX + 2;
  const labelY = up ? y + 11 : y + ROW_H - 4;
  const isSel = selected.has(t);
  const missing = !!conds.missing;
  const regions = regionSurfaces(t);
  const plan = planned.get(t) ?? [];

  // Roots
  const n = rootCount(t);
  const rootW = 5, gap = 4, totalW = n * rootW + (n - 1) * gap;
  const rx0 = bx + BOX / 2 - totalW / 2;
  const roots = conds.implant
    ? raw(`<g class="odo-implant"><rect x="${bx + BOX / 2 - 5}" y="${rootY}" width="10" height="19" rx="2" fill="${CONDITION.implant.color}"/>${[4, 9, 14].map((d) => `<line x1="${bx + BOX / 2 - 7}" x2="${bx + BOX / 2 + 7}" y1="${rootY + d}" y2="${rootY + d}" stroke="${CONDITION.implant.color}" stroke-width="2"/>`).join('')}</g>`)
    : raw(Array.from({ length: n }, (_, i) => `<rect class="odo-root" x="${rx0 + i * (rootW + gap)}" y="${rootY}" width="${rootW}" height="19" rx="2.5" ${conds.rct ? `style="fill:${CONDITION.rct.color}"` : ''}/>`).join(''));

  // Surfaces
  const crownTint = conds.crown ? CONDITION.crown.color : conds.bridge ? CONDITION.bridge.color : null;
  const polys = Object.entries(REGION).map(([region, pts]) => {
    const s = regions[region];
    let fill = surfaceColor(conds, s);
    if (!fill && conds.veneer && s === 'B') fill = CONDITION.veneer.color;
    const on = selectedSurfaces?.has(s) && isSel;
    return `<polygon class="odo-surface${on ? ' is-on' : ''}" data-surface="${s}" points="${pts}" ${fill ? `style="fill:${fill}"` : crownTint ? `style="fill:${crownTint};fill-opacity:.28"` : ''}/>`;
  }).join('');
  const centerS = regions.center;
  const centerFill = surfaceColor(conds, centerS);
  const center = `<rect class="odo-surface${selectedSurfaces?.has(centerS) && isSel ? ' is-on' : ''}" data-surface="${centerS}" x="${IN}" y="${IN}" width="${BOX - 2 * IN}" height="${BOX - 2 * IN}" ${centerFill ? `style="fill:${centerFill}"` : crownTint ? `style="fill:${crownTint};fill-opacity:.28"` : ''}/>`;

  // Whole-tooth marks
  const marks = [];
  if (conds.crown) marks.push(`<rect x="-3" y="-3" width="${BOX + 6}" height="${BOX + 6}" rx="13" fill="none" stroke="${CONDITION.crown.color}" stroke-width="3.5"/>`);
  if (conds.bridge) marks.push(`<rect x="-3" y="-3" width="${BOX + 6}" height="${BOX + 6}" rx="13" fill="none" stroke="${CONDITION.bridge.color}" stroke-width="3.5" stroke-dasharray="${conds.crown ? '6 4' : '0'}"/>`);
  if (conds.fractured) marks.push(`<polyline points="6,8 16,20 10,24 24,36 20,40 34,${BOX - 2}" fill="none" stroke="${CONDITION.fractured.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
  if (conds.extract) marks.push(`<g stroke="${CONDITION.extract.color}" stroke-width="4" stroke-linecap="round"><line x1="5" y1="5" x2="${BOX - 5}" y2="${BOX - 5}"/><line x1="${BOX - 5}" y1="5" x2="5" y2="${BOX - 5}"/></g>`);
  if (missing) marks.push(`<g class="odo-missing" stroke-width="3" stroke-linecap="round"><line x1="8" y1="8" x2="${BOX - 8}" y2="${BOX - 8}"/><line x1="${BOX - 8}" y1="8" x2="8" y2="${BOX - 8}"/></g>`);
  if (isSel) marks.push(`<rect class="odo-select" x="-6" y="-6" width="${BOX + 12}" height="${BOX + 12}" rx="15"/>`);

  const label = [
    tr`سن ${t}، ${toothName(t)}`,
    ...toothConditions(state, t).map((c) => (c.surface && c.surfaces.length ? `${c.label} ${surfacesText(t, c.surfaces)}` : c.label)),
    plan.length ? tr`مخطط: ${plan.map((p) => p.procedureName).join('، ')}` : '',
  ].filter(Boolean).join('، ');

  return raw(`
    <g class="odo-tooth${missing ? ' is-missing' : ''}${isSel ? ' is-selected' : ''}" data-tooth="${t}" ${readonly ? '' : 'tabindex="0" role="button"'} aria-pressed="${isSel}" aria-label="${label.replace(/"/g, '&quot;')}">
      <title>${label.replace(/</g, '&lt;')}</title>
      <rect class="odo-hit" x="${cx}" y="${y}" width="${CELL}" height="${ROW_H}" />
      <text class="odo-num" x="${cx + CELL / 2}" y="${labelY}" text-anchor="middle">${t}</text>
      ${plan.length ? tr`<circle class="odo-planned" cx="${cx + CELL / 2 + 13}" cy="${labelY - 4}" r="4.5"><title>${plan.length} إجراء مخطط</title></circle>` : ''}
      <g class="odo-roots">${roots}</g>
      <g transform="translate(${bx},${boxY})">
        <g clip-path="url(#odo-clip)">${polys}${center}</g>
        <rect class="odo-outline" width="${BOX}" height="${BOX}" rx="10"/>
        ${marks.join('')}
      </g>
    </g>`);
}

/**
 * @param {{ dentition: 'adult'|'primary'|'mixed', state: Map, planned?: Map<number, object[]>,
 *           selected?: Set<number>, selectedSurfaces?: Set<string>, readonly?: boolean,
 *           style?: 'art'|'boxes' }} o  style defaults to this device's choice
 */
export function odontogram(o) {
  return (o.style ?? chartStyle()) === 'boxes' ? boxOdontogram(o) : artOdontogram(o);
}

function boxOdontogram({ dentition = 'adult', state, planned = new Map(), selected = new Set(), selectedSurfaces = new Set(), readonly = false }) {
  const rows = DENTITIONS[dentition].rows.map((key) => ({ key, teeth: ROWS[key], upper: key.endsWith('Upper') }));
  const width = 16 * CELL + MID_GAP + PAD * 2;
  const midX = width / 2;
  let y = PAD;
  const parts = [];
  let occlusalY = 0;
  rows.forEach((row, i) => {
    if (i > 0 && rows[i - 1].upper && !row.upper) { occlusalY = y + 6; y += 18; }
    const xs = rowPositions(row.teeth, midX);
    // bridge connectors between neighbouring bridged teeth
    row.teeth.forEach((t, j) => {
      const next = row.teeth[j + 1];
      if (!next || !state.get(t)?.bridge || !state.get(next)?.bridge) return;
      const boxY = row.upper ? y + 36 : y;
      const x1 = xs[j] + (CELL + BOX) / 2, x2 = xs[j + 1] + (CELL - BOX) / 2;
      parts.push(raw(`<rect x="${x1}" y="${boxY + BOX / 2 - 4}" width="${x2 - x1}" height="8" rx="4" fill="${CONDITION.bridge.color}"/>`));
    });
    row.teeth.forEach((t, j) => parts.push(drawTooth(t, xs[j], y, { state, planned, selected, selectedSurfaces, readonly })));
    // braces: brackets on the buccal edge of each box, the wire joining neighbours
    const boxY = row.upper ? y + 36 : y;
    const braces = bracesMarkup(row.teeth.map((t, j) => (state.get(t)?.braces ? { x: xs[j] + CELL / 2, y: boxY + (row.upper ? IN / 2 : BOX - IN / 2) } : null)));
    if (braces) parts.push(raw(braces));
    y += ROW_H + (i < rows.length - 1 && row.upper === rows[i + 1].upper ? 8 : 0);
  });
  const height = y + PAD;
  return html`
    <svg class="odo ${readonly ? 'is-readonly' : ''}" viewBox="0 0 ${width} ${height}" role="group" aria-label="خريطة الأسنان" preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="odo-clip"><rect width="${BOX}" height="${BOX}" rx="10"/></clipPath></defs>
      <line class="odo-midline" x1="${midX}" x2="${midX}" y1="${PAD - 4}" y2="${height - PAD + 4}"/>
      ${occlusalY ? raw(`<line class="odo-occlusal" x1="${PAD}" x2="${width - PAD}" y1="${occlusalY}" y2="${occlusalY}"/>`) : ''}
      <text class="odo-side" x="${PAD + 2}" y="${height - 2}">يمين المريض</text>
      <text class="odo-side" x="${width - PAD - 2}" y="${height - 2}" text-anchor="end">يسار المريض</text>
      ${parts}
    </svg>`;
}
