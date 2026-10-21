/** Roles: list on one side, permission grid editor on the other. */
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { digits } from '../../core/format.js';
import { setLeaveGuard } from '../../core/router.js';
import { ADMIN_ROLE_ID } from '../../core/permissions.js';
import { permissionGrid, readPermissionGrid, enhancePermissionGrid } from '../../components/permission-grid.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { textField, selectField } from '../../components/form.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { listRoles, roleUsage, createRole, updateRole, deleteRole } from '../../services/users.js';

export async function renderTab({ body, actions, query, signal }) {
  render(actions, html`<button type="button" class="btn btn--primary" data-add-role>${ico('plus')} دور جديد</button>`);
  let roles = await listRoles();
  let usage = await roleUsage();
  let selectedId = roles.find((r) => r.id === query.role)?.id ?? roles[1]?.id ?? roles[0]?.id;
  let dirty = false;

  const setDirty = (v) => {
    dirty = v;
    const bar = body.querySelector('#role-savebar');
    if (bar) bar.hidden = !v;
    setLeaveGuard(v ? () => confirmDialog({ title: 'تغييرات غير محفوظة', message: 'لم تحفظ تعديلات الصلاحيات. هل تريد المغادرة بدون حفظ؟', confirmLabel: 'مغادرة بدون حفظ', danger: true }) : null);
  };

  const draw = () => {
    const role = roles.find((r) => r.id === selectedId);
    const locked = role?.id === ADMIN_ROLE_ID;
    render(body, html`
      <div class="bento">
        <aside class="card span-4" aria-label="الأدوار">
          <div class="card__header"><div class="card__heading"><h2 class="card__title">الأدوار</h2><p class="card__subtitle">اختر دورًا لتعديل صلاحياته</p></div></div>
          <div class="card__body">
            <div class="role-list">
              ${roles.map((r) => html`
                <button type="button" class="role-item" data-role="${r.id}" aria-current="${String(r.id === selectedId)}">
                  <span class="kpi__icon" style="inline-size:40px;block-size:40px">${ico(r.id === ADMIN_ROLE_ID ? 'shield-check' : r.id === 'doctor' ? 'stethoscope' : r.id === 'nurse' ? 'heart-pulse' : r.id === 'reception' ? 'phone' : 'user', { size: 20 })}</span>
                  <span class="role-item__text">
                    <span class="role-item__name">${r.name}</span>
                    <span class="role-item__meta">${digits(usage[r.id] ?? 0)} مستخدم${r.system ? ' · أساسي' : ''}</span>
                  </span>
                  ${r.id === ADMIN_ROLE_ID ? ico('lock', { size: 16 }) : ''}
                </button>`)}
            </div>
          </div>
        </aside>
        <section class="card span-8" aria-labelledby="role-title">
          <div class="card__header">
            <div class="card__heading">
              <h2 class="card__title" id="role-title">صلاحيات «${role?.name ?? ''}»</h2>
              <p class="card__subtitle">${locked ? 'مدير النظام يملك كل الصلاحيات دائمًا.' : 'الإضافة أو التعديل أو الحذف تتطلب «عرض». ما لا يُسمح بعرضه يختفي من القوائم.'}</p>
            </div>
            ${locked ? '' : html`<div class="row">
              <button type="button" class="btn btn--sm" data-rename>${ico('pencil', { size: 16 })} إعادة تسمية</button>
              ${role?.system ? '' : html`<button type="button" class="btn btn--sm btn--ghost" data-delete-role style="color: var(--c-danger)">${ico('trash-2', { size: 16 })} حذف</button>`}
            </div>`}
          </div>
          <div class="card__body stack" id="grid-wrap">
            ${role ? permissionGrid({ value: role.permissions, locked, caption: `صلاحيات ${role.name}` }) : ''}
            <div class="row" id="role-savebar" hidden>
              <button type="button" class="btn btn--primary" data-save>${ico('save')} حفظ الصلاحيات</button>
              <button type="button" class="btn btn--ghost" data-discard>تجاهل التغييرات</button>
            </div>
          </div>
        </section>
      </div>`);
    if (!locked) enhancePermissionGrid(body.querySelector('#grid-wrap'), () => setDirty(true));
  };

  const reload = async () => { roles = await listRoles(); usage = await roleUsage(); draw(); };

  on(body, 'click', '[data-role]', async (_, b) => {
    if (b.dataset.role === selectedId) return;
    if (dirty && !(await confirmDialog({ title: 'تغييرات غير محفوظة', message: 'هل تريد تجاهل التعديلات على هذا الدور؟', confirmLabel: 'تجاهل', danger: true }))) return;
    setDirty(false);
    selectedId = b.dataset.role;
    draw();
  }, { signal });

  on(body, 'click', '[data-save]', async (_, btn) => {
    btn.setAttribute('aria-busy', 'true');
    try {
      await updateRole(selectedId, { permissions: readPermissionGrid(body) });
      setDirty(false);
      toastSuccess('تم حفظ الصلاحيات. تُطبَّق فورًا على كل مستخدمي هذا الدور.');
      await reload();
    } catch (err) { toastError(err.message); btn.removeAttribute('aria-busy'); }
  }, { signal });

  on(body, 'click', '[data-discard]', () => { setDirty(false); draw(); }, { signal });

  on(body, 'click', '[data-rename]', async () => {
    const role = roles.find((r) => r.id === selectedId);
    const name = await askRoleName({ title: 'إعادة تسمية الدور', value: role.name });
    if (!name) return;
    try { await updateRole(role.id, { name }); toastSuccess('تم تغيير الاسم'); await reload(); } catch (err) { toastError(err.message); }
  }, { signal });

  on(body, 'click', '[data-delete-role]', async () => {
    const role = roles.find((r) => r.id === selectedId);
    if (!(await confirmDialog({ title: `حذف دور «${role.name}»؟`, message: 'لا يمكن حذف دور مُسند لمستخدمين.', confirmLabel: 'حذف', danger: true }))) return;
    try {
      await deleteRole(role.id);
      setDirty(false);
      selectedId = roles.find((r) => r.id !== role.id && r.id !== ADMIN_ROLE_ID)?.id;
      toastSuccess('تم حذف الدور');
      await reload();
    } catch (err) { toastError(err.message); }
  }, { signal });

  on(actions, 'click', '[data-add-role]', async () => {
    const res = await openModal({
      title: 'دور جديد',
      icon: 'shield-check',
      body: html`
        <form class="form" novalidate>
          ${textField({ name: 'name', label: 'اسم الدور', required: true, placeholder: 'مثال: محاسب' })}
          ${selectField({ name: 'copyFrom', label: 'ابدأ بصلاحيات', placeholder: 'بدون صلاحيات', options: roles.filter((r) => r.id !== ADMIN_ROLE_ID).map((r) => ({ value: r.id, label: r.name })) })}
        </form>`,
      actions: [{ label: 'إنشاء', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
      onOpen(d, close) { const f = d.querySelector('form'); f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); f.querySelector('input').focus(); },
      async beforeClose(v, d) {
        if (v !== 'save') return true;
        const f = d.querySelector('form');
        const data = formData(f);
        try {
          const role = await createRole(data);
          selectedId = role.id;
          return true;
        } catch (err) { showFieldErrors(f, { name: err.message }); return false; }
      },
    });
    if (res === 'save') { setDirty(false); toastSuccess('تم إنشاء الدور — حدّد صلاحياته الآن'); await reload(); }
  }, { signal });

  signal.addEventListener('abort', () => setLeaveGuard(null));
  draw();
}

async function askRoleName({ title, value }) {
  let name = null;
  const res = await openModal({
    title, icon: 'pencil',
    body: html`<form class="form" novalidate>${textField({ name: 'name', label: 'اسم الدور', value, required: true })}</form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) { const f = d.querySelector('form'); f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); }); f.querySelector('input').select(); },
    beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      name = formData(f).name.trim();
      return showFieldErrors(f, name ? {} : { name: 'اسم الدور مطلوب' });
    },
  });
  return res === 'save' ? name : null;
}
