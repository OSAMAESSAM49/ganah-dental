/**
 * Navigation and route table. `module` is the permission key used by the permission
 * matrix (phase 2); items the user cannot view are hidden from menus, not just blocked.
 * `phase` marks screens that are not built yet (they render a "coming soon" view).
 */

/** @typedef {{ path: string, label: string, icon: string, module: string, phase?: number }} NavItem */

/** @type {{ title?: string, items: NavItem[] }[]} */
export const NAV_GROUPS = [
  {
    items: [
      { path: '/', label: 'الرئيسية', icon: 'layout-dashboard', module: 'dashboard' },
      { path: '/appointments', label: 'المواعيد', icon: 'calendar-days', module: 'appointments', phase: 5 },
      { path: '/patients', label: 'المرضى', icon: 'users', module: 'patients', phase: 3 },
    ],
  },
  {
    title: 'العيادة',
    items: [
      { path: '/followups', label: 'المتابعات', icon: 'bell', module: 'followups', phase: 8 },
      { path: '/prescriptions', label: 'الروشتات', icon: 'pill', module: 'prescriptions', phase: 8 },
      { path: '/labs', label: 'معامل التركيبات', icon: 'flask-conical', module: 'labs', phase: 7 },
    ],
  },
  {
    title: 'المالية والمخزون',
    items: [
      { path: '/billing', label: 'الحسابات والفواتير', icon: 'receipt', module: 'billing', phase: 6 },
      { path: '/expenses', label: 'المصروفات', icon: 'wallet', module: 'expenses', phase: 7 },
      { path: '/inventory', label: 'المخزون', icon: 'package', module: 'inventory', phase: 7 },
      { path: '/reports', label: 'التقارير', icon: 'chart-column', module: 'reports', phase: 9 },
    ],
  },
  {
    title: 'الإدارة',
    items: [
      { path: '/procedures', label: 'الإجراءات والأسعار', icon: 'list-checks', module: 'procedures', phase: 3 },
      { path: '/users', label: 'المستخدمون والصلاحيات', icon: 'shield-check', module: 'users', phase: 2 },
      { path: '/audit', label: 'سجل العمليات', icon: 'scroll-text', module: 'audit', phase: 2 },
      { path: '/settings', label: 'الإعدادات', icon: 'settings', module: 'settings', phase: 10 },
      { path: '/styleguide', label: 'دليل التصميم', icon: 'palette', module: 'settings' },
    ],
  },
];

/** Bottom bar on phones: four shortcuts + "more" (opens the drawer). */
export const BOTTOM_NAV = ['/', '/appointments', '/patients', '/followups'];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const comingSoon = () => import('../modules/coming-soon/index.js');

/** Route definitions for the router. */
export const ROUTES = [
  { path: '/', title: 'الرئيسية', load: () => import('../modules/dashboard/index.js'), permission: ['dashboard', 'view'] },
  { path: '/styleguide', title: 'دليل التصميم', load: () => import('../modules/styleguide/index.js'), permission: ['settings', 'view'] },
  ...NAV_ITEMS.filter((i) => i.phase).map((i) => ({
    path: i.path, title: i.label, load: comingSoon, permission: [i.module, 'view'], meta: { phase: i.phase, icon: i.icon },
  })),
];

export const NOT_FOUND_ROUTE = { path: '*', title: 'الصفحة غير موجودة', load: () => import('../modules/not-found/index.js') };
