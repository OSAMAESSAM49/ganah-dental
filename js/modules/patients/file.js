/**
 * Patient file: header (photo, name, file no, age, contact), critical medical banner, and
 * tabs (each tab is its own module, loaded on demand).
 */
import { html, ico, render, on } from '../../core/dom.js';
import { digits, formatAge, formatMoney, formatDate, todayISO } from '../../core/format.js';
import { toWhatsAppNumber } from '../../core/validate.js';
import { GENDER_LABELS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { href, navigate, confirmLeave, replaceUrl } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { openMenu } from '../../components/menu.js';
import { confirmDialog } from '../../components/modal.js';
import { emptyState } from '../../components/states.js';
import { toastSuccess } from '../../components/toast.js';
import { getPatient, deletePatient, canChangePatient } from '../../services/patients.js';
import { medicalBanner } from './medical.js';
import { nextAppointment, listForPatient } from '../../services/appointments.js';
import { patientAccount } from '../../services/billing.js';
import { dayLabel, formatClock } from '../../core/time.js';
import { patientAvatar } from './list.js';
import { tr, t } from '../../core/i18n.js';

const TABS = [
  { key: 'overview', label: 'نظرة عامة', icon: 'user-round', load: () => import('./tab-overview.js') },
  { key: 'medical', label: 'التاريخ الطبي', icon: 'heart-pulse', load: () => import('./tab-medical.js') },
  { key: 'chart', label: 'خريطة الأسنان', icon: 'tooth', module: 'chart', load: () => import('./tab-chart.js') },
  { key: 'plan', label: 'خطة العلاج', icon: 'list-checks', module: 'treatment', load: () => import('./tab-plan.js') },
  { key: 'visits', label: 'الزيارات والمواعيد', icon: 'calendar-days', module: 'appointments', load: () => import('./tab-visits.js') },
  { key: 'payments', label: 'الحسابات', icon: 'receipt', module: 'billing', load: () => import('./tab-payments.js') },
  { key: 'photos', label: 'الصور والأشعة', icon: 'image', load: () => import('./tab-photos.js') },
  { key: 'rx', label: 'الروشتات', icon: 'pill', module: 'prescriptions', load: () => import('./tab-rx.js') },
  { key: 'followups', label: 'المتابعات', icon: 'bell', module: 'followups', load: () => import('./tab-followups.js') },
];

export default {
  async render(ctx) {
    const { el, params, query, signal } = ctx;
    let patient = await getPatient(params.id);
    if (!patient || patient.deletedAt) {
      render(el, html`<div class="card">${emptyState({ icon: 'search', title: 'ملف المريض غير موجود', hint: patient?.deletedAt ? 'تم حذف هذا الملف. يمكن استعادته من قائمة المرضى ← المحذوفون.' : 'ربما تم حذفه أو الرابط غير صحيح.', actions: html`<a class="btn btn--primary" href="#/patients">قائمة المرضى</a>` })}</div>`);
      return;
    }
    const tabs = TABS.filter((t) => !t.module || can(t.module, 'view'));
    let tab = tabs.find((t) => t.key === query.tab) ?? tabs[0];
    document.title = `${patient.name} · ${t(tab.label)}`;

    let next = can('appointments', 'view') ? await nextAppointment(patient.id) : null;
    // What reception asks first: does the patient owe anything, and when did they last come.
    const loadSummary = async () => ({
      balance: can('billing', 'view') ? (await patientAccount(patient.id)).balance : null,
      lastVisit: can('appointments', 'view') ? (await listForPatient(patient.id)).filter((a) => a.status === 'done' && a.date <= todayISO()).at(-1)?.date ?? null : null,
    });
    let summary = await loadSummary();
    // Patients with invoices: only the Admin or whoever registered them may edit or delete.
    let changeable = await canChangePatient(patient);

    const header = () => {
      const wa = toWhatsAppNumber(patient.phone);
      return html`
        <section class="card">
          <div class="pfile-head">
            ${patientAvatar(patient, 'pfile-head__photo')}
            <div class="pfile-head__main">
              <h1 class="pfile-head__name">${patient.name}</h1>
              <div class="pfile-head__meta">
                <span class="badge badge--dark ltr">${digits(patient.fileNo)}</span>
                ${patient.legacyFileNo ? html`<span class="badge" title="رقم الملف في البرنامج القديم">قديم <span class="ltr">#${digits(patient.legacyFileNo)}</span></span>` : ''}
                ${patient.dob ? html`<span class="badge">${formatAge(patient.dob)}${patient.dobEstimated ? ' تقريبًا' : ''}</span>` : ''}
                ${patient.gender ? html`<span class="badge">${GENDER_LABELS[patient.gender]}</span>` : ''}
                ${patient.isDemo ? html`<span class="badge badge--warning">بيانات تجريبية</span>` : ''}
                ${summary.balance > 0 ? html`<a class="badge badge--danger" href="${href('/patients/:id', { id: patient.id }, { tab: 'payments' })}" data-tab-link="payments">عليه ${formatMoney(summary.balance)}</a>` : ''}
                ${summary.balance < 0 ? html`<a class="badge badge--success" href="${href('/patients/:id', { id: patient.id }, { tab: 'payments' })}" data-tab-link="payments">رصيد مقدم ${formatMoney(-summary.balance)}</a>` : ''}
                ${summary.lastVisit ? html`<span class="badge">آخر زيارة ${formatDate(summary.lastVisit)}</span>` : ''}
                ${next ? html`<a class="badge badge--accent" href="${href('/appointments', {}, { view: 'day', date: next.date })}">${ico('calendar-check', { size: 14 })} الموعد القادم: ${dayLabel(next.date)} ${formatClock(next.startMin)}</a>` : ''}
                ${patient.phone ? html`<span class="muted ltr num">${digits(patient.phone)}</span>` : ''}
              </div>
            </div>
            <div class="pfile-head__actions">
              ${can('treatment', 'create') && !patient.deletedAt ? html`<button type="button" class="btn btn--primary btn--sm" data-quick-add>${ico('tooth', { size: 18 })} إضافة إجراء</button>` : ''}
              ${can('appointments', 'create') ? html`<button type="button" class="btn btn--primary btn--sm" data-book-appt>${ico('calendar-check', { size: 18 })} حجز موعد</button>` : ''}
              ${patient.phone ? html`<a class="btn btn--sm" href="tel:${patient.phone}" data-secondary>${ico('phone', { size: 18 })} اتصال</a>` : ''}
              ${wa ? html`<a class="btn btn--whatsapp btn--sm" href="https://wa.me/${wa}" target="_blank" rel="noopener" data-secondary>${ico('message-circle', { size: 18 })} واتساب</a>` : ''}
              ${can('patients', 'edit') && changeable ? html`<a class="btn btn--sm btn--soft" href="${href('/patients/:id/edit', { id: patient.id })}" data-secondary>${ico('pencil', { size: 18 })} تعديل</a>` : ''}
              ${(can('patients', 'delete') && changeable) || patient.phone || (can('patients', 'edit') && changeable) ? html`<button type="button" class="btn btn--sm btn--icon ${can('patients', 'delete') && changeable ? '' : 'pfile-more--phone'}" data-more aria-label="المزيد" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
            </div>
          </div>
        </section>`;
    };

    render(el, html`
      <div class="stack">
        <a class="link-btn" href="#/patients" style="align-self:flex-start">${ico('arrow-right', { size: 18 })} كل المرضى</a>
        <div id="pf-head">${header()}</div>
        <div id="pf-banner">${medicalBanner(patient, { link: can('patients', 'edit') ? href('/patients/:id', { id: patient.id }, { tab: 'medical' }) : '' })}</div>
        <nav class="tabs pfile-tabs" aria-label="أقسام ملف المريض" style="margin-block-end: 0">
          ${tabs.map((t) => html`<a class="tab" href="${href('/patients/:id', { id: patient.id }, t.key === 'overview' ? undefined : { tab: t.key })}" data-tab-link="${t.key}" aria-selected="${String(t === tab)}" ${t === tab ? html`aria-current="page"` : ''}>${ico(t.icon, { size: 18 })} ${t.label}</a>`)}
        </nav>
        <div id="pf-body"></div>
      </div>`);

    // keep header/banner fresh when the record changes (e.g. medical tab saves)
    const off = onEvent('data:changed', async ({ store, id }) => {
      if (store === 'invoices' || store === 'payments') {
        changeable = await canChangePatient(patient);
        summary = await loadSummary();
        render(el.querySelector('#pf-head'), header());
        return;
      }
      if (store === 'appointments') {
        next = await nextAppointment(patient.id);
        summary = await loadSummary();
        render(el.querySelector('#pf-head'), header());
        return;
      }
      if (store !== 'patients' || id !== patient.id) return;
      patient = await getPatient(patient.id);
      if (!patient || patient.deletedAt) return;
      render(el.querySelector('#pf-head'), header());
      render(el.querySelector('#pf-banner'), medicalBanner(patient, { link: href('/patients/:id', { id: patient.id }, { tab: 'medical' }) }));
    });

    on(el, 'click', '[data-book-appt]', async () => {
      const { openAppointmentForm } = await import('../appointments/appt-form.js');
      openAppointmentForm({ patientId: patient.id });
    }, { signal });

    // Chart + procedure in one window (fewest taps); the open tab then shows the new work.
    on(el, 'click', '[data-quick-add]', async () => {
      const { openQuickTreatment } = await import('../appointments/quick-treatment.js');
      if (await openQuickTreatment({ patientId: patient.id })) await showTab();
    }, { signal });

    // On phones the ⋮ menu also holds call / WhatsApp / edit (only two big buttons stay).
    on(el, 'click', '[data-more]', (_, b) => openMenu(b, {
      items: [...(matchMedia('(max-width: 639px)').matches ? [
        ...(patient.phone ? [{ label: 'اتصال', icon: 'phone', onSelect: () => { location.href = `tel:${patient.phone}`; } }] : []),
        ...(toWhatsAppNumber(patient.phone) ? [{ label: 'واتساب', icon: 'message-circle', onSelect: () => window.open(`https://wa.me/${toWhatsAppNumber(patient.phone)}`, '_blank', 'noopener') }] : []),
        ...(can('patients', 'edit') && changeable ? [{ label: 'تعديل البيانات', icon: 'pencil', onSelect: () => navigate(`/patients/${patient.id}/edit`) }] : []),
      ] : []), ...(can('patients', 'delete') && changeable ? [{
        label: 'حذف ملف المريض', icon: 'trash-2', danger: true,
        onSelect: async () => {
          const ok = await confirmDialog({
            title: tr`حذف ملف ${patient.name}؟`,
            message: 'سينتقل الملف إلى «المحذوفون» ويمكن استعادته لاحقًا. لن يظهر في البحث أو القوائم.',
            confirmLabel: 'حذف', danger: true,
          });
          if (!ok) return;
          await deletePatient(patient.id);
          toastSuccess('تم نقل الملف إلى المحذوفين');
          navigate('/patients');
        },
      }] : [])],
    }), { signal });

    let cleanup = null;
    let mod = await tab.load();
    /** (Re)draws the open tab on a fresh element, so no listeners are left behind. */
    const showTab = async () => {
      if (typeof cleanup === 'function') cleanup();
      const old = el.querySelector('#pf-body');
      const body = /** @type {HTMLElement} */ (old.cloneNode(false));
      old.replaceWith(body);
      cleanup = await mod.renderTab({ ...ctx, body, patient: () => patient });
    };
    await showTab();

    // Tabs switch in place: the header stays, only the tab body is drawn.
    const nav = /** @type {HTMLElement} */ (el.querySelector('.pfile-tabs'));
    const centerActive = () => nav.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    centerActive();
    on(el, 'click', '[data-tab-link]', async (e, a) => {
      const chosen = tabs.find((t) => t.key === a.dataset.tabLink);
      if (!chosen) return;
      e.preventDefault();
      if (chosen === tab || !(await confirmLeave())) return;
      tab = chosen;
      for (const x of nav.querySelectorAll('[data-tab-link]')) {
        const selected = x.dataset.tabLink === tab.key;
        x.setAttribute('aria-selected', String(selected));
        if (selected) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
      }
      centerActive();
      replaceUrl(href('/patients/:id', { id: patient.id }, tab.key === 'overview' ? undefined : { tab: tab.key }));
      document.title = `${patient.name} · ${t(tab.label)}`;
      mod = await tab.load();
      await showTab();
    }, { signal });
    return () => { off(); if (typeof cleanup === 'function') cleanup(); };
  },
};
