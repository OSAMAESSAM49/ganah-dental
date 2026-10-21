/**
 * Default procedures catalog (from the clinic brief). Fully editable in the app.
 * Prices start at 0 on purpose: the clinic sets its own prices (the catalog screen shows
 * a reminder until every active procedure has one).
 *
 * Fields: name, minutes (estimated duration), sessions, perTooth, lab (needs a dental lab).
 */
import { inferChartEffect } from '../core/chart-conditions.js';

export const SEED_CATEGORIES = [
  { id: 'endo', name: 'علاج الجذور', icon: 'tooth', items: [
    { name: 'حشو عصب (أمامي)', minutes: 45, sessions: 1, perTooth: true },
    { name: 'حشو عصب (ضاحك)', minutes: 60, sessions: 1, perTooth: true },
    { name: 'حشو عصب (ضرس)', minutes: 90, sessions: 2, perTooth: true },
    { name: 'إعادة حشو عصب', minutes: 90, sessions: 2, perTooth: true },
  ] },
  { id: 'fillings', name: 'الحشوات', icon: 'sparkles', items: [
    { name: 'حشو تجميلي عالي الجودة', minutes: 45, sessions: 1, perTooth: true },
    { name: 'حشو تجميلي اقتصادي', minutes: 40, sessions: 1, perTooth: true },
    { name: 'حشو مؤقت', minutes: 20, sessions: 1, perTooth: true },
  ] },
  { id: 'prostho', name: 'التركيبات', icon: 'flask-conical', items: [
    { name: 'كراون زيركون', minutes: 60, sessions: 2, perTooth: true, lab: true },
    { name: 'كراون إيماكس', minutes: 60, sessions: 2, perTooth: true, lab: true },
    { name: 'كراون بورسلين', minutes: 60, sessions: 2, perTooth: true, lab: true },
    { name: 'كراون مؤقت', minutes: 30, sessions: 1, perTooth: true },
    { name: 'فينير إيماكس', minutes: 60, sessions: 2, perTooth: true, lab: true },
    { name: 'كوبري (للوحدة)', minutes: 60, sessions: 2, perTooth: true, lab: true },
  ] },
  { id: 'surgery', name: 'الجراحة', icon: 'stethoscope', items: [
    { name: 'خلع عادي', minutes: 30, sessions: 1, perTooth: true },
    { name: 'خلع جراحي', minutes: 60, sessions: 1, perTooth: true },
    { name: 'خلع ضرس عقل', minutes: 60, sessions: 1, perTooth: true },
  ] },
  { id: 'perio', name: 'اللثة والوقاية', icon: 'heart-pulse', items: [
    { name: 'تنظيف جير', minutes: 45, sessions: 1 },
    { name: 'تلميع', minutes: 20, sessions: 1 },
    { name: 'تبييض', minutes: 60, sessions: 1 },
    { name: 'فلورايد', minutes: 15, sessions: 1 },
    { name: 'سيلانت', minutes: 20, sessions: 1, perTooth: true },
  ] },
  { id: 'pedo', name: 'الأطفال', icon: 'smile', items: [
    { name: 'بلبوتومي', minutes: 40, sessions: 1, perTooth: true },
    { name: 'كراون أطفال', minutes: 40, sessions: 1, perTooth: true },
    { name: 'حافظ مسافة', minutes: 30, sessions: 2, perTooth: true, lab: true },
  ] },
  { id: 'other', name: 'أخرى', icon: 'clipboard-list', items: [
    { name: 'كشف', minutes: 15, sessions: 1 },
    { name: 'استشارة', minutes: 15, sessions: 1 },
    { name: 'أشعة', minutes: 10, sessions: 1 },
  ] },
];

/**
 * Writes the seed catalog using the given put function (works inside the upgrade
 * transaction as well as a normal adapter transaction).
 * @param {(store: string, record: object) => any} put
 */
export function seedCatalog(put) {
  const t = new Date().toISOString();
  const meta = { createdAt: t, updatedAt: t, createdBy: null, updatedBy: null };
  SEED_CATEGORIES.forEach((c, ci) => {
    put('procedureCategories', { id: c.id, name: c.name, icon: c.icon, order: ci, active: true, ...meta });
    c.items.forEach((p, pi) => {
      put('procedures', {
        id: crypto.randomUUID(),
        categoryId: c.id,
        name: p.name,
        price: 0,
        durationMin: p.minutes,
        sessions: p.sessions,
        perTooth: !!p.perTooth,
        needsLab: !!p.lab,
        active: true,
        order: pi,
        notes: '',
        instructionTemplateId: null, // phase 8
        followUpSchedule: [],        // phase 8
        recipe: [],                  // phase 7
        chartEffect: inferChartEffect(p.name),
        ...meta,
      });
    });
  });
}
