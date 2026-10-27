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
import { confirmDialog, openModal } from '../components/modal.js';
import { logout } from '../services/auth.js';
import { attachPatientSearch } from '../components/patient-search.js';
import { backupStatus } from '../services/backup.js';
import { collectAlerts } from '../services/alerts.js';
import { syncStatus, syncNow } from '../services/cloud-sync.js';
import { digits, formatDateTime } from './format.js';

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
  scheduleBell();
  drawSync();
}

/* ---------- Cloud sync status (only on devices linked to the cloud) ---------- */

const SYNC_UI = {
  syncing: ['refresh-cw', 'جارٍ المزامنة…'], ok: ['cloud', 'متزامن'], offline: ['cloud-off', 'بدون إنترنت — ستتم المزامنة عند عودته'],
  error: ['triangle-alert', 'تعذّرت المزامنة'], auth: ['lock', 'يلزم تسجيل الدخول بحساب العيادة'],
};

/** "منذ 5 دقائق" style age of the last successful sync. */
function ago(iso) {
  if (!iso) return 'لم تتم بعد';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `منذ ${digits(min)} دقيقة`;
  if (min < 24 * 60) return `منذ ${digits(Math.round(min / 60))} ساعة`;
  return formatDateTime(iso);
}

/** Small sheet anyone can open from the cloud icon: what is happening, and a retry. */
async function openSyncSheet() {
  const draw = (st) => html`<dl class="dl">
      <dt>الحالة</dt><dd>${SYNC_UI[st.state]?.[1] ?? 'غير مربوط بالسحابة'}</dd>
      <dt>آخر مزامنة</dt><dd>${ago(st.lastSyncAt)}</dd>
      <dt>بانتظار الرفع</dt><dd>${st.pending ? `${digits(st.pending)} تعديل` : 'لا شيء'}</dd>
      ${st.error ? html`<dt>السبب</dt><dd>${st.error}</dd>` : ''}
    </dl>
    <p class="muted text-sm">${st.state === 'auth' ? 'اطلب من مدير النظام إعادة تسجيل الدخول بحساب العيادة من الإعدادات ← المزامنة.' : 'البرنامج يعمل بدون إنترنت، والتعديلات تُرفع تلقائيًا عند عودة الاتصال.'}</p>`;
  const res = await openModal({
    title: 'المزامنة مع السحابة', icon: 'cloud',
    body: html`<div class="stack-sm" data-sync-sheet>${draw(syncStatus())}</div>`,
    actions: [{ label: 'مزامنة الآن', value: 'now', variant: 'primary' }, ...(can('settings', 'view') ? [{ label: 'الإعدادات', value: 'settings' }] : []), { label: 'إغلاق', value: null }],
    async beforeClose(v, d) {
      if (v !== 'now') return true;
      render(d.querySelector('[data-sync-sheet]'), draw(await syncNow()));
      return false; // stay open to show the result
    },
  });
  if (res === 'settings') navigate('/settings?tab=cloud');
}

let lastSyncState = '';
function drawSync(st = syncStatus()) {
  // Say it once when sync starts failing, instead of only changing the icon colour.
  if (st.state !== lastSyncState && (st.state === 'error' || st.state === 'auth') && getSession()) {
    toast(st.state === 'auth' ? 'توقفت المزامنة: يلزم تسجيل الدخول بحساب العيادة.' : 'تعذّرت المزامنة مع السحابة — ستتم المحاولة تلقائيًا.', {
      type: 'warning', action: { label: 'التفاصيل', onClick: openSyncSheet },
    });
  }
  lastSyncState = st.state;
  const btn = app.querySelector('[data-action="sync"]');
  if (!btn) return;
  const ui = SYNC_UI[st.state];
  btn.hidden = !ui || !getSession();
  if (!ui) return;
  btn.dataset.state = st.state;
  const label = `${ui[1]}${st.pending ? ` · ${digits(st.pending)} تعديل لم يُرفع` : ''}`;
  btn.title = label;
  btn.setAttribute('aria-label', `المزامنة: ${label}`);
  render(btn, html`${ico(ui[0], { size: 20 })}${st.pending && st.state !== 'syncing' ? html`<span class="icon-btn__badge"></span>` : ''}`);
}

/* ---------- Top-bar bell: the same alerts as the dashboard panel ---------- */

let alerts = [];
let bellTimer = 0;
async function drawBell() {
  const btn = app.querySelector('[data-action="notifications"]');
  if (!btn) return;
  try { alerts = getSession() ? await collectAlerts() : []; } catch (err) { console.error(err); alerts = []; }
  render(btn, html`${ico('bell', { size: 20 })}${alerts.length ? html`<span class="icon-btn__badge"></span>` : ''}`);
  btn.setAttribute('aria-label', alerts.length ? `التنبيهات (${alerts.length})` : 'التنبيهات');
}
const scheduleBell = () => { clearTimeout(bellTimer); bellTimer = setTimeout(drawBell, 600); };

function openBell(anchor) {
  openMenu(anchor, {
    header: html`<div class="menu__header"><div class="menu__header-text"><strong>يحتاج انتباهك</strong><small>${alerts.length ? `${alerts.length} تنبيه` : 'لا شيء عاجل الآن'}</small></div></div>`,
    items: alerts.map((a) => ({ label: `${a.title} — ${a.sub}`, icon: a.icon, onSelect: () => navigate(a.link.replace(/^#/, '')) })),
  });
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
      { label: 'تغيير كلمة المرور', icon: 'key-round', onSelect: async () => (await import('../modules/account/dialogs.js')).openChangePasswordDialog() },
      { label: s.user.hasPin ? 'تغيير الرمز السريع' : 'تعيين رمز سريع (PIN)', icon: 'lock', onSelect: async () => (await import('../modules/account/dialogs.js')).openPinDialog() },
      { label: `المظهر: ${THEME_LABELS[getTheme()]}`, icon: 'palette', onSelect: () => { const t = cycleTheme(); toast(`المظهر: ${THEME_LABELS[t]}`, { duration: 1800 }); document.querySelectorAll('[data-action="theme"]').forEach((b) => render(b, themeButton())); } },
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
          <a class="btn btn--accent btn--sm btn--block" href="#/settings?tab=backup">${ico('database', { size: 18 })} النسخ الاحتياطي</a>
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
          <button type="button" class="icon-btn topbar__search-close" data-action="close-search" aria-label="إغلاق البحث">${ico('x', { size: 20 })}</button>
        </div>
        <div class="topbar__spacer"></div>
        <div class="topbar__actions">
          <button type="button" class="icon-btn topbar__search-btn" data-action="open-search" aria-label="بحث عن مريض">${ico('search', { size: 20 })}</button>
          <button type="button" class="icon-btn sync-btn" data-action="sync" hidden></button>
          <button type="button" class="icon-btn" data-action="theme" aria-live="polite">${themeButton()}</button>
          <button type="button" class="icon-btn" data-action="notifications" aria-label="التنبيهات" aria-haspopup="menu">
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
  // Phones/tablets: the search field opens over the top bar from the 🔍 button.
  const closeSearch = () => {
    delete app.dataset.search;
    const input = /** @type {HTMLInputElement} */ (app.querySelector('#gsearch-input'));
    input.value = '';
    input.dispatchEvent(new Event('input'));
  };

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
      case 'open-search': app.dataset.search = 'open'; /** @type {HTMLInputElement} */ (app.querySelector('#gsearch-input')).focus(); break;
      case 'close-search': closeSearch(); break;
      case 'open-drawer': app.dataset.drawer = 'open'; app.querySelector('.sidebar a')?.focus(); break;
      case 'close-drawer': closeDrawer(); break;
      case 'theme': {
        const t = cycleTheme();
        render(el, themeButton());
        toast(`المظهر: ${THEME_LABELS[t]}`, { duration: 1800 });
        break;
      }
      case 'notifications': openBell(el); break;
      case 'sync': openSyncSheet(); break;
      case 'user-menu': openUserMenu(el); break;
    }
  });
  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (app.dataset.drawer === 'open') closeDrawer();
    if (app.dataset.search === 'open') closeSearch();
  });
  onEvent('route:changed', () => { closeDrawer(); if (app.dataset.search === 'open') closeSearch(); scheduleBell(); });
  onEvent('auth:changed', () => drawNav());
  onEvent('data:changed', ({ store, id }) => { if (store === 'meta' && id === 'lastBackupAt') drawBackupCard(); if (store !== 'auditLog') scheduleBell(); });
  onEvent('settings:changed', ({ key }) => { if (key === 'clinic') drawBrand(); });
  onEvent('sync:status', drawSync);

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
