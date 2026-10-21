/**
 * The signed-in user for this browser tab. Kept in memory plus sessionStorage so a page
 * reload keeps you signed in (closing the tab/browser signs you out).
 * Only services/auth.js should call setSession/clearSession.
 */
import { emit } from './bus.js';

const KEY = 'ganah.session';

/**
 * @typedef {{ user: object, role: object, permissions: Record<string, Record<string, boolean>>,
 *             startedAt: string }} Session
 */

/** @type {Session|null} */
let session = null;

export const getSession = () => session;
export const currentUser = () => session?.user ?? null;

/** @param {Session} s */
export function setSession(s) {
  session = s;
  persist({ userId: s.user.id, lastActive: Date.now() });
  emit('auth:changed', { user: s.user });
}

export function clearSession() {
  session = null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  emit('auth:changed', { user: null });
}

/** Updates the cached user/role (after editing your own profile, etc.). */
export function refreshSession(patch) {
  if (!session) return;
  session = { ...session, ...patch };
  emit('auth:changed', { user: session.user });
}

/** @returns {{ userId: string, lastActive: number } | null} */
export function readStoredSession() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function touchSession() {
  if (session) persist({ userId: session.user.id, lastActive: Date.now() });
}

function persist(value) {
  try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ }
}
