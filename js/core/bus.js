/**
 * App-wide event bus. Known events:
 *   'data:changed'     { store, action: 'create'|'update'|'delete'|'restore', id }
 *   'settings:changed' { key, value }
 *   'route:changed'    { path, route }
 */
const target = new EventTarget();

/** @returns {() => void} unsubscribe */
export function onEvent(type, handler, opts) {
  const fn = (e) => handler(/** @type {CustomEvent} */ (e).detail);
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn);
}

export function emit(type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}
