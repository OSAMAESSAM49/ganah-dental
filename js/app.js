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
import { defineRoutes, startRouter, navigate } from './core/router.js';
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
import { pageSkeleton, errorState } from './components/states.js';
import { toast, toastError } from './components/toast.js';

applyTheme();

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
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const promptUpdate = (worker) => toast('يوجد إصدار جديد من البرنامج', {
      duration: 0,
      action: { label: 'تحديث الآن', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
    });
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
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  document.querySelector('.menu[data-popover]')?.remove();
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
  const settings = await loadSettings();
  setDigitStyle(settings.app.digitStyle);
  requestPersistentStorage().catch(() => {});

  let setupDone = await isSetupDone();
  if (setupDone) await restoreSession(idleMs());

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

  onEvent('settings:changed', ({ key, value }) => { if (key === 'app') setDigitStyle(value.digitStyle); });

  // Auto-lock after inactivity while someone is signed in.
  const watchIdle = () => startIdleWatch({ minutes: () => getSettings('app').idleLogoutMinutes, onIdle: lockForIdle });
  onEvent('auth:changed', ({ user }) => (user ? watchIdle() : stopIdleWatch()));
  if (getSession()) watchIdle();

  // Recurring monthly expenses are created when the app opens (no background jobs on a static site).
  if (setupDone) generateRecurringExpenses().catch((err) => console.warn('[boot] recurring expenses', err));

  registerServiceWorker();
  hideSplash();

  window.addEventListener('offline', () => toast('انقطع الإنترنت — البرنامج يعمل بشكل طبيعي بدونه.', { type: 'info' }));
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('[app] unhandled', e.reason);
  toastError('حدث خطأ غير متوقع. إذا تكرر أعد تحميل الصفحة.');
});

// Skip link: focus main content without changing the hash (hash = route).
document.addEventListener('click', (e) => {
  if (/** @type {HTMLElement} */ (e.target).closest('[data-skip-link]')) document.getElementById('main')?.focus();
});

boot();
