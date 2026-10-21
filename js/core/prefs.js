/**
 * Per-device UI conveniences (theme, collapsed sidebar). Kept in localStorage so the theme
 * applies before first paint. Never store clinic data here — that belongs in IndexedDB.
 */
const KEY = 'ganah.prefs';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function getPref(name, fallback) {
  const v = readAll()[name];
  return v === undefined ? fallback : v;
}

export function setPref(name, value) {
  try {
    const all = readAll();
    all[name] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable (private mode): preference lasts for this session only */ }
}
