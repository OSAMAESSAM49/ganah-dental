/**
 * App shell: floating sidebar, top bar, phone bottom nav, drawer behaviour, user menu.
 * The shell renders once; route changes only update the active link, title and layout.
 * Menu items the user cannot view are hidden (not just blocked).
 */
import { html, ico, on, render } from './dom.js';
import { NAV_GROUPS, BOTTOM_NAV, NAV_ITEMS } from './nav.js';
import { getPref, setPref } from './prefs.js';
import { cycleTheme, getTheme, THEME_ICONS, THEME_LABELS } from './theme.js';
import { onEvent } from './bus.js';
import { can } from './permissions.js';
import { getSession } from './session.js';
import { initials } from './text.js';
import { navigate } from './router.js';
import { brandMark } from '../components/brand.js';
import { getSettings } from '../data/settings.js';
import { toast } from '../components/toast.js';
import { openMenu } from '../components/menu.js';
import { confirmDialog } from '../components/modal.js';
import { logout } from '../services/auth.js';
import { openChangePasswordDialog, openPinDialog } from '../modules/account/dialogs.js';
import { attachPatientSearch } from '../components/patient-search.js';
import { backupStatus } from '../services/backup.js';

/** @type {HTMLElement} */
let app;
let currentPath = '/';

const canSee = (item) => can(item.module, 'view');
const isActive = (path, current) => (path === '/' ? current === '/' : current === path || current.startsWith(path + '/'));

function navMarkup(current) {
  return NAV_GROUPS.map((group) => {
    const items = group.items.filter(canSee);
    if (!items.length) return '';
    return html`
      <div class="nav-group">
        ${group.title ? html`<div class="nav-group__title">${group.title}</div>` : ''}
        ${items.map((item) => html`
          <a class="nav-link" href="#${item.path}" title="${item.label}" ${isActive(item.path, current) ? html`aria-current="page"` : ''}>
            ${ico(item.icon, { size: 22 })}
            <span class="nav-link__label">${item.label}</span>
            <span class="nav-link__dot" aria-hidden="true"></span>
          </a>`)}
      </div>`;
  });
}

function bottomMarkup(current) {
  const items = BOTTOM_NAV.map((p) => NAV_ITEMS.find((i) => i.path === p)).filter((i) => i && canSee(i));
  return html`
    ${items.map((item) => html`
      <a class="bottom-nav__item" href="#${item.path}" ${isActive(item.path, current) ? html`aria-current="page"` : ''}>
        ${ico(item.icon, { size: 22 })}<span>${item.label}</span>
      </a>`)}
    <button type="button" class="bottom-nav__item" data-action="open-drawer" aria-label="القائمة الكاملة">
      ${ico('menu', { size: 22 })}<span>المزيد</span>
    </button>`;
}

const avatar = (user) => html`<span class="avatar avatar--c-${user?.color || 'lime'}">${initials((user?.displayName ?? '؟').replace(/^د\.\s*/, ''))}</span>`;

function userChipMarkup() {
  const s = getSession();
  if (!s) return '';
  return html`${avatar(s.user)}
    <span class="user-chip__text">
      <span class="user-chip__name">${s.user.displayName}</span>
      <span class="user-chip__role">${s.role?.name ?? ''}</span>
    </span>
    ${ico('chevron-down', { size: 16 })}`;
}

function drawNav() {
  render(app.querySelector('.sidebar__nav'), html`${navMarkup(currentPath)}`);
  render(app.querySelector('.bottom-nav'), bottomMarkup(currentPath));
  render(app.querySelector('[data-action="user-menu"]'), userChipMarkup());
  const search = app.querySelector('.topbar__search');
  if (search) search.hidden = !can('patients', 'view');
  drawBackupCard();
}

/** Sidebar card: when the last backup was taken (only for users who can make backups). */
async function drawBackupCard() {
  const card = app.querySelector('[data-slot="sidebar-card"]');
  if (!card) return;
  if (!getSession() || !can('settings', 'edit')) { card.hidden = true; return; }
  const s = await backupStatus();
  card.hidden = false;
  card.dataset.due = s.due ? '1' : '';
  render(card, html`
    <div class="sidebar-card__title">${s.due ? 'حان وقت النسخ الاحتياطي' : 'بياناتك محفوظة على هذا الجهاز'}</div>
    <p class="sidebar-card__text">${s.lastAt
      ? (s.days === 0 ? 'آخر نسخة احتياطية: اليوم' : `آخر نسخة احتياطية: منذ ${s.days === 1 ? 'يوم' : s.days === 2 ? 'يومين' : `${s.days} ${s.days <= 10 ? 'أيام' : 'يومًا'}`}`)
      : 'لم تؤخذ أي نسخة احتياطية بعد.'}</p>
    <a class="btn btn--accent btn--sm btn--block" href="#/settings?tab=backup">${ico('database', { size: 18 })} ${s.due ? 'خذ نسخة الآن' : 'النسخ الاحتياطي'}</a>`);
}

function drawBrand() {
  const clinic = getSettings('clinic');
  render(app.querySelector('.sidebar__brand'), html`
    ${clinic.logo ? html`<img class="brand-mark" src="${clinic.logo}" alt="" style="object-fit:contain;background:#fff">` : brandMark({ size: 46 })}
    <span class="sidebar__brand-text">
      <span class="sidebar__brand-name">${clinic.shortName}</span>
      <span class="sidebar__brand-sub">${clinic.tagline}</span>
    </span>`);
}

function themeButton() {
  const t = getTheme();
  return html`${ico(THEME_ICONS[t], { size: 20 })}<span class="visually-hidden">المظهر: ${THEME_LABELS[t]}</span>`;
}

async function signOut({ switchUser = false } = {}) {
  if (!switchUser && !(await confirmDialog({ title: 'تسجيل الخروج؟', message: 'ستحتاج إلى كلمة المرور أو الرمز السريع للدخول مرة أخرى.', confirmLabel: 'تسجيل الخروج' }))) return;
  await logout('logout');
  navigate('/login', { replace: true });
}

function openUserMenu(anchor) {
  const s = getSession();
  if (!s) return;
  openMenu(anchor, {
    header: html`<div class="menu__header">${avatar(s.user)}<div class="menu__header-text"><strong>${s.user.displayName}</strong><small>${s.role?.name ?? ''} · <span class="ltr">${s.user.username}</span></small></div></div>`,
    items: [
      { label: 'تبديل المستخدم', icon: 'users', onSelect: () => signOut({ switchUser: true }) },
      { label: 'تغيير كلمة المرور', icon: 'key-round', onSelect: () => openChangePasswordDialog() },
      { label: s.user.hasPin ? 'تغيير الرمز السريع' : 'تعيين رمز سريع (PIN)', icon: 'lock', onSelect: () => openPinDialog() },
      'sep',
      { label: 'تسجيل الخروج', icon: 'log-out', danger: true, onSelect: () => signOut() },
    ],
  });
}

/** Renders the shell into #app and wires its controls. */
export function mountShell(root) {
  app = root;
  render(app, html`
    <aside class="sidebar" id="sidebar" aria-label="القائمة الرئيسية">
      <a class="sidebar__brand" href="#/"></a>
      <nav class="sidebar__nav"></nav>
      <div class="sidebar__footer">
        <div class="sidebar-card" data-slot="sidebar-card">
          <div class="sidebar-card__title">بياناتك على هذا الجهاز</div>
          <p class="sidebar-card__text">خذ نسخة احتياطية بانتظام لحماية ملفات المرضى.</p>
          <a class="btn btn--accent btn--sm btn--block" href="#/settings">${ico('database', { size: 18 })} النسخ الاحتياطي</a>
        </div>
      </div>
    </aside>
    <div class="drawer-overlay" data-action="close-drawer" aria-hidden="true"></div>
    <div class="app__main">
      <header class="topbar">
        <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-controls="sidebar" aria-label="إظهار/إخفاء القائمة">
          ${ico('menu', { size: 20 })}
        </button>
        <div class="topbar__search input-group">
          ${ico('search', { size: 20 })}
          <input class="input input--pill" type="search" placeholder="ابحث عن مريض بالاسم أو الموبايل أو رقم الملف…" aria-label="بحث عن مريض" id="gsearch-input" autocomplete="off">
        </div>
        <div class="topbar__spacer"></div>
        <div class="topbar__actions">
          <button type="button" class="icon-btn" data-action="theme" aria-live="polite">${themeButton()}</button>
          <button type="button" class="icon-btn" data-action="notifications" aria-label="التنبيهات">
            ${ico('bell', { size: 20 })}
          </button>
          <button type="button" class="user-chip" data-action="user-menu" aria-label="حساب المستخدم" aria-haspopup="menu"></button>
        </div>
      </header>
      <main id="main" class="content" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="التنقل السريع"></nav>
  `);

  if (getPref('sidebar') === 'collapsed') app.dataset.sidebar = 'collapsed';
  drawBrand();
  drawNav();
  attachPatientSearch(/** @type {HTMLInputElement} */ (app.querySelector('#gsearch-input')));

  const mqDrawer = matchMedia('(max-width: 1023px)');
  const closeDrawer = () => { delete app.dataset.drawer; };

  on(app, 'click', '[data-action]', (e, el) => {
    switch (el.dataset.action) {
      case 'toggle-sidebar':
        if (mqDrawer.matches) {
          if (app.dataset.drawer === 'open') closeDrawer();
          else { app.dataset.drawer = 'open'; app.querySelector('.sidebar a')?.focus(); }
        } else {
          const collapsed = app.dataset.sidebar === 'collapsed';
          if (collapsed) delete app.dataset.sidebar; else app.dataset.sidebar = 'collapsed';
          setPref('sidebar', collapsed ? 'expanded' : 'collapsed');
        }
        break;
      case 'open-drawer': app.dataset.drawer = 'open'; app.querySelector('.sidebar a')?.focus(); break;
      case 'close-drawer': closeDrawer(); break;
      case 'theme': {
        const t = cycleTheme();
        render(el, themeButton());
        toast(`المظهر: ${THEME_LABELS[t]}`, { duration: 1800 });
        break;
      }
      case 'notifications': toast('التنبيهات (نقص المخزون، المتابعات، الأقساط) ستظهر هنا في المرحلة ٩.'); break;
      case 'user-menu': openUserMenu(el); break;
    }
  });
  app.addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.dataset.drawer === 'open') closeDrawer(); });
  onEvent('route:changed', closeDrawer);
  onEvent('auth:changed', () => drawNav());
  onEvent('data:changed', ({ store, id }) => { if (store === 'meta' && id === 'lastBackupAt') drawBackupCard(); });
  onEvent('settings:changed', ({ key }) => { if (key === 'clinic') drawBrand(); });

  return /** @type {HTMLElement} */ (app.querySelector('#main'));
}

/**
 * Highlights the active nav item, sets the document title and switches between the full
 * shell and the bare (login/setup) layout.
 */
export function setActiveRoute(path, title, route) {
  currentPath = path;
  if (route?.meta?.layout === 'bare') app.dataset.layout = 'bare';
  else delete app.dataset.layout;
  drawNav();
  const clinic = getSettings('clinic');
  document.title = title ? `${title} · ${clinic.shortName}` : clinic.shortName;
}
