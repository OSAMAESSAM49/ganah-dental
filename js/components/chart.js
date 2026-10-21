/**
 * Small SVG charts in the app's style (no library). Column charts read right-to-left like
 * the rest of the UI: the first period is on the right. One y-axis only.
 * Marks: columns ≤ 24px with a 4px rounded top and a 2px gap between grouped columns;
 * 1px solid recessive gridlines; legend for ≥ 2 series; hover tooltip per period.
 * Series colors: var(--chart-1), var(--chart-2) (validated for colour-blind separation).
 */
import { html, raw, render } from '../core/dom.js';
import { digits } from '../core/format.js';

/** Clean tick step for a max value: 1, 2, 2.5 or 5 × 10ⁿ. Exported for tests. */
export function niceMax(max, ticks = 4) {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw0 = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw0);
  return { max: step * ticks, step };
}

/** 1.2K / 35K / 1.5M — compact tick labels. */
export function compact(n) {
  const a = Math.abs(n);
  const f = (v, s) => `${digits(Number.isInteger(v) ? v : Number(v.toFixed(1)))}${s}`;
  if (a >= 1e6) return f(n / 1e6, 'M');
  if (a >= 1e3) return f(n / 1e3, 'K');
  return digits(Math.round(n));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Column path with a rounded top (r = 4) and a square base. */
function colPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * @param {{ labels: string[], series: Array<{ name: string, values: number[], color?: string }>,
 *   format?: (v: number) => string, tick?: (v: number) => string, height?: number, width?: number,
 *   label?: string, tipLabels?: string[] }} o  width: pixel width to draw at (use mountChart to measure)
 *   labels: short x labels (some are skipped when crowded) · tipLabels: full labels for the tooltip
 */
export function columnChart({ labels, series, format = (v) => digits(v), tick = compact, height = 240, width = 640, label = '', tipLabels }) {
  const W = Math.max(240, Math.round(width)), H = height, padTop = 12, padBottom = 28, axisW = 44;
  const n = labels.length;
  const plotW = W - axisW - 8, plotH = H - padTop - padBottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  let { max: top, step } = niceMax(max);
  // Counts never get fractional ticks (0, 0.5, 1 … would print as 0, 1, 1).
  if (step < 1 && series.every((s) => s.values.every(Number.isInteger))) { step = 1; top = Math.max(1, Math.ceil(max)); }
  const band = plotW / Math.max(1, n);
  const groupW = Math.min(band * 0.7, series.length * 24 + (series.length - 1) * 2);
  const colW = (groupW - (series.length - 1) * 2) / series.length;
  const y = (v) => padTop + plotH - (v / top) * plotH;
  // RTL: index 0 sits at the right edge, next to the y-axis.
  const bandX = (i) => W - axisW - (i + 1) * band;
  const every = Math.ceil(n / Math.floor(plotW / 46));
  const colors = series.map((s, i) => s.color ?? `var(--chart-${i + 1})`);

  let svg = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="chart__grid" x1="8" x2="${W - axisW}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="chart__tick" x="${W - axisW + 6}" y="${y(v) + 4}" text-anchor="start">${esc(tick(v))}</text>`;
  }
  labels.forEach((l, i) => {
    const x0 = bandX(i) + (band - groupW) / 2;
    series.forEach((s, si) => {
      const v = s.values[i] ?? 0;
      const x = x0 + groupW - (si + 1) * colW - si * 2; // first series rightmost
      if (v > 0) svg += `<path d="${colPath(x, y(v), colW, padTop + plotH - y(v))}" fill="${colors[si]}"/>`;
    });
    if (i % every === 0) svg += `<text class="chart__tick" x="${bandX(i) + band / 2}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
    const tip = `${tipLabels?.[i] ?? l}|${series.map((s, si) => `${si}:${s.name}:${format(s.values[i] ?? 0)}`).join('|')}`;
    svg += `<rect class="chart__hit" x="${bandX(i)}" y="${padTop}" width="${band}" height="${plotH}" data-tip="${esc(tip)}"/>`;
  });
  svg += `<line class="chart__axis" x1="8" x2="${W - axisW}" y1="${padTop + plotH}" y2="${padTop + plotH}"/>`;

  return html`
    <figure class="chart" data-chart>
      ${series.length > 1 ? html`<div class="chart__legend">${series.map((s, i) => html`<span><i style="background:${colors[i]}"></i>${s.name}</span>`)}</div>` : ''}
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">${raw(svg)}</svg>
      <div class="chart__tip" role="status" hidden></div>
    </figure>`;
}

/**
 * Renders a column chart into el at its real width and redraws when the width changes.
 * @param {HTMLElement} el @param {Parameters<typeof columnChart>[0]} opts @param {AbortSignal} signal
 */
export function mountChart(el, opts, signal) {
  let last = 0;
  const draw = () => {
    const w = el.clientWidth;
    if (!w || Math.abs(w - last) < 4) return;
    last = w;
    render(el, columnChart({ ...opts, width: w }));
  };
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(el);
  signal?.addEventListener('abort', () => ro.disconnect());
}

/** Hover / touch tooltips for every chart inside root. */
export function wireCharts(root, signal) {
  const show = (rect, fig) => {
    const tip = fig.querySelector('.chart__tip');
    const [title, ...rows] = rect.dataset.tip.split('|');
    tip.innerHTML = '';
    const h = document.createElement('strong');
    h.textContent = title;
    tip.append(h);
    for (const r of rows) {
      const [si, name, value] = r.split(':');
      const line = document.createElement('span');
      const sw = document.createElement('i');
      sw.style.background = `var(--chart-${Number(si) + 1})`;
      line.append(sw, `${name}: `);
      const b = document.createElement('b');
      b.textContent = value;
      line.append(b);
      tip.append(line);
    }
    tip.hidden = false;
    const fr = fig.getBoundingClientRect(), rr = rect.getBoundingClientRect();
    const left = Math.min(Math.max(0, rr.left - fr.left + rr.width / 2 - tip.offsetWidth / 2), fr.width - tip.offsetWidth);
    tip.style.insetInlineStart = '';
    tip.style.left = `${left}px`;
    fig.querySelectorAll('.chart__hit[data-on]').forEach((r) => r.removeAttribute('data-on'));
    rect.setAttribute('data-on', '');
  };
  const hide = (fig) => { fig.querySelector('.chart__tip').hidden = true; fig.querySelectorAll('.chart__hit[data-on]').forEach((r) => r.removeAttribute('data-on')); };
  root.addEventListener('pointerover', (e) => {
    const rect = /** @type {Element} */ (e.target).closest?.('.chart__hit');
    if (rect) show(rect, rect.closest('[data-chart]'));
  }, { signal });
  root.addEventListener('pointerout', (e) => {
    const fig = /** @type {Element} */ (e.target).closest?.('[data-chart]');
    if (fig && !fig.contains(/** @type {Node} */ (e.relatedTarget))) hide(fig);
  }, { signal });
}

/**
 * Horizontal bar list (label · bar · value) for rankings — bars share one scale.
 * @param {Array<{ label: string, value: number, text?: string, sub?: string }>} rows
 */
export function barList(rows, { format = (v) => digits(v) } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return html`<div class="stack-sm">${rows.map((r) => html`
    <div class="bar-row" title="${r.label}: ${r.text ?? format(r.value)}">
      <span class="bar-row__label">${r.label}${r.sub ? html` <span class="subtle text-sm">${r.sub}</span>` : ''}</span>
      <span class="bar-row__track"><span class="bar-row__fill" style="inline-size: ${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%"></span></span>
      <span class="bar-row__value">${r.text ?? format(r.value)}</span>
    </div>`)}</div>`;
}
