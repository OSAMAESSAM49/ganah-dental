/**
 * Patient picker for dialogs: a search box that turns into the chosen patient's card.
 * Markup goes in a container; wirePatientPicker() handles searching, picking and "change".
 */
import { html, ico, render } from '../core/dom.js';
import { digits } from '../core/format.js';
import { searchPatients, getPatient } from '../services/patients.js';
import { patientAvatar } from '../modules/patients/list.js';

/** @param {{ patient?: object|null, locked?: boolean }} o */
export function patientPicker({ patient = null, locked = false } = {}) {
  if (patient) {
    return html`<div class="appt-patient">${patientAvatar(patient)}
      <div class="grow"><strong>${patient.name}</strong><div class="muted text-sm"><span class="ltr">${digits(patient.fileNo)}</span>${patient.phone ? html` · <span class="ltr">${digits(patient.phone)}</span>` : ''}</div></div>
      ${locked ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-pp-change>تغيير</button>`}</div>`;
  }
  return html`<div class="field"><label class="field__label" for="pp-q">المريض<span class="req">*</span></label>
    <div class="input-group">${ico('search', { size: 20 })}<input class="input" id="pp-q" autocomplete="off" placeholder="ابحث بالاسم أو الموبايل أو رقم الملف…"></div>
    <ul class="gsearch__list pp-results" hidden></ul></div>`;
}

/**
 * @param {HTMLElement} box container holding patientPicker() markup
 * @param {(patient: object|null) => void|Promise<void>} onChange
 */
export function wirePatientPicker(box, onChange) {
  let timer;
  box.addEventListener('input', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (input.id !== 'pp-q') return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const list = box.querySelector('.pp-results');
      const q = input.value.trim();
      const found = q ? await searchPatients(q, { limit: 6 }) : [];
      render(list, found.length ? html`${found.map((p) => html`<li class="gsearch__item" data-pp-pick="${p.id}">${patientAvatar(p)}<span class="gsearch__text"><strong>${p.name}</strong><span class="gsearch__sub ltr">${digits(p.fileNo)}</span></span></li>`)}` : html`<li class="gsearch__empty">لا يوجد مريض مطابق</li>`);
      list.hidden = !q;
    }, 120);
  });
  box.addEventListener('click', async (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const pick = t.closest('[data-pp-pick]');
    if (pick) {
      const p = await getPatient(pick.dataset.ppPick);
      render(box, patientPicker({ patient: p }));
      await onChange(p);
    }
    if (t.closest('[data-pp-change]')) {
      render(box, patientPicker());
      box.querySelector('input')?.focus();
      await onChange(null);
    }
  });
  box.querySelector('#pp-q')?.focus();
}
