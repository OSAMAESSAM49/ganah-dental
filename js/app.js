/**
 * Boot sequence:
 *   1. open storage + run migrations     5. render shell + start router (with auth guard)
 *   2. connect the audit log             6. watch for idle → auto-lock
 *   3. load settings (digit style…)      7. register service worker (offline)
 *   4. restore this tab's session        8. hide splash
 * Route guard order: setup wizard (first run) → login → permission check.
 */
import { applyTheme } from './core/theme.js';
import { html, render } from './core/dom.js';
import { setDigitStyle } from './core/format.js';
import { defineRoutes, startRouter, navigate, setBackInterceptor, hasLeaveGuard } from './core/router.js';
import { ROUTES, NOT_FOUND_ROUTE, FORBIDDEN_ROUTE } from './core/nav.js';
import { mountShell, setActiveRoute } from './core/shell.js';
import { can } from './core/permissions.js';
import { getSession, currentUser } from './core/session.js';
import { startIdleWatch, stopIdleWatch } from './core/idle.js';
import { initData, requestPersistentStorage } from './data/index.js';
import { loadSettings, getSettings } from './data/settings.js';
import { onEvent } from './core/bus.js';
import { installAuditHook } from './services/audit.js';
import { isSetupDone, restoreSession, logout } from './services/auth.js';
import './services/inventory.js'; // registers the stock-deduction done-handler
import './services/followups.js'; // registers the follow-up scheduling done-handler
import { generateRecurringExpenses } from './services/expenses.js';
import { startCloudSync } from './services/cloud-sync.js';
import { pageSkeleton, errorState } from './components/states.js';
import { toast, toastError } from './components/toast.js';
import { applyLanguage, loadLanguage, lang, isEnglish, rememberLanguage } from './core/i18n.js';
import { closeAllModals, dismissTopModal, hasDirtyModal } from './components/modal.js';
import { closeMenu } from './components/menu.js';

applyTheme();
applyLanguage();

function hideSplash() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.dataset.state = 'done';
  setTimeout(() => boot.remove(), 300);
}

/** Full-screen fatal error (storage unavailable, etc.). */
function fatal(title, message) {
  const app = document.getElementById('app');
  app.dataset.layout = 'bare';
  render(app, html`
    <main class="content" style="max-inline-size: 640px; padding-block: 15vh">
      <div class="card">${errorState({ title, message })}</div>
    </main>`);
  app.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
  hideSplash();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // updateViaCache 'none': update checks read sw.js and asset-list.js fresh, never the HTTP cache.
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    let prompted = false;
    const promptUpdate = (worker) => {
      if (prompted) return;
      prompted = true;
      toast('يوجد إصدار جديد من البرنامج', {
        duration: 0, sticky: true,
        action: { label: 'تحديث الآن', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
      });
    };
    // The app is often left open all day: look for a new version every 30 minutes and
    // whenever it comes back to the screen.
    const check = () => reg.update().catch(() => {});
    setInterval(check, 30 * 60_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(worker);
      });
    });
  }).catch((err) => console.warn('[sw] registration failed', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

const idleMs = () => (getSettings('app').idleLogoutMinutes || 0) * 60_000;

async function lockForIdle() {
  const user = currentUser();
  if (!user) return;
  closeAllModals();
  closeMenu();
  await logout('lock');
  navigate(`/login?user=${encodeURIComponent(user.id)}&reason=idle`, { replace: true });
}

async function boot() {
  try {
    await initData({
      onVersionChange: () => toast('تم تحديث قاعدة البيانات من نافذة أخرى. أعد تحميل الصفحة.', {
        type: 'warning', duration: 0, action: { label: 'إعادة التحميل', onClick: () => location.reload() },
      }),
      onBlocked: () => toast('أغلق نوافذ البرنامج الأخرى لإكمال التحديث.', { type: 'warning', duration: 0 }),
    });
  } catch (err) {
    console.error('[boot] storage failed', err);
    fatal('تعذّر فتح قاعدة البيانات', 'قد يكون المتصفح في وضع التصفح الخاص أو أن التخزين محظور. افتح البرنامج في نافذة عادية من Chrome أو Edge.');
    return;
  }

  installAuditHook();
  // Start tracking + syncing before anything else writes (only on devices linked to the cloud).
  startCloudSync();
  const settings = await loadSettings();
  // English always uses 0-9.
  const digitStyle = (style) => (isEnglish() ? 'western' : style);
  requestPersistentStorage().catch(() => {});

  let setupDone = await isSetupDone();
  if (setupDone) await restoreSession(idleMs());
  // Each user keeps their language; this device remembers the last one for the sign-in page.
  const userLang = getSession()?.user?.lang;
  if (userLang && userLang !== lang()) { rememberLanguage(userLang); location.reload(); return; }
  await loadLanguage();
  if (isEnglish()) {
    const { repos } = await import('./data/index.js');
    const { setDataTranslations } = await import('./core/i18n.js');
    const loadNames = async () => setDataTranslations('procedures', (await repos.procedures.list()).map((p) => [p.name, p.nameEn]));
    await loadNames();
    onEvent('data:changed', ({ store }) => { if (store === 'procedures') loadNames(); });
  }
  setDigitStyle(digitStyle(settings.app.digitStyle));

  const outlet = mountShell(document.getElementById('app'));

  defineRoutes(ROUTES, NOT_FOUND_ROUTE);
  startRouter(outlet, {
    loading: (el) => render(el, pageSkeleton()),
    async beforeEach(route, _params, path) {
      if (!setupDone) setupDone = await isSetupDone();
      if (!setupDone) return route.meta?.setup ? true : '/setup';
      if (route.meta?.setup) return getSession() ? '/' : '/login';
      if (route.meta?.public) return getSession() && path === '/login' ? '/' : true;
      if (!getSession()) {
        const next = location.hash.replace(/^#/, '') || '/';
        return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
      }
      if (route.permission && !can(...route.permission)) return { render: FORBIDDEN_ROUTE };
      return true;
    },
    afterEach: (route, { title, path }) => {
      setActiveRoute(path, title, route);
      window.scrollTo({ top: 0 });
      outlet.focus({ preventScroll: true });
    },
    onError: (el, _err, retry) => {
      render(el, html`<div class="card">${errorState({})}</div>`);
      el.querySelector('[data-retry]')?.addEventListener('click', retry);
      toastError('تعذّر فتح الصفحة');
    },
  });

  // Back closes the open menu or window first (like a phone app); leaving a page closes them.
  setBackInterceptor(() => closeMenu() || dismissTopModal());
  onEvent('route:leaving', () => { closeMenu(); closeAllModals(); });
  window.addEventListener('beforeunload', (e) => {
    if (hasLeaveGuard() || hasDirtyModal()) { e.preventDefault(); e.returnValue = ''; }
  });

  onEvent('settings:changed', ({ key, value }) => { if (key === 'app') setDigitStyle(digitStyle(value.digitStyle)); });

  // Auto-lock after inactivity while someone is signed in.
  const watchIdle = () => startIdleWatch({ minutes: () => getSettings('app').idleLogoutMinutes, onIdle: lockForIdle });
  onEvent('auth:changed', ({ user }) => (user ? watchIdle() : stopIdleWatch()));
  // Signing in as someone who uses the other language switches to it.
  onEvent('auth:changed', ({ user }) => {
    if (user?.lang && user.lang !== lang()) { rememberLanguage(user.lang); location.reload(); }
  });
  if (getSession()) watchIdle();

  // Recurring monthly expenses are created when the app opens (no background jobs on a static site).
  if (setupDone) generateRecurringExpenses().catch((err) => console.warn('[boot] recurring expenses', err));

  registerServiceWorker();
  hideSplash();

  window.addEventListener('offline', () => toast('انقطع الإنترنت — البرنامج يعمل بشكل طبيعي بدونه.', { type: 'info' }));
}

// Anything that slips through: log it and tell the user once (not a burst of toasts).
let lastErrorToast = 0;
const reportUnexpected = (err) => {
  console.error('[app] unexpected', err);
  if (Date.now() - lastErrorToast < 5000) return;
  lastErrorToast = Date.now();
  toastError('حدث خطأ غير متوقع. إذا تكرر أعد تحميل الصفحة.');
};
window.addEventListener('unhandledrejection', (e) => reportUnexpected(e.reason));
window.addEventListener('error', (e) => { if (e.error) reportUnexpected(e.error); });

// Language switch on pages outside the app shell (sign-in, setup).
document.addEventListener('click', (e) => {
  if (/** @type {HTMLElement} */ (e.target).closest('[data-switch-lang]')) import('./services/language.js').then((m) => m.switchLanguage());
});

// Skip link: focus main content without changing the hash (hash = route).
document.addEventListener('click', (e) => {
  if (/** @type {HTMLElement} */ (e.target).closest('[data-skip-link]')) document.getElementById('main')?.focus();
});

boot();
