/** Users list + add/edit dialog with per-user permission overrides. */
import { DASHBOARD_CARDS } from '../../core/dashboard-cards.js';
import { html, ico, render, on, formData, showFieldErrors } from '../../core/dom.js';
import { initials } from '../../core/text.js';
import { formatDateTime, digits } from '../../core/format.js';
import { validate, required } from '../../core/validate.js';
import { currentUser } from '../../core/session.js';
import { ADMIN_ROLE_ID, effectivePermissions, diffOverrides, countOverrides } from '../../core/permissions.js';
import { onEvent } from '../../core/bus.js';
import { mountTable, searchRows } from '../../components/table.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { openMenu } from '../../components/menu.js';
import { textField, selectField, passwordField, enhancePasswordFields } from '../../components/form.js';
import { permissionGrid, readPermissionGrid, enhancePermissionGrid } from '../../components/permission-grid.js';
import { toastSuccess, toastError } from '../../components/toast.js';
import { listUsers, listRoles, createUser, updateUser, resetPassword, deleteUser, clearPin, USER_COLORS } from '../../services/users.js';
import { validatePassword, validateUsername, passwordStrength } from '../../services/auth.js';

const COLOR_LABELS = { violet: 'بنفسجي', lime: 'ليموني', info: 'أزرق', warning: 'برتقالي', success: 'أخضر', danger: 'أحمر' };
const ROLE_TONES = { admin: 'primary', doctor: 'accent', nurse: 'info', reception: 'warning' };

export async function renderTab({ body, actions, signal }) {
  render(actions, html`<button type="button" class="btn btn--primary" data-add-user>${ico('user-plus')} مستخدم جديد</button>`);
  render(body, html`
    <div class="toolbar">
      <div class="input-group toolbar__search">${ico('search', { size: 20 })}<input class="input input--pill" type="search" id="user-search" placeholder="ابحث بالاسم أو اسم المستخدم…" aria-label="بحث في المستخدمين"></div>
      <div class="chips" role="group" aria-label="تصفية الحالة">
        <button type="button" class="chip" data-filter="all" aria-pressed="true">الكل</button>
        <button type="button" class="chip" data-filter="active" aria-pressed="false">المفعّلون</button>
        <button type="button" class="chip" data-filter="inactive" aria-pressed="false">الموقوفون</button>
      </div>
    </div>
    <div id="users-table"></div>`);

  let users = [], roles = [], filter = 'all', q = '';
  const roleById = () => Object.fromEntries(roles.map((r) => [r.id, r]));
  const me = currentUser();

  const table = mountTable(body.querySelector('#users-table'), {
    signal,
    caption: 'المستخدمون',
    sort: { key: 'name', dir: 'asc' },
    empty: { icon: 'users', title: 'لا يوجد مستخدمون مطابقون', hint: 'جرّب بحثًا آخر أو أضف مستخدمًا جديدًا.' },
    rows: [],
    columns: [
      { key: 'name', label: 'المستخدم', sortable: true, value: (u) => u.displayName, render: (u) => html`
        <span class="cell-person">
          <span class="avatar avatar--c-${u.color || 'violet'}">${initials(u.displayName.replace(/^د\.\s*/, ''))}</span>
          <span class="cell-person__text"><strong>${u.displayName}${u.id === me?.id ? html` <span class="badge badge--accent">أنت</span>` : ''}</strong><span class="cell-person__sub ltr">${u.username}</span></span>
        </span>` },
      { key: 'role', label: 'الدور', sortable: true, value: (u) => roleById()[u.roleId]?.name, render: (u) => html`
        <span class="badge badge--${ROLE_TONES[u.roleId] ?? 'primary'}">${roleById()[u.roleId]?.name ?? '—'}</span>
        ${countOverrides(u.permOverrides) ? html` <span class="badge" title="صلاحيات مخصصة لهذا المستخدم">${ico('shield-check', { size: 14 })} ${digits(countOverrides(u.permOverrides))} مخصصة</span>` : ''}` },
      { key: 'status', label: 'الحالة', render: (u) => html`
        <span class="badge badge--dot ${u.active ? 'badge--success' : 'badge--danger'}">${u.active ? 'مفعّل' : 'موقوف'}</span>
        ${u.isDoctor ? html` <span class="badge">${ico('stethoscope', { size: 14 })} طبيب</span>` : ''}
        ${u.hasPin ? html` <span class="badge">PIN</span>` : ''}
        ${u.mustChangePassword ? html` <span class="badge badge--warning">لم يغيّر كلمة المرور</span>` : ''}` },
      { key: 'lastLoginAt', label: 'آخر دخول', sortable: true, render: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : html`<span class="muted">لم يدخل بعد</span>`) },
      { key: 'actions', label: 'إجراءات', render: (u) => html`
        <div class="table__actions">
          <button type="button" class="btn btn--icon btn--sm" data-edit="${u.id}" aria-label="تعديل ${u.displayName}">${ico('pencil', { size: 18 })}</button>
          <button type="button" class="btn btn--icon btn--sm" data-more="${u.id}" aria-label="المزيد لـ ${u.displayName}" aria-haspopup="menu">${ico('ellipsis-vertical', { size: 18 })}</button>
        </div>` },
    ],
  });

  const refresh = async () => {
    [users, roles] = await Promise.all([listUsers(), listRoles()]);
    let rows = searchRows(users, q, ['displayName', 'username']);
    if (filter === 'active') rows = rows.filter((u) => u.active);
    if (filter === 'inactive') rows = rows.filter((u) => !u.active);
    table.update(rows);
  };

  body.querySelector('#user-search').addEventListener('input', (e) => { q = /** @type {HTMLInputElement} */ (e.target).value; refresh(); }, { signal });
  on(body, 'click', '[data-filter]', (_, chip) => {
    filter = chip.dataset.filter;
    body.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    refresh();
  }, { signal });
  on(actions, 'click', '[data-add-user]', () => openUserDialog(null, roles).then((saved) => saved && refresh()), { signal });
  on(body, 'click', '[data-edit]', (_, b) => openUserDialog(users.find((u) => u.id === b.dataset.edit), roles).then((saved) => saved && refresh()), { signal });
  on(body, 'click', '[data-more]', (_, b) => {
    const u = users.find((x) => x.id === b.dataset.more);
    openMenu(b, {
      items: [
        { label: 'تعيين كلمة مرور مؤقتة', icon: 'key-round', onSelect: () => openResetDialog(u).then(refresh) },
        ...(u.hasPin ? [{ label: 'إزالة الرمز السريع', icon: 'lock', onSelect: async () => { await clearPin(u.id); toastSuccess('تمت إزالة الرمز'); refresh(); } }] : []),
        { label: u.active ? 'إيقاف الحساب' : 'تفعيل الحساب', icon: u.active ? 'circle-x' : 'circle-check', onSelect: () => toggleActive(u).then(refresh) },
        'sep',
        { label: 'حذف المستخدم', icon: 'trash-2', danger: true, onSelect: () => removeUser(u).then(refresh) },
      ],
    });
  }, { signal });

  const off = onEvent('data:changed', ({ store }) => { if (store === 'users' || store === 'roles') refresh(); });
  await refresh();
  return off;
}

async function toggleActive(u) {
  if (u.active) {
    const ok = await confirmDialog({
      title: `إيقاف حساب ${u.displayName}؟`,
      message: 'لن يستطيع الدخول إلى البرنامج حتى يُعاد تفعيله. بياناته وسجلاته تبقى كما هي.',
      confirmLabel: 'إيقاف', danger: true,
    });
    if (!ok) return;
  }
  try {
    await updateUser(u.id, { active: !u.active });
    toastSuccess(u.active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب');
  } catch (err) { toastError(err.message); }
}

async function removeUser(u) {
  const ok = await confirmDialog({
    title: `حذف ${u.displayName}؟`,
    message: 'سيختفي من القوائم ولن يستطيع الدخول. اسمه يبقى ظاهرًا على السجلات التي أنشأها. يُفضّل «إيقاف الحساب» إذا كان مؤقتًا.',
    confirmLabel: 'حذف', danger: true,
  });
  if (!ok) return;
  try { await deleteUser(u.id); toastSuccess('تم حذف المستخدم'); } catch (err) { toastError(err.message); }
}

async function openResetDialog(u) {
  const res = await openModal({
    title: `كلمة مرور مؤقتة لـ ${u.displayName}`,
    icon: 'key-round',
    body: html`
      <form class="form" novalidate>
        <p class="muted">أعطِ الموظف هذه الكلمة شفهيًا. سيُطلب منه اختيار كلمة مرور جديدة عند أول دخول.</p>
        ${passwordField({ name: 'password', label: 'كلمة المرور المؤقتة', required: true, meter: true })}
      </form>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) {
      const f = d.querySelector('form');
      enhancePasswordFields(f, passwordStrength);
      f.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
      f.querySelector('input').focus();
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const f = d.querySelector('form');
      const { password } = formData(f);
      const err = validatePassword(password, u.username);
      if (!showFieldErrors(f, err ? { password: err } : {})) return false;
      try { await resetPassword(u.id, password); return true; } catch (e) { showFieldErrors(f, { password: e.message }); return false; }
    },
  });
  if (res === 'save') toastSuccess('تم تعيين كلمة المرور المؤقتة');
}

/**
 * Add / edit user. @returns {Promise<boolean>} saved
 * @param {object|null} user @param {object[]} roles
 */
async function openUserDialog(user, roles) {
  const isNew = !user;
  const me = currentUser();
  const nonAdminDefault = roles.find((r) => r.id === 'reception') ?? roles.find((r) => r.id !== ADMIN_ROLE_ID) ?? roles[0];
  let roleId = user?.roleId ?? nonAdminDefault?.id;
  let overrides = structuredClone(user?.permOverrides ?? {});

  const gridSection = () => {
    const role = roles.find((r) => r.id === roleId);
    if (roleId === ADMIN_ROLE_ID) {
      return html`<div class="alert">${ico('shield-check')}<div class="alert__content"><div class="alert__body">مدير النظام يملك كل الصلاحيات، ولا يمكن تقييده.</div></div></div>`;
    }
    return html`
      <details class="card card--flat" ${countOverrides(overrides) ? 'open' : ''}>
        <summary class="card__body row row--between" style="cursor:pointer; padding-block: var(--sp-4)">
          <span class="stack-sm"><strong>صلاحيات خاصة لهذا المستخدم (اختياري)</strong>
          <span class="muted text-sm">تبدأ من صلاحيات دور «${role?.name}». أي خانة تغيّرها هنا تخص هذا المستخدم وحده.</span></span>
          ${ico('chevron-down')}
        </summary>
        <div class="card__body stack" style="padding-block-start: 0">
          <div class="legend"><span class="legend__item"><span class="legend__swatch"></span> مختلفة عن صلاحيات الدور</span></div>
          ${permissionGrid({ value: effectivePermissions(role, { permOverrides: overrides }), base: role?.permissions, caption: 'صلاحيات المستخدم' })}
          <button type="button" class="btn btn--ghost btn--sm" data-reset-overrides style="align-self:flex-start">${ico('refresh-cw', { size: 16 })} إرجاع لصلاحيات الدور</button>
        </div>
      </details>`;
  };

  const res = await openModal({
    title: isNew ? 'مستخدم جديد' : `تعديل ${user.displayName}`,
    dirty: true,
    icon: isNew ? 'user-plus' : 'pencil',
    size: 'lg',
    body: html`
      <form class="form" novalidate id="f-user">
        <div class="form-grid" style="grid-template-columns: 120px minmax(0, 1fr)">
          ${textField({ name: 'title', label: 'اللقب', value: user?.title ?? '', placeholder: 'د.' })}
          ${textField({ name: 'displayName', label: 'الاسم', value: user ? user.displayName.replace(new RegExp(`^${(user.title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '') : '', required: true })}
        </div>
        <div class="form-grid">
          ${isNew
            ? textField({ name: 'username', label: 'اسم المستخدم (للدخول)', required: true, ltr: true, hint: 'حروف إنجليزية صغيرة أو أرقام', autocomplete: 'off' })
            : html`<div class="field"><span class="field__label">اسم المستخدم</span><input class="input input--ltr" value="${user.username}" disabled aria-label="اسم المستخدم"></div>`}
          ${selectField({ name: 'roleId', label: 'الدور', value: roleId, required: true, options: roles.map((r) => ({ value: r.id, label: r.name })) })}
        </div>
        ${isNew ? html`<div class="form-grid">
          ${passwordField({ name: 'password', label: 'كلمة مرور مؤقتة', required: true, meter: true, hint: 'سيغيّرها الموظف عند أول دخول' })}
          ${textField({ name: 'pin', label: 'رمز سريع PIN (اختياري)', type: 'password', ltr: true, inputmode: 'numeric', hint: '4–6 أرقام' })}
        </div>` : ''}
        <div class="row" style="gap: var(--sp-6)">
          <label class="check"><input type="checkbox" name="isDoctor" ${user?.isDoctor ? 'checked' : ''}> طبيب معالج (يظهر في المواعيد)</label>
          <fieldset class="row" style="border:0;padding:0;margin:0;gap:var(--sp-2)">
            <legend class="field__label" style="float:inline-start;margin-inline-end:var(--sp-2)">لون الحساب</legend>
            ${USER_COLORS.map((c) => html`<label class="chip" title="${COLOR_LABELS[c]}"><input type="radio" name="color" value="${c}" ${(user?.color ?? 'violet') === c ? 'checked' : ''}><span class="avatar avatar--c-${c}" style="inline-size:22px;block-size:22px"></span><span class="visually-hidden">${COLOR_LABELS[c]}</span></label>`)}
          </fieldset>
        </div>
        <div id="grid-slot">${gridSection()}</div>
        <details class="card card--flat" ${Array.isArray(user?.dashboardCards) ? 'open' : ''}>
          <summary class="card__body row row--between" style="cursor:pointer; padding-block: var(--sp-4)">
            <span class="stack-sm"><strong>كروت الشاشة الرئيسية</strong>
            <span class="muted text-sm">اختر ما يظهر لهذا المستخدم في الصفحة الرئيسية. الكارت يظهر فقط إذا كانت لديه صلاحية القسم الخاص به.</span></span>
            ${ico('chevron-down')}
          </summary>
          <div class="card__body dash-cards-pick" style="padding-block-start: 0">
            ${DASHBOARD_CARDS.map((c) => html`<label class="check"><input type="checkbox" data-dash-card value="${c.key}" ${!Array.isArray(user?.dashboardCards) || user.dashboardCards.includes(c.key) ? 'checked' : ''}> ${c.label}</label>`)}
          </div>
        </details>
      </form>`,
    actions: [{ label: isNew ? 'إضافة المستخدم' : 'حفظ التعديلات', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    onOpen(d, close) {
      const form = d.querySelector('form');
      enhancePasswordFields(form, passwordStrength);
      const slot = d.querySelector('#grid-slot');
      const wireGrid = () => enhancePermissionGrid(slot, () => {
        const role = roles.find((r) => r.id === roleId);
        overrides = diffOverrides(role, readPermissionGrid(slot));
      });
      wireGrid();
      form.querySelector('[name=roleId]').addEventListener('change', (e) => {
        const next = /** @type {HTMLSelectElement} */ (e.target).value;
        if (countOverrides(overrides)) toastSuccess('تمت إعادة الصلاحيات الخاصة إلى صلاحيات الدور الجديد');
        roleId = next;
        overrides = {};
        render(slot, gridSection());
      });
      slot.addEventListener('click', (e) => {
        if (!(/** @type {HTMLElement} */ (e.target)).closest('[data-reset-overrides]')) return;
        overrides = {};
        render(slot, gridSection());
        slot.querySelector('details')?.setAttribute('open', '');
      });
      form.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
      form.querySelector('input:not([disabled])')?.focus();
    },
    async beforeClose(v, d) {
      if (v !== 'save') return true;
      const form = d.querySelector('form');
      const data = formData(form);
      const errors = validate(data, {
        displayName: (x) => required(x, 'الاسم'),
        ...(isNew ? {
          username: (x) => validateUsername(x),
          password: (x) => validatePassword(x, data.username),
        } : {}),
      });
      if (!showFieldErrors(form, errors)) return false;
      const displayName = [data.title.trim(), data.displayName.trim()].filter(Boolean).join(' ');
      const picked = [...form.querySelectorAll('[data-dash-card]:checked')].map((i) => /** @type {HTMLInputElement} */ (i).value);
      const dashboardCards = picked.length === DASHBOARD_CARDS.length ? null : picked;
      try {
        if (isNew) {
          const created = await createUser({ displayName, title: data.title, username: data.username, password: data.password, pin: data.pin || undefined, roleId: data.roleId, isDoctor: data.isDoctor, color: data.color });
          if (countOverrides(overrides) || dashboardCards) await updateUser(created.id, { permOverrides: overrides, dashboardCards });
        } else {
          await updateUser(user.id, { displayName, title: data.title.trim(), roleId: data.roleId, isDoctor: data.isDoctor, color: data.color, permOverrides: data.roleId === ADMIN_ROLE_ID ? {} : overrides, dashboardCards });
        }
        return true;
      } catch (err) {
        const field = /اسم المستخدم/.test(err.message) ? 'username' : /الدور|المدير/.test(err.message) ? 'roleId' : /PIN|الرمز/.test(err.message) ? 'pin' : /كلمة المرور/.test(err.message) ? 'password' : 'displayName';
        showFieldErrors(form, { [field]: err.message });
        if (field === 'displayName' && !/الاسم/.test(err.message)) toastError(err.message);
        return false;
      }
    },
  });
  if (res === 'save') {
    toastSuccess(isNew ? 'تمت إضافة المستخدم' : 'تم حفظ التعديلات');
    if (!isNew && user.id === me?.id) toastSuccess('تم تحديث صلاحياتك');
  }
  return res === 'save';
}
