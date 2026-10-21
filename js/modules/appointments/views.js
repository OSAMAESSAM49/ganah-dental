/**
 * Calendar view renderers (pure markup): day (columns per chair or doctor), week (Sat → Fri),
 * month grid and list. Times run top → bottom; 1 minute = PX_PER_MIN pixels.
 */
import { html } from '../../core/dom.js';
import { digits, formatDate, todayISO } from '../../core/format.js';
import { APPT_STATUS } from '../../core/labels.js';
import { medicalAlerts } from '../../core/medical.js';
import { formatClock, formatRange, weekDays, monthGrid, sameMonth, WEEKDAYS, WEEK_ORDER, nowMinutes, weekday } from '../../core/time.js';
import { hoursFor } from '../../services/schedule.js';

export const PX_PER_MIN = 2;

/** Splits overlapping appointments into side-by-side lanes. Exported for tests. */
export function assignLanes(appts) {
  const sorted = [...appts].sort((a, b) => a.startMin - b.startMin || b.duration - a.duration);
  const lanes = [];
  const out = new Map();
  let group = [];
  let groupEnd = -1;
  const flush = () => { const n = Math.max(1, ...group.map((g) => out.get(g.id).lane + 1)); group.forEach((g) => { out.get(g.id).lanes = n; }); group = []; };
  for (const a of sorted) {
    if (a.startMin >= groupEnd) { flush(); lanes.length = 0; }
    let lane = lanes.findIndex((end) => end <= a.startMin);
    if (lane < 0) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = a.startMin + a.duration;
    out.set(a.id, { lane, lanes: 1 });
    group.push(a);
    groupEnd = Math.max(groupEnd, a.startMin + a.duration);
  }
  flush();
  return out;
}

const alertIcon = (patient) => (patient && medicalAlerts(patient).critical.length
  ? html`<span class="appt-block__alert" title="${medicalAlerts(patient).critical.join('، ')}" aria-label="تنبيه طبي">!</span>` : '');

function block(a, { from, patients, lane, compact }) {
  const st = APPT_STATUS[a.status];
  const top = (a.startMin - from) * PX_PER_MIN;
  const height = Math.max(22, a.duration * PX_PER_MIN - 2);
  const width = 100 / lane.lanes;
  const short = height < 44;
  return html`
    <button type="button" class="appt-block ${short ? 'appt-block--short' : ''}" data-appt="${a.id}" data-status="${a.status}"
      style="top:${top}px; height:${height}px; inset-inline-start: calc(${lane.lane * width}% + 2px); inline-size: calc(${width}% - 4px); --st:${st.color}"
      aria-label="${formatRange(a.startMin, a.duration)} ${a.patientName} — ${st.label}">
      <span class="appt-block__time">${formatClock(a.startMin)}${alertIcon(patients.get(a.patientId))}</span>
      <span class="appt-block__name">${a.patientName}</span>
      ${!compact && height >= 78 && a.procedureNames?.length ? html`<span class="appt-block__procs">${a.procedureNames.join('، ')}</span>` : ''}
      ${!compact && height >= 58 ? html`<span class="appt-block__status">${st.label}</span>` : ''}
    </button>`;
}

function timeGutter(from, to) {
  const marks = [];
  for (let m = Math.ceil(from / 60) * 60; m < to; m += 60) marks.push(m);
  return html`<div class="cal-gutter" style="block-size:${(to - from) * PX_PER_MIN}px">
    ${marks.map((m) => html`<span class="cal-gutter__mark" style="top:${(m - from) * PX_PER_MIN}px">${formatClock(m)}</span>`)}
  </div>`;
}

function gridLines(from, to) {
  const lines = [];
  for (let m = Math.ceil(from / 30) * 30; m < to; m += 30) lines.push(m);
  return lines.map((m) => html`<span class="cal-line ${m % 60 ? 'cal-line--half' : ''}" style="top:${(m - from) * PX_PER_MIN}px"></span>`);
}

function closedOverlay(day, from, to) {
  const h = hoursFor(day);
  if (!h?.open) return html`<span class="cal-closed" style="top:0; block-size:100%"><span>مغلق</span></span>`;
  const parts = [];
  if (h.from > from) parts.push(html`<span class="cal-closed" style="top:0; block-size:${(h.from - from) * PX_PER_MIN}px"></span>`);
  if (h.to < to) parts.push(html`<span class="cal-closed" style="top:${(h.to - from) * PX_PER_MIN}px; block-size:${(to - h.to) * PX_PER_MIN}px"></span>`);
  return parts;
}

const nowLine = (day, from, to) => {
  const n = nowMinutes();
  return day === todayISO() && n >= from && n <= to ? html`<span class="cal-now" style="top:${(n - from) * PX_PER_MIN}px"></span>` : '';
};

/** Day view: one column per chair (or per doctor). */
export function dayView({ day, appts, columns, columnKey, range, patients }) {
  const { from, to } = range;
  const height = (to - from) * PX_PER_MIN;
  return html`
    <div class="sched" style="--cols:${columns.length}">
      <div class="cal-head">
        <span class="cal-head__gutter"></span>
        ${columns.map((c) => html`<span class="cal-head__col">${c.name} <span class="chip__count">${digits(appts.filter((a) => (a[columnKey] ?? '') === c.id).length)}</span></span>`)}
      </div>
      <div class="cal-body">
        ${timeGutter(from, to)}
        ${columns.map((c) => {
          const mine = appts.filter((a) => (a[columnKey] ?? '') === c.id);
          const lanes = assignLanes(mine);
          return html`<div class="cal-col" data-day="${day}" data-col-id="${c.id}" style="block-size:${height}px">
            ${closedOverlay(day, from, to)}${gridLines(from, to)}${nowLine(day, from, to)}
            ${mine.map((a) => block(a, { from, patients, lane: lanes.get(a.id) }))}
          </div>`;
        })}
      </div>
    </div>`;
}

/** Week view: Saturday → Friday. */
export function weekView({ day, appts, range, patients }) {
  const { from, to } = range;
  const height = (to - from) * PX_PER_MIN;
  const days = weekDays(day);
  return html`
    <div class="sched sched--week" style="--cols:7">
      <div class="cal-head">
        <span class="cal-head__gutter"></span>
        ${days.map((d) => html`<button type="button" class="cal-head__col cal-head__day ${d === todayISO() ? 'is-today' : ''}" data-goto-day="${d}">
          <span>${WEEKDAYS[weekday(d)]}</span><strong>${digits(Number(d.slice(8)))}</strong></button>`)}
      </div>
      <div class="cal-body">
        ${timeGutter(from, to)}
        ${days.map((d) => {
          const mine = appts.filter((a) => a.date === d);
          const lanes = assignLanes(mine);
          return html`<div class="cal-col" data-day="${d}" style="block-size:${height}px">
            ${closedOverlay(d, from, to)}${gridLines(from, to)}${nowLine(d, from, to)}
            ${mine.map((a) => block(a, { from, patients, lane: lanes.get(a.id), compact: true }))}
          </div>`;
        })}
      </div>
    </div>`;
}

/** Month grid with the first few appointments per day. */
export function monthView({ day, appts, patients }) {
  const cells = monthGrid(day);
  return html`
    <div class="month">
      ${WEEK_ORDER.map((wd) => html`<span class="month__wd">${WEEKDAYS[wd]}</span>`)}
      ${cells.map((d) => {
        const mine = appts.filter((a) => a.date === d && a.status !== 'cancelled');
        const closed = !hoursFor(d)?.open;
        return html`<button type="button" class="month__day ${sameMonth(d, day) ? '' : 'is-other'} ${d === todayISO() ? 'is-today' : ''} ${closed ? 'is-closed' : ''}" data-goto-day="${d}" aria-label="${formatDate(d)}: ${digits(mine.length)} موعد">
          <span class="month__num">${digits(Number(d.slice(8)))}${mine.length ? html`<span class="chip__count">${digits(mine.length)}</span>` : ''}</span>
          ${mine.slice(0, 3).map((a) => html`<span class="month__appt" style="--st:${APPT_STATUS[a.status].color}">${formatClock(a.startMin)} ${a.patientName}${alertIcon(patients.get(a.patientId))}</span>`)}
          ${mine.length > 3 ? html`<span class="month__more">+${digits(mine.length - 3)}</span>` : ''}
        </button>`;
      })}
    </div>`;
}

