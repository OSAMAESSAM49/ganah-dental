/**
 * Follow-ups: today / overdue / upcoming calls, check-ups and recalls created when
 * treatments are completed (or added by hand), with one-click WhatsApp messages.
 * Second tab: post-op instruction templates and the WhatsApp message texts.
 */
import { html, ico, render, on, formData } from '../../core/dom.js';
import { digits, todayISO } from '../../core/format.js';
import { addDays } from '../../core/time.js';
import { FOLLOWUP_TYPES } from '../../core/labels.js';
import { normalizeArabic } from '../../core/text.js';
import { can } from '../../core/permissions.js';
import { href } from '../../core/router.js';
import { onEvent } from '../../core/bus.js';
import { openModal } from '../../components/modal.js';
import { textField, textareaField } from '../../components/form.js';
import { emptyState } from '../../components/states.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { listFollowUps, listTemplates, saveTemplate, setTemplateActive, getMessages, saveMessages, DEFAULT_MESSAGES } from '../../services/followups.js';
import { renderRows, wireFollowUpRows, newFollowUpDialog } from './shared.js';

const TABS = [['list', 'المتابعات', 'bell'], ['templates', 'التعليمات والرسائل', 'file-text']];
const FILTERS = { due: 'المطلوبة الآن', today: 'اليوم', overdue: 'متأخرة', upcoming: 'القادمة', done: 'تمت', all: 'الكل' };
const PLACEHOLDERS = ['{الاسم}', '{الاسم_الكامل}', '{الإجراء}', '{العيادة}', '{هاتف_العيادة}', '{التعليمات}'];
const MESSAGE_LABELS = { instructions: 'رسالة تعليمات ما بعد العلاج', call: 'رسالة اتصال الاطمئنان', check: 'رسالة فحص المتابعة', recall: 'رسالة الاستدعاء الدوري' };

async function templateDialog(tpl) {
  let saved = null;
  await openModal({
    title: tpl ? 'تعديل قالب التعليمات' : 'قالب تعليمات جديد',
    icon: 'file-text', size: 'lg',
    body: html`<form class="form" novalidate>
      ${textField({ name: 'name', label: 'اسم القالب', value: tpl?.name ?? '', required: true, placeholder: 'مثال: بعد الخلع' })}
      ${textareaField({ name: 'body', label: 'التعليمات', value: tpl?.body ?? '', rows: 10, hint: 'سطر لكل تعليمة. تُرسل للمريض على واتساب ويمكن طباعتها.' })}
    </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      try { saved = await saveTemplate(tpl?.id, formData(d.querySelector('form'))); return true; } catch (err) { toastError(err.message); return false; }
    },
  });
  if (saved) toastSuccess('تم حفظ القالب');
}

export default {
  title: 'المتابعات',
  async render({ el, query, signal }) {
    const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'list';
    const perm = { create: can('followups', 'create'), edit: can('followups', 'edit') };
    const st = { filter: query.filter && FILTERS[query.filter] ? query.filter : 'due', type: '', q: '' };
    let all = [];

    render(el, html`
      <header class="page-header">
        <div class="page-header__text"><h1 class="page-header__title">المتابعات</h1>
          <p class="page-header__sub">اتصالات الاطمئنان وفحوص المتابعة والاستدعاء الدوري — تُنشأ تلقائيًا عند انتهاء العلاج</p></div>
        <div class="page-header__actions">${perm.create && tab === 'list' ? html`<button type="button" class="btn btn--primary" data-new>${ico('plus')} متابعة جديدة</button>` : ''}
          ${perm.edit && tab === 'templates' ? html`<button type="button" class="btn btn--primary" data-new-tpl>${ico('plus')} قالب تعليمات</button>` : ''}</div>
      </header>
      <nav class="tabs" aria-label="أقسام المتابعات">
        ${TABS.map(([k, label, icon]) => html`<a class="tab" href="${href('/followups', {}, k === 'list' ? undefined : { tab: k })}" aria-selected="${String(k === tab)}">${ico(icon, { size: 18 })} ${label}</a>`)}
      </nav>
      <div id="fu-body"></div>`);
    const body = el.querySelector('#fu-body');

    /* ---------- List ---------- */
    const groups = (today = todayISO()) => {
      const pending = all.filter((f) => f.status === 'pending');
      return {
        due: pending.filter((f) => f.dueDate <= today),
        today: pending.filter((f) => f.dueDate === today),
        overdue: pending.filter((f) => f.dueDate < today),
        upcoming: pending.filter((f) => f.dueDate > today),
        done: all.filter((f) => f.status !== 'pending').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
        all: [...all].reverse(),
      };
    };
    const drawList = () => {
      const g = groups();
      const rows = g[st.filter].filter((f) => (!st.type || f.type === st.type) && (!st.q || normalizeArabic(`${f.patientName} ${f.procedureName} ${f.note}`).includes(normalizeArabic(st.q))));
      const weekAhead = g.upcoming.filter((f) => f.dueDate <= addDays(todayISO(), 7)).length;
      render(body.querySelector('#fu-summary'), html`
        <div class="totals__item totals__item--hero"><div class="totals__label">مطلوبة اليوم</div><div class="totals__value">${digits(g.today.length)}</div></div>
        <div class="totals__item"><div class="totals__label">متأخرة</div><div class="totals__value">${digits(g.overdue.length)}</div></div>
        <div class="totals__item"><div class="totals__label">خلال 7 أيام</div><div class="totals__value">${digits(weekAhead)}</div></div>`);
      render(body.querySelector('#fu-chips'), html`${Object.entries(FILTERS).map(([k, label]) => html`<button type="button" class="chip" data-filter="${k}" aria-pressed="${String(k === st.filter)}">${k === 'overdue' ? ico('triangle-alert', { size: 16 }) : ''}${label} <span class="chip__count">${digits(g[k].length)}</span></button>`)}`);
      renderRows(body.querySelector('#fu-rows'), rows, { showPatient: true }, emptyState({
        icon: 'bell',
        title: st.filter === 'due' || st.filter === 'today' ? 'لا توجد متابعات مطلوبة الآن 🎉' : st.filter === 'overdue' ? 'لا توجد متابعات متأخرة' : 'لا توجد متابعات',
        hint: 'عند انتهاء علاج له جدول متابعة (مثل الخلع أو حشو العصب) تُضاف متابعاته هنا تلقائيًا.',
      }));
    };
    const listTab = async () => {
      render(body, html`
        <div class="totals" id="fu-summary" style="margin-block-end: var(--sp-4)"></div>
        <div class="toolbar">
          <div class="input-group toolbar__search">${ico('search', { size: 20 })}<input class="input input--pill" id="fq" placeholder="ابحث باسم المريض أو الإجراء…" aria-label="بحث"></div>
          <select class="select input--pill" id="ftype" style="inline-size:auto" aria-label="النوع"><option value="">كل الأنواع</option>${Object.entries(FOLLOWUP_TYPES).map(([k, t]) => html`<option value="${k}">${t.label}</option>`)}</select>
        </div>
        <div class="chips" id="fu-chips" style="margin-block-end: var(--sp-4)"></div>
        <section class="card"><div class="card__body" id="fu-rows"></div></section>`);
      all = await listFollowUps();
      drawList();
    };
    on(el, 'click', '[data-filter]', (_, b) => { st.filter = b.dataset.filter; drawList(); }, { signal });
    on(el, 'input', '#fq', (_, i) => { st.q = i.value; drawList(); }, { signal });
    on(el, 'change', '#ftype', (_, s) => { st.type = s.value; drawList(); }, { signal });
    on(el, 'click', '[data-new]', () => newFollowUpDialog(), { signal });
    wireFollowUpRows(body, (id) => all.find((f) => f.id === id), signal);

    /* ---------- Templates & messages ---------- */
    let templates = [];
    const templatesTab = async () => {
      templates = await listTemplates({ includeInactive: true });
      const msgs = getMessages();
      render(body, html`
        <div class="bento">
          <section class="card span-12">
            <div class="card__header"><div class="card__heading"><h2 class="card__title">قوالب تعليمات ما بعد العلاج</h2>
              <p class="card__subtitle">اربط كل قالب بالإجراءات من «الإجراءات والأسعار». يُعرض إرساله بعد انتهاء العلاج مباشرة.</p></div></div>
            <div class="card__body">${templates.length ? html`<div class="tpl-grid">${templates.map((t) => html`
              <article class="tpl-card ${t.active === false ? 'tpl-card--off' : ''}">
                <header class="tpl-card__head"><strong>${t.name}</strong>${t.active === false ? html`<span class="badge">موقوف</span>` : ''}</header>
                <p class="tpl-card__body">${t.body}</p>
                ${perm.edit ? html`<footer class="row"><button type="button" class="btn btn--soft btn--sm" data-edit-tpl="${t.id}">${ico('pencil', { size: 16 })} تعديل</button>
                  <button type="button" class="btn btn--ghost btn--sm" data-toggle-tpl="${t.id}">${t.active === false ? 'تفعيل' : 'إيقاف'}</button></footer>` : ''}
              </article>`)}</div>` : emptyState({ icon: 'file-text', title: 'لا توجد قوالب' })}</div>
          </section>
          <section class="card span-12">
            <div class="card__header"><div class="card__heading"><h2 class="card__title">نصوص رسائل واتساب</h2>
              <p class="card__subtitle">الكلمات بين الأقواس تُستبدل تلقائيًا: ${PLACEHOLDERS.map((p) => html`<code>${p}</code> `)}</p></div></div>
            <div class="card__body">
              <form class="form" id="msg-form" novalidate>
                ${Object.entries(MESSAGE_LABELS).map(([k, label]) => html`<div class="stack-sm">
                  ${textareaField({ name: k, label, value: msgs[k], rows: k === 'instructions' ? 5 : 3, attrs: perm.edit ? '' : html`readonly` })}
                  ${perm.edit && msgs[k] !== DEFAULT_MESSAGES[k] ? html`<button type="button" class="link-btn" data-reset-msg="${k}" style="align-self:flex-start">استعادة النص الافتراضي</button>` : ''}</div>`)}
                ${perm.edit ? html`<div><button type="submit" class="btn btn--primary">${ico('save')} حفظ الرسائل</button></div>` : ''}
              </form>
            </div>
          </section>
        </div>`);
    };
    on(el, 'click', '[data-new-tpl]', () => templateDialog(null), { signal });
    on(el, 'click', '[data-edit-tpl]', (_, b) => templateDialog(templates.find((t) => t.id === b.dataset.editTpl)), { signal });
    on(el, 'click', '[data-toggle-tpl]', async (_, b) => { const t = templates.find((x) => x.id === b.dataset.toggleTpl); await setTemplateActive(t.id, t.active === false); }, { signal });
    on(el, 'click', '[data-reset-msg]', (_, b) => { /** @type {HTMLTextAreaElement} */ (el.querySelector(`[name=${b.dataset.resetMsg}]`)).value = DEFAULT_MESSAGES[b.dataset.resetMsg]; b.remove(); }, { signal });
    on(el, 'submit', '#msg-form', async (e, f) => {
      e.preventDefault();
      const data = formData(/** @type {HTMLFormElement} */ (f));
      await saveMessages(Object.fromEntries(Object.keys(MESSAGE_LABELS).map((k) => [k, data[k].trim() || DEFAULT_MESSAGES[k]])));
      toastSuccess('تم حفظ نصوص الرسائل');
      templatesTab();
    }, { signal });

    const load = tab === 'list' ? listTab : templatesTab;
    const off = onEvent('data:changed', async ({ store }) => {
      if (tab === 'list' && store === 'followUps') { all = await listFollowUps(); drawList(); }
      if (tab === 'templates' && store === 'instructionTemplates') templatesTab();
    });
    await load();
    return off;
  },
};
