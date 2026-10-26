/**
 * Quick "add procedure" — from an appointment or straight from a patient (file / list card):
 * the patient's dental chart and the procedure list in one window. Tap teeth (or a surface), pick the procedure, «إضافة» — the item joins
 * the active treatment plan, is linked to this visit, and (by default) starts right away so
 * its charge shows in the day's invoices. «إضافة وإجراء آخر» keeps the window open.
 * Opened from a patient, the work is linked to their visit today if they have one.
 */
import { html, ico, render } from '../../core/dom.js';
import { formatMoney, digits, todayISO } from '../../core/format.js';
import { sortTeeth, toothName, DENTITIONS } from '../../core/teeth.js';
import { CONDITION } from '../../core/chart-conditions.js';
import { repos } from '../../data/index.js';
import { odontogram } from '../../components/odontogram.js';
import { openModal } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { getChart } from '../../services/chart.js';
import { ensureActivePlan, addItems, setItemStatus, listItems, listPlans, plannedByTooth } from '../../services/treatment.js';
import { loadCatalog } from '../../services/procedures.js';
import { getPatient } from '../../services/patients.js';
import { defaultDentition } from '../patients/tab-chart.js';

/** The patient's visit today (not cancelled / no-show), if any. */
async function visitToday(patientId) {
  const today = todayISO();
  return (await repos.appointments.findBy('patientId', patientId))
    .filter((a) => a.date === today && a.status !== 'cancelled' && a.status !== 'no_show')
    .sort((a, b) => a.startMin - b.startMin)[0] ?? null;
}

/**
 * @param {{ patientId: string, appt?: object|null }} target  appt: the visit the work belongs to
 *   (omitted → today's visit of the patient, when there is one)
 * @returns {Promise<number>} how many items were added
 */
export async function openQuickTreatment({ patientId, appt }) {
  appt = appt === undefined ? await visitToday(patientId) : appt;
  const patient = await getPatient(patientId);
  const [{ state }, catalog, items, plans] = await Promise.all([getChart(patientId), loadCatalog({ includeInactive: false }), listItems(patientId), listPlans(patientId)]);
  const all = catalog.flatMap((c) => c.procedures);
  const ui = { dentition: defaultDentition(patient), selected: new Set(), surfaces: new Set(), procedureId: '', start: true };
  let planned = plannedByTooth(items, plans);
  let added = 0;

  const proc = () => all.find((p) => p.id === ui.procedureId);
  const chart = () => odontogram({ dentition: ui.dentition, state, planned, selected: ui.selected, selectedSurfaces: ui.surfaces });
  const selection = () => {
    const teeth = sortTeeth([...ui.selected]);
    const p = proc();
    return html`${teeth.length
      ? html`<span class="qt__teeth">${ico('tooth', { size: 16 })} ${teeth.length === 1 ? toothName(teeth[0]) : `${digits(teeth.length)} أسنان: ${teeth.join('، ')}`}${ui.surfaces.size ? html` · <span class="ltr">${[...ui.surfaces].join('')}</span>` : ''}</span>
        <button type="button" class="link-btn" data-qt-clear>مسح الاختيار</button>`
      : html`<span class="muted text-sm">اضغط على السن (أو على سطح منه). اتركه بدون اختيار للإجراءات العامة مثل التنظيف.</span>`}
      ${p ? html`<span class="qt__price">${p.name}: <strong>${formatMoney(p.price * Math.max(1, p.perTooth ? teeth.length : 1))}</strong></span>` : ''}`;
  };

  const body = html`
    <div class="qt">
      <div class="row row--between">
        <div class="segmented" role="radiogroup" aria-label="نوع الأسنان">
          ${Object.entries(DENTITIONS).map(([k, d]) => html`<label><input type="radio" name="qt-dent" value="${k}" ${ui.dentition === k ? 'checked' : ''}><span>${d.label}</span></label>`)}
        </div>
      </div>
      <div class="odo-wrap qt__chart" id="qt-chart">${chart()}</div>
      <div class="qt__sel" id="qt-sel">${selection()}</div>
      <div class="field">
        <label class="field__label" for="qt-proc">الإجراء<span class="req">*</span></label>
        <select class="select" id="qt-proc">
          <option value="">اختر الإجراء…</option>
          ${catalog.map((cat) => html`<optgroup label="${cat.name}">${cat.procedures.map((p) => html`<option value="${p.id}">${p.name}${p.price ? ` — ${formatMoney(p.price)}` : ''}</option>`)}</optgroup>`)}
        </select>
      </div>
      <label class="check"><input type="checkbox" id="qt-start" checked> ابدأ العلاج الآن <span class="muted text-sm">(يظهر حسابه فورًا في «فواتير اليوم»)</span></label>
    </div>`;

  const add = async (d) => {
    const p = proc();
    const teeth = sortTeeth([...ui.selected]);
    if (!p) { toastError('اختر الإجراء'); d.querySelector('#qt-proc').focus(); return false; }
    if (p.perTooth && !teeth.length) { toastError('هذا الإجراء لكل سن: اختر السن من الخريطة'); return false; }
    try {
      const plan = await ensureActivePlan(patientId);
      const surfaces = CONDITION[p.chartEffect]?.surface ? [...ui.surfaces] : [];
      const created = await addItems(plan.id, { procedure: p, teeth, surfaces });
      if (appt) {
        const cur = await repos.appointments.get(appt.id, { includeDeleted: true });
        await repos.appointments.update(appt.id, {
          treatmentItemIds: [...(cur.treatmentItemIds ?? []), ...created.map((i) => i.id)],
          procedureIds: [...new Set([...(cur.procedureIds ?? []), p.id])],
          procedureNames: [...new Set([...(cur.procedureNames ?? []), p.name])],
        });
      }
      if (ui.start) for (const i of created) await setItemStatus(i.id, 'in_progress');
      added += created.length;
      toastSuccess(`أُضيف «${p.name}»${teeth.length ? ` على ${teeth.join('، ')}` : ''}${ui.start ? ' وبدأ العلاج' : ''}`);
      return true;
    } catch (err) { toastError(err.message); return false; }
  };

  await openModal({
    title: `إضافة إجراء — ${patient?.name ?? appt?.patientName ?? ''}`,
    icon: 'tooth',
    size: 'lg',
    body,
    actions: [
      { label: 'إضافة', value: 'add', variant: 'primary' },
      { label: 'إضافة وإجراء آخر', value: 'more' },
      { label: 'إغلاق', value: null },
    ],
    onOpen(d) {
      const redraw = () => { render(d.querySelector('#qt-chart'), chart()); render(d.querySelector('#qt-sel'), selection()); };
      // On a phone the chart is wider than the screen: start at the middle (between 11 and 21).
      const wrap = d.querySelector('#qt-chart');
      requestAnimationFrame(() => { wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2; });
      d.addEventListener('click', (e) => {
        const t = /** @type {Element} */ (e.target);
        if (t.closest('[data-qt-clear]')) { ui.selected.clear(); ui.surfaces.clear(); redraw(); return; }
        const g = t.closest('[data-tooth]');
        if (!g) return;
        const tooth = Number(g.getAttribute('data-tooth'));
        const surf = t.closest('[data-surface]');
        if (surf) {
          ui.selected.add(tooth);
          const s = surf.getAttribute('data-surface');
          if (ui.surfaces.has(s)) ui.surfaces.delete(s); else ui.surfaces.add(s);
        } else if (ui.selected.has(tooth)) ui.selected.delete(tooth);
        else ui.selected.add(tooth);
        if (!ui.selected.size) ui.surfaces.clear();
        redraw();
      });
      d.addEventListener('change', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.id === 'qt-proc') { ui.procedureId = t.value; render(d.querySelector('#qt-sel'), selection()); }
        if (t.id === 'qt-start') ui.start = t.checked;
        if (t.name === 'qt-dent') { ui.dentition = t.value; redraw(); }
      });
    },
    async beforeClose(v, d) {
      if (v !== 'add' && v !== 'more') return true;
      const ok = await add(d);
      if (!ok) return false;
      if (v === 'add') return true;
      // keep the window open for the next procedure
      ui.selected.clear(); ui.surfaces.clear(); ui.procedureId = '';
      planned = plannedByTooth(await listItems(patientId), await listPlans(patientId));
      /** @type {HTMLSelectElement} */ (d.querySelector('#qt-proc')).value = '';
      render(d.querySelector('#qt-chart'), chart());
      render(d.querySelector('#qt-sel'), selection());
      return false;
    },
  });
  return added;
}
