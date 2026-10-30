/**
 * Tooth chart drawn from real tooth pictures (assets/teeth, described in core/tooth-art.js):
 * each tooth shows its buccal view (with roots) and its occlusal view. Upper teeth: buccal
 * on top, occlusal below; lower teeth: occlusal on top, buccal below — so the two arches
 * meet at the occlusal plane. Facing the patient: the patient's right is on the viewer's left.
 *
 * The pictures show the patient's LEFT side (mesial on the left), so teeth on the screen's
 * left are drawn mirrored. Everything on a tooth is drawn in its picture's own pixels inside
 * a scaled group, so the masks (the tooth's outline) line up for both sides.
 *
 * Same contract as the square chart: data-tooth on each tooth, data-surface (M O D B L) on
 * the five tap areas over the occlusal view, `regionSurfaces()` for which is where.
 */
import { html, raw } from '../core/dom.js';
import { ROWS, DENTITIONS, isUpper, isScreenLeft, position, isPrimary, toothName, surfacesText } from '../core/teeth.js';
import { CONDITION, toothConditions } from '../core/chart-conditions.js';
import { TOOTH_ART } from '../core/tooth-art.js';
import { tr } from '../core/i18n.js';

const CELL = 64;            // horizontal space per tooth
const MID_GAP = 22;
const PAD = 14;
const SB = 0.3;             // buccal picture px → chart units
const SO = 0.26;            // occlusal picture px → chart units
const PRIMARY_SCALE = 0.8;
const BUCCAL_H = 92;        // room for the tallest buccal picture
const OCCL_H = 58;          // room for the tallest occlusal picture
const GAP = 6;
const ROW_H = 16 + BUCCAL_H + GAP + OCCL_H + 8;
const SURFACE_PRIORITY = ['caries', 'temporary', 'filled', 'sealant'];
/** Primary teeth borrow the closest permanent shape: A B C → 1 2 3, D E → molar. */
const PRIMARY_SHAPE = { 1: 1, 2: 2, 3: 3, 4: 6, 5: 6 };

const art = (t) => TOOTH_ART[`${isUpper(t) ? 'u' : 'l'}${isPrimary(t) ? PRIMARY_SHAPE[position(t)] : position(t)}`];
const artKey = (t) => `${isUpper(t) ? 'u' : 'l'}${isPrimary(t) ? PRIMARY_SHAPE[position(t)] : position(t)}`;
const href = (key, view) => `assets/teeth/${key}-${view}.webp`;
const maskId = (key, view) => `odo-m-${key}-${view}`;
const f = (n) => +n.toFixed(2);

/** Which canonical surface sits in each screen region (same rule as the square chart). */
function screenSurfaces(tooth) {
  const up = isUpper(tooth);
  const left = isScreenLeft(tooth);
  return { center: 'O', top: up ? 'B' : 'L', bottom: up ? 'L' : 'B', left: left ? 'D' : 'M', right: left ? 'M' : 'D' };
}

function surfaceColor(conds, surface) {
  for (const key of SURFACE_PRIORITY) if (conds[key]?.surfaces.includes(surface)) return CONDITION[key].color;
  return null;
}

/** Tap areas over an occlusal picture of size W×H (in its own pixels). */
function zones(W, H) {
  const a = 0.32, b = 0.68;
  return {
    top: `0,0 ${W},0 ${W * b},${H * a} ${W * a},${H * a}`,
    bottom: `0,${H} ${W},${H} ${W * b},${H * b} ${W * a},${H * b}`,
    left: `0,0 ${W * a},${H * a} ${W * a},${H * b} 0,${H}`,
    right: `${W},0 ${W},${H} ${W * b},${H * b} ${W * b},${H * a}`,
    center: `${W * a},${H * a} ${W * b},${H * a} ${W * b},${H * b} ${W * a},${H * b}`,
  };
}

/** Screen x of each tooth cell in a row. */
function rowPositions(teeth, midX) {
  const half = teeth.length / 2;
  return teeth.map((_, i) => (i < half ? midX - MID_GAP / 2 - (half - i) * CELL : midX + MID_GAP / 2 + (i - half) * CELL));
}

/** Group that places a picture of size w×h (px) at x,y with scale s, mirrored when asked. */
const place = (x, y, w, h, s, flip) => `translate(${f(x)},${f(y)}) scale(${f(s)}) ${flip ? `translate(${w},0) scale(-1,1)` : ''}`;

function drawTooth(t, cx, y, { state, planned, selected, selectedSurfaces, readonly }) {
  const a = art(t);
  const key = artKey(t);
  const up = isUpper(t);
  const k = isPrimary(t) ? PRIMARY_SCALE : 1;
  const flip = isScreenLeft(t);
  const conds = Object.fromEntries(toothConditions(state, t).map((c) => [c.key, c]));
  const isSel = selected.has(t);
  const missing = !!conds.missing;
  const plan = planned.get(t) ?? [];
  const center = cx + CELL / 2;

  // Where the two views go (chart units)
  const sb = SB * k, so = SO * k;
  const bw = a.b.w * sb, bh = a.b.h * sb;
  const ow = a.o.w * so, oh = a.o.h * so;
  const crownLine = up ? y + 16 + BUCCAL_H : y + GAP + OCCL_H + GAP;   // where the buccal crown edge sits
  const by = up ? crownLine - bh : crownLine;
  const occMid = up ? crownLine + GAP + OCCL_H / 2 : y + GAP + OCCL_H / 2;
  const oy = occMid - oh / 2;
  const labelY = up ? y + 11 : y + ROW_H - 3;
  const sw = (n, s) => f(n / s);   // stroke width in picture pixels for n chart units

  // Buccal view: crown part = from the CEJ to the crown edge
  const B = a.b;
  const cejY = B.cej * B.h;
  const crownRect = up ? `x="0" y="${f(cejY)}" width="${B.w}" height="${f(B.h - cejY)}"` : `x="0" y="0" width="${B.w}" height="${f(cejY)}"`;
  const crownTint = conds.crown ? CONDITION.crown.color : conds.bridge ? CONDITION.bridge.color : conds.veneer ? CONDITION.veneer.color : null;
  const bParts = [`<image href="${href(key, 'b')}" width="${B.w}" height="${B.h}" ${conds.implant ? 'opacity=".3"' : ''}/>`];
  if (crownTint) bParts.push(`<g mask="url(#${maskId(key, 'b')})"><rect ${crownRect} fill="${crownTint}" fill-opacity=".45"/></g>`);
  if (conds.rct && !conds.implant) {
    for (const canal of B.canals) bParts.push(`<polyline points="${canal.map(([px, py]) => `${f(px * B.w)},${f(py * B.h)}`).join(' ')}" fill="none" stroke="${CONDITION.rct.color}" stroke-width="${sw(2.6, sb)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  if (conds.implant) {
    const iw = B.w * 0.26, ix = (B.w - iw) / 2;
    const len = (up ? cejY : B.h - cejY) * 0.85;
    const iy = up ? cejY - len : cejY;
    const threads = Array.from({ length: 6 }, (_, n) => iy + (len / 7) * (n + 1));
    bParts.push(`<g class="odo-implant"><rect x="${f(ix)}" y="${f(iy)}" width="${f(iw)}" height="${f(len)}" rx="${f(iw / 3)}" fill="${CONDITION.implant.color}"/>${threads.map((ty) => `<line x1="${f(ix - iw * 0.18)}" x2="${f(ix + iw * 1.18)}" y1="${f(ty)}" y2="${f(ty)}" stroke="${CONDITION.implant.color}" stroke-width="${sw(1.6, sb)}"/>`).join('')}</g>`);
  }
  if (conds.fractured) {
    const y0 = up ? cejY : 0, y1 = up ? B.h : cejY, dy = (y1 - y0) / 5;
    bParts.push(`<polyline points="${[0, 1, 2, 3, 4, 5].map((n) => `${f(B.w * (n % 2 ? 0.62 : 0.38))},${f(y0 + dy * n)}`).join(' ')}" fill="none" stroke="${CONDITION.fractured.color}" stroke-width="${sw(2.4, sb)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // Occlusal view: five tap areas, condition colours clipped to the tooth's outline
  const O = a.o;
  const regions = screenSurfaces(t);
  const local = (region) => (flip && region === 'left' ? 'right' : flip && region === 'right' ? 'left' : region);
  const zonePts = zones(O.w, O.h);
  const fills = [];
  const taps = [];
  for (const region of ['top', 'bottom', 'left', 'right', 'center']) {
    const s = regions[region];
    const pts = zonePts[local(region)];
    const fill = surfaceColor(conds, s);
    if (fill) fills.push(`<polygon points="${pts}" fill="${fill}" fill-opacity=".62"/>`);
    const on = isSel && selectedSurfaces?.has(s);
    taps.push(`<polygon class="odo-zone${on ? ' is-on' : ''}" data-surface="${s}" points="${pts}"/>`);
  }
  if (crownTint && !conds.veneer) fills.unshift(`<rect width="${O.w}" height="${O.h}" fill="${crownTint}" fill-opacity=".35"/>`);
  const oParts = [
    `<image href="${href(key, 'o')}" width="${O.w}" height="${O.h}"/>`,
    fills.length ? `<g mask="url(#${maskId(key, 'o')})">${fills.join('')}</g>` : '',
    taps.join(''),
  ];
  const cross = (w, h, color, inset) => `<g stroke="${color}" stroke-width="${sw(3, so)}" stroke-linecap="round" fill="none"><line x1="${w * inset}" y1="${h * inset}" x2="${w * (1 - inset)}" y2="${h * (1 - inset)}"/><line x1="${w * (1 - inset)}" y1="${h * inset}" x2="${w * inset}" y2="${h * (1 - inset)}"/></g>`;
  if (conds.extract) oParts.push(cross(O.w, O.h, CONDITION.extract.color, 0.12));
  if (missing) oParts.push(cross(O.w, O.h, '#94A3B8', 0.18));

  // Selection frame around both views, the planned-work dot, the number
  const top = Math.min(by, oy) - 4, bottom = Math.max(by + bh, oy + oh) + 4;
  const marks = [];
  if (isSel) marks.push(`<rect class="odo-select" x="${f(cx + 2)}" y="${f(top)}" width="${CELL - 4}" height="${f(bottom - top)}" rx="14"/>`);

  const label = [
    tr`سن ${t}، ${toothName(t)}`,
    ...toothConditions(state, t).map((c) => (c.surface && c.surfaces.length ? `${c.label} ${surfacesText(t, c.surfaces)}` : c.label)),
    plan.length ? tr`مخطط: ${plan.map((p) => p.procedureName).join('، ')}` : '',
  ].filter(Boolean).join('، ');

  return raw(`
    <g class="odo-tooth odo-art${missing ? ' is-missing' : ''}${isSel ? ' is-selected' : ''}" data-tooth="${t}" ${readonly ? '' : 'tabindex="0" role="button"'} aria-pressed="${isSel}" aria-label="${label.replace(/"/g, '&quot;')}">
      <title>${label.replace(/</g, '&lt;')}</title>
      <rect class="odo-hit" x="${cx}" y="${y}" width="${CELL}" height="${ROW_H}"/>
      <text class="odo-num" x="${f(center)}" y="${f(labelY)}" text-anchor="middle">${t}</text>
      ${plan.length ? tr`<circle class="odo-planned" cx="${f(center + 14)}" cy="${f(labelY - 4)}" r="4.5"><title>${plan.length} إجراء مخطط</title></circle>` : ''}
      <g class="odo-views">
        <g transform="${place(center - bw / 2, by, B.w, B.h, sb, flip)}">${bParts.join('')}</g>
        <g transform="${place(center - ow / 2, oy, O.w, O.h, so, flip)}">${oParts.join('')}</g>
      </g>
      ${marks.join('')}
    </g>`);
}

/** Masks (each picture's own outline) used to keep colours on the tooth. */
function masks(keys) {
  return [...keys].flatMap((key) => ['b', 'o'].map((view) => {
    const { w, h } = TOOTH_ART[key][view];
    return `<mask id="${maskId(key, view)}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" style="mask-type:alpha"><image href="${href(key, view)}" width="${w}" height="${h}"/></mask>`;
  })).join('');
}

/**
 * @param {{ dentition: 'adult'|'primary'|'mixed', state: Map, planned?: Map<number, object[]>,
 *           selected?: Set<number>, selectedSurfaces?: Set<string>, readonly?: boolean }} o
 */
export function artOdontogram({ dentition = 'adult', state, planned = new Map(), selected = new Set(), selectedSurfaces = new Set(), readonly = false }) {
  const rows = DENTITIONS[dentition].rows.map((key) => ({ key, teeth: ROWS[key], upper: key.endsWith('Upper') }));
  const width = 16 * CELL + MID_GAP + PAD * 2;
  const midX = width / 2;
  const keys = new Set(rows.flatMap((r) => r.teeth.map(artKey)));
  let y = PAD;
  const parts = [];
  let occlusalY = 0;
  rows.forEach((row, i) => {
    if (i > 0 && rows[i - 1].upper && !row.upper) { occlusalY = y + 2; y += 6; }
    const xs = rowPositions(row.teeth, midX);
    // bridge bars between neighbouring bridged crowns
    const barY = row.upper ? y + 16 + BUCCAL_H - 12 : y + GAP + OCCL_H + GAP + 12;
    row.teeth.forEach((t, j) => {
      const next = row.teeth[j + 1];
      if (!next || !state.get(t)?.bridge || !state.get(next)?.bridge) return;
      parts.push(raw(`<rect x="${xs[j] + CELL / 2}" y="${barY - 3}" width="${xs[j + 1] - xs[j]}" height="6" rx="3" fill="${CONDITION.bridge.color}"/>`));
    });
    row.teeth.forEach((t, j) => parts.push(drawTooth(t, xs[j], y, { state, planned, selected, selectedSurfaces, readonly })));
    y += ROW_H + (i < rows.length - 1 && row.upper === rows[i + 1].upper ? 10 : 0);
  });
  const height = y + PAD;
  return html`
    <svg class="odo odo--art ${readonly ? 'is-readonly' : ''}" viewBox="0 0 ${width} ${height}" role="group" aria-label="خريطة الأسنان" preserveAspectRatio="xMidYMid meet">
      <defs>${raw(masks(keys))}</defs>
      <line class="odo-midline" x1="${midX}" x2="${midX}" y1="${PAD - 4}" y2="${height - PAD + 4}"/>
      ${occlusalY ? raw(`<line class="odo-occlusal" x1="${PAD}" x2="${width - PAD}" y1="${occlusalY}" y2="${occlusalY}"/>`) : ''}
      <text class="odo-side" x="${PAD + 2}" y="${height - 2}">يمين المريض</text>
      <text class="odo-side" x="${width - PAD - 2}" y="${height - 2}" text-anchor="end">يسار المريض</text>
      ${parts}
    </svg>`;
}
