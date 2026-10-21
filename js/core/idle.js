/**
 * Idle watcher: calls onIdle after N minutes without keyboard/mouse/touch activity.
 * Activity also refreshes the session's lastActive so a reload after the limit asks to log in.
 */
import { touchSession } from './session.js';

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
const CHECK_EVERY_MS = 15_000;

let last = Date.now();
let lastTouch = 0;
let timer = null;
/** @type {{ minutes: () => number, onIdle: () => void } | null} */
let watch = null;

function activity() {
  last = Date.now();
  if (last - lastTouch > 10_000) { lastTouch = last; touchSession(); }
}

function check() {
  if (!watch) return;
  const m = watch.minutes();
  if (m > 0 && Date.now() - last >= m * 60_000) {
    const { onIdle } = watch;
    stopIdleWatch();
    onIdle();
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') check();
}

/** @param {{ minutes: () => number, onIdle: () => void }} opts minutes() 0 = disabled */
export function startIdleWatch(opts) {
  stopIdleWatch();
  watch = opts;
  last = Date.now();
  EVENTS.forEach((e) => window.addEventListener(e, activity, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', onVisible);
  timer = setInterval(check, CHECK_EVERY_MS);
}

export function stopIdleWatch() {
  watch = null;
  clearInterval(timer);
  timer = null;
  EVENTS.forEach((e) => window.removeEventListener(e, activity, { capture: true }));
  document.removeEventListener('visibilitychange', onVisible);
}
