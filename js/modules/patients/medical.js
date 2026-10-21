/** Medical history checklist fields + the alert banner shown on the patient file. */
import { html, ico } from '../../core/dom.js';
import { MEDICAL_GROUPS, medicalAlerts } from '../../core/medical.js';
import { formatDateTime } from '../../core/format.js';
import { textareaField, textField } from '../../components/form.js';

/**
 * Checklist markup. Items for women only are hidden when gender is 'male'.
 * @param {object} medical patient.medical @param {string} gender
 */
export function medicalFields(medical = {}, gender = '') {
  const items = medical.items ?? {};
  return html`
    <div class="med" data-medical data-gender="${gender}">
      ${MEDICAL_GROUPS.map((g) => html`
        <fieldset class="med__group">
          <legend class="med__title">${g.title}</legend>
          <div class="med__items">
            ${g.items.map((it) => html`
              <label class="med-chip med-chip--${it.level}" ${it.female ? html`data-female` : ''} title="${it.hint ?? ''}">
                <input type="checkbox" name="med.${it.key}" ${items[it.key] ? 'checked' : ''}>
                <span class="med-chip__box" aria-hidden="true">${ico('check', { size: 16 })}</span>
                <span>${it.label}</span>
                ${it.level === 'critical' ? html`<span class="med-chip__flag" aria-label="مهم">!</span>` : ''}
              </label>`)}
          </div>
        </fieldset>`)}
      <div class="form-grid">
        ${textField({ name: 'med.allergyOther', label: 'حساسية أخرى', value: medical.allergyOther ?? '', placeholder: 'مثال: حساسية من السلفا' })}
        ${textareaField({ name: 'med.medications', label: 'أدوية يتناولها حاليًا', value: medical.medications ?? '', rows: 2 })}
      </div>
      ${textareaField({ name: 'med.notes', label: 'ملاحظات طبية', value: medical.notes ?? '', rows: 2 })}
    </div>`;
}

/** Reads the checklist from form data produced by formData(). */
export function readMedical(data) {
  const items = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('med.') && v === true) items[k.slice(4)] = true;
  }
  return { items, allergyOther: data['med.allergyOther'] ?? '', medications: data['med.medications'] ?? '', notes: data['med.notes'] ?? '' };
}

/**
 * Red banner for critical items + amber chips for cautions. Returns '' when there is
 * nothing to show and the history was filled; a gentle prompt when it was never filled.
 */
export function medicalBanner(patient, { link } = {}) {
  const { critical, caution } = medicalAlerts(patient);
  if (!critical.length && !caution.length) {
    if (patient.medical?.updatedAt || Object.keys(patient.medical?.items ?? {}).length) return '';
    return html`<div class="alert">${ico('heart-pulse')}<div class="alert__content"><div class="alert__body">لم يُسجّل التاريخ الطبي لهذا المريض بعد. ${link ? html`<a href="${link}">سجّله الآن</a>` : ''}</div></div></div>`;
  }
  return html`
    <div class="alert ${critical.length ? 'alert--critical' : 'alert--warning'}" role="alert">
      ${ico('triangle-alert', { size: 26 })}
      <div class="alert__content">
        <div class="alert__title">${critical.length ? 'تنبيه طبي مهم' : 'ملاحظات طبية'}</div>
        <div class="alert__body med-alert">
          ${critical.map((c) => html`<span class="med-alert__item">${c}</span>`)}
          ${caution.map((c) => html`<span class="med-alert__item med-alert__item--caution">${c}</span>`)}
        </div>
      </div>
      ${link ? html`<a class="btn btn--sm ${critical.length ? '' : 'btn--soft'}" href="${link}" style="${critical.length ? 'background:#fff;color:#C1272D;border-color:transparent' : ''}">التفاصيل</a>` : ''}
    </div>`;
}

/** Read-only summary of the full history. */
export function medicalSummary(patient) {
  const m = patient.medical ?? {};
  const on = MEDICAL_GROUPS.flatMap((g) => g.items).filter((it) => m.items?.[it.key] && !(it.female && patient.gender === 'male'));
  return html`
    <div class="stack">
      ${on.length
        ? html`<div class="med__items">${on.map((it) => html`<span class="badge ${it.level === 'critical' ? 'badge--danger' : it.level === 'caution' ? 'badge--warning' : ''}">${it.label}</span>`)}</div>`
        : html`<p class="muted">لا توجد أمراض أو حساسية مسجّلة.</p>`}
      ${m.allergyOther ? html`<p><strong>حساسية أخرى:</strong> ${m.allergyOther}</p>` : ''}
      ${m.medications ? html`<p><strong>الأدوية:</strong> ${m.medications}</p>` : ''}
      ${m.notes ? html`<p><strong>ملاحظات:</strong> ${m.notes}</p>` : ''}
      ${m.updatedAt ? html`<p class="subtle text-sm">آخر تحديث: ${formatDateTime(m.updatedAt)}${m.updatedBy ? ` · ${m.updatedBy}` : ''}</p>` : ''}
    </div>`;
}

/** True when two medical histories have the same content (ignores who/when). */
export function sameMedical(a = {}, b = {}) {
  const norm = (m) => JSON.stringify({
    items: Object.keys(m.items ?? {}).filter((k) => m.items[k]).sort(),
    allergyOther: (m.allergyOther ?? '').trim(),
    medications: (m.medications ?? '').trim(),
    notes: (m.notes ?? '').trim(),
  });
  return norm(a) === norm(b);
}
