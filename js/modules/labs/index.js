/** Lab cases: sent → received → try-in → cemented; overdue alerts; lab cost → expenses. */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { formatMoney, toPiasters, piastersToInput, formatDate, digits, todayISO, parseDateInput } from '../../core/format.js';
import { addDays } from '../../core/time.js';
import { LAB_STATUS, LAB_WORK_TYPES } from '../../core/labels.js';
import { parseTeeth } from '../../core/teeth.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { mountTable } from '../../components/table.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textField, selectField, textareaField } from '../../components/form.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { searchPatients, getPatient } from '../../services/patients.js';
import { listItems as listTreatmentItems } from '../../services/treatment.js';
import { listLabCases, createLabCase, updateLabCase, setLabStatus, deleteLabCase, knownLabs, isOverdue, LAB_FLOW } from '../../services/labs.js';
import { patientAvatar } from '../patients/list.js';

const NEXT = { sent: ['received', 'استلام من المعمل'], received: ['try_in', 'تمت التجربة'], try_in: ['cemented', 'تم التركيب'] };

/** Guesses the work type from a procedure name. */
const workTypeFor = (name = '') => (/كوبري/.test(name) ? 'bridge' : /فينير/.test(name) ? 'veneer' : /طقم/.test(name) ? 'denture' : /حافظ مسافة/.test(name) ? 'space_maintainer' : /كراون|تاج/.test(name) ? 'crown' : 'other');

export const labSteps = (c) => html`<span class="lab-steps">${LAB_FLOW.map((s) => {
  const idx = LAB_FLOW.indexOf(c.status), i = LAB_FLOW.indexOf(s);
  return html`<span class="lab-step" ${c.status !== 'cancelled' && i < idx ? html`data-done` : ''} ${s === c.status ? html`data-current` : ''}>${LAB_STATUS[s].label.replace('استُلم من المعمل', 'استُلم')}</span>`;
})}</span>`;

/**
 * New / edit lab case.
 * @param {{ labCase?: object, patientId?: string, treatmentItemId?: string }} [preset]
 */
export async function labCaseDialog(preset = {}) {
  const editing = preset.labCase ?? null;
  const labs = await knownLabs();
  const st = { patient: null, items: [] };
  const setPatient = async (id) => {
    st.patient = id ? await getPatient(id) : null;
    st.items = st.patient ? (await listTreatmentItems(st.patient.id)).filter((i) => i.needsLab && i.status !== 'cancelled') : [];
  };
  await setPatient(editing?.patientId ?? preset.patientId ?? null);
  const linked = st.items.find((i) => i.id === (editing?.treatmentItemId ?? preset.treatmentItemId));
  let saved = null;

  const patientBox = () => (st.patient ? html`
    <div class="appt-patient">${patientAvatar(st.patient)}<div class="grow"><strong>${st.patient.name}</strong><div class="muted text-sm ltr">${st.patient.fileNo}</div></div>
      ${editing || preset.patientId ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-change>تغيير</button>`}</div>
    ${st.items.length ? selectField({ name: 'treatmentItemId', label: 'من خطة العلاج', value: editing?.treatmentItemId ?? preset.treatmentItemId ?? '', placeholder: 'بدون ربط', options: st.items.map((i) => ({ value: i.id, label: `${i.procedureName}${i.teeth?.length ? ` (${i.teeth.join(',')})` : ''}` })) }) : ''}`
    : html`<div class="field"><label class="field__label" for="lab-ps">المريض<span class="req">*</span></label>
      <div class="input-group">${ico('search', { size: 20 })}<input class="input" id="lab-ps" autocomplete="off" placeholder="ابحث بالاسم أو الموبايل…"></div>
      <ul class="gsearch__list" id="lab-pr" style="position: static; box-shadow:none; padding:0; margin-block-start: var(--sp-2)" hidden></ul></div>`);

  await openModal({
    title: editing ? 'تعديل حالة المعمل' : 'إرسال حالة للمعمل',
    icon: 'flask-conical',
    size: 'lg',
    body: html`
      <form class="form" novalidate>
        <div id="lab-patient" class="stack-sm">${patientBox()}</div>
        <div class="form-grid">
          ${textField({ name: 'labName', label: 'اسم المعمل', value: editing?.labName ?? labs[0] ?? '', required: true, attrs: html`list="dl-labs"` })}
          ${selectField({ name: 'workType', label: 'نوع العمل', value: editing?.workType ?? workTypeFor(linked?.procedureName), options: Object.entries(LAB_WORK_TYPES).map(([value, label]) => ({ value, label })) })}
        </div>
        <div class="form-grid">
          ${textField({ name: 'teeth', label: 'الأسنان', value: (editing?.teeth ?? linked?.teeth ?? []).join(', '), ltr: true, placeholder: '11, 21' })}
          ${textField({ name: 'shade', label: 'اللون (Shade)', value: editing?.shade ?? '', ltr: true, placeholder: 'A2' })}
          ${textField({ name: 'material', label: 'الخامة', value: editing?.material ?? '', placeholder: 'زيركون، إيماكس…' })}
        </div>
        <div class="form-grid">
          ${dateField({ name: 'sentAt', label: 'تاريخ الإرسال', value: editing?.sentAt ?? todayISO() })}
          ${dateField({ name: 'expectedAt', label: 'الاستلام المتوقع', value: editing?.expectedAt ?? addDays(todayISO(), 7) })}
          ${textField({ name: 'cost', label: 'تكلفة المعمل (ج.م)', value: editing?.cost ? piastersToInput(editing.cost) : '', ltr: true, inputmode: 'decimal' })}
        </div>
        <label class="check"><input type="checkbox" name="recordCost" ${editing?.recordCost === false ? '' : 'checked'}> تسجيل التكلفة في المصروفات (مصاريف المعمل)</label>
        ${textareaField({ name: 'notes', label: 'ملاحظات للمعمل', value: editing?.notes ?? '', rows: 2 })}
        <datalist id="dl-labs">${labs.map((l) => html`<option value="${l}"></option>`)}</datalist>
      </form>`,
    actions: [{ label: editing ? 'حفظ' : 'تسجيل الإرسال', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      enhanceDateFields(f);
      const wire = () => {
        const input = /** @type {HTMLInputElement} */ (f.querySelector('#lab-ps'));
        if (!input) return;
        let t;
        input.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const list = f.querySelector('#lab-pr');
            const found = input.value.trim() ? await searchPatients(input.value, { limit: 6 }) : [];
            render(list, found.length ? html`${found.map((p) => html`<li class="gsearch__item" data-pick="${p.id}">${patientAvatar(p)}<span class="gsearch__text"><strong>${p.name}</strong><span class="gsearch__sub ltr">${p.fileNo}</span></span></li>`)}` : html`<li class="gsearch__empty">لا يوجد مريض مطابق</li>`);
            list.hidden = !input.value.trim();
          }, 120);
        });
        input.focus();
      };
      wire();
      f.addEventListener('click', async (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const pick = t.closest('[data-pick]');
        if (pick) { await setPatient(pick.dataset.pick); render(f.querySelector('#lab-patient'), patientBox()); }
        if (t.closest('[data-change]')) { await setPatient(null); render(f.querySelector('#lab-patient'), patientBox()); wire(); }
      });
      f.addEventListener('change', (e) => {
        const t = /** @type {HTMLSelectElement} */ (e.target);
        if (t.name !== 'treatmentItemId') return;
        const it = st.items.find((i) => i.id === t.value);
        if (!it) return;
        /** @type {HTMLInputElement} */ (f.querySelector('[name=teeth]')).value = (it.teeth ?? []).join(', ');
        /** @type {HTMLSelectElement} */ (f.querySelector('[name=workType]')).value = workTypeFor(it.procedureName);
      });
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const data = formData(f);
      const errors = {};
      if (!st.patient) { toastError('اختر المريض'); return false; }
      if (!data.labName.trim()) errors.labName = 'اكتب اسم المعمل';
      const sentAt = parseDateInput(data.sentAt), expectedAt = data.expectedAt ? parseDateInput(data.expectedAt) : null;
      if (!sentAt) errors.sentAt = 'تاريخ غير صحيح';
      if (data.expectedAt && !expectedAt) errors.expectedAt = 'تاريخ غير صحيح';
      const cost = data.cost ? toPiasters(data.cost) : 0;
      if (Number.isNaN(cost)) errors.cost = 'مبلغ غير صحيح';
      if (!showFieldErrors(f, errors)) return false;
      const input = { patientId: st.patient.id, patientName: st.patient.name, treatmentItemId: data.treatmentItemId || null, labName: data.labName, workType: data.workType, teeth: parseTeeth(data.teeth), shade: data.shade, material: data.material, sentAt, expectedAt, cost, notes: data.notes };
      try {
        saved = editing ? await updateLabCase(editing.id, input, { recordCost: !!data.recordCost }) : await createLabCase(input, { recordCost: !!data.recordCost });
        return true;
      } catch (err) { toastError(err.message); return false; }
    },
  });
  if (saved) toastSuccess(editing ? 'تم الحفظ' : 'تم تسجيل إرسال الحالة للمعمل');
  return saved;
}

export default {
  title: 'معامل التركيبات',
  async render({ el, query, signal }) {
    const perm = { create: can('labs', 'create'), edit: can('labs', 'edit'), del: can('labs', 'delete') };
    let filter = query.filter ?? 'open';
    let cases = [];
    render(el, html`
      <header class="page-header">
        <div class="page-header__text"><h1 class="page-header__title">معامل التركيبات</h1><p class="page-header__sub">متابعة الكراون والكباري والفينير والأطقم مع المعامل</p></div>
        <div class="page-header__actions">${perm.create ? html`<button type="button" class="btn btn--primary" data-new>${ico('plus')} إرسال حالة</button>` : ''}</div>
      </header>
      <div class="chips" id="lab-chips" style="margin-block-end: var(--sp-4)"></div>
      <div id="tbl"></div>`);

    const groups = () => ({
      open: cases.filter((c) => c.status !== 'cemented' && c.status !== 'cancelled'),
      overdue: cases.filter((c) => isOverdue(c)),
      sent: cases.filter((c) => c.status === 'sent'),
      back: cases.filter((c) => c.status === 'received' || c.status === 'try_in'),
      done: cases.filter((c) => c.status === 'cemented'),
      all: cases,
    });
    const LABELS = { open: 'الجارية', overdue: 'متأخرة', sent: 'في المعمل', back: 'وصلت العيادة', done: 'تم التركيب', all: 'الكل' };

    const draw = () => {
      const g = groups();
      render(el.querySelector('#lab-chips'), html`${Object.keys(LABELS).map((k) => html`<button type="button" class="chip" data-filter="${k}" aria-pressed="${String(k === filter)}">${k === 'overdue' ? ico('triangle-alert', { size: 16 }) : ''}${LABELS[k]} <span class="chip__count">${digits(g[k].length)}</span></button>`)}`);
      mountTable(el.querySelector('#tbl'), {
        signal, caption: 'حالات المعمل', rows: g[filter],
        empty: { icon: 'flask-conical', title: filter === 'overdue' ? 'لا توجد حالات متأخرة 🎉' : 'لا توجد حالات', hint: 'سجّل كل شغل يُرسل للمعمل لتتابع موعد رجوعه وتكلفته.' },
        columns: [
          { key: 'patient', label: 'المريض', render: (c) => html`<a href="${href('/patients/:id', { id: c.patientId })}">${c.patientName}</a>` },
          { key: 'work', label: 'العمل', render: (c) => html`<strong>${LAB_WORK_TYPES[c.workType]}</strong>${c.teeth?.length ? html` <span class="ltr subtle">${c.teeth.join(',')}</span>` : ''}${c.shade ? html` · <span class="ltr">${c.shade}</span>` : ''}${c.material ? html`<br><span class="muted text-sm">${c.material}</span>` : ''}` },
          { key: 'lab', label: 'المعمل', render: (c) => c.labName },
          { key: 'dates', label: 'الإرسال / المتوقع', render: (c) => html`${formatDate(c.sentAt)}<br><span class="${isOverdue(c) ? '' : 'muted'} text-sm">${c.expectedAt ? formatDate(c.expectedAt) : '—'}</span> ${isOverdue(c) ? html`<span class="badge badge--danger">متأخر</span>` : ''}` },
          { key: 'status', label: 'المرحلة', render: (c) => (c.status === 'cancelled' ? html`<span class="badge">ملغي</span>` : labSteps(c)) },
          { key: 'cost', label: 'التكلفة', num: true, render: (c) => (c.cost ? formatMoney(c.cost) : '—') },
          { key: 'a', label: '', render: (c) => html`<div class="table__actions">
            ${perm.edit && NEXT[c.status] ? html`<button type="button" class="btn btn--soft btn--sm" data-next="${c.id}">${NEXT[c.status][1]}</button>` : ''}
            ${perm.edit || perm.del ? html`<button type="button" class="btn btn--icon btn--sm" data-menu="${c.id}" aria-label="خيارات" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}</div>` },
        ],
      });
    };
    const load = async () => { cases = await listLabCases(); draw(); };

    on(el, 'click', '[data-filter]', (_, b) => { filter = b.dataset.filter; draw(); }, { signal });
    on(el, 'click', '[data-new]', () => labCaseDialog(), { signal });
    on(el, 'click', '[data-next]', async (_, b) => { const c = cases.find((x) => x.id === b.dataset.next); await setLabStatus(c.id, NEXT[c.status][0]); toastSuccess(`${c.patientName}: ${LAB_STATUS[NEXT[c.status][0]].label}`); }, { signal });
    on(el, 'click', '[data-menu]', (_, b) => {
      const c = cases.find((x) => x.id === b.dataset.menu);
      const idx = LAB_FLOW.indexOf(c.status);
      openMenu(b, { items: [
        ...(perm.edit ? [{ label: 'تعديل', icon: 'pencil', onSelect: () => labCaseDialog({ labCase: c }) }] : []),
        ...(perm.edit && idx > 0 ? [{ label: `رجوع إلى «${LAB_STATUS[LAB_FLOW[idx - 1]].label}»`, icon: 'refresh-cw', onSelect: () => setLabStatus(c.id, LAB_FLOW[idx - 1]) }] : []),
        ...(perm.edit && c.status !== 'cancelled' && c.status !== 'cemented' ? [{ label: 'إلغاء الحالة', icon: 'circle-x', onSelect: async () => { if (await confirmDialog({ title: 'إلغاء الحالة؟', message: 'يُحذف مصروفها المرتبط من المصروفات.', confirmLabel: 'إلغاء الحالة', danger: true })) setLabStatus(c.id, 'cancelled'); } }] : []),
        ...(perm.edit && c.status === 'cancelled' ? [{ label: 'إعادة فتح', icon: 'refresh-cw', onSelect: () => setLabStatus(c.id, 'sent') }] : []),
        ...(perm.del ? ['sep', { label: 'حذف', icon: 'trash-2', danger: true, onSelect: async () => { if (await confirmDialog({ title: 'حذف الحالة؟', message: c.patientName, confirmLabel: 'حذف', danger: true })) { await deleteLabCase(c.id); toastSuccess('تم الحذف'); } } }] : []),
      ] });
    }, { signal });

    const off = onEvent('data:changed', ({ store }) => { if (store === 'labCases') load(); });
    await load();
    return off;
  },
};
