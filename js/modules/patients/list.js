/** Patients list: fast search (name / phone / file no), filters, sorting, trash. */
import { html, ico, render, on } from '../../core/dom.js';
import { initials } from '../../core/text.js';
import { formatDate, digits, formatAge, arabicCount, todayISO, toISODate } from '../../core/format.js';
import { toWhatsAppNumber } from '../../core/validate.js';
import { REFERRAL_SOURCES, GENDER_LABELS } from '../../core/labels.js';
import { medicalAlerts } from '../../core/medical.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { mountTable } from '../../components/table.js';
import { confirmDialog } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { allPatients, searchPatients, restorePatient, ageYears } from '../../services/patients.js';

const PAGE = 100;
const PATIENT_COUNT = { one: 'مريض واحد', two: 'مريضان', few: 'مرضى', many: 'مريضًا' };

export const patientAvatar = (p, cls = '') => (p.photo
  ? html`<span class="avatar ${cls}"><img src="${p.photo}" alt=""></span>`
  : html`<span class="avatar ${cls} ${p.gender === 'female' ? 'avatar--c-danger' : 'avatar--c-info'}">${initials(p.name) || ico('user', { size: 22 })}</span>`);

export default {
  title: 'المرضى',
  async render({ el, query, signal }) {
    const state = {
      q: query.q ?? '',
      filter: query.filter ?? 'all',
      source: query.source ?? '',
      sort: query.sort ?? 'newest',
      shown: PAGE,
    };
    const canCreate = can('patients', 'create');
    const canDelete = can('patients', 'delete');

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">المرضى</h1>
          <p class="page-header__sub" id="pcount"></p>
        </div>
        <div class="page-header__actions">
          ${can('patients', 'export') ? html`<button type="button" class="btn" data-export>${ico('file-spreadsheet')} Excel</button>` : ''}
          ${canCreate ? html`<a class="btn btn--primary" href="#/patients/new">${ico('user-plus')} مريض جديد</a>` : ''}
        </div>
      </header>
      <div class="toolbar">
        <div class="input-group toolbar__search">${ico('search', { size: 20 })}
          <input class="input input--pill" type="search" id="psearch" value="${state.q}" placeholder="الاسم أو الموبايل أو رقم الملف…" aria-label="بحث في المرضى" autocomplete="off">
        </div>
        <select class="select input--pill" id="psource" aria-label="مصدر المعرفة" style="inline-size:auto; min-inline-size: 170px">
          <option value="">كل المصادر</option>
          ${Object.entries(REFERRAL_SOURCES).map(([k, v]) => html`<option value="${k}" ${state.source === k ? 'selected' : ''}>${v}</option>`)}
        </select>
        <select class="select input--pill" id="psort" aria-label="الترتيب" style="inline-size:auto; min-inline-size: 170px">
          <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>الأحدث تسجيلًا</option>
          <option value="name" ${state.sort === 'name' ? 'selected' : ''}>الاسم (أ–ي)</option>
          <option value="file" ${state.sort === 'file' ? 'selected' : ''}>رقم الملف</option>
        </select>
      </div>
      <div class="chips" role="group" aria-label="تصفية" style="margin-block-end: var(--sp-4)">
        ${[['all', 'الكل'], ['alerts', 'لديهم تنبيه طبي'], ['children', 'أطفال (أقل من 14)'], ['female', 'إناث'], ['male', 'ذكور'],
          ...(canDelete ? [['trash', 'المحذوفون']] : [])].map(([k, label]) => html`
          <button type="button" class="chip" data-filter="${k}" aria-pressed="${String(state.filter === k)}">${k === 'trash' ? ico('trash-2', { size: 16 }) : ''}${label}</button>`)}
      </div>
      <div id="ptable"></div>
      <div class="row" style="justify-content:center; margin-block-start: var(--sp-4)"><button type="button" class="btn" id="pmore" hidden>عرض المزيد</button></div>`);

    const table = mountTable(el.querySelector('#ptable'), {
      signal,
      caption: 'قائمة المرضى',
      rows: [],
      rowHref: (p) => (p.deletedAt ? '' : href('/patients/:id', { id: p.id })),
      empty: { icon: 'users', title: 'لا يوجد مرضى مطابقون', hint: 'جرّب كلمة بحث أخرى، أو أضف مريضًا جديدًا.', actions: canCreate ? html`<a class="btn btn--primary" href="#/patients/new">${ico('user-plus')} مريض جديد</a>` : '' },
      columns: [
        { key: 'name', label: 'المريض', render: (p) => html`
          <span class="cell-person">${patientAvatar(p)}
            <span class="cell-person__text"><strong>${p.name}</strong><span class="cell-person__sub ltr num">${digits(p.fileNo)}</span></span>
          </span>` },
        { key: 'phone', label: 'الموبايل', render: (p) => (p.phone ? html`
          <span class="row" style="gap: var(--sp-2); flex-wrap: nowrap">
            <span class="ltr num">${digits(p.phone)}</span>
            ${toWhatsAppNumber(p.phone) ? html`<a class="btn btn--whatsapp btn--icon btn--sm" href="https://wa.me/${toWhatsAppNumber(p.phone)}" target="_blank" rel="noopener" aria-label="واتساب ${p.name}">${ico('message-circle', { size: 18 })}</a>` : ''}
          </span>` : html`<span class="muted">—</span>`) },
        { key: 'age', label: 'العمر', render: (p) => html`${p.dob ? formatAge(p.dob) : '—'}${p.dobEstimated ? html` <span class="subtle text-sm">تقريبًا</span>` : ''}${p.gender ? html` · <span class="muted">${GENDER_LABELS[p.gender]}</span>` : ''}` },
        { key: 'alerts', label: 'تنبيهات', render: (p) => {
          const a = medicalAlerts(p);
          if (a.critical.length) return html`<span class="badge badge--danger" title="${a.critical.join('، ')}">${ico('triangle-alert', { size: 14 })} ${a.critical[0]}${a.critical.length > 1 ? ` +${digits(a.critical.length - 1)}` : ''}</span>`;
          if (a.caution.length) return html`<span class="badge badge--warning" title="${a.caution.join('، ')}">${a.caution[0]}</span>`;
          return html`<span class="subtle">—</span>`;
        } },
        { key: 'source', label: 'المصدر', render: (p) => REFERRAL_SOURCES[p.referralSource] ?? html`<span class="subtle">—</span>` },
        { key: 'createdAt', label: 'تاريخ التسجيل', render: (p) => (p.deletedAt
          ? html`<button type="button" class="btn btn--soft btn--sm" data-restore="${p.id}">${ico('refresh-cw', { size: 16 })} استعادة</button>`
          : formatDate(p.createdAt)) },
      ],
    });

    const syncUrl = () => {
      const q = Object.fromEntries(Object.entries({ q: state.q, filter: state.filter === 'all' ? '' : state.filter, source: state.source, sort: state.sort === 'newest' ? '' : state.sort }).filter(([, v]) => v));
      history.replaceState(history.state, '', href('/patients', {}, Object.keys(q).length ? q : undefined));
    };

    let current = [];
    const refresh = async () => {
      let rows = state.filter === 'trash'
        ? (await allPatients({ includeDeleted: true })).filter((p) => p.deletedAt)
        : await allPatients();
      if (state.filter === 'alerts') rows = rows.filter((p) => medicalAlerts(p).critical.length || medicalAlerts(p).caution.length);
      if (state.filter === 'children') rows = rows.filter((p) => { const a = ageYears(p); return a !== null && a < 14; });
      if (state.filter === 'female' || state.filter === 'male') rows = rows.filter((p) => p.gender === state.filter);
      if (state.source) rows = rows.filter((p) => p.referralSource === state.source);
      if (state.q.trim()) {
        rows = await searchPatients(state.q, { list: rows, limit: 5000 });
      } else {
        const cmp = {
          newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
          name: (a, b) => a.name.localeCompare(b.name, 'ar'),
          file: (a, b) => a.fileNo.localeCompare(b.fileNo),
        }[state.sort];
        rows = [...rows].sort(cmp);
      }
      current = rows;
      table.update(rows.slice(0, state.shown));
      el.querySelector('#pmore').hidden = rows.length <= state.shown;
      el.querySelector('#pcount').textContent = rows.length ? arabicCount(rows.length, PATIENT_COUNT) : 'لا يوجد مرضى';
      syncUrl();
    };

    let t;
    el.querySelector('#psearch').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = /** @type {HTMLInputElement} */ (e.target).value; state.shown = PAGE; refresh(); }, 120);
    }, { signal });
    el.querySelector('#psource').addEventListener('change', (e) => { state.source = /** @type {HTMLSelectElement} */ (e.target).value; refresh(); }, { signal });
    el.querySelector('#psort').addEventListener('change', (e) => { state.sort = /** @type {HTMLSelectElement} */ (e.target).value; refresh(); }, { signal });
    el.querySelector('#pmore').addEventListener('click', () => { state.shown += PAGE; refresh(); }, { signal });
    on(el, 'click', '[data-export]', async (_, b) => {
      b.disabled = true;
      try {
        const { exportExcel } = await import('../../components/export.js');
        await exportExcel({
          fileName: `ganah-patients-${todayISO()}`, title: 'قائمة المرضى', subtitle: el.querySelector('#pcount').textContent,
          sheets: [{ name: 'المرضى', rows: current, columns: [
            { header: 'رقم الملف', key: 'fileNo', width: 12 }, { header: 'الاسم', key: 'name', width: 28 }, { header: 'الموبايل', key: 'phone', width: 15 },
            { header: 'النوع', key: 'gender', value: (x) => GENDER_LABELS[x.gender] ?? '' }, { header: 'العمر', key: 'age', type: 'number', width: 8, value: (x) => ageYears(x) ?? '' },
            { header: 'العنوان', key: 'address' }, { header: 'مصدر المعرفة', key: 'src', value: (x) => REFERRAL_SOURCES[x.referralSource] ?? '' },
            { header: 'تنبيهات طبية', key: 'alerts', width: 30, value: (x) => [...medicalAlerts(x).critical, ...medicalAlerts(x).caution].join('، ') },
            { header: 'تاريخ التسجيل', key: 'created', type: 'date', value: (x) => toISODate(new Date(x.createdAt)) },
          ] }],
        });
        toastSuccess('تم تنزيل ملف Excel');
      } catch (err) { toastError(err.message); } finally { b.disabled = false; }
    }, { signal });
    on(el, 'click', '[data-filter]', (_, chip) => {
      state.filter = chip.dataset.filter;
      state.shown = PAGE;
      el.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      refresh();
    }, { signal });
    on(el, 'click', '[data-restore]', async (e, b) => {
      e.stopPropagation();
      if (!(await confirmDialog({ title: 'استعادة المريض؟', message: 'سيعود الملف للظهور في قائمة المرضى.', confirmLabel: 'استعادة' }))) return;
      await restorePatient(b.dataset.restore);
      toastSuccess('تمت استعادة ملف المريض');
      refresh();
    }, { signal });

    await refresh();
    if (state.q) el.querySelector('#psearch').focus();
  },
};
