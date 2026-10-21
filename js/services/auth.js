/**
 * Authentication: first-run setup, login (password or PIN), sessions, recovery code.
 *
 * IMPORTANT: everything runs in the browser, so this is access control for staff on a
 * shared device — not real security. Anyone with access to the device's browser profile
 * can read IndexedDB. Real security needs a backend (Supabase/Firebase). See README.
 */
import { getAdapter, repos } from '../data/index.js';
import { newId } from '../data/repository.js';
import { hashSecret, verifySecret, generateRecoveryCode, normalizeRecoveryCode } from '../core/crypto.js';
import { setSession, clearSession, getSession, currentUser, readStoredSession, refreshSession } from '../core/session.js';
import { DEFAULT_ROLES, ADMIN_ROLE_ID, effectivePermissions } from '../core/permissions.js';
import { DEFAULT_CLINIC, DEFAULT_APP, loadSettings } from '../data/settings.js';
import { logEvent } from './audit.js';
import { emit } from '../core/bus.js';

export class AuthError extends Error {
  /** @param {'invalid'|'disabled'|'locked'|'no_pin'|'weak'|'recovery'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/* ---------- Validation ---------- */

export const normalizeUsername = (u) => String(u ?? '').trim().toLowerCase();

/** @returns {string} Arabic error, or '' when acceptable */
export function validateUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return 'اسم المستخدم مطلوب';
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) return 'استخدم حروفًا إنجليزية صغيرة أو أرقامًا (3 أحرف على الأقل، بدون مسافات)';
  return '';
}

/** @returns {string} Arabic error, or '' when acceptable */
export function validatePassword(password, username = '') {
  const p = String(password ?? '');
  if (p.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
  if (username && p.toLowerCase() === normalizeUsername(username)) return 'لا تجعل كلمة المرور مثل اسم المستخدم';
  if (/^(.)\1+$/.test(p) || ['12345678', '123456789', 'password', '00000000'].includes(p.toLowerCase())) return 'كلمة المرور سهلة التخمين جدًا';
  return '';
}

/** PIN: 4–6 digits (Arabic digits accepted). */
export function validatePin(pin) {
  const p = String(pin ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!/^\d{4,6}$/.test(p)) return 'الرمز السريع من 4 إلى 6 أرقام';
  if (/^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p)) return 'اختر رمزًا أصعب من الأرقام المتتالية أو المكررة';
  return '';
}
export const cleanPin = (pin) => String(pin).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** 0–4 strength score for the password meter. */
export function passwordStrength(password) {
  const p = String(password ?? '');
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z؀-ۿ]/i.test(p) && /\d/.test(p)) s++;
  if (/[^a-z0-9؀-ۿ]/i.test(p) || (/[a-z]/.test(p) && /[A-Z]/.test(p))) s++;
  return Math.min(s, 4);
}

/* ---------- Brute-force throttling (per tab) ---------- */

const attempts = new Map();
const MAX_FREE_ATTEMPTS = 5;

function checkThrottle(key) {
  const a = attempts.get(key);
  if (a?.until && a.until > Date.now()) {
    const secs = Math.ceil((a.until - Date.now()) / 1000);
    throw new AuthError('locked', `محاولات كثيرة خاطئة. حاول مرة أخرى بعد ${secs} ثانية.`);
  }
}
function recordFailure(key) {
  const a = attempts.get(key) ?? { count: 0, until: 0 };
  a.count++;
  if (a.count >= MAX_FREE_ATTEMPTS) a.until = Date.now() + Math.min(300, 30 * 2 ** (a.count - MAX_FREE_ATTEMPTS)) * 1000;
  attempts.set(key, a);
}
const clearFailures = (key) => attempts.delete(key);

/* ---------- Setup ---------- */

export const isSetupDone = async () => (await repos.meta.get('setupDone', false)) === true;

/**
 * First run: saves clinic info, seeds default roles, creates the Admin account and a
 * recovery code. All records are written in one transaction.
 * @param {{ clinic: object, admin: { displayName: string, username: string, password: string, pin?: string } }} input
 * @returns {Promise<{ recoveryCode: string }>}
 */
export async function completeSetup({ clinic, admin }) {
  if (await isSetupDone()) throw new Error('Setup already completed');
  const username = normalizeUsername(admin.username);
  const errors = [validateUsername(username), validatePassword(admin.password, username), admin.pin ? validatePin(admin.pin) : ''].filter(Boolean);
  if (errors.length) throw new AuthError('weak', errors[0]);

  const recoveryCode = generateRecoveryCode();
  const [password, pin, recovery] = await Promise.all([
    hashSecret(admin.password),
    admin.pin ? hashSecret(cleanPin(admin.pin)) : Promise.resolve(null),
    hashSecret(recoveryCode),
  ]);

  const t = new Date().toISOString();
  const userId = newId();
  const user = {
    id: userId, username, displayName: admin.displayName.trim(), title: admin.title ?? '',
    roleId: ADMIN_ROLE_ID, isDoctor: !!admin.isDoctor, color: 'violet', active: true,
    mustChangePassword: false, permOverrides: {}, password, pin,
    createdAt: t, updatedAt: t, createdBy: userId, updatedBy: userId,
  };

  await getAdapter().transaction(['roles', 'users', 'settings', 'meta'], 'readwrite', async (tx) => {
    for (const role of DEFAULT_ROLES) {
      await tx.put('roles', { ...role, createdAt: t, updatedAt: t, createdBy: userId, updatedBy: userId });
    }
    await tx.put('users', user);
    await tx.put('settings', { key: 'clinic', value: { ...DEFAULT_CLINIC, ...clinic }, updatedAt: t });
    await tx.put('settings', { key: 'app', value: { ...DEFAULT_APP }, updatedAt: t });
    await tx.put('meta', { key: 'recovery', value: recovery, updatedAt: t });
    await tx.put('meta', { key: 'setupDone', value: true, updatedAt: t });
    await tx.put('meta', { key: 'setupAt', value: t, updatedAt: t });
  });

  const settings = await loadSettings();
  emit('settings:changed', { key: 'clinic', value: settings.clinic });
  await startSession(user);
  await logEvent({ action: 'setup', entity: 'auth', entityId: userId, summary: `إنشاء حساب المدير ${user.displayName}` });
  return { recoveryCode };
}

/* ---------- Login ---------- */

/** Users shown as quick-pick tiles on the login screen (no secrets). */
export async function listLoginUsers() {
  const users = await repos.users.list();
  return users
    .filter((u) => u.active)
    .map((u) => ({ id: u.id, displayName: u.displayName, username: u.username, color: u.color, roleId: u.roleId, hasPin: !!u.pin }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ar'));
}

/** Builds and stores the session for a user. */
async function startSession(user) {
  const role = await repos.roles.get(user.roleId);
  setSession({ user: publicUser(user), role, permissions: effectivePermissions(role, user), startedAt: new Date().toISOString() });
  await repos.users.update(user.id, { lastLoginAt: new Date().toISOString() });
}

/** Strips secrets before a user object is kept in memory. */
function publicUser(u) {
  const { password, pin, ...rest } = u;
  return { ...rest, hasPin: !!pin };
}

/**
 * @param {string} username @param {string} password
 * @returns {Promise<object>} the signed-in user (check .mustChangePassword)
 */
export async function login(username, password) {
  const key = `u:${normalizeUsername(username)}`;
  checkThrottle(key);
  const [user] = await repos.users.findBy('username', normalizeUsername(username));
  const ok = user ? await verifySecret(password, user.password) : false;
  if (!ok) {
    recordFailure(key);
    await logEvent({ action: 'login_failed', entity: 'auth', entityId: user?.id ?? null, userId: user?.id ?? null, userName: user?.displayName ?? null, summary: `اسم المستخدم: ${normalizeUsername(username)}` });
    throw new AuthError('invalid', 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (!user.active) throw new AuthError('disabled', 'هذا الحساب موقوف. تواصل مع مدير النظام.');
  clearFailures(key);
  await startSession(user);
  await logEvent({ action: 'login', entity: 'auth', entityId: user.id, summary: 'بكلمة المرور' });
  return currentUser();
}

/** Quick switch with the user's PIN. */
export async function loginWithPin(userId, pin) {
  const key = `p:${userId}`;
  checkThrottle(key);
  const user = await repos.users.get(userId);
  if (!user?.pin) throw new AuthError('no_pin', 'لم يتم تعيين رمز سريع لهذا المستخدم');
  if (!(await verifySecret(cleanPin(pin), user.pin))) {
    recordFailure(key);
    await logEvent({ action: 'login_failed', entity: 'auth', entityId: user.id, userId: user.id, userName: user.displayName, summary: 'رمز سريع خاطئ' });
    throw new AuthError('invalid', 'الرمز غير صحيح');
  }
  if (!user.active) throw new AuthError('disabled', 'هذا الحساب موقوف. تواصل مع مدير النظام.');
  clearFailures(key);
  await startSession(user);
  await logEvent({ action: 'login', entity: 'auth', entityId: user.id, summary: 'بالرمز السريع' });
  return currentUser();
}

/**
 * Restores the tab's session after a reload, unless it has been idle too long.
 * @param {number} maxIdleMs 0 = no idle limit
 */
export async function restoreSession(maxIdleMs) {
  const stored = readStoredSession();
  if (!stored?.userId) return null;
  if (maxIdleMs && Date.now() - stored.lastActive > maxIdleMs) { clearSession(); return null; }
  const user = await repos.users.get(stored.userId);
  if (!user?.active) { clearSession(); return null; }
  const role = await repos.roles.get(user.roleId);
  setSession({ user: publicUser(user), role, permissions: effectivePermissions(role, user), startedAt: new Date().toISOString() });
  return currentUser();
}

/** Recomputes the session after the signed-in user's role or overrides changed. */
export async function reloadSessionPermissions() {
  const s = getSession();
  if (!s) return;
  const user = await repos.users.get(s.user.id);
  if (!user?.active) { await logout('logout'); return; }
  const role = await repos.roles.get(user.roleId);
  refreshSession({ user: publicUser(user), role, permissions: effectivePermissions(role, user) });
}

/** @param {'logout'|'lock'} [reason] */
export async function logout(reason = 'logout') {
  const user = currentUser();
  if (user) await logEvent({ action: reason, entity: 'auth', entityId: user.id, summary: reason === 'lock' ? 'بسبب عدم النشاط' : '' });
  clearSession();
}

/* ---------- Passwords & PIN ---------- */

export async function changeOwnPassword(current, next) {
  const me = currentUser();
  const user = await repos.users.require(me.id);
  if (!(await verifySecret(current, user.password))) throw new AuthError('invalid', 'كلمة المرور الحالية غير صحيحة');
  const err = validatePassword(next, user.username);
  if (err) throw new AuthError('weak', err);
  await repos.users.update(user.id, { password: await hashSecret(next), mustChangePassword: false });
  await logEvent({ action: 'password_change', entity: 'users', entityId: user.id, summary: user.displayName });
  await reloadSessionPermissions();
}

/** Sets (or removes, with null) the signed-in user's PIN. */
export async function setOwnPin(pin) {
  const me = currentUser();
  if (pin != null) {
    const err = validatePin(pin);
    if (err) throw new AuthError('weak', err);
  }
  await repos.users.update(me.id, { pin: pin == null ? null : await hashSecret(cleanPin(pin)) });
  await reloadSessionPermissions();
}

/* ---------- Recovery code ---------- */

export async function verifyRecoveryCode(code) {
  return verifySecret(normalizeRecoveryCode(code), await repos.meta.get('recovery'));
}

/** Active admin accounts that the recovery flow may reset. */
export async function listAdmins() {
  return (await repos.users.list()).filter((u) => u.roleId === ADMIN_ROLE_ID && u.active)
    .map((u) => ({ id: u.id, displayName: u.displayName, username: u.username }));
}

/**
 * Resets an admin's password using the recovery code and issues a NEW recovery code
 * (the old one stops working).
 * @returns {Promise<{ recoveryCode: string }>}
 */
export async function recoverWithCode(code, userId, newPassword) {
  checkThrottle('recovery');
  if (!(await verifyRecoveryCode(code))) {
    recordFailure('recovery');
    throw new AuthError('recovery', 'رمز الاسترداد غير صحيح');
  }
  clearFailures('recovery');
  const user = await repos.users.require(userId);
  if (user.roleId !== ADMIN_ROLE_ID) throw new AuthError('invalid', 'يمكن استرداد حسابات المدير فقط');
  const err = validatePassword(newPassword, user.username);
  if (err) throw new AuthError('weak', err);
  await repos.users.update(user.id, { password: await hashSecret(newPassword), mustChangePassword: false, active: true });
  const recoveryCode = await rotateRecoveryCode();
  await logEvent({ action: 'recovery_used', entity: 'auth', entityId: user.id, userId: user.id, userName: user.displayName, summary: `إعادة تعيين كلمة مرور ${user.displayName}` });
  return { recoveryCode };
}

/** Issues a new recovery code (admin). */
export async function regenerateRecoveryCode() {
  const recoveryCode = await rotateRecoveryCode();
  await logEvent({ action: 'recovery_regenerated', entity: 'auth', summary: 'تم إلغاء الرمز القديم' });
  return { recoveryCode };
}

async function rotateRecoveryCode() {
  const recoveryCode = generateRecoveryCode();
  await repos.meta.set('recovery', await hashSecret(recoveryCode));
  return recoveryCode;
}

export { hashSecret };
