/** New / edit patient. Medical history is part of registration so it is never skipped. */
import { html, ico, render, formData, showFieldErrors } from '../../core/dom.js';
import { validate, required, phone as phoneRule } from '../../core/validate.js';
import { parseDateInput, todayISO, ageFromDOB, digits } from '../../core/format.js';
import { normalizeDigits } from '../../core/text.js';
import { REFERRAL_SOURCES } from '../../core/labels.js';
import { navigate, setLeaveGuard, href } from '../../core/router.js';
import { imageFileToDataURL } from '../../core/image.js';
import { textField, textareaField } from '../../components/form.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { confirmDialog } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import { createPatient, updatePatient, updateMedical, getPatient, findByPhone, dobFromAge, canChangePatient } from '../../services/patients.js';
import { medicalFields, readMedical, sameMedical } from './medical.js';
import { patientAvatar } from './list.js';

export default {
  async render({ el, params, signal }) {
    const isNew = !params.id;
    const patient = isNew ? null : await getPatient(params.id);
    if (!isNew && (!patient || patient.deletedAt)) {
      render(el, html`<div class="card">${emptyState({ icon: 'search', title: 'المريض غير موجود', actions: html`<a class="btn btn--primary" href="#/patients">قائمة المرضى</a>` })}</div>`);
      return;
    }
    if (!isNew && !(await canChangePatient(patient))) {
      render(el, html`<div class="card">${emptyState({ icon: 'lock', title: 'لا يمكنك تعديل بيانات هذا المريض', hint: 'المريض عليه فواتير، وتعديل بياناته متاح لمدير النظام أو لمن سجّله فقط.', actions: html`<a class="btn btn--primary" href="${href('/patients/:id', { id: patient.id })}">ملف المريض</a>` })}</div>`);
      return;
    }
    const p = patient ?? { name: '', gender: '', medical: {} };
    let photo = p.photo ?? null;
    let dobMode = p.dobEstimated ? 'age' : 'dob';
    const age = p.dob ? ageFromDOB(p.dob)?.years : '';
    document.title = isNew ? 'مريض جديد' : `تعديل ${p.name}`;

    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">${isNew ? 'مريض جديد' : html`تعديل بيانات ${p.name}`}</h1>
          <p class="page-header__sub">${isNew ? 'رقم الملف يُنشأ تلقائيًا عند الحفظ' : html`ملف رقم <span class="ltr">${digits(p.fileNo)}</span>`}</p>
        </div>
      </header>
      <form id="pform" class="stack" novalidate>
        <section class="card">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">البيانات الأساسية</h2></div></div>
          <div class="card__body form">
            <div class="avatar-pick">
              <span id="photo-preview">${patientAvatar({ ...p, photo })}</span>
              <label class="btn btn--soft btn--sm">${ico('upload', { size: 18 })} صورة المريض
                <input type="file" accept="image/*" capture="user" id="photo-input" class="visually-hidden">
              </label>
              <button type="button" class="btn btn--ghost btn--sm" id="photo-clear" ${photo ? '' : 'hidden'}>إزالة الصورة</button>
            </div>
            <div class="form-grid">
              ${textField({ name: 'name', label: 'الاسم بالكامل', value: p.name, required: true, placeholder: 'الاسم الثلاثي أو الرباعي', autocomplete: 'off' })}
              <fieldset class="field" style="border:0;padding:0;margin:0">
                <legend class="field__label" style="margin-block-end: var(--sp-2)">النوع</legend>
                <div class="segmented">
                  <label><input type="radio" name="gender" value="female" ${p.gender === 'female' ? 'checked' : ''}><span>أنثى</span></label>
                  <label><input type="radio" name="gender" value="male" ${p.gender === 'male' ? 'checked' : ''}><span>ذكر</span></label>
                </div>
              </fieldset>
            </div>
            <div class="form-grid">
              ${textField({ name: 'phone', label: 'الموبايل', value: p.phone ?? '', ltr: true, inputmode: 'tel', placeholder: '01012345678', hint: 'يُستخدم لرسائل واتساب' })}
              ${textField({ name: 'phone2', label: 'هاتف آخر (اختياري)', value: p.phone2 ?? '', ltr: true, inputmode: 'tel' })}
            </div>
            <div class="stack-sm">
              <div class="segmented" role="radiogroup" aria-label="طريقة إدخال العمر">
                <label><input type="radio" name="dobMode" value="dob" ${dobMode === 'dob' ? 'checked' : ''}><span>تاريخ الميلاد</span></label>
                <label><input type="radio" name="dobMode" value="age" ${dobMode === 'age' ? 'checked' : ''}><span>العمر فقط</span></label>
              </div>
              <div id="dob-wrap" ${dobMode === 'age' ? 'hidden' : ''}>${dateField({ name: 'dob', label: 'تاريخ الميلاد', value: p.dobEstimated ? '' : p.dob, max: todayISO() })}</div>
              <div id="age-wrap" ${dobMode === 'dob' ? 'hidden' : ''}>${textField({ name: 'age', label: 'العمر بالسنوات', value: dobMode === 'age' ? age : '', ltr: true, inputmode: 'numeric', hint: 'يُحسب تاريخ ميلاد تقريبي' })}</div>
            </div>
            <div class="form-grid">
              ${textField({ name: 'address', label: 'العنوان', value: p.address ?? '' })}
              ${textField({ name: 'occupation', label: 'المهنة', value: p.occupation ?? '' })}
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">كيف عرف المريض العيادة؟</h2><p class="card__subtitle">يساعد في معرفة أنجح وسائل التسويق</p></div></div>
          <div class="card__body form">
            <div class="chips" role="radiogroup" aria-label="مصدر المعرفة">
              ${Object.entries(REFERRAL_SOURCES).map(([k, v]) => html`<label class="chip"><input type="radio" name="referralSource" value="${k}" ${p.referralSource === k ? 'checked' : ''}>${v}</label>`)}
            </div>
            ${textField({ name: 'referralNote', label: 'تفاصيل (اختياري)', value: p.referralNote ?? '', placeholder: 'مثال: من طرف المريضة سارة محمود' })}
          </div>
        </section>

        <section class="card">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">${ico('heart-pulse')} التاريخ الطبي</h2><p class="card__subtitle">الخانات المميزة بعلامة ! تظهر كتنبيه أحمر في ملف المريض وعلى المواعيد</p></div></div>
          <div class="card__body">${medicalFields(p.medical, p.gender)}</div>
        </section>

        <section class="card">
          <div class="card__body">${textareaField({ name: 'notes', label: 'ملاحظات عامة', value: p.notes ?? '', rows: 3 })}</div>
        </section>

        <div class="form-actions card" style="padding: var(--sp-4); position: sticky; inset-block-end: var(--sp-3); z-index: 5; box-shadow: var(--shadow-lg)">
          <button class="btn btn--primary" type="submit">${ico('save')} ${isNew ? 'حفظ وفتح الملف' : 'حفظ التعديلات'}</button>
          <a class="btn btn--ghost" href="${isNew ? '#/patients' : href('/patients/:id', { id: p.id })}">إلغاء</a>
        </div>
      </form>`);

    const form = /** @type {HTMLFormElement} */ (el.querySelector('#pform'));
    enhanceDateFields(form, signal);

    let dirty = false;
    const markDirty = () => {
      if (dirty) return;
      dirty = true;
      setLeaveGuard(() => confirmDialog({ title: 'لم تحفظ البيانات', message: 'هل تريد المغادرة بدون حفظ؟', confirmLabel: 'مغادرة بدون حفظ', danger: true }));
    };
    form.addEventListener('input', markDirty, { signal });
    form.addEventListener('change', (e) => {
      markDirty();
      const t = /** @type {HTMLInputElement} */ (e.target);
      if (t.name === 'gender') form.querySelector('[data-medical]').dataset.gender = t.value;
      if (t.name === 'dobMode') {
        dobMode = t.value;
        form.querySelector('#dob-wrap').hidden = dobMode !== 'dob';
        form.querySelector('#age-wrap').hidden = dobMode !== 'age';
      }
    }, { signal });

    const drawPhoto = () => {
      render(form.querySelector('#photo-preview'), patientAvatar({ ...p, name: form.querySelector('[name=name]').value || p.name, photo }));
      form.querySelector('#photo-clear').hidden = !photo;
    };
    form.querySelector('#photo-input').addEventListener('change', async (e) => {
      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (!file) return;
      try { photo = await imageFileToDataURL(file, { maxSize: 256, type: 'image/jpeg', quality: 0.82 }); drawPhoto(); markDirty(); }
      catch { toastError('تعذّرت قراءة الصورة'); }
    }, { signal });
    form.querySelector('#photo-clear').addEventListener('click', () => { photo = null; drawPhoto(); markDirty(); }, { signal });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formData(form);
      const errors = validate(data, {
        name: (v) => required(v, 'اسم المريض') || (String(v).trim().length < 3 ? 'اكتب الاسم بالكامل' : ''),
        phone: (v) => phoneRule(v),
        phone2: (v) => phoneRule(v),
        dob: (v) => {
          if (dobMode !== 'dob' || !String(v).trim()) return '';
          const iso = parseDateInput(v);
          if (!iso) return 'اكتب التاريخ بالشكل يوم/شهر/سنة';
          return iso > todayISO() ? 'تاريخ الميلاد في المستقبل' : '';
        },
        age: (v) => {
          if (dobMode !== 'age' || !String(v).trim()) return '';
          const n = Number(normalizeDigits(v));
          return Number.isInteger(n) && n >= 0 && n <= 120 ? '' : 'اكتب العمر كرقم من 0 إلى 120';
        },
      });
      if (!showFieldErrors(form, errors)) { toastError('راجع الحقول المظللة بالأحمر'); return; }

      const dob = dobMode === 'dob' ? parseDateInput(data.dob) : dobFromAge(data.age);
      const input = {
        name: data.name, gender: data.gender, phone: data.phone, phone2: data.phone2,
        dob, dobEstimated: dobMode === 'age' && !!dob,
        address: data.address, occupation: data.occupation,
        referralSource: data.referralSource, referralNote: data.referralNote, notes: data.notes, photo,
      };

      if (data.phone) {
        const same = await findByPhone(data.phone, p.id);
        if (same.length) {
          const ok = await confirmDialog({
            title: 'رقم الموبايل مسجّل لمريض آخر',
            message: html`<p>الرقم مسجّل باسم: <strong>${same.map((s) => `${s.name} (${s.fileNo})`).join('، ')}</strong>.</p><p class="muted">قد يكون من نفس العائلة. هل تريد المتابعة والحفظ؟</p>`,
            confirmLabel: 'متابعة الحفظ',
          });
          if (!ok) return;
        }
      }

      const btn = form.querySelector('[type=submit]');
      btn.setAttribute('aria-busy', 'true');
      try {
        const medical = readMedical(data);
        let saved;
        if (isNew) {
          saved = await createPatient({ ...input, medical: { ...medical, updatedAt: new Date().toISOString() } });
        } else {
          saved = await updatePatient(p.id, input);
          if (!sameMedical(p.medical, medical)) await updateMedical(p.id, medical);
        }
        setLeaveGuard(null);
        toastSuccess(isNew ? `تم تسجيل المريض · ملف ${saved.fileNo}` : 'تم حفظ التعديلات');
        navigate(`/patients/${saved.id}`, { replace: isNew });
      } catch (err) {
        console.error(err);
        btn.removeAttribute('aria-busy');
        toastError(err.message || 'تعذّر الحفظ');
      }
    }, { signal });

    signal.addEventListener('abort', () => setLeaveGuard(null));
    form.querySelector('[name=name]').focus();
  },
};
