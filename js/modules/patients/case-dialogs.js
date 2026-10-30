/**
 * Orthodontic and implant case files, opened from the patient header: the plan (editable at
 * any time) and the follow-up visits. Lists offer ready choices and remember anything typed
 * before (a datalist), so «أخرى» is simply typing something new.
 */
import { html, ico, render, formData, keep } from '../../core/dom.js';
import { digits, formatDate, todayISO, parseDateInput } from '../../core/format.js';
import { addDays } from '../../core/time.js';
import { can } from '../../core/permissions.js';
import { ROWS, sortTeeth, isUpper } from '../../core/teeth.js';
import { repos } from '../../data/index.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { textField, selectField, textareaField, segmentedField } from '../../components/form.js';
import { dateField, enhanceDateFields, dateRule, isoToInput } from '../../components/date-field.js';
import { archTeeth } from '../../components/odontogram.js';
import { getChart, recordToothEvents } from '../../services/chart.js';
import { CASE_TYPES, CASE_STATUS, isOpen, listCases, getCase, createCase, updateCase, deleteCase, listVisits, saveVisit, deleteVisit, suggestedDates } from '../../services/cases.js';
import { t, tr } from '../../core/i18n.js';

/* ---------- Choices ---------- */

const MALOCCLUSION = [['I', 'Class I'], ['II1', 'Class II div 1'], ['II2', 'Class II div 2'], ['III', 'Class III']];
const PROBLEMS = [['crowding', 'ازدحام'], ['spacing', 'فراغات'], ['deepbite', 'عضة عميقة'], ['openbite', 'عضة مفتوحة'], ['crossbite', 'عضة معكوسة'], ['overjet', 'بروز الأسنان الأمامية'], ['midline', 'انحراف خط المنتصف']];
const APPLIANCES = ['براكيت معدن', 'براكيت سيراميك', 'Self-ligating', 'Clear aligners', 'جهاز متحرك'];
const ARCHES = [['both', 'الفكين'], ['upper', 'العلوي'], ['lower', 'السفلي']];
const PRESCRIPTIONS = ['MBT', 'Roth', 'Edgewise'];
const SLOTS = ['0.018', '0.022'];
const ANCHORAGE = ['بدون', 'TADs (مسامير)', 'Headgear', 'TPA', 'Nance'];
const RETENTION = ['Fixed retainer', 'Essix', 'Hawley'];
const WIRES = ['NiTi 0.012', 'NiTi 0.014', 'NiTi 0.016', 'NiTi 0.018', 'NiTi 0.016×0.022', 'NiTi 0.017×0.025', 'NiTi 0.019×0.025',
  'SS 0.016', 'SS 0.018', 'SS 0.016×0.022', 'SS 0.017×0.025', 'SS 0.019×0.025', 'TMA 0.017×0.025', 'TMA 0.019×0.025', 'Reverse curve NiTi', 'نفس السلك'];
const CHAIN_WHERE = [['', 'بدون'], ['upper', 'علوي'], ['lower', 'سفلي'], ['both', 'الفكين']];
const CHAIN_TYPE = [['closed', 'Closed'], ['short', 'Short'], ['long', 'Long']];
const ELASTICS = ['Class II', 'Class III', 'Box', 'Cross', 'Vertical'];
const ELASTIC_SIZE = ['1/8', '3/16', '1/4', '5/16'];
const FORCE = [['light', 'خفيف'], ['medium', 'متوسط'], ['heavy', 'قوي']];
const COIL = [['', 'بدون'], ['open', 'Open'], ['closed', 'Closed']];
const DONE = [['bond', 'تركيب / إعادة تركيب براكيت'], ['band', 'تركيب Band'], ['reposition', 'تعديل مكان براكيت'], ['ipr', 'IPR'], ['bend', 'تني السلك'], ['tad', 'تركيب مسمار TAD'], ['debond', 'فك التقويم']];
const HYGIENE = [['good', 'جيدة'], ['fair', 'متوسطة'], ['poor', 'ضعيفة']];
const NEXT = [['wire', 'تغيير السلك'], ['chain', 'Power chain'], ['elastics', 'أستك'], ['bond', 'تركيب باقي البراكيت'], ['ipr', 'IPR'], ['debond', 'فك التقويم']];
const WEEKS = [2, 3, 4, 6, 8];

const BRANDS = ['Straumann', 'Nobel Biocare', 'MIS', 'Dentium', 'Osstem', 'Megagen', 'Neodent', 'BioHorizons', 'Zimmer Biomet', 'Alpha-Bio', 'Dentsply Sirona (Astra)'];
const DIAMETERS = ['3.0', '3.3', '3.5', '3.75', '4.0', '4.2', '4.5', '4.8', '5.0', '5.5', '6.0'];
const LENGTHS = ['6', '7', '8', '8.5', '10', '11', '11.5', '12', '13', '14', '16'];
const TIMING = [['immediate', 'فوري'], ['early', 'مبكر'], ['delayed', 'متأخر']];
const STAGES = [['one', 'مرحلة واحدة (Healing abutment)'], ['two', 'مرحلتين (Cover screw)']];
const GRAFTS = ['Autograft', 'Xenograft', 'Allograft', 'Alloplast'];
const SINUS = [['', 'بدون'], ['internal', 'داخلي (Crestal)'], ['lateral', 'جانبي (Lateral window)']];
const IMPLANT_STATUS = [['placed', 'تم الزرع'], ['healing', 'فترة الالتحام'], ['uncovered', 'تم الكشف'], ['impression', 'تم أخذ المقاس'], ['loaded', 'تم تركيب التركيبة'], ['failed', 'فشلت']];
const PROSTHESES = ['تاج بمسمار (Screw-retained)', 'تاج ملصوق (Cement-retained)', 'كوبري على زرعات', 'طقم على زرعات (Overdenture)', 'All-on-4', 'All-on-6'];
const ABUTMENTS = ['Stock', 'Custom', 'Ti-base', 'Multi-unit', 'Locator', 'Ball'];
const IMPLANT_VISITS = [['surgery', 'الجراحة'], ['sutures', 'فك الخيط'], ['check', 'متابعة'], ['uncover', 'كشف الزرعة'], ['impression', 'أخذ المقاس'], ['tryin', 'بروفة'], ['delivery', 'تركيب التركيبة'], ['problem', 'مشكلة']];
const ADULT_TEETH = sortTeeth([...ROWS.adultUpper, ...ROWS.adultLower]);

const label = (pairs, v) => pairs.find(([k]) => k === v)?.[1] ?? v;
const labels = (pairs, vs = []) => vs.map((v) => t(label(pairs, v))).join('، ');
const opts = (pairs) => pairs.map(([value, l]) => ({ value, label: l }));
/** «بعد أسبوعين», «بعد ٤ أسابيع» (whole phrases, so each has its own English). */
const weeksLater = (n) => (n === 1 ? t('بعد أسبوع') : n === 2 ? t('بعد أسبوعين') : n <= 10 ? tr`بعد ${digits(n)} أسابيع` : tr`بعد ${digits(n)} أسبوعًا`);

/* ---------- Field helpers ---------- */

let dl = 0;
/** Text field with suggestions: the ready list plus anything typed in earlier cases. */
function listField(name, fieldLabel, value, suggestions, o = {}) {
  const id = `case-dl-${++dl}`;
  return html`
    ${textField({ name, label: fieldLabel, value: value ?? '', ltr: o.ltr, placeholder: o.placeholder ?? 'اختر أو اكتب', hint: o.hint, attrs: html`list="${id}"` })}
    <datalist id="${id}">${[...new Set(suggestions.map((s) => t(s)))].map((s) => html`<option value="${s}"></option>`)}</datalist>`;
}

/** Several-choice chips (checkboxes). */
const chipsField = (name, fieldLabel, pairs, values = []) => html`
  <fieldset class="field case-chips"><legend class="field__label">${fieldLabel}</legend>
    <div class="chips">${pairs.map(([v, l]) => html`<label class="chip"><input type="checkbox" name="${name}" value="${v}" ${values.includes(v) ? 'checked' : ''}>${l}</label>`)}</div>
  </fieldset>`;

/** One-choice chips (radios) for lists too long for a segmented bar. */
const radioChips = (name, fieldLabel, pairs, value = '') => html`
  <fieldset class="field case-chips"><legend class="field__label">${fieldLabel}</legend>
    <div class="chips">${pairs.map(([v, l]) => html`<label class="chip"><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}>${l}</label>`)}</div>
  </fieldset>`;

/** Values typed before, per field, for the suggestion lists. */
async function remembered() {
  const [cases, visits] = await Promise.all([repos.cases.list(), repos.caseVisits.list()]);
  const m = new Map();
  const add = (k, v) => { if (typeof v === 'string' && v.trim()) { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v.trim()); } };
  for (const c of cases) {
    for (const [k, v] of Object.entries(c.plan ?? {})) add(k, v);
    for (const i of c.implants ?? []) for (const [k, v] of Object.entries(i)) add(`imp.${k}`, v);
  }
  for (const v of visits) for (const [k, x] of Object.entries(v.data ?? {})) add(k, x);
  return (...keys) => keys.flatMap((k) => [...(m.get(k) ?? [])]);
}

/** Reads a DD/MM/YYYY field; '' when empty. Shows the error and throws when invalid. */
function readDate(form, name, required = false) {
  const input = /** @type {HTMLInputElement} */ (form.querySelector(`[name="${name}"]`));
  const err = dateRule(input.value, { required });
  const box = form.querySelector(`[data-error-for="${name}"]`);
  if (box) box.textContent = t(err);
  if (err) { input.focus(); throw new Error(err); }
  return input.value.trim() ? parseDateInput(input.value) : '';
}

/* ---------- Plan forms ---------- */

function orthoPlanFields(c, memo, isNew) {
  const p = c?.plan ?? {};
  return html`
    <div class="form-grid">
      ${dateField({ name: 'startDate', label: 'بداية العلاج (تركيب التقويم)', value: c?.startDate ?? todayISO(), required: true })}
      ${isNew ? '' : selectField({ name: 'status', label: 'حالة الملف', value: c.status, options: Object.entries(CASE_STATUS).map(([value, s]) => ({ value, label: s.label })) })}
      ${isNew ? '' : dateField({ name: 'endDate', label: 'تاريخ فك التقويم', value: c.endDate })}
    </div>
    ${radioChips('malocclusion', 'التشخيص', MALOCCLUSION, p.malocclusion)}
    ${chipsField('problems', 'المشاكل', PROBLEMS, p.problems)}
    <div class="form-grid">
      ${listField('appliance', 'نوع الجهاز', p.appliance, [...APPLIANCES, ...memo('appliance')])}
      ${segmentedField({ name: 'arches', label: 'الفك', value: p.arches ?? 'both', options: opts(ARCHES) })}
    </div>
    <div class="form-grid">
      ${listField('prescription', 'نظام البراكيت (Prescription)', p.prescription, [...PRESCRIPTIONS, ...memo('prescription')], { ltr: true })}
      ${listField('slot', 'Slot', p.slot, SLOTS, { ltr: true })}
    </div>
    <div class="form-grid">
      ${textField({ name: 'extractions', label: 'أسنان مقرر خلعها', value: p.extractions ?? '', ltr: true, placeholder: '14 24 34 44' })}
      ${listField('anchorage', 'التثبيت (Anchorage)', p.anchorage, [...ANCHORAGE, ...memo('anchorage')])}
    </div>
    <div class="form-grid">
      ${textField({ name: 'months', label: 'المدة المتوقعة (شهور)', value: p.months ?? '', ltr: true, inputmode: 'numeric' })}
      ${listField('retention', 'التثبيت بعد الفك (Retainer)', p.retention, [...RETENTION, ...memo('retention')])}
    </div>
    ${textareaField({ name: 'notes', label: 'تفاصيل الخطة', value: p.notes ?? '', rows: 3 })}
    ${isNew ? html`<label class="check"><input type="checkbox" name="placeBraces" checked> ضع «تقويم» على خريطة الأسنان للفك المختار</label>` : ''}`;
}

function implantCard(imp, i, memo) {
  const n = (k) => `i_${i}_${k}`;
  return html`
    <section class="case-implant" data-imp="${i}">
      <div class="row row--between"><strong>${tr`زرعة ${digits(i + 1)}`}${imp.tooth ? html` · <span class="ltr">${imp.tooth}</span>` : ''}</strong>
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-imp-remove="${i}" aria-label="حذف الزرعة">${ico('trash-2', { size: 16 })}</button></div>
      <div class="form-grid">
        ${selectField({ name: n('tooth'), label: 'مكان الزرعة (السن)', value: String(imp.tooth ?? ''), placeholder: 'اختر', options: ADULT_TEETH.map((x) => ({ value: String(x), label: String(x) })) })}
        ${selectField({ name: n('status'), label: 'الحالة', value: imp.status ?? 'placed', options: opts(IMPLANT_STATUS) })}
      </div>
      <div class="form-grid">
        ${listField(n('brand'), 'الشركة', imp.brand, [...BRANDS, ...memo('imp.brand')], { ltr: true })}
        ${listField(n('system'), 'النظام / النوع', imp.system, memo('imp.system'), { ltr: true, placeholder: 'مثال: BLT, C1, SuperLine' })}
      </div>
      <div class="form-grid">
        ${listField(n('diameter'), 'القطر (مم)', imp.diameter, [...DIAMETERS, ...memo('imp.diameter')], { ltr: true })}
        ${listField(n('length'), 'الطول (مم)', imp.length, [...LENGTHS, ...memo('imp.length')], { ltr: true })}
      </div>
      <div class="form-grid">
        ${textField({ name: n('ref'), label: 'الكود (REF)', value: imp.ref ?? '', ltr: true })}
        ${textField({ name: n('lot'), label: 'LOT', value: imp.lot ?? '', ltr: true })}
      </div>
      <div class="form-grid">
        ${textField({ name: n('torque'), label: 'عزم التثبيت (Ncm)', value: imp.torque ?? '', ltr: true, inputmode: 'decimal' })}
        ${textField({ name: n('isq'), label: 'ISQ', value: imp.isq ?? '', ltr: true, inputmode: 'numeric' })}
      </div>
      <div class="form-grid">
        ${segmentedField({ name: n('timing'), label: 'توقيت الزرع', value: imp.timing ?? '', options: opts(TIMING) })}
        ${selectField({ name: n('stage'), label: 'المراحل', value: imp.stage ?? '', placeholder: '—', options: opts(STAGES) })}
      </div>
      <div class="case-implant__extras">
        <label class="check"><input type="checkbox" name="${n('graft')}" ${imp.graft ? 'checked' : ''}> استخدمنا جرافت (Bone graft)</label>
        <div class="form-grid">
          ${listField(n('graftType'), 'نوع الجرافت', imp.graftType, [...GRAFTS, ...memo('imp.graftType')], { ltr: true })}
          ${listField(n('graftBrand'), 'اسم الجرافت / الكمية', imp.graftBrand, memo('imp.graftBrand'), { ltr: true, placeholder: 'مثال: Bio-Oss 0.5g' })}
        </div>
        <label class="check"><input type="checkbox" name="${n('membrane')}" ${imp.membrane ? 'checked' : ''}> غشاء (Membrane)</label>
        ${listField(n('membraneType'), 'نوع الغشاء', imp.membraneType, memo('imp.membraneType'), { ltr: true })}
        <div class="form-grid">
          ${selectField({ name: n('sinus'), label: 'رفع الجيب الأنفي (Sinus lift)', value: imp.sinus ?? '', options: opts(SINUS) })}
          <label class="check" style="align-self:end"><input type="checkbox" name="${n('prf')}" ${imp.prf ? 'checked' : ''}> PRF</label>
        </div>
      </div>
      ${textField({ name: n('notes'), label: 'ملاحظات الزرعة', value: imp.notes ?? '' })}
    </section>`;
}

function implantPlanFields(c, memo, isNew, imps) {
  const p = c?.plan ?? {};
  return html`
    <div class="form-grid">
      ${dateField({ name: 'startDate', label: 'تاريخ الجراحة', value: c?.startDate ?? todayISO(), required: true })}
      ${isNew ? '' : selectField({ name: 'status', label: 'حالة الملف', value: c.status, options: Object.entries(CASE_STATUS).filter(([k]) => k !== 'retention').map(([value, s]) => ({ value, label: s.label })) })}
    </div>
    <div class="form-grid">
      ${dateField({ name: 'sutureDate', label: 'فك الخيط', value: p.sutureDate })}
      ${dateField({ name: 'uncoverDate', label: 'كشف الزرعة (المرحلة الثانية)', value: p.uncoverDate })}
    </div>
    <div class="form-grid">
      ${dateField({ name: 'loadingDate', label: 'الموعد المتوقع للتركيبة', value: p.loadingDate })}
      <div class="field" style="align-self:end"><button type="button" class="btn btn--soft btn--sm" data-suggest-dates>${ico('sparkles', { size: 16 })} اقترح التواريخ من تاريخ الجراحة</button></div>
    </div>
    <div class="form-grid">
      ${listField('prosthesis', 'نوع التركيبة', p.prosthesis, [...PROSTHESES, ...memo('prosthesis')])}
      ${listField('abutment', 'نوع الدعامة (Abutment)', p.abutment, [...ABUTMENTS, ...memo('abutment')], { ltr: true })}
    </div>
    <label class="check"><input type="checkbox" name="reminders" ${p.reminders === false ? '' : 'checked'}> أضف تذكيرات في «المتابعات» لفك الخيط وموعد التركيبة</label>
    ${textareaField({ name: 'notes', label: 'تفاصيل الخطة', value: p.notes ?? '', rows: 3 })}
    <div class="stack-sm">
      <div class="row row--between"><span class="field__label">${ico('tooth', { size: 18 })} الزرعات</span>
        <button type="button" class="btn btn--soft btn--sm" data-imp-add>${ico('plus', { size: 16 })} إضافة زرعة</button></div>
      <div id="case-imps" class="stack">${imps.length ? imps.map((imp, i) => implantCard(imp, i, memo)) : html`<p class="muted text-sm">أضف كل زرعة بمكانها ونوعها ومقاسها.</p>`}</div>
    </div>`;
}

/** Reads the implant cards back into objects. */
function readImplants(form, imps) {
  const data = formData(form);
  return imps.map((imp, i) => {
    const g = (k) => data[`i_${i}_${k}`];
    return {
      id: imp.id, tooth: Number(g('tooth')) || null, status: g('status') || 'placed', brand: g('brand') ?? '', system: g('system') ?? '',
      diameter: g('diameter') ?? '', length: g('length') ?? '', ref: g('ref') ?? '', lot: g('lot') ?? '', torque: g('torque') ?? '', isq: g('isq') ?? '',
      timing: g('timing') ?? '', stage: g('stage') ?? '', graft: !!g('graft'), graftType: g('graftType') ?? '', graftBrand: g('graftBrand') ?? '',
      membrane: !!g('membrane'), membraneType: g('membraneType') ?? '', sinus: g('sinus') ?? '', prf: !!g('prf'), notes: g('notes') ?? '',
    };
  });
}

/** Reads the plan form. Throws (after showing the error) when a date is invalid. */
function readPlan(form, type, imps) {
  const data = formData(form);
  const plan = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('i_') && !['startDate', 'endDate', 'status', 'sutureDate', 'uncoverDate', 'loadingDate', 'placeBraces'].includes(k)));
  const out = { startDate: readDate(form, 'startDate', true), plan };
  if (data.status !== undefined) out.status = data.status;
  if (type === 'ortho' && form.querySelector('[name="endDate"]')) out.endDate = readDate(form, 'endDate');
  if (type === 'implant') {
    Object.assign(plan, { sutureDate: readDate(form, 'sutureDate'), uncoverDate: readDate(form, 'uncoverDate'), loadingDate: readDate(form, 'loadingDate'), reminders: !!data.reminders });
    out.implants = readImplants(form, imps);
  }
  return { ...out, placeBraces: !!data.placeBraces };
}

/** Wires the implant add/remove buttons and the date suggestion inside a plan form. */
function wirePlanForm(form, type, memo, imps, signal) {
  enhanceDateFields(form, signal);
  if (type !== 'implant') return;
  const drawImps = () => {
    render(form.querySelector('#case-imps'), imps.length ? html`${imps.map((imp, i) => implantCard(imp, i, memo))}` : html`<p class="muted text-sm">أضف كل زرعة بمكانها ونوعها ومقاسها.</p>`);
    enhanceDateFields(form, signal);
  };
  form.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest('[data-imp-add]')) {
      imps.splice(0, imps.length, ...readImplants(form, imps), { status: 'placed' });
      drawImps();
      form.querySelector(`[name="i_${imps.length - 1}_tooth"]`)?.focus();
    }
    const rm = target.closest('[data-imp-remove]');
    if (rm) {
      const kept = readImplants(form, imps).filter((_, i) => i !== Number(rm.dataset.impRemove));
      imps.splice(0, imps.length, ...kept);
      drawImps();
    }
    if (target.closest('[data-suggest-dates]')) {
      let surgery;
      try { surgery = readDate(form, 'startDate', true); } catch { return; }
      const upper = readImplants(form, imps).some((x) => x.tooth && isUpper(x.tooth));
      const s = suggestedDates(surgery, upper);
      for (const [name, iso] of [['sutureDate', s.sutureDate], ['loadingDate', s.loadingDate]]) {
        const input = /** @type {HTMLInputElement} */ (form.querySelector(`[name="${name}"]`));
        if (!input.value.trim()) input.value = isoToInput(iso);
      }
    }
  }, { signal });
}

/** Puts «تقويم» on the chosen arches (teeth that are there and not braced yet). */
async function placeBraces(patientId, arches) {
  const { state } = await getChart(patientId);
  const teeth = archTeeth('adult', arches === 'both' ? 'all' : arches, state).filter((x) => !state.get(x)?.braces);
  await recordToothEvents(patientId, teeth.map((tooth) => ({ tooth, type: 'add', condition: 'braces' })), { note: 'بداية التقويم' });
}

/* ---------- Start a case ---------- */

async function startCase(patient, type) {
  const memo = await remembered();
  const imps = [];
  const ac = new AbortController();
  let created = null;
  await openModal({
    title: tr`بدء ${CASE_TYPES[type].title} — ${patient.name}`, icon: 'tooth', size: 'lg',
    body: html`<form class="stack case-form" novalidate>${type === 'ortho' ? orthoPlanFields(null, memo, true) : implantPlanFields(null, memo, true, imps)}</form>`,
    actions: [{ label: 'حفظ وبدء الحالة', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    dirty: true,
    onOpen(d) { wirePlanForm(d.querySelector('form'), type, memo, imps, ac.signal); },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      try {
        const { placeBraces: braces, ...input } = readPlan(d.querySelector('form'), type, imps);
        created = await createCase(patient.id, type, { ...input.plan, startDate: input.startDate });
        if (input.implants?.length) created = await updateCase(created.id, { implants: input.implants });
        if (type === 'ortho' && braces) await placeBraces(patient.id, input.plan.arches || 'both');
        toastSuccess(tr`تم بدء ${CASE_TYPES[type].title}`);
        return true;
      } catch (err) { if (err?.name !== 'Error') toastError(err.message); return false; }
    },
  });
  ac.abort();
  return created;
}

/* ---------- Visits ---------- */

function orthoVisitFields(v, last, memo) {
  const x = v?.data ?? {};
  const wires = [...WIRES, ...memo('upperWire', 'lowerWire')];
  return html`
    ${dateField({ name: 'date', label: 'تاريخ الزيارة', value: v?.date ?? todayISO(), required: true })}
    <div class="form-grid">
      ${listField('upperWire', 'السلك العلوي', x.upperWire ?? last?.data?.upperWire, wires, { ltr: true })}
      ${listField('lowerWire', 'السلك السفلي', x.lowerWire ?? last?.data?.lowerWire, wires, { ltr: true })}
    </div>
    ${radioChips('chainWhere', 'Power chain', CHAIN_WHERE, x.chainWhere ?? '')}
    <div class="form-grid">
      ${selectField({ name: 'chainType', label: 'نوع الـ Power chain', value: x.chainType ?? '', placeholder: '—', options: opts(CHAIN_TYPE) })}
      ${textField({ name: 'chainTeeth', label: 'من سن إلى سن', value: x.chainTeeth ?? '', ltr: true, placeholder: '13-23' })}
    </div>
    <div class="form-grid">
      ${listField('elastics', 'الأستك (Elastics)', x.elastics, [...ELASTICS, ...memo('elastics')], { ltr: true, placeholder: 'بدون' })}
      ${listField('elasticSize', 'مقاس الأستك', x.elasticSize, ELASTIC_SIZE, { ltr: true })}
    </div>
    ${segmentedField({ name: 'elasticForce', label: 'قوة الأستك', value: x.elasticForce ?? '', options: opts(FORCE) })}
    <div class="form-grid">
      ${segmentedField({ name: 'coil', label: 'Coil spring', value: x.coil ?? '', options: opts(COIL) })}
      ${textField({ name: 'coilTeeth', label: 'مكان الـ Coil', value: x.coilTeeth ?? '', ltr: true })}
    </div>
    ${chipsField('done', 'تم في الزيارة', DONE, x.done)}
    ${segmentedField({ name: 'hygiene', label: 'نظافة الفم', value: x.hygiene ?? '', options: opts(HYGIENE) })}
    ${textareaField({ name: 'notes', label: 'ملاحظات', value: x.notes ?? '', rows: 2 })}
    <hr>
    ${chipsField('next', 'المطلوب الزيارة القادمة', NEXT, x.next)}
    <div class="form-grid">
      ${textField({ name: 'nextNotes', label: 'تفاصيل الزيارة القادمة', value: x.nextNotes ?? '' })}
      ${selectField({ name: 'nextWeeks', label: 'موعد الزيارة القادمة', value: String(x.nextWeeks ?? 4), placeholder: '—', options: WEEKS.map((w) => ({ value: String(w), label: weeksLater(w) })) })}
    </div>`;
}

function implantVisitFields(v, c) {
  const x = v?.data ?? {};
  const teeth = (c.implants ?? []).map((i) => i.tooth).filter(Boolean);
  return html`
    <div class="form-grid">
      ${dateField({ name: 'date', label: 'تاريخ الزيارة', value: v?.date ?? todayISO(), required: true })}
      ${selectField({ name: 'kind', label: 'نوع الزيارة', value: x.kind ?? 'check', options: opts(IMPLANT_VISITS) })}
    </div>
    ${teeth.length ? chipsField('teeth', 'الزرعات المعنية', teeth.map((n) => [String(n), String(n)]), x.teeth ?? []) : ''}
    ${textareaField({ name: 'notes', label: 'ما تم في الزيارة', value: x.notes ?? '', rows: 3 })}
    <div class="form-grid">
      ${textField({ name: 'nextNotes', label: 'الخطوة القادمة', value: x.nextNotes ?? '' })}
      ${selectField({ name: 'nextWeeks', label: 'موعد الزيارة القادمة', value: String(x.nextWeeks ?? ''), placeholder: '—', options: [1, 2, 3, 4, 6, 8, 12].map((w) => ({ value: String(w), label: weeksLater(w) })) })}
    </div>`;
}

async function visitForm(c, visit, last) {
  const memo = await remembered();
  const ac = new AbortController();
  let saved = null;
  await openModal({
    title: visit ? 'تعديل الزيارة' : 'زيارة جديدة', icon: 'calendar-check', size: 'lg',
    body: html`<form class="stack case-form" novalidate>${c.type === 'ortho' ? orthoVisitFields(visit, last, memo) : implantVisitFields(visit, c)}</form>`,
    actions: [{ label: 'حفظ الزيارة', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    dirty: true,
    onOpen(d) { enhanceDateFields(d.querySelector('form'), ac.signal); },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const form = d.querySelector('form');
      try {
        const date = readDate(form, 'date', true);
        const { date: _, ...data } = formData(form);
        if (data.nextWeeks) data.nextWeeks = Number(data.nextWeeks);
        saved = await saveVisit(c.id, { id: visit?.id, date, data });
        toastSuccess('تم حفظ الزيارة');
        return true;
      } catch (err) { if (err?.name !== 'Error') toastError(err.message); return false; }
    },
  });
  ac.abort();
  return saved;
}

/** Short lines describing a visit. */
function visitSummary(c, v) {
  const x = v.data ?? {};
  const lines = [];
  if (c.type === 'ortho') {
    // <bdi> keeps «NiTi 0.016×0.022» in one piece inside the Arabic line
    const wires = [x.upperWire && html`${'علوي'} <bdi>${keep(x.upperWire)}</bdi>`, x.lowerWire && html`${'سفلي'} <bdi>${keep(x.lowerWire)}</bdi>`].filter(Boolean);
    if (wires.length) lines.push(html`<span class="muted">السلك:</span> ${wires.map((w, i) => html`${i ? ' · ' : ''}${w}`)}`);
    if (x.chainWhere) lines.push(html`<span class="muted"><bdi>Power chain</bdi>:</span> ${label(CHAIN_WHERE, x.chainWhere)}${x.chainType ? html` · <bdi>${label(CHAIN_TYPE, x.chainType)}</bdi>` : ''}${x.chainTeeth ? html` · <span class="ltr">${keep(x.chainTeeth)}</span>` : ''}`);
    if (x.elastics) lines.push(html`<span class="muted">الأستك:</span> <bdi>${keep(`${x.elastics}${x.elasticSize ? ` ${x.elasticSize}` : ''}`)}</bdi>${x.elasticForce ? html` · ${label(FORCE, x.elasticForce)}` : ''}`);
    if (x.coil) lines.push(html`<span class="muted">Coil:</span> ${label(COIL, x.coil)}${x.coilTeeth ? html` · <span class="ltr">${keep(x.coilTeeth)}</span>` : ''}`);
    if (x.done?.length) lines.push(html`<span class="muted">تم:</span> ${labels(DONE, x.done)}`);
    if (x.hygiene) lines.push(html`<span class="muted">نظافة الفم:</span> ${label(HYGIENE, x.hygiene)}`);
  } else {
    lines.push(html`<strong>${label(IMPLANT_VISITS, x.kind)}</strong>${x.teeth?.length ? html` · <span class="ltr">${x.teeth.join(' ')}</span>` : ''}`);
  }
  if (x.notes) lines.push(html`<span style="white-space: pre-line">${keep(x.notes)}</span>`);
  const next = c.type === 'ortho' && x.next?.length ? labels(NEXT, x.next) : '';
  if (next || x.nextNotes || x.nextWeeks) lines.push(html`<span class="muted">القادم:</span> ${next}${next && x.nextNotes ? ' — ' : ''}${x.nextNotes ? keep(x.nextNotes) : ''}${x.nextWeeks ? ` (${weeksLater(x.nextWeeks).toLowerCase()})` : ''}`);
  return lines;
}

/* ---------- The case file ---------- */

async function openCaseFile(patient, caseId) {
  const canEdit = can('treatment', 'edit');
  let c = await getCase(caseId);
  let visits = await listVisits(caseId);
  const memo = await remembered();
  let imps = [...(c.implants ?? [])];
  let planDirty = false;
  const ac = new AbortController();

  const visitsView = () => html`
    <div class="row row--between">
      <span class="muted text-sm">${visits.length ? tr`عدد الزيارات: ${digits(visits.length)}` : 'لا توجد زيارات بعد'}</span>
      ${canEdit ? html`<button type="button" class="btn btn--primary btn--sm" data-visit-new>${ico('plus', { size: 16 })} زيارة جديدة</button>` : ''}
    </div>
    ${visits.length ? html`<ol class="case-visits">${visits.map((v, i) => html`
      <li class="case-visit">
        <div class="row row--between case-visit__head">
          <strong>${tr`الزيارة ${digits(visits.length - i)}`} · ${formatDate(v.date)}</strong>
          ${canEdit ? html`<span class="row" style="gap: var(--sp-1)">
            <button type="button" class="btn btn--ghost btn--icon btn--sm" data-visit-edit="${v.id}" aria-label="تعديل الزيارة">${ico('pencil', { size: 16 })}</button>
            <button type="button" class="btn btn--ghost btn--icon btn--sm" data-visit-delete="${v.id}" aria-label="حذف الزيارة">${ico('trash-2', { size: 16 })}</button></span>` : ''}
        </div>
        <div class="case-visit__body">${visitSummary(c, v).map((l) => html`<div>${l}</div>`)}</div>
        ${i === 0 && v.data?.nextWeeks && can('appointments', 'create') ? html`<button type="button" class="btn btn--soft btn--sm" data-book-next="${v.id}">${ico('calendar-check', { size: 16 })} حجز الموعد القادم (${formatDate(nextDate(v))})</button>` : ''}
      </li>`)}</ol>` : html`<p class="muted">${canEdit ? 'سجّل كل زيارة: ما تم فيها والمطلوب في الزيارة القادمة.' : ''}</p>`}`;

  const planView = () => html`
    <form class="stack case-form" id="case-plan" novalidate>
      ${c.type === 'ortho' ? orthoPlanFields(c, memo, false) : implantPlanFields(c, memo, false, imps)}
      ${canEdit ? html`<div class="row row--between">
        <button type="submit" class="btn btn--primary">${ico('save', { size: 18 })} حفظ الخطة</button>
        <button type="button" class="btn btn--ghost btn--sm" data-case-delete>${ico('trash-2', { size: 16 })} حذف الملف</button>
      </div>` : ''}
    </form>`;

  const nextDate = (v) => { const d = addDays(v.date, v.data.nextWeeks * 7); return d < todayISO() ? todayISO() : d; };

  await openModal({
    title: tr`${CASE_TYPES[c.type].title} — ${patient.name}`, icon: 'tooth', size: 'lg',
    body: html`
      <div class="stack case-file">
        <div class="segmented case-tabs" role="tablist">
          <label><input type="radio" name="case-tab" value="visits" checked><span>الزيارات</span></label>
          <label><input type="radio" name="case-tab" value="plan"><span>تفاصيل الخطة</span></label>
        </div>
        <div id="case-visits-pane">${visitsView()}</div>
        <div id="case-plan-pane" hidden>${planView()}</div>
      </div>`,
    actions: [{ label: 'إغلاق', value: null }],
    dirty: () => planDirty,
    onOpen(d, close) {
      const pane = (name) => /** @type {HTMLElement} */ (d.querySelector(`#case-${name}-pane`));
      const form = () => /** @type {HTMLFormElement} */ (d.querySelector('#case-plan'));
      const redrawVisits = async () => { visits = await listVisits(caseId); render(pane('visits'), visitsView()); };
      wirePlanForm(form(), c.type, memo, imps, ac.signal);
      if (!canEdit) form().querySelectorAll('input, select, textarea, button').forEach((x) => { /** @type {HTMLInputElement} */ (x).disabled = true; });

      d.addEventListener('change', (e) => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        if (target.name === 'case-tab') { pane('visits').hidden = target.value !== 'visits'; pane('plan').hidden = target.value !== 'plan'; return; }
        if (target.closest('#case-plan')) planDirty = true;
      }, { signal: ac.signal });
      d.addEventListener('input', (e) => { if (/** @type {HTMLElement} */ (e.target).closest('#case-plan')) planDirty = true; }, { signal: ac.signal });

      d.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const { placeBraces: _, ...input } = readPlan(form(), c.type, imps);
          c = await updateCase(c.id, input);
          imps.splice(0, imps.length, ...(c.implants ?? []));
          planDirty = false;
          toastSuccess('تم حفظ الخطة');
          render(pane('visits'), visitsView()); // summaries depend on the implants
        } catch (err) { if (err?.name !== 'Error') toastError(err.message); }
      }, { signal: ac.signal });

      d.addEventListener('click', async (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('[data-visit-new]')) { if (await visitForm(c, null, visits[0])) await redrawVisits(); return; }
        const edit = target.closest('[data-visit-edit]');
        if (edit) { if (await visitForm(c, visits.find((v) => v.id === edit.dataset.visitEdit), null)) await redrawVisits(); return; }
        const del = target.closest('[data-visit-delete]');
        if (del) {
          if (!(await confirmDialog({ title: 'حذف الزيارة؟', message: 'ستُحذف تفاصيل هذه الزيارة من الملف.', confirmLabel: 'حذف', danger: true }))) return;
          await deleteVisit(del.dataset.visitDelete);
          toastSuccess('تم حذف الزيارة');
          await redrawVisits();
          return;
        }
        const book = target.closest('[data-book-next]');
        if (book) {
          const v = visits.find((x) => x.id === book.dataset.bookNext);
          const { openAppointmentForm } = await import('../appointments/appt-form.js');
          openAppointmentForm({ patientId: patient.id, date: nextDate(v) });
          return;
        }
        if (target.closest('[data-case-delete]')) {
          if (!(await confirmDialog({ title: tr`حذف ${CASE_TYPES[c.type].title}؟`, message: 'ستُحذف الخطة وكل الزيارات المسجلة فيه.', confirmLabel: 'حذف الملف', danger: true }))) return;
          await deleteCase(c.id);
          toastSuccess('تم حذف الملف');
          planDirty = false;
          close(null);
        }
      }, { signal: ac.signal });
    },
  });
  ac.abort();
}

/* ---------- Entry point ---------- */

/** The patient's ortho / implant cases; start a new one or open one. */
export async function openCases(patient, { open, start } = {}) {
  if (start) { const c = await startCase(patient, start); if (c) await openCaseFile(patient, c.id); }
  else if (open) await openCaseFile(patient, open);
  if (start || open) return;
  for (;;) {
    const cases = await listCases(patient.id);
    const counts = new Map(await Promise.all(cases.map(async (c) => [c.id, (await repos.caseVisits.findBy('caseId', c.id)).length])));
    const canEdit = can('treatment', 'edit');
    const choice = await openModal({
      title: tr`التقويم والزراعة — ${patient.name}`, icon: 'tooth',
      body: html`
        <div class="stack">
          ${cases.length ? html`<ul class="case-list">${cases.map((c) => html`
            <li><button type="button" class="case-row" data-case-open="${c.id}">
              <span class="case-row__icon" data-type="${c.type}">${ico('tooth', { size: 18 })}</span>
              <span class="case-row__text"><strong>${CASE_TYPES[c.type].title}</strong>
                <span class="muted text-sm">${tr`من ${formatDate(c.startDate)}`} · ${tr`عدد الزيارات: ${digits(counts.get(c.id) ?? 0)}`}</span></span>
              <span class="badge ${CASE_STATUS[c.status]?.tone ? `badge--${CASE_STATUS[c.status].tone}` : ''}">${CASE_STATUS[c.status]?.label ?? c.status}</span>
            </button></li>`)}</ul>` : html`<p class="muted">لا توجد ملفات تقويم أو زراعة لهذا المريض.</p>`}
          ${canEdit ? html`<div class="row">
            <button type="button" class="btn btn--primary btn--sm" data-case-start="ortho">${ico('plus', { size: 16 })} بدء حالة تقويم</button>
            <button type="button" class="btn btn--primary btn--sm" data-case-start="implant">${ico('plus', { size: 16 })} بدء حالة زراعة</button>
          </div>` : ''}
        </div>`,
      actions: [{ label: 'إغلاق', value: null }],
      onOpen(d, close) {
        d.addEventListener('click', (e) => {
          const b = /** @type {HTMLElement} */ (e.target).closest('[data-case-open], [data-case-start]');
          if (b) close(b.dataset.caseOpen ? { open: b.dataset.caseOpen } : { start: b.dataset.caseStart });
        });
      },
    });
    if (!choice) return;
    await openCases(patient, choice);
  }
}

/** True when the patient has no open case of this type (to offer starting one). */
export async function noOpenCase(patientId, type) {
  return !(await listCases(patientId)).some((c) => c.type === type && isOpen(c));
}
