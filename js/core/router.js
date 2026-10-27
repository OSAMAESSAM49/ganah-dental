/**
 * Hash router (GitHub Pages has no server-side routing): "#/patients/42?tab=chart".
 *
 * Route definition:
 *   { path: '/patients/:id', load: () => import('../modules/patients/file.js'),
 *     title: 'ملف المريض', permission: ['patients', 'view'], meta: {...} }
 *
 * A view module default-exports { title?, render(ctx) }. ctx = { el, params, query, route, signal }.
 * render may return a cleanup function. `signal` aborts when the user leaves the view, so
 * listeners added with { signal } are removed automatically.
 */
import { emit } from './bus.js';

/** @typedef {{ path: string, load: () => Promise<any>, title?: string, permission?: [string, string], meta?: object }} RouteDef */
/** @typedef {RouteDef & { regex: RegExp, keys: string[] }} CompiledRoute */

/** @type {CompiledRoute[]} */
let routes = [];
/** @type {CompiledRoute|null} */
let notFound = null;
let outlet = null;
let hooks = { beforeEach: null, afterEach: null, onError: null, loading: null };
let current = { path: null, key: null, cleanup: null, controller: null };
let renderToken = 0;
let dirtyGuard = null;
let suppressNext = false;
let backInterceptor = null;
/** Position in this tab's history, stamped on every entry, to tell Back from a new page. */
let historyIndex = 0;

/** Compiles '/patients/:id' to a RegExp. Exported for tests. */
export function compilePath(path) {
  const keys = [];
  const pattern = path
    .replace(/\/+$/, '')
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { regex: new RegExp(`^${pattern || ''}/?$`), keys };
}

/** @param {RouteDef[]} defs @param {RouteDef} [fallback] route used when nothing matches */
export function defineRoutes(defs, fallback) {
  routes = defs.map((r) => ({ ...r, ...compilePath(r.path) }));
  notFound = fallback ? { ...fallback, regex: /^$/, keys: [] } : null;
}

/** Splits "/a/b?x=1" into { path, query }. Exported for tests. */
export function parseHash(hash) {
  const h = decodeURI(String(hash || '').replace(/^#/, '')) || '/';
  const [p, q = ''] = h.split('?');
  const path = (p.startsWith('/') ? p : '/' + p).replace(/\/+$/, '') || '/';
  return { path, query: Object.fromEntries(new URLSearchParams(q)) };
}

/** @returns {{ route: CompiledRoute, params: Record<string,string> } | null} */
export function matchRoute(path) {
  for (const route of routes) {
    const m = route.regex.exec(path);
    if (m) {
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

/** Builds a hash href: href('/patients/:id', { id: 5 }) → '#/patients/5'. */
export function href(path, params = {}, query) {
  const p = path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
  const q = query ? '?' + new URLSearchParams(query).toString() : '';
  return '#' + p + q;
}

/** @param {string} path e.g. '/patients' @param {{ replace?: boolean }} [opts] */
export function navigate(path, { replace = false } = {}) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) {
    history.replaceState(history.state, '', target);
    handleChange();
  } else if (location.hash === target) {
    handleChange(); // same route: re-render
  } else {
    location.hash = target;
  }
}

export const currentRoute = () => parseHash(location.hash);

/**
 * Registers a function that returns a confirmation promise when the view has unsaved
 * changes; pass null to clear. The router asks before leaving.
 * @param {(() => Promise<boolean>) | null} fn resolves true to allow leaving
 */
export function setLeaveGuard(fn) { dirtyGuard = fn; }
export const hasLeaveGuard = () => !!dirtyGuard;

/**
 * Lets Back close something on top of the page (a modal) instead of leaving it.
 * @param {(() => boolean) | null} fn returns true when it handled the Back press
 */
export function setBackInterceptor(fn) { backInterceptor = fn; }

/** Undoes the history move that triggered this change, without handling it again. */
function stayHere(direction) {
  suppressNext = true;
  if (direction === 'back') history.forward(); else history.back();
}

/**
 * Starts listening. hooks.beforeEach(route, params, path) may return false (block), a path
 * string (redirect) or { render: RouteDef } (show another view at this URL).
 * hooks.loading(el) renders a loading state.
 */
export function startRouter(el, opts = {}) {
  outlet = el;
  hooks = { ...hooks, ...opts };
  window.addEventListener('hashchange', handleChange);
  handleChange();
}

async function handleChange() {
  if (suppressNext) { suppressNext = false; return; }
  const { path, query } = parseHash(location.hash);

  // A new entry has no index yet; an entry we stamped before is Back (lower) or Forward.
  const stamped = history.state?.ganahIndex;
  const direction = typeof stamped === 'number' && stamped < historyIndex ? 'back' : 'forward';
  if (typeof stamped === 'number') historyIndex = stamped;
  else { historyIndex += current.key ? 1 : 0; history.replaceState({ ...(history.state ?? {}), ganahIndex: historyIndex }, ''); }

  const key = location.hash || '#/';
  if (direction === 'back' && current.key && key !== current.key && backInterceptor?.()) {
    stayHere(direction);
    historyIndex += 1;
    return;
  }
  if (dirtyGuard && current.key && key !== current.key) {
    const ok = await dirtyGuard();
    if (!ok) { stayHere(direction); historyIndex += direction === 'back' ? 1 : -1; return; }
    dirtyGuard = null;
  }
  if (current.key && key !== current.key) emit('route:leaving', { path });

  const match = matchRoute(path) ?? (notFound ? { route: notFound, params: {} } : null);
  if (!match) return;

  if (hooks.beforeEach) {
    const verdict = await hooks.beforeEach(match.route, match.params, path);
    if (verdict === false) return;
    if (typeof verdict === 'string' && verdict !== path) { navigate(verdict, { replace: true }); return; }
    // { render: RouteDef } shows another view at the same URL (e.g. "no permission")
    if (verdict && typeof verdict === 'object' && verdict.render) {
      await renderRoute(verdict.render, match.params, query, path);
      return;
    }
  }

  await renderRoute(match.route, match.params, query, path);
}

async function renderRoute(route, params, query, path) {
  const token = ++renderToken;
  teardown();
  const controller = new AbortController();
  current = { path, key: location.hash || '#/', cleanup: null, controller };
  dirtyGuard = null;

  hooks.loading?.(outlet);
  try {
    const mod = await route.load();
    if (token !== renderToken) return; // user navigated away meanwhile
    const view = mod.default ?? mod;
    const title = view.title ?? route.title ?? '';
    const cleanup = await view.render({ el: outlet, params, query, route, signal: controller.signal });
    if (token !== renderToken) { if (typeof cleanup === 'function') cleanup(); return; }
    current.cleanup = typeof cleanup === 'function' ? cleanup : null;
    hooks.afterEach?.(route, { title, path, params });
    emit('route:changed', { path, route });
  } catch (err) {
    if (token !== renderToken) return;
    console.error('[router] failed to render', path, err);
    hooks.onError?.(outlet, err, () => renderRoute(route, params, query, path));
  }
}

function teardown() {
  current.controller?.abort();
  try { current.cleanup?.(); } catch (e) { console.error('[router] cleanup failed', e); }
}
