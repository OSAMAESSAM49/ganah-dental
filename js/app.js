/**
 * Boot sequence:
 *   1. open storage + run migrations     4. render shell + start router
 *   2. load settings (digit style…)      5. register service worker (offline)
 *   3. ask for persistent storage        6. hide splash
 * Phase 2 inserts: setup wizard (first run) and login before step 4.
 */
import { applyTheme } from './core/theme.js';
import { html, ico, render } from './core/dom.js';
import { setDigitStyle } from './core/format.js';
import { defineRoutes, startRouter } from './core/router.js';
import { ROUTES, NOT_FOUND_ROUTE } from './core/nav.js';
import { mountShell, setActiveRoute } from './core/shell.js';
import { initData, requestPersistentStorage } from './data/index.js';
import { loadSettings } from './data/settings.js';
import { onEvent } from './core/bus.js';
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

  const settings = await loadSettings();
  setDigitStyle(settings.app.digitStyle);
  requestPersistentStorage().catch(() => {});

  const outlet = mountShell(document.getElementById('app'));

  defineRoutes(ROUTES, NOT_FOUND_ROUTE);
  startRouter(outlet, {
    loading: (el) => render(el, pageSkeleton()),
    afterEach: (_route, { title, path }) => {
      setActiveRoute(path, title);
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
