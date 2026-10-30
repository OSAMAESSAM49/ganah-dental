/** Settings → appointments: working hours, chairs, slot length, reminder message. */
import { html, ico, render, on } from '../../core/dom.js';
import { digits, todayISO } from '../../core/format.js';
import { WEEKDAYS, WEEK_ORDER, formatClock, addDays } from '../../core/time.js';
import { can } from '../../core/permissions.js';
import { getSettings } from '../../data/settings.js';
import { openModal } from '../../components/modal.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { getSchedule, saveSchedule, addChair, DEFAULT_SCHEDULE } from '../../services/schedule.js';
import { reminderMessage } from '../../services/appointments.js';
import { tr } from '../../core/i18n.js';

const TIMES = Array.from({ length: 48 }, (_, i) => i * 30);
const PLACEHOLDERS = ['{الاسم}', '{الاسم_الكامل}', '{العيادة}', '{اليوم}', '{التاريخ}', '{الوقت}', '{الطبيب}', '{هاتف_العيادة}'];

export async function renderTab({ body, signal }) {
  const editable = can('settings', 'edit');

  const preview = (template) => reminderMessage(
    { patientName: 'سارة محمود', date: addDays(todayISO(), 1), startMin: 17 * 60 + 30 },
    { template, clinic: getSettings('clinic'), doctorName: 'د. أحمد' },
  );

  const draw = () => {
    const s = getSchedule();
    render(body, html`
      <div class="bento">
        <section class="card span-7">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">مواعيد العمل</h2><p class="card__subtitle">تحدد الأوقات المتاحة للحجز وشكل التقويم</p></div></div>
          <div class="card__body">
            ${WEEK_ORDER.map((wd) => {
              const h = s.hours[wd];
              return html`<div class="setting-row" data-wd="${wd}">
                <label class="switch"><input type="checkbox" data-open ${h.open ? 'checked' : ''} ${editable ? '' : 'disabled'}><span class="switch__track"></span> <strong style="min-inline-size: 80px">${WEEKDAYS[wd]}</strong></label>
                <div class="row" ${h.open ? '' : html`style="opacity:.4"`}>
                  <span class="muted">من</span>
                  <select class="select" data-from style="inline-size:auto" ${editable && h.open ? '' : 'disabled'} aria-label="من">${TIMES.map((m) => html`<option value="${m}" ${m === h.from ? 'selected' : ''}>${formatClock(m)}</option>`)}</select>
                  <span class="muted">إلى</span>
                  <select class="select" data-to style="inline-size:auto" ${editable && h.open ? '' : 'disabled'} aria-label="إلى">${TIMES.slice(1).map((m) => html`<option value="${m}" ${m === h.to ? 'selected' : ''}>${formatClock(m)}</option>`)}<option value="1439" ${h.to === 1439 ? 'selected' : ''}>${formatClock(1439)}</option></select>
                </div>
              </div>`;
            })}
          </div>
        </section>
        <aside class="card span-5">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">الكراسي والحجز</h2></div></div>
          <div class="card__body stack">
            <ul class="list">${s.chairs.map((c) => html`
              <li class="list__item">
                ${ico('stethoscope', { size: 20 })}
                <span class="list__main"><span class="list__title">${c.name}</span>${c.active === false ? html`<span class="list__meta">موقوف</span>` : ''}</span>
                ${editable ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-rename-chair="${c.id}" aria-label="إعادة تسمية">${ico('pencil', { size: 16 })}</button>
                  ${s.chairs.filter((x) => x.active !== false).length > 1 || c.active === false ? html`<button type="button" class="btn btn--ghost btn--sm" data-toggle-chair="${c.id}">${c.active === false ? 'تفعيل' : 'إيقاف'}</button>` : ''}` : ''}
              </li>`)}</ul>
            ${editable ? html`<button type="button" class="btn btn--sm" data-add-chair style="align-self:flex-start">${ico('plus', { size: 16 })} إضافة كرسي</button>` : ''}
            <hr style="margin: 0">
            <label class="field"><span class="field__label">الفاصل بين أوقات الحجز</span>
              <select class="select" id="slot" ${editable ? '' : 'disabled'}>${[10, 15, 20, 30].map((m) => html`<option value="${m}" ${m === s.slotMin ? 'selected' : ''}>كل ${digits(m)} دقيقة</option>`)}</select></label>
            <label class="field"><span class="field__label">المدة الافتراضية للموعد</span>
              <select class="select" id="defdur" ${editable ? '' : 'disabled'}>${[15, 20, 30, 45, 60].map((m) => html`<option value="${m}" ${m === s.defaultDuration ? 'selected' : ''}>${digits(m)} دقيقة</option>`)}</select></label>
          </div>
        </aside>
        <section class="card span-12">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">${ico('message-circle', { size: 20 })} رسالة تذكير واتساب</h2><p class="card__subtitle">تُرسل يدويًا بضغطة واحدة لكل مريض من «تذكيرات الغد»</p></div></div>
          <div class="card__body">
            <div class="grid grid--2">
              <div class="stack-sm">
                <textarea class="textarea" id="tpl" rows="6" ${editable ? '' : 'disabled'} aria-label="نص الرسالة">${s.reminderTemplate}</textarea>
                <div class="chips">${PLACEHOLDERS.map((p) => html`<button type="button" class="chip" data-ph="${p}" ${editable ? '' : 'disabled'}>${p}</button>`)}</div>
                ${editable ? html`<div class="row"><button type="button" class="btn btn--primary btn--sm" data-save-tpl>${ico('save', { size: 16 })} حفظ الرسالة</button><button type="button" class="btn btn--ghost btn--sm" data-reset-tpl>استعادة النص الافتراضي</button></div>` : ''}
              </div>
              <div class="stack-sm"><span class="field__label">معاينة</span><div class="card card--flat"><div class="card__body" id="tpl-preview" style="white-space: pre-line">${preview(s.reminderTemplate)}</div></div></div>
            </div>
          </div>
        </section>
      </div>`);
  };

  const askName = async (title, value) => {
    let name = null;
    const r = await openModal({
      title, icon: 'pencil',
      dirty: true,
      body: html`<form class="form" novalidate><label class="field"><span class="field__label">الاسم</span><input class="input" name="n" value="${value}"></label></form>`,
      actions: [{ label: 'حفظ', value: 'ok', variant: 'primary' }, { label: 'إغلاق', value: null }],
      onOpen(d, close) { d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); close('ok'); }); d.querySelector('input').select(); },
      beforeClose(v, d) { if (v !== 'ok') return true; name = /** @type {HTMLInputElement} */ (d.querySelector('input')).value.trim(); return !!name; },
    });
    return r === 'ok' ? name : null;
  };

  body.addEventListener('change', async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const rowEl = t.closest('[data-wd]');
    const s = getSchedule();
    if (rowEl) {
      const wd = rowEl.dataset.wd;
      const h = { ...s.hours[wd] };
      if (t.matches('[data-open]')) h.open = t.checked;
      if (t.matches('[data-from]')) h.from = Number(t.value);
      if (t.matches('[data-to]')) h.to = Number(t.value);
      if (h.to <= h.from) { toastError('وقت النهاية يجب أن يكون بعد وقت البداية'); draw(); return; }
      await saveSchedule({ hours: { ...s.hours, [wd]: h } });
      draw();
      return;
    }
    if (t.id === 'slot') { await saveSchedule({ slotMin: Number(t.value) }); toastSuccess('تم الحفظ'); }
    if (t.id === 'defdur') { await saveSchedule({ defaultDuration: Number(t.value) }); toastSuccess('تم الحفظ'); }
  }, { signal });

  body.addEventListener('input', (e) => {
    if (/** @type {HTMLElement} */ (e.target).id === 'tpl') body.querySelector('#tpl-preview').textContent = preview(/** @type {HTMLTextAreaElement} */ (e.target).value);
  }, { signal });

  on(body, 'click', '[data-ph]', (_, b) => {
    const ta = /** @type {HTMLTextAreaElement} */ (body.querySelector('#tpl'));
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + b.dataset.ph + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, { signal });
  on(body, 'click', '[data-save-tpl]', async () => { await saveSchedule({ reminderTemplate: /** @type {HTMLTextAreaElement} */ (body.querySelector('#tpl')).value }); toastSuccess('تم حفظ نص الرسالة'); }, { signal });
  on(body, 'click', '[data-reset-tpl]', () => {
    const ta = /** @type {HTMLTextAreaElement} */ (body.querySelector('#tpl'));
    ta.value = DEFAULT_SCHEDULE.reminderTemplate;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, { signal });
  on(body, 'click', '[data-add-chair]', async () => { const name = await askName('كرسي جديد', tr`الكرسي ${getSchedule().chairs.length + 1}`); if (name) { await addChair(name); draw(); } }, { signal });
  on(body, 'click', '[data-rename-chair]', async (_, b) => {
    const s = getSchedule();
    const c = s.chairs.find((x) => x.id === b.dataset.renameChair);
    const name = await askName('إعادة تسمية الكرسي', c.name);
    if (name) { await saveSchedule({ chairs: s.chairs.map((x) => (x.id === c.id ? { ...x, name } : x)) }); draw(); }
  }, { signal });
  on(body, 'click', '[data-toggle-chair]', async (_, b) => {
    const s = getSchedule();
    await saveSchedule({ chairs: s.chairs.map((x) => (x.id === b.dataset.toggleChair ? { ...x, active: x.active === false } : x)) });
    draw();
  }, { signal });

  draw();
}
