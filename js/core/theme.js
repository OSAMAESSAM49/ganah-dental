/** Light / dark / auto theme. The inline script in index.html applies it before paint. */
import { getPref, setPref } from './prefs.js';
import { emit } from './bus.js';

export const THEMES = /** @type {const} */ (['auto', 'light', 'dark']);
export const THEME_LABELS = { auto: 'تلقائي حسب الجهاز', light: 'فاتح', dark: 'داكن' };
export const THEME_ICONS = { auto: 'monitor', light: 'sun', dark: 'moon' };

/** @returns {'auto'|'light'|'dark'} */
export const getTheme = () => (THEMES.includes(getPref('theme')) ? getPref('theme') : 'auto');

/** Whether dark colors are currently showing (resolves 'auto'). */
export function isDark() {
  const t = getTheme();
  return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/** @param {'auto'|'light'|'dark'} theme */
export function setTheme(theme) {
  setPref('theme', theme);
  applyTheme();
  emit('theme:changed', { theme });
}

export function applyTheme() {
  const t = getTheme();
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', isDark() ? '#0D0A17' : '#4A0CD3');
}

/** Cycles auto → light → dark → auto. */
export function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  setTheme(next);
  return next;
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getTheme() === 'auto') { applyTheme(); emit('theme:changed', { theme: 'auto' }); }
});
