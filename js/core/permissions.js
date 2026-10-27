/**
 * Permission matrix: module × action. A role grants a default matrix; a user may carry
 * per-cell overrides (true = allow, false = deny) on top of their role.
 * The Admin role always has everything and cannot be edited.
 */
import { getSession } from './session.js';

export const ACTIONS = /** @type {const} */ (['view', 'create', 'edit', 'delete', 'export']);
export const ACTION_LABELS = { view: 'عرض', create: 'إضافة', edit: 'تعديل', delete: 'حذف', export: 'تصدير' };

const ALL = ['view', 'create', 'edit', 'delete', 'export'];

/**
 * Modules and the actions that make sense for each.
 * adminOnly modules can never be granted to other roles (brief: only Admin sees the audit log
 * and manages users).
 * @type {{ key: string, label: string, actions: string[], adminOnly?: boolean, hint?: string }[]}
 */
export const MODULES = [
  { key: 'dashboard', label: 'الرئيسية', actions: ['view'] },
  { key: 'patients', label: 'المرضى', actions: ALL, hint: 'الملف والتاريخ الطبي' },
  { key: 'chart', label: 'خريطة الأسنان', actions: ['view', 'edit'] },
  { key: 'treatment', label: 'خطط العلاج', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'appointments', label: 'المواعيد', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'billing', label: 'الفواتير والمدفوعات', actions: ['view', 'create', 'delete'], hint: 'الحذف = إبطال فاتورة أو إيصال' },
  { key: 'inventory', label: 'المخزون', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'expenses', label: 'المصروفات', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'labs', label: 'معامل التركيبات', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'followups', label: 'المتابعات', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'prescriptions', label: 'الروشتات', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'reports', label: 'التقارير', actions: ['view', 'export'] },
  { key: 'procedures', label: 'الإجراءات والأسعار', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'settings', label: 'الإعدادات والنسخ الاحتياطي', actions: ['view', 'edit'] },
  { key: 'users', label: 'المستخدمون والصلاحيات', actions: ['view', 'create', 'edit', 'delete'], adminOnly: true },
  { key: 'audit', label: 'سجل العمليات', actions: ['view'], adminOnly: true },
];

export const ADMIN_ROLE_ID = 'admin';

/** Builds a matrix from a compact spec: { patients: 'vcex' } (v c e d x). */
function matrix(spec) {
  const letters = { v: 'view', c: 'create', e: 'edit', d: 'delete', x: 'export' };
  const out = {};
  for (const m of MODULES) {
    out[m.key] = {};
    const granted = [...(spec[m.key] ?? '')].map((l) => letters[l]);
    for (const a of m.actions) out[m.key][a] = granted.includes(a);
  }
  return out;
}

export const fullMatrix = () => matrix(Object.fromEntries(MODULES.map((m) => [m.key, 'vcedx'])));
export const emptyMatrix = () => matrix({});

/** Default roles seeded by the setup wizard. Ids are stable; names can be edited. */
export const DEFAULT_ROLES = [
  { id: ADMIN_ROLE_ID, name: 'مدير النظام', system: true, color: 'violet', permissions: fullMatrix() },
  {
    id: 'doctor', name: 'طبيب', system: true, color: 'lime',
    permissions: matrix({
      dashboard: 'v', patients: 'vcex', chart: 've', treatment: 'vcedx', appointments: 'vce',
      billing: 'v', inventory: 'v', labs: 'vce', followups: 'vce', prescriptions: 'vced',
      reports: 'v', procedures: 'v',
    }),
  },
  {
    id: 'nurse', name: 'ممرض / مساعد', system: true, color: 'info',
    permissions: matrix({
      dashboard: 'v', patients: 'v', chart: 'v', treatment: 've', appointments: 've',
      inventory: 'vce', labs: 've', followups: 've', prescriptions: 'v', procedures: 'v',
    }),
  },
  {
    id: 'reception', name: 'استقبال', system: true, color: 'warning',
    permissions: matrix({
      dashboard: 'v', patients: 'vcex', appointments: 'vced', billing: 'vc', labs: 'v',
      followups: 've', prescriptions: 'v', procedures: 'v',
    }),
  },
];

/**
 * Effective permission matrix for a user with a role.
 * @param {{ id: string, permissions: Record<string, Record<string, boolean>> } | null} role
 * @param {{ permOverrides?: Record<string, Record<string, boolean>> } | null} [user]
 */
export function effectivePermissions(role, user) {
  if (!role) return emptyMatrix();
  if (role.id === ADMIN_ROLE_ID) return fullMatrix();
  const out = {};
  for (const m of MODULES) {
    out[m.key] = {};
    for (const a of m.actions) {
      const override = user?.permOverrides?.[m.key]?.[a];
      const value = typeof override === 'boolean' ? override : !!role.permissions?.[m.key]?.[a];
      out[m.key][a] = m.adminOnly ? false : value;
    }
  }
  return out;
}

/**
 * Overrides needed so that `desired` holds for a user of `role` (cells equal to the role
 * default are dropped). Used by the per-user grid.
 */
export function diffOverrides(role, desired) {
  const out = {};
  for (const m of MODULES) {
    if (m.adminOnly) continue;
    for (const a of m.actions) {
      const base = !!role?.permissions?.[m.key]?.[a];
      const want = !!desired?.[m.key]?.[a];
      if (base !== want) (out[m.key] ??= {})[a] = want;
    }
  }
  return out;
}

/** Number of overridden cells. */
export const countOverrides = (overrides) =>
  Object.values(overrides ?? {}).reduce((n, cells) => n + Object.keys(cells).length, 0);

/**
 * Whether the signed-in user may perform an action.
 * @param {string} module @param {string} [action='view']
 */
export function can(module, action = 'view') {
  const s = getSession();
  return !!s?.permissions?.[module]?.[action];
}

export const isAdmin = () => getSession()?.user?.roleId === ADMIN_ROLE_ID;

/**
 * Invoices, receipts and patients who have invoices may only be voided, edited or deleted
 * by the Admin or by the user who entered them. With nobody signed in (background work,
 * tests) the services' own rules apply.
 */
export function ownsOrAdmin(record) {
  const s = getSession();
  if (!s) return true;
  return s.user?.roleId === ADMIN_ROLE_ID || (!!record?.createdBy && record.createdBy === s.user?.id);
}
