/**
 * User and role management (Admin only). Enforces the safety rules:
 *   - there is always at least one active Admin
 *   - you cannot disable, delete or demote yourself
 *   - system roles cannot be deleted; the Admin role cannot be edited
 *   - a role in use cannot be deleted
 */
import { repos } from '../data/index.js';
import { hashSecret } from '../core/crypto.js';
import { currentUser } from '../core/session.js';
import { ADMIN_ROLE_ID, MODULES, emptyMatrix } from '../core/permissions.js';
import { normalizeUsername, validatePassword, validateUsername, validatePin, cleanPin, AuthError, reloadSessionPermissions } from './auth.js';
import { logEvent } from './audit.js';

export const USER_COLORS = ['violet', 'lime', 'info', 'warning', 'success', 'danger'];

export class RuleError extends Error {
  constructor(message) { super(message); this.name = 'RuleError'; }
}

/** Users without secrets, newest first. */
export async function listUsers({ includeDeleted = false } = {}) {
  const users = await repos.users.list({ includeDeleted });
  return users.map(({ password, pin, ...u }) => ({ ...u, hasPin: !!pin }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ar'));
}

async function activeAdmins() {
  return (await repos.users.list()).filter((u) => u.active && u.roleId === ADMIN_ROLE_ID);
}

async function assertUsernameFree(username, exceptId) {
  const found = await repos.users.findBy('username', username, { includeDeleted: true });
  if (found.some((u) => u.id !== exceptId)) throw new RuleError('اسم المستخدم مستخدم بالفعل');
}

/**
 * @param {{ displayName: string, username: string, password: string, roleId: string,
 *           title?: string, isDoctor?: boolean, color?: string, pin?: string }} input
 */
export async function createUser(input) {
  const username = normalizeUsername(input.username);
  const err = validateUsername(username) || validatePassword(input.password, username) || (input.pin ? validatePin(input.pin) : '');
  if (err) throw new AuthError('weak', err);
  if (!input.displayName?.trim()) throw new RuleError('الاسم مطلوب');
  if (!(await repos.roles.get(input.roleId))) throw new RuleError('اختر دورًا صحيحًا');
  await assertUsernameFree(username);
  const count = (await repos.users.list({ includeDeleted: true })).length;
  const user = await repos.users.create({
    username,
    displayName: input.displayName.trim(),
    title: input.title?.trim() ?? '',
    roleId: input.roleId,
    isDoctor: !!input.isDoctor,
    color: input.color ?? USER_COLORS[count % USER_COLORS.length],
    active: true,
    mustChangePassword: true, // the new person sets their own password at first login
    permOverrides: {},
    password: await hashSecret(input.password),
    pin: input.pin ? await hashSecret(cleanPin(input.pin)) : null,
  });
  return user;
}

/**
 * Updates profile/role/permissions (not secrets).
 * @param {string} id
 * @param {Partial<{ displayName: string, title: string, roleId: string, isDoctor: boolean,
 *                   color: string, active: boolean, permOverrides: object }>} patch
 */
export async function updateUser(id, patch) {
  const me = currentUser();
  const user = await repos.users.require(id);
  const allowed = ['displayName', 'title', 'roleId', 'isDoctor', 'color', 'active', 'permOverrides'];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  if ('displayName' in clean && !String(clean.displayName).trim()) throw new RuleError('الاسم مطلوب');

  const losesAdmin = user.roleId === ADMIN_ROLE_ID && user.active &&
    (('roleId' in clean && clean.roleId !== ADMIN_ROLE_ID) || clean.active === false);
  if (losesAdmin) {
    if (id === me?.id) throw new RuleError('لا يمكنك إزالة صلاحية المدير أو إيقاف حسابك بنفسك');
    if ((await activeAdmins()).length <= 1) throw new RuleError('يجب أن يبقى مدير نظام واحد مفعّل على الأقل');
  }
  if (clean.active === false && id === me?.id) throw new RuleError('لا يمكنك إيقاف حسابك بنفسك');
  if ('roleId' in clean && !(await repos.roles.get(clean.roleId))) throw new RuleError('اختر دورًا صحيحًا');

  const updated = await repos.users.update(id, clean);
  if (id === me?.id) await reloadSessionPermissions();
  return updated;
}

/** Admin sets a temporary password; the user must change it at next login. */
export async function resetPassword(id, newPassword) {
  const user = await repos.users.require(id);
  const err = validatePassword(newPassword, user.username);
  if (err) throw new AuthError('weak', err);
  await repos.users.update(id, { password: await hashSecret(newPassword), mustChangePassword: id !== currentUser()?.id });
  await logEvent({ action: 'password_reset', entity: 'users', entityId: id, summary: user.displayName });
}

/** Removes a user's PIN (admin). */
export async function clearPin(id) {
  await repos.users.update(id, { pin: null });
}

/** Soft-deletes a user (their name stays on records they created). */
export async function deleteUser(id) {
  const me = currentUser();
  if (id === me?.id) throw new RuleError('لا يمكنك حذف حسابك بنفسك');
  const user = await repos.users.require(id);
  if (user.roleId === ADMIN_ROLE_ID && user.active && (await activeAdmins()).length <= 1) {
    throw new RuleError('لا يمكن حذف آخر مدير نظام');
  }
  await repos.users.remove(id);
}

/* ---------- Roles ---------- */

export async function listRoles() {
  const order = ['admin', 'doctor', 'nurse', 'reception'];
  const roles = await repos.roles.list();
  const rank = (r) => (order.includes(r.id) ? order.indexOf(r.id) : 99);
  return roles.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ar'));
}

/** Count of (non-deleted) users per role id. */
export async function roleUsage() {
  const counts = {};
  for (const u of await repos.users.list()) counts[u.roleId] = (counts[u.roleId] ?? 0) + 1;
  return counts;
}

/** @param {{ name: string, copyFrom?: string }} input */
export async function createRole({ name, copyFrom }) {
  if (!name?.trim()) throw new RuleError('اسم الدور مطلوب');
  const roles = await repos.roles.list();
  if (roles.some((r) => r.name.trim() === name.trim())) throw new RuleError('يوجد دور بنفس الاسم');
  const source = copyFrom ? roles.find((r) => r.id === copyFrom) : null;
  const permissions = source && source.id !== ADMIN_ROLE_ID ? structuredClone(source.permissions) : emptyMatrix();
  return repos.roles.create({ name: name.trim(), system: false, color: 'primary', permissions });
}

/** @param {string} id @param {{ name?: string, permissions?: object }} patch */
export async function updateRole(id, patch) {
  if (id === ADMIN_ROLE_ID) throw new RuleError('صلاحيات مدير النظام ثابتة ولا يمكن تعديلها');
  const clean = {};
  if ('name' in patch) {
    if (!patch.name?.trim()) throw new RuleError('اسم الدور مطلوب');
    clean.name = patch.name.trim();
  }
  if ('permissions' in patch) {
    // keep only known module/action cells; admin-only modules are never granted
    clean.permissions = {};
    for (const m of MODULES) {
      clean.permissions[m.key] = {};
      for (const a of m.actions) clean.permissions[m.key][a] = !m.adminOnly && !!patch.permissions?.[m.key]?.[a];
    }
  }
  const role = await repos.roles.update(id, clean);
  if (currentUser()?.roleId === id) await reloadSessionPermissions();
  return role;
}

export async function deleteRole(id) {
  const role = await repos.roles.require(id);
  if (role.system) throw new RuleError('لا يمكن حذف الأدوار الأساسية');
  const usage = (await roleUsage())[id] ?? 0;
  if (usage > 0) throw new RuleError(`هذا الدور مُسند إلى ${usage} مستخدم. انقلهم إلى دور آخر أولًا.`);
  await repos.roles.remove(id);
}
