/**
 * Cards on the home screen. A card shows when the user may view its module AND the Admin
 * has not hidden it for that user (user.dashboardCards: list of keys; null/absent = all).
 */
import { can } from './permissions.js';

/** @type {{ key: string, label: string, module: string }[]} */
export const DASHBOARD_CARDS = [
  { key: 'appointments', label: 'مواعيد اليوم', module: 'appointments' },
  { key: 'collections', label: 'مدفوعات اليوم', module: 'billing' },
  { key: 'net', label: 'صافي اليوم', module: 'billing' },
  { key: 'newPatients', label: 'مرضى جدد', module: 'patients' },
  { key: 'invoices', label: 'فواتير اليوم', module: 'billing' },
  { key: 'patientsList', label: 'قائمة مرضى اليوم', module: 'appointments' },
  { key: 'alerts', label: 'يحتاج انتباهك', module: 'dashboard' },
  { key: 'trend', label: 'رسم المقبوضات والمصروفات (12 شهرًا)', module: 'billing' },
  { key: 'system', label: 'حالة النظام', module: 'dashboard' },
];

/** Is the card shown to this user? @param {string} key @param {{ dashboardCards?: string[]|null }|null} user */
export function cardVisible(key, user) {
  const card = DASHBOARD_CARDS.find((c) => c.key === key);
  if (!card || !can(card.module)) return false;
  return !Array.isArray(user?.dashboardCards) || user.dashboardCards.includes(key);
}
