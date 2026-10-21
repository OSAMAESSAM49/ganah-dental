/**
 * Everything that needs attention now (dashboard panel and the top-bar bell), limited to
 * the modules the signed-in user can view. Each alert links to the screen that resolves it.
 */
import { can } from '../core/permissions.js';
import { digits, formatMoney } from '../core/format.js';
import { followUpCounts } from './followups.js';
import { allInstallments } from './billing.js';
import { tomorrowsReminders } from './appointments.js';
import { overdueLabCases } from './labs.js';
import { inventoryAlerts } from './inventory.js';
import { backupStatus } from './backup.js';

/** @typedef {{ icon: string, tone: 'danger'|'warning'|'info', title: string, sub: string, link: string }} Alert */

/** Most urgent first. @param {object|null} [backup] backupStatus() result if already loaded @returns {Promise<Alert[]>} */
export async function collectAlerts(backup) {
  if (backup === undefined) backup = can('settings', 'edit') ? await backupStatus() : null;
  const out = [];
  if (backup?.due) out.push({ icon: 'database', tone: 'warning', title: 'حان وقت النسخ الاحتياطي', sub: backup.lastAt ? `آخر نسخة منذ ${digits(backup.days)} يوم` : 'لم تؤخذ أي نسخة بعد', link: '#/settings?tab=backup' });
  if (can('followups')) {
    const fu = await followUpCounts();
    if (fu.overdue) out.push({ icon: 'bell', tone: 'danger', title: `${digits(fu.overdue)} متابعة متأخرة`, sub: 'اتصالات وفحوص بعد العلاج', link: '#/followups?filter=overdue' });
    if (fu.today) out.push({ icon: 'bell', tone: 'info', title: `${digits(fu.today)} متابعة اليوم`, sub: 'رسالة واتساب جاهزة لكل مريض', link: '#/followups?filter=today' });
  }
  if (can('billing')) {
    const overdue = (await allInstallments()).filter((i) => i.status === 'overdue');
    if (overdue.length) out.push({ icon: 'wallet', tone: 'danger', title: `${digits(overdue.length)} قسط متأخر`, sub: formatMoney(overdue.reduce((n, i) => n + i.remainingOnInstallment, 0)), link: '#/billing?tab=installments' });
  }
  if (can('appointments')) {
    const pending = (await tomorrowsReminders()).filter((a) => !a.reminderSentAt);
    if (pending.length) out.push({ icon: 'message-circle', tone: 'info', title: `${digits(pending.length)} تذكير لمواعيد الغد`, sub: 'لم تُرسل بعد', link: '#/appointments' });
  }
  if (can('labs')) {
    const late = await overdueLabCases();
    if (late.length) out.push({ icon: 'flask-conical', tone: 'warning', title: `${digits(late.length)} حالة معمل متأخرة`, sub: late.slice(0, 2).map((c) => c.patientName).join('، '), link: '#/labs?filter=overdue' });
  }
  if (can('inventory')) {
    const inv = await inventoryAlerts();
    if (inv.expired.length) out.push({ icon: 'triangle-alert', tone: 'danger', title: `${digits(inv.expired.length)} تشغيلة منتهية الصلاحية`, sub: 'استبعدها من الاستخدام', link: '#/inventory?tab=alerts' });
    if (inv.low.length) out.push({ icon: 'package', tone: 'warning', title: `${digits(inv.low.length)} صنف يحتاج شراء`, sub: inv.low.slice(0, 2).map((i) => i.name).join('، '), link: '#/inventory?tab=shopping' });
    if (inv.expiring.length) out.push({ icon: 'clock', tone: 'warning', title: `${digits(inv.expiring.length)} تشغيلة تنتهي قريبًا`, sub: 'خلال 60 يومًا', link: '#/inventory?tab=alerts' });
  }
  return out;
}
