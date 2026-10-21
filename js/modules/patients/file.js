/**
 * Patient file: header (photo, name, file no, age, contact), critical medical banner, and
 * tabs. Tabs from later phases show where they are coming.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { digits, formatAge } from '../../core/format.js';
import { toWhatsAppNumber } from '../../core/validate.js';
import { GENDER_LABELS } from '../../core/labels.js';
import { can } from '../../core/permissions.js';
import { href, navigate } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { openMenu } from '../../components/menu.js';
import { confirmDialog } from '../../components/modal.js';
import { emptyState } from '../../components/states.js';
import { toastSuccess } from '../../components/toast.js';
import { getPatient, deletePatient } from '../../services/patients.js';
import { medicalBanner } from './medical.js';
import { nextAppointment } from '../../services/appointments.js';
import { dayLabel, formatClock } from '../../core/time.js';
import { patientAvatar } from './list.js';

const TABS = [
  { key: 'overview', label: 'نظرة عامة', icon: 'user-round', load: () => import('./tab-overview.js') },
  { key: 'medical', label: 'التاريخ الطبي', icon: 'heart-pulse', load: () => import('./tab-medical.js') },
  { key: 'chart', label: 'خريطة الأسنان', icon: 'tooth', module: 'chart', load: () => import('./tab-chart.js') },
  { key: 'plan', label: 'خطة العلاج', icon: 'list-checks', module: 'treatment', load: () => import('./tab-plan.js') },
  { key: 'visits', label: 'الزيارات والمواعيد', icon: 'calendar-days', module: 'appointments', load: () => import('./tab-visits.js') },
  { key: 'payments', label: 'المدفوعات', icon: 'receipt', phase: 6, module: 'billing' },
  { key: 'photos', label: 'الصور والأشعة', icon: 'image', load: () => import('./tab-photos.js') },
  { key: 'rx', label: 'الروشتات', icon: 'pill', phase: 8, module: 'prescriptions' },
  { key: 'followups', label: 'المتابعات', icon: 'bell', phase: 8, module: 'followups' },
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
    const tab = tabs.find((t) => t.key === query.tab) ?? tabs[0];
    document.title = `${patient.name} · ${tab.label}`;

    let next = can('appointments', 'view') ? await nextAppointment(patient.id) : null;

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
                ${patient.dob ? html`<span class="badge">${formatAge(patient.dob)}${patient.dobEstimated ? ' تقريبًا' : ''}</span>` : ''}
                ${patient.gender ? html`<span class="badge">${GENDER_LABELS[patient.gender]}</span>` : ''}
                ${patient.isDemo ? html`<span class="badge badge--warning">بيانات تجريبية</span>` : ''}
                ${next ? html`<a class="badge badge--accent" href="${href('/appointments', {}, { view: 'day', date: next.date })}">${ico('calendar-check', { size: 14 })} الموعد القادم: ${dayLabel(next.date)} ${formatClock(next.startMin)}</a>` : ''}
                ${patient.phone ? html`<span class="muted ltr num">${digits(patient.phone)}</span>` : ''}
              </div>
            </div>
            <div class="pfile-head__actions">
              ${can('appointments', 'create') ? html`<button type="button" class="btn btn--primary btn--sm" data-book-appt>${ico('calendar-check', { size: 18 })} حجز موعد</button>` : ''}
              ${patient.phone ? html`<a class="btn btn--sm" href="tel:${patient.phone}">${ico('phone', { size: 18 })} اتصال</a>` : ''}
              ${wa ? html`<a class="btn btn--whatsapp btn--sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">${ico('message-circle', { size: 18 })} واتساب</a>` : ''}
              ${can('patients', 'edit') ? html`<a class="btn btn--sm btn--soft" href="${href('/patients/:id/edit', { id: patient.id })}">${ico('pencil', { size: 18 })} تعديل</a>` : ''}
              ${can('patients', 'delete') ? html`<button type="button" class="btn btn--sm btn--icon" data-more aria-label="المزيد" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>` : ''}
            </div>
          </div>
        </section>`;
    };

    render(el, html`
      <div class="stack">
        <a class="link-btn" href="#/patients" style="align-self:flex-start">${ico('arrow-right', { size: 18 })} كل المرضى</a>
        <div id="pf-head">${header()}</div>
        <div id="pf-banner">${medicalBanner(patient, { link: can('patients', 'edit') ? href('/patients/:id', { id: patient.id }, { tab: 'medical' }) : '' })}</div>
        <nav class="tabs" aria-label="أقسام ملف المريض" style="margin-block-end: 0">
          ${tabs.map((t) => html`<a class="tab" href="${href('/patients/:id', { id: patient.id }, t.key === 'overview' ? undefined : { tab: t.key })}" aria-selected="${String(t === tab)}" ${t === tab ? html`aria-current="page"` : ''}>${ico(t.icon, { size: 18 })} ${t.label}</a>`)}
        </nav>
        <div id="pf-body"></div>
      </div>`);

    // keep header/banner fresh when the record changes (e.g. medical tab saves)
    const off = onEvent('data:changed', async ({ store, id }) => {
      if (store === 'appointments') {
        next = await nextAppointment(patient.id);
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

    on(el, 'click', '[data-more]', (_, b) => openMenu(b, {
      items: [{
        label: 'حذف ملف المريض', icon: 'trash-2', danger: true,
        onSelect: async () => {
          const ok = await confirmDialog({
            title: `حذف ملف ${patient.name}؟`,
            message: 'سينتقل الملف إلى «المحذوفون» ويمكن استعادته لاحقًا. لن يظهر في البحث أو القوائم.',
            confirmLabel: 'حذف', danger: true,
          });
          if (!ok) return;
          await deletePatient(patient.id);
          toastSuccess('تم نقل الملف إلى المحذوفين');
          navigate('/patients');
        },
      }],
    }), { signal });

    const body = el.querySelector('#pf-body');
    let cleanup = null;
    if (tab.load) {
      const mod = await tab.load();
      cleanup = await mod.renderTab({ ...ctx, body, patient: () => patient });
    } else {
      render(body, html`<div class="card">${emptyState({ icon: tab.icon, title: `${tab.label} — المرحلة ${digits(tab.phase)}`, hint: 'هذا القسم ضمن خطة البناء وسيظهر هنا عند اكتمال مرحلته.' })}</div>`);
    }
    return () => { off(); if (typeof cleanup === 'function') cleanup(); };
  },
};
