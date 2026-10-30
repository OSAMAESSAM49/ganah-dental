/**
 * Patient file → dental chart. Click teeth to select (several at once), click a surface to
 * pick it. Then record a condition or add a procedure to the treatment plan.
 * The history selector shows the chart as it was on any earlier day.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { formatDate, formatDateTime, formatMoney, digits, todayISO } from '../../core/format.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { TREATMENT_STATUS } from '../../core/labels.js';
import { DENTITIONS, ROWS, toothName, surfaceLabel, surfacesText, sortTeeth, isUpper, isScreenLeft } from '../../core/teeth.js';
import { CONDITIONS, CONDITION, toothConditions } from '../../core/chart-conditions.js';
import { odontogram } from '../../components/odontogram.js';
import { confirmDialog } from '../../components/modal.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { getChart, historyDays, recordToothEvents, voidToothEvent } from '../../services/chart.js';
import { listPlans, listItems, ensureActivePlan, addItems, plannedByTooth, chargedPerTooth } from '../../services/treatment.js';
import { loadCatalog } from '../../services/procedures.js';
import { ageYears } from '../../services/patients.js';
import { tr } from '../../core/i18n.js';

/** Default dentition from age: under 6 primary, 6–12 mixed, otherwise adult. */
export function defaultDentition(p) {
  const age = ageYears(p);
  if (age === null) return 'adult';
  if (age < 6) return 'primary';
  if (age <= 12) return 'mixed';
  return 'adult';
}

export async function renderTab({ body, patient, signal }) {
  const p = patient();
  const canEdit = can('chart', 'edit');
  const canPlan = can('treatment', 'create');
  const ui = {
    dentition: defaultDentition(p),
    day: '',                 // '' = today/live
    selected: new Set(),
    surfaces: new Set(),
    condition: 'caries',
    procedureId: '',
    planId: '',
    showLog: false,
  };
  let events = [], state = new Map(), plans = [], items = [], catalog = [];

  const load = async () => {
    const chart = await getChart(p.id, ui.day || undefined);
    events = chart.events;
    state = chart.state;
    [plans, items, catalog] = await Promise.all([listPlans(p.id), listItems(p.id), canPlan ? loadCatalog({ includeInactive: false }) : []]);
  };

  const openPlans = () => plans.filter((pl) => pl.status === 'active' || pl.status === 'proposal');

  /* ---------- side panel ---------- */
  const conditionPanel = () => {
    const c = CONDITION[ui.condition];
    const single = ui.selected.size === 1 ? [...ui.selected][0] : null;
    const sample = single ?? 16;
    const reg = (s) => surfaceLabel(sample, s);
    // picker laid out like the chart box for the (first) selected tooth
    const top = isUpper(sample) ? 'B' : 'L', bottom = isUpper(sample) ? 'L' : 'B';
    const left = isScreenLeft(sample) ? 'D' : 'M', right = isScreenLeft(sample) ? 'M' : 'D';
    const btn = (s, cls) => html`<button type="button" class="${cls}" data-surface-btn="${s}" aria-pressed="${String(ui.surfaces.has(s))}">${reg(s).code}<small>${reg(s).ar}</small></button>`;
    return html`
      <div class="stack-sm">
        <span class="field__label">الحالة</span>
        <div class="cond-chips" role="group" aria-label="اختر الحالة">
          ${CONDITIONS.map((x) => html`<button type="button" class="cond-chip" data-cond="${x.key}" aria-pressed="${String(x.key === ui.condition)}"><span class="cond-dot" style="background:${x.color}"></span>${x.label}</button>`)}
        </div>
      </div>
      ${c.surface ? html`
        <div class="stack-sm">
          <span class="field__label">الأسطح ${single ? '' : html`<span class="subtle text-sm">(تُطبّق على كل الأسنان المختارة)</span>`}</span>
          <div class="row" style="align-items:center">
            <div class="surface-picker" role="group" aria-label="الأسطح">
              ${btn(top, 'sp-top')}${btn(left, 'sp-left')}${btn('O', 'sp-center')}${btn(right, 'sp-right')}${btn(bottom, 'sp-bottom')}
            </div>
            <span class="muted text-sm">أو اضغط على السطح نفسه في الخريطة</span>
          </div>
        </div>` : ''}
      <div class="row">
        <button type="button" class="btn btn--primary btn--sm" data-apply ${c.surface && !ui.surfaces.size ? 'disabled' : ''}>${ico('check', { size: 18 })} تسجيل «${c.label}»</button>
        <button type="button" class="btn btn--ghost btn--sm" data-clear-teeth title="مسح كل الحالات من الأسنان المختارة">${ico('refresh-cw', { size: 16 })} سليم</button>
      </div>`;
  };

  const planPanel = () => {
    const proc = catalog.flatMap((cat) => cat.procedures).find((x) => x.id === ui.procedureId);
    const targets = openPlans();
    return html`
      <hr style="margin-block: var(--sp-2)">
      <div class="stack-sm">
        <span class="field__label">${ico('list-checks', { size: 18 })} إضافة إجراء لخطة العلاج</span>
        <select class="select" id="proc-pick" aria-label="الإجراء">
          <option value="">اختر الإجراء…</option>
          ${catalog.map((cat) => html`<optgroup label="${cat.name}">${cat.procedures.map((x) => html`<option value="${x.id}" ${x.id === ui.procedureId ? 'selected' : ''}>${x.name}${x.price ? ` — ${formatMoney(x.price)}` : ''}</option>`)}</optgroup>`)}
        </select>
        ${targets.length > 1 ? html`<select class="select" id="plan-pick" aria-label="الخطة">
          ${targets.map((pl) => html`<option value="${pl.id}" ${pl.id === ui.planId ? 'selected' : ''}>${pl.name}${pl.status === 'proposal' ? ' (بديلة)' : ''}</option>`)}
        </select>` : ''}
        ${proc ? html`<p class="muted text-sm">${chargedPerTooth(proc, [...ui.selected]) ? tr`بند لكل سن (${digits(ui.selected.size)})` : 'بند واحد'}${CONDITION[proc.chartEffect]?.surface && ui.surfaces.size ? tr` · الأسطح: ${[...ui.surfaces].join('')}` : ''}${proc.price ? ` · ${formatMoney(proc.price * (chargedPerTooth(proc, [...ui.selected]) ? ui.selected.size : 1))}` : ' · بدون سعر'}</p>` : ''}
        <button type="button" class="btn btn--dark btn--sm" data-add-plan ${proc ? '' : 'disabled'} style="align-self:flex-start">${ico('plus', { size: 18 })} أضف للخطة</button>
      </div>`;
  };

  const panel = () => {
    if (ui.day) {
      return html`<div class="stack">
        <div class="alert alert--warning">${ico('clock')}<div class="alert__content"><div class="alert__title">عرض تاريخي</div><div class="alert__body">الخريطة كما كانت في نهاية يوم ${formatDate(ui.day)}. لا يمكن التعديل في هذا العرض.</div></div></div>
        <button type="button" class="btn btn--primary" data-live>${ico('arrow-right', { size: 18 })} العودة للخريطة الحالية</button>
      </div>`;
    }
    const sel = sortTeeth([...ui.selected]);
    if (!sel.length) {
      return html`<div class="stack">
        <p class="muted">${canEdit ? 'اضغط على سن لاختياره، أو على أكثر من سن لتحديدها معًا. لاختيار الأسطح اضغط على صورة السطح الماضغ (الوسط أو الأطراف).' : 'اضغط على سن لعرض حالته.'}</p>
        <div class="legend-grid">${CONDITIONS.map((c) => html`<span class="legend__item"><span class="cond-dot" style="background:${c.color}"></span>${c.label}</span>`)}<span class="legend__item"><span class="cond-dot" style="background: var(--brand-lime); border-radius: 50%; box-shadow: inset 0 0 0 1px #000"></span>إجراء مخطط</span></div>
      </div>`;
    }
    const single = sel.length === 1 ? sel[0] : null;
    const planned = plannedByTooth(items, plans);
    const plannedHere = [...new Map(sel.flatMap((t) => planned.get(t) ?? []).map((i) => [i.id, i])).values()];
    return html`
      <div class="stack">
        <div class="row row--between">
          <div class="tooth-pills">${sel.map((t) => html`<span class="tooth-pill">${t}</span>`)}</div>
          <button type="button" class="btn btn--ghost btn--sm" data-unselect>إلغاء التحديد</button>
        </div>
        ${single ? html`<p class="bold">${toothName(single)}</p>` : ''}
        ${single ? html`<div class="stack-sm">
          ${toothConditions(state, single).length
            ? toothConditions(state, single).map((c) => html`<div class="row row--between" style="gap: var(--sp-2)">
                <span class="row" style="gap: var(--sp-2)"><span class="cond-dot" style="background:${c.color}"></span>${c.label}${c.surface && c.surfaces.length ? html` <span class="badge ltr">${surfacesText(single, c.surfaces)}</span>` : ''}</span>
                ${canEdit ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-remove-cond="${c.key}" aria-label="إزالة ${c.label}">${ico('x', { size: 16 })}</button>` : ''}
              </div>`)
            : html`<p class="muted text-sm">لا توجد حالات مسجّلة — سليم.</p>`}
        </div>` : ''}
        ${plannedHere.length ? html`<div class="stack-sm"><span class="field__label">مخطط لهذه الأسنان</span>
          ${plannedHere.map((i) => html`<div class="row" style="gap: var(--sp-2)"><span class="badge badge--${TREATMENT_STATUS[i.status].tone}">${TREATMENT_STATUS[i.status].label}</span>${i.procedureName} <span class="ltr subtle">${(i.teeth ?? []).join(',')}</span></div>`)}</div>` : ''}
        ${canEdit ? html`<hr style="margin-block: var(--sp-2)">${conditionPanel()}` : ''}
        ${canPlan ? planPanel() : ''}
      </div>`;
  };

  /* ---------- change log ---------- */
  const describeEvent = (e) => {
    if (e.type === 'clear') return tr`تحديد السن ${e.tooth} سليمًا`;
    const c = CONDITION[e.condition];
    const s = e.surfaces?.length ? ` (${surfacesText(e.tooth, e.surfaces)})` : '';
    return tr`${e.type === 'add' ? 'إضافة' : 'إزالة'} «${c?.label ?? e.condition}»${s} — سن ${e.tooth}`;
  };
  const logMarkup = () => {
    const rows = [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
    return rows.length ? html`<ul class="timeline">${rows.map((e) => html`
      <li class="timeline__item" ${e.voided ? html`data-voided` : ''}>
        <span class="cond-dot" style="background:${CONDITION[e.condition]?.color ?? 'var(--c-border-strong)'}"></span>
        <span class="timeline__main">${describeEvent(e)}<br><span class="subtle">${formatDateTime(e.at)} · ${e.source === 'treatment' ? tr`من خطة العلاج${e.note ? `: ${e.note}` : ''}` : 'يدوي'}${e.userName ? ` · ${e.userName}` : ''}${e.voided ? ' · أُلغي' : ''}</span></span>
        ${canEdit && !e.voided && e.source !== 'treatment' ? html`<button type="button" class="btn btn--ghost btn--sm" data-void="${e.id}">تراجع</button>` : ''}
      </li>`)}</ul>` : html`<p class="muted">لا توجد تغييرات مسجّلة بعد.</p>`;
  };

  /* ---------- main draw ---------- */
  let odoScroll = null; // keep the chart's sideways scroll across redraws (phones)
  let sheetWasOpen = false;
  const draw = () => {
    const days = historyDays(events.length ? events : []);
    const prev = body.querySelector('#odo');
    if (prev) odoScroll = prev.scrollLeft;
    render(body, html`
      <div class="chart-layout">
        <section class="card">
          <div class="card__header" style="flex-wrap: wrap">
            <div class="segmented" role="radiogroup" aria-label="نوع الأسنان">
              ${Object.entries(DENTITIONS).map(([k, d]) => html`<label><input type="radio" name="dentition" value="${k}" ${ui.dentition === k ? 'checked' : ''}><span>${d.label}</span></label>`)}
            </div>
            <label class="row" style="gap: var(--sp-2)">
              <span class="muted text-sm">${ico('clock', { size: 16 })} عرض بتاريخ</span>
              <select class="select" id="chart-day" style="inline-size:auto; min-block-size: 40px" aria-label="عرض الخريطة بتاريخ">
                <option value="">الآن</option>
                ${days.filter((d) => d !== todayISO()).map((d) => html`<option value="${d}" ${ui.day === d ? 'selected' : ''}>${formatDate(d)}</option>`)}
              </select>
            </label>
          </div>
          <div class="card__body">
            <div class="odo-wrap" id="odo">${odontogram({ dentition: ui.dentition, state, planned: ui.day ? new Map() : plannedByTooth(items, plans), selected: ui.selected, selectedSurfaces: ui.surfaces, readonly: !!ui.day })}</div>
          </div>
          <div class="card__footer">
            <button type="button" class="btn btn--ghost btn--sm" data-toggle-log aria-expanded="${String(ui.showLog)}">${ico('scroll-text', { size: 16 })} سجل تغييرات الخريطة (${digits(events.length)})</button>
            ${ui.showLog ? html`<div style="margin-block-start: var(--sp-3)">${logMarkup()}</div>` : ''}
          </div>
        </section>
        <aside class="card chart-aside" aria-label="الأسنان المختارة" ${ui.selected.size && !ui.day ? html`data-sheet` : ''}>
          <div class="card__header"><div class="card__heading"><h2 class="card__title">${ui.day ? 'الخريطة السابقة' : 'الأسنان المختارة'}</h2></div></div>
          <div class="card__body" id="chart-panel">${panel()}</div>
        </aside>
      </div>`);
    const odo = body.querySelector('#odo');
    // Phones: when the sheet first rises, bring the chart up above it.
    const sheetOpen = !!body.querySelector('.chart-aside[data-sheet]');
    if (odo && sheetOpen && !sheetWasOpen && matchMedia('(max-width: 767px)').matches) {
      const top = odo.getBoundingClientRect().top - (document.querySelector('.topbar')?.offsetHeight ?? 0) - 8;
      if (top > 0 && odo.getBoundingClientRect().bottom > innerHeight * 0.55) scrollBy({ top, behavior: 'smooth' });
    }
    sheetWasOpen = sheetOpen;
    if (odo && odo.scrollWidth > odo.clientWidth) {
      if (odoScroll === null) odo.scrollLeft = (odo.scrollWidth - odo.clientWidth) / 2 * (getComputedStyle(odo).direction === 'rtl' ? -1 : 1);
      else odo.scrollLeft = odoScroll;
    }
  };

  const redraw = async () => { await load(); draw(); };

  /* ---------- interactions ---------- */
  const toggleTooth = (t) => {
    if (ui.selected.has(t)) ui.selected.delete(t); else ui.selected.add(t);
    if (!ui.selected.size) ui.surfaces.clear();
  };

  on(body, 'click', '[data-tooth]', (e, g) => {
    if (ui.day) return;
    const t = Number(g.dataset.tooth);
    const surf = /** @type {Element} */ (e.target).closest('[data-surface]');
    if (surf && canEdit && CONDITION[ui.condition].surface) {
      if (!ui.selected.has(t)) ui.selected.add(t);
      const s = surf.getAttribute('data-surface');
      if (ui.surfaces.has(s)) ui.surfaces.delete(s); else ui.surfaces.add(s);
    } else {
      toggleTooth(t);
    }
    draw();
    body.querySelector(`[data-tooth="${t}"]`)?.focus({ preventScroll: true });
  }, { signal });

  on(body, 'keydown', '[data-tooth]', (e, g) => {
    const ev = /** @type {KeyboardEvent} */ (e);
    const t = Number(g.dataset.tooth);
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (ui.day) return;
      toggleTooth(t); draw(); body.querySelector(`[data-tooth="${t}"]`)?.focus({ preventScroll: true });
      return;
    }
    const rows = DENTITIONS[ui.dentition].rows.map((k) => ROWS[k]);
    const r = rows.findIndex((row) => row.includes(t));
    const i = rows[r].indexOf(t);
    let next = null;
    if (ev.key === 'ArrowRight') next = rows[r][i + 1];
    if (ev.key === 'ArrowLeft') next = rows[r][i - 1];
    if (ev.key === 'ArrowDown' && rows[r + 1]) next = rows[r + 1][Math.min(i, rows[r + 1].length - 1)];
    if (ev.key === 'ArrowUp' && rows[r - 1]) next = rows[r - 1][Math.min(i, rows[r - 1].length - 1)];
    if (next) { ev.preventDefault(); body.querySelector(`[data-tooth="${next}"]`)?.focus(); }
  }, { signal });

  on(body, 'click', '[data-cond]', (_, b) => { ui.condition = b.dataset.cond; if (!CONDITION[ui.condition].surface) ui.surfaces.clear(); draw(); }, { signal });
  on(body, 'click', '[data-surface-btn]', (_, b) => { const s = b.dataset.surfaceBtn; if (ui.surfaces.has(s)) ui.surfaces.delete(s); else ui.surfaces.add(s); draw(); }, { signal });
  on(body, 'click', '[data-unselect]', () => { ui.selected.clear(); ui.surfaces.clear(); draw(); }, { signal });
  on(body, 'click', '[data-live]', () => { ui.day = ''; redraw(); }, { signal });
  on(body, 'click', '[data-toggle-log]', () => { ui.showLog = !ui.showLog; draw(); }, { signal });

  body.addEventListener('change', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.name === 'dentition') { ui.dentition = t.value; draw(); }
    if (t.id === 'chart-day') { ui.day = t.value; ui.selected.clear(); ui.surfaces.clear(); redraw(); }
    if (t.id === 'proc-pick') {
      ui.procedureId = t.value;
      draw();
    }
    if (t.id === 'plan-pick') ui.planId = t.value;
  }, { signal });

  on(body, 'click', '[data-apply]', async () => {
    const c = CONDITION[ui.condition];
    const teeth = sortTeeth([...ui.selected]);
    const changes = teeth.map((tooth) => ({ tooth, type: 'add', condition: c.key, surfaces: c.surface ? [...ui.surfaces] : [] }));
    try {
      const recorded = await recordToothEvents(p.id, changes);
      undoToast(tr`تم تسجيل «${c.label}» على ${teeth.join('، ')}`, recorded);
      ui.surfaces.clear();
      ui.selected.clear(); // next tap starts a fresh selection
      await redraw();
    } catch (err) { toastError(err.message); }
  }, { signal });

  on(body, 'click', '[data-clear-teeth]', async () => {
    const teeth = sortTeeth([...ui.selected]);
    if (!(await confirmDialog({ title: 'تحديد الأسنان كسليمة؟', message: tr`ستُزال كل الحالات المسجّلة على ${teeth.join('، ')}. يبقى ذلك في سجل التغييرات.`, confirmLabel: 'نعم، سليمة' }))) return;
    const recorded = await recordToothEvents(p.id, teeth.map((tooth) => ({ tooth, type: 'clear' })));
    undoToast(tr`${teeth.join('، ')}: سليمة`, recorded);
    ui.selected.clear();
    ui.surfaces.clear();
    await redraw();
  }, { signal });

  /** Chart changes can be taken back from the toast (the events stay in the log as voided). */
  function undoToast(message, recorded) {
    toast(message, { type: 'success', action: { label: 'تراجع', onClick: async () => {
      for (const e of recorded) await voidToothEvent(e.id);
      await redraw();
    } } });
  }

  on(body, 'click', '[data-remove-cond]', async (_, b) => {
    const tooth = [...ui.selected][0];
    const recorded = await recordToothEvents(p.id, [{ tooth, type: 'remove', condition: b.dataset.removeCond }]);
    undoToast(tr`أُزيلت «${CONDITION[b.dataset.removeCond]?.label ?? b.dataset.removeCond}» من سن ${tooth}`, recorded);
    await redraw();
  }, { signal });

  on(body, 'click', '[data-void]', async (_, b) => {
    if (!(await confirmDialog({ title: 'التراجع عن هذا التغيير؟', message: 'سيُلغى أثره على الخريطة ويبقى ظاهرًا في السجل كمُلغى.', confirmLabel: 'تراجع' }))) return;
    await voidToothEvent(b.dataset.void);
    await redraw();
  }, { signal });

  on(body, 'click', '[data-add-plan]', async () => {
    const proc = catalog.flatMap((cat) => cat.procedures).find((x) => x.id === ui.procedureId);
    if (!proc) return;
    try {
      const plan = ui.planId ? plans.find((pl) => pl.id === ui.planId) : (openPlans().find((pl) => pl.status === 'active') ?? await ensureActivePlan(p.id));
      const created = await addItems(plan.id, { procedure: proc, teeth: sortTeeth([...ui.selected]), surfaces: [...ui.surfaces] });
      toastSuccess(tr`أُضيف ${created.length > 1 ? tr`${digits(created.length)} بنود` : 'بند'} إلى «${plan.name}»`, {
        action: { label: 'فتح الخطة', onClick: () => { location.hash = href('/patients/:id', { id: p.id }, { tab: 'plan' }); } },
      });
      ui.procedureId = '';
      ui.selected.clear();
      ui.surfaces.clear();
      await redraw();
    } catch (err) { toastError(err.message); }
  }, { signal });

  await redraw();
}
