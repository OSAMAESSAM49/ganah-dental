/**
 * App shell: floating sidebar, top bar, phone bottom nav, drawer behaviour.
 * The shell renders once; route changes only update the active link and the page title.
 */
import { html, ico, on, render } from './dom.js';
import { NAV_GROUPS, BOTTOM_NAV, NAV_ITEMS } from './nav.js';
import { getPref, setPref } from './prefs.js';
import { cycleTheme, getTheme, THEME_ICONS, THEME_LABELS } from './theme.js';
import { onEvent } from './bus.js';
import { brandMark } from '../components/brand.js';
import { getSettings } from '../data/settings.js';
import { toast } from '../components/toast.js';

/** @type {HTMLElement} */
let app;
/** Visibility filter for nav items; replaced by the permission system in phase 2. */
let canSee = (_item) => true;

/** @param {(item: import('./nav.js').NavItem) => boolean} fn */
export function setNavFilter(fn) { canSee = fn; if (app) drawNav(); }

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

let currentPath = '/';

function drawNav() {
  render(app.querySelector('.sidebar__nav'), html`${navMarkup(currentPath)}`);
  render(app.querySelector('.bottom-nav'), bottomMarkup(currentPath));
}

function themeButton() {
  const t = getTheme();
  return html`${ico(THEME_ICONS[t], { size: 20 })}<span class="visually-hidden">المظهر: ${THEME_LABELS[t]}</span>`;
}

/** Renders the shell into #app and wires its controls. */
export function mountShell(root) {
  app = root;
  const clinic = getSettings('clinic');
  render(app, html`
    <aside class="sidebar" id="sidebar" aria-label="القائمة الرئيسية">
      <a class="sidebar__brand" href="#/">
        ${brandMark({ size: 46 })}
        <span class="sidebar__brand-text">
          <span class="sidebar__brand-name">${clinic.shortName}</span>
          <span class="sidebar__brand-sub">${clinic.tagline}</span>
        </span>
      </a>
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
          <input class="input input--pill" type="search" placeholder="ابحث عن مريض بالاسم أو الموبايل أو رقم الملف…" aria-label="بحث" disabled title="متاح في المرحلة ٣">
        </div>
        <div class="topbar__spacer"></div>
        <div class="topbar__actions">
          <button type="button" class="icon-btn" data-action="theme" aria-live="polite">${themeButton()}</button>
          <button type="button" class="icon-btn" data-action="notifications" aria-label="التنبيهات">
            ${ico('bell', { size: 20 })}
          </button>
          <button type="button" class="user-chip" data-action="user-menu" aria-label="حساب المستخدم">
            <span class="avatar avatar--lime">ج</span>
            <span class="user-chip__text">
              <span class="user-chip__name">مستخدم تجريبي</span>
              <span class="user-chip__role">بدون تسجيل دخول</span>
            </span>
          </button>
        </div>
      </header>
      <main id="main" class="content" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="التنقل السريع"></nav>
  `);

  if (getPref('sidebar') === 'collapsed') app.dataset.sidebar = 'collapsed';
  drawNav();

  const mqDrawer = matchMedia('(max-width: 1023px)');
  const closeDrawer = () => { delete app.dataset.drawer; };

  on(app, 'click', '[data-action]', (e, el) => {
    switch (el.dataset.action) {
      case 'toggle-sidebar':
        if (mqDrawer.matches) {
          app.dataset.drawer = app.dataset.drawer === 'open' ? '' : 'open';
          if (app.dataset.drawer === 'open') app.querySelector('.sidebar a')?.focus();
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
      case 'user-menu': toast('تسجيل الدخول وتبديل المستخدم في المرحلة ٢.'); break;
    }
  });
  app.addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.dataset.drawer === 'open') closeDrawer(); });
  onEvent('route:changed', closeDrawer);
  onEvent('settings:changed', ({ key, value }) => {
    if (key !== 'clinic') return;
    app.querySelector('.sidebar__brand-name').textContent = value.shortName;
    app.querySelector('.sidebar__brand-sub').textContent = value.tagline;
  });

  return /** @type {HTMLElement} */ (app.querySelector('#main'));
}

/** Highlights the active nav item and sets the document title. */
export function setActiveRoute(path, title) {
  currentPath = path;
  drawNav();
  const clinic = getSettings('clinic');
  document.title = title ? `${title} · ${clinic.shortName}` : clinic.shortName;
}
