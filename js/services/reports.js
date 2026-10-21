/**
 * Clinic reports for a period [from, to] (inclusive 'YYYY-MM-DD' days). Read-only: every
 * function aggregates existing records; nothing is cached or stored.
 *   - collections = non-void payments received (cash basis)
 *   - production  = value of treatment items completed (done) in the period
 *   - billed      = totals of non-void invoices dated in the period
 */
import { repos } from '../data/index.js';
import { todayISO } from '../core/format.js';
import { addDays, weekday } from '../core/time.js';
import { itemMath } from './treatment.js';
import { invoiceTotals, outstandingBalances, allInstallments } from './billing.js';
import { listCategories } from './expenses.js';
import { listItems } from './inventory.js';
import { ageYears } from './patients.js';

const inRange = (day, from, to) => !!day && day >= from && day <= to;
const localDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const add = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

/** 'YYYY-MM' keys covering [from, to]. Exported for tests. */
export function monthKeys(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
    if (out.length > 120) break;
  }
  return out;
}

/** Day keys covering [from, to] (max 92). */
export function dayKeys(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 92; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Buckets by day when the period is ≤ 62 days, otherwise by month. */
export function bucketsFor(from, to) {
  const days = dayKeys(from, to);
  return days.length <= 62 && days.at(-1) === to
    ? { unit: 'day', keys: days, of: (day) => day }
    : { unit: 'month', keys: monthKeys(from, to), of: (day) => day.slice(0, 7) };
}

/** Named periods for the period picker. */
export function presetRange(key, today = todayISO()) {
  const [y, m] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const monthEnd = (yy, mm) => `${yy}-${pad(mm)}-${pad(new Date(yy, mm, 0).getDate())}`;
  switch (key) {
    case 'today': return [today, today];
    case 'week': return [addDays(today, -((weekday(today) + 1) % 7)), today];
    case 'last30': return [addDays(today, -29), today];
    case 'lastMonth': { const lm = m === 1 ? 12 : m - 1, ly = m === 1 ? y - 1 : y; return [`${ly}-${pad(lm)}-01`, monthEnd(ly, lm)]; }
    case 'quarter': { const qm = Math.floor((m - 1) / 3) * 3 + 1; return [`${y}-${pad(qm)}-01`, today]; }
    case 'year': return [`${y}-01-01`, today];
    case 'last12': { const sm = m === 12 ? 1 : m + 1, sy = m === 12 ? y : y - 1; return [`${sy}-${pad(sm)}-01`, today]; }
    default: return [`${y}-${pad(m)}-01`, today]; // 'month'
  }
}

/* ---------- Financial ---------- */

export async function financialReport(from, to) {
  const [payments, expenses, invoices, categories] = await Promise.all([
    repos.payments.list({ index: 'date', range: { gte: from, lte: to } }),
    repos.expenses.list({ index: 'date', range: { gte: from, lte: to } }),
    repos.invoices.list({ index: 'date', range: { gte: from, lte: to } }),
    listCategories(),
  ]);
  const live = payments.filter((p) => !p.voided);
  const liveInvoices = invoices.filter((i) => i.status !== 'void');
  const b = bucketsFor(from, to);
  const inc = new Map(), exp = new Map(), byMethod = new Map(), byCat = new Map(), byUser = new Map();
  for (const p of live) { add(inc, b.of(p.date), p.amount); add(byMethod, p.method, p.amount); add(byUser, p.userName ?? '—', p.amount); }
  for (const e of expenses) { add(exp, b.of(e.date), e.amount); add(byCat, e.categoryId, e.amount); }
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const collections = live.reduce((n, p) => n + p.amount, 0);
  const expensesTotal = expenses.reduce((n, e) => n + e.amount, 0);
  const billed = liveInvoices.reduce((n, i) => n + invoiceTotals(i).total, 0);
  const discounts = liveInvoices.reduce((n, i) => n + invoiceTotals(i).discount, 0);
  return {
    collections, expenses: expensesTotal, net: collections - expensesTotal, billed, discounts,
    invoicesCount: liveInvoices.length, paymentsCount: live.length,
    unit: b.unit,
    series: b.keys.map((k) => ({ key: k, income: inc.get(k) ?? 0, expenses: exp.get(k) ?? 0, net: (inc.get(k) ?? 0) - (exp.get(k) ?? 0) })),
    byMethod: [...byMethod].map(([method, amount]) => ({ method, amount })).sort((a, b2) => b2.amount - a.amount),
    byCategory: [...byCat].map(([id, amount]) => ({ id, name: catName.get(id) ?? 'أخرى', amount })).sort((a, b2) => b2.amount - a.amount),
    byUser: [...byUser].map(([name, amount]) => ({ name, amount })).sort((a, b2) => b2.amount - a.amount),
    payments: live.sort((a, b2) => a.date.localeCompare(b2.date) || a.at.localeCompare(b2.at)),
    expenseRows: expenses.sort((a, b2) => a.date.localeCompare(b2.date)).map((e) => ({ ...e, categoryName: catName.get(e.categoryId) ?? 'أخرى' })),
  };
}

/* ---------- Treatments ---------- */

/** Completed treatment items in the period with value and actual material cost. */
export async function treatmentsReport(from, to) {
  const [items, moves, users, cats, procs] = await Promise.all([
    repos.treatmentItems.list({ index: 'status', range: { eq: 'done' } }),
    repos.stockMovements.list(), repos.users.list(), repos.procedureCategories.list(), repos.procedures.list(),
  ]);
  const done = items.filter((i) => inRange(localDay(i.doneAt), from, to));
  const cost = new Map();
  for (const m of moves) {
    if (!m.treatmentItemId) continue;
    if (m.type === 'consume') add(cost, m.treatmentItemId, m.cost);
    if (m.type === 'return') add(cost, m.treatmentItemId, -m.cost);
  }
  const userName = new Map(users.map((u) => [u.id, u.displayName]));
  const catOf = new Map(procs.map((p) => [p.id, p.categoryId]));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const doneBy = (i) => (i.doctorId && userName.get(i.doctorId)) || [...(i.statusHistory ?? [])].reverse().find((h) => h.status === 'done')?.by || '—';
  const rows = done.map((i) => ({
    id: i.id, day: localDay(i.doneAt), patientId: i.patientId, procedureName: i.procedureName, teeth: i.teeth ?? [],
    value: itemMath(i).total, materials: Math.max(0, cost.get(i.id) ?? 0), doctor: doneBy(i),
    category: catName.get(catOf.get(i.procedureId)) ?? 'أخرى', invoiced: !!i.invoiceId,
  }));
  const group = (key) => {
    const m = new Map();
    for (const r of rows) {
      const g = m.get(r[key]) ?? { name: r[key], count: 0, value: 0, materials: 0 };
      g.count++; g.value += r.value; g.materials += r.materials;
      m.set(r[key], g);
    }
    return [...m.values()].map((g) => ({ ...g, margin: g.value - g.materials })).sort((a, b) => b.value - a.value || b.count - a.count);
  };
  const value = rows.reduce((n, r) => n + r.value, 0), materials = rows.reduce((n, r) => n + r.materials, 0);
  return {
    count: rows.length, value, materials, margin: value - materials, uninvoiced: rows.filter((r) => !r.invoiced).reduce((n, r) => n + r.value, 0),
    byProcedure: group('procedureName'), byDoctor: group('doctor'), byCategory: group('category'),
    rows: rows.sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/* ---------- Patients ---------- */

const AGE_GROUPS = [['أقل من 13', 0, 12], ['13–17', 13, 17], ['18–29', 18, 29], ['30–44', 30, 44], ['45–59', 45, 59], ['60+', 60, 200]];

export async function patientsReport(from, to) {
  const [patients, appts, items] = await Promise.all([
    repos.patients.list(), repos.appointments.list({ index: 'date', range: { gte: from, lte: to } }),
    repos.treatmentItems.list({ index: 'status', range: { eq: 'done' } }),
  ]);
  const created = patients.filter((p) => inRange(localDay(p.createdAt), from, to));
  const b = bucketsFor(from, to);
  const perBucket = new Map();
  for (const p of created) add(perBucket, b.of(localDay(p.createdAt)));
  const bySource = new Map(), byGender = new Map(), byAge = new Map();
  for (const p of created) {
    add(bySource, p.referralSource || '');
    add(byGender, p.gender || '');
    const age = ageYears(p);
    const g = age == null ? 'غير مسجل' : AGE_GROUPS.find(([, lo, hi]) => age >= lo && age <= hi)?.[0] ?? 'غير مسجل';
    add(byAge, g);
  }
  const visited = new Set([...appts.filter((a) => a.status === 'done').map((a) => a.patientId), ...items.filter((i) => inRange(localDay(i.doneAt), from, to)).map((i) => i.patientId)]);
  return {
    total: patients.length, newCount: created.length, activeCount: visited.size,
    unit: b.unit, series: b.keys.map((k) => ({ key: k, count: perBucket.get(k) ?? 0 })),
    bySource: [...bySource].map(([key, count]) => ({ key, count })).sort((a, c) => c.count - a.count),
    byGender: [...byGender].map(([key, count]) => ({ key, count })),
    byAge: [...AGE_GROUPS.map(([g]) => g), 'غير مسجل'].map((key) => ({ key, count: byAge.get(key) ?? 0 })).filter((r) => r.count),
    newPatients: created.sort((a, c) => a.createdAt.localeCompare(c.createdAt)),
  };
}

/* ---------- Appointments ---------- */

export async function appointmentsReport(from, to) {
  const [appts, users, followUps] = await Promise.all([
    repos.appointments.list({ index: 'date', range: { gte: from, lte: to } }), repos.users.list(),
    repos.followUps.list({ index: 'dueDate', range: { gte: from, lte: to } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.displayName]));
  const byStatus = new Map(), byDoctor = new Map(), byWeekday = new Map(), perBucket = new Map();
  const b = bucketsFor(from, to);
  for (const a of appts) {
    add(byStatus, a.status);
    if (a.status !== 'cancelled') {
      add(perBucket, b.of(a.date));
      add(byWeekday, weekday(a.date));
      const d = byDoctor.get(a.doctorId ?? '') ?? { name: userName.get(a.doctorId) ?? 'بدون طبيب', total: 0, done: 0, noShow: 0, minutes: 0 };
      d.total++; if (a.status === 'done') { d.done++; d.minutes += a.duration ?? 0; } if (a.status === 'no_show') d.noShow++;
      byDoctor.set(a.doctorId ?? '', d);
    }
  }
  const past = appts.filter((a) => a.date < todayISO() || a.status === 'done' || a.status === 'no_show');
  const finished = past.filter((a) => a.status === 'done' || a.status === 'no_show');
  const noShow = finished.filter((a) => a.status === 'no_show').length;
  const fuDone = followUps.filter((f) => f.status === 'done').length;
  return {
    total: appts.filter((a) => a.status !== 'cancelled').length,
    done: byStatus.get('done') ?? 0, noShow, cancelled: byStatus.get('cancelled') ?? 0,
    noShowRate: finished.length ? noShow / finished.length : 0,
    byStatus: [...byStatus].map(([status, count]) => ({ status, count })).sort((a, c) => c.count - a.count),
    byDoctor: [...byDoctor.values()].sort((a, c) => c.total - a.total),
    // Saturday-first
    byWeekday: [6, 0, 1, 2, 3, 4, 5].map((wd) => ({ wd, count: byWeekday.get(wd) ?? 0 })),
    unit: b.unit, series: b.keys.map((k) => ({ key: k, count: perBucket.get(k) ?? 0 })),
    followUps: { total: followUps.length, done: fuDone, pending: followUps.filter((f) => f.status === 'pending').length, skipped: followUps.filter((f) => f.status === 'skipped').length },
  };
}

/* ---------- Receivables ---------- */

export async function receivablesReport(today = todayISO()) {
  const [balances, inst] = await Promise.all([outstandingBalances(), allInstallments(today)]);
  const overdue = inst.filter((i) => i.status === 'overdue');
  const upcoming30 = inst.filter((i) => i.status !== 'overdue' && i.dueDate <= addDays(today, 30));
  return {
    balances: balances.rows, total: balances.total,
    overdue, overdueTotal: overdue.reduce((n, i) => n + i.remainingOnInstallment, 0),
    upcoming30, upcomingTotal: upcoming30.reduce((n, i) => n + i.remainingOnInstallment, 0),
  };
}

/* ---------- Inventory ---------- */

export async function inventoryReport(from, to) {
  const [moves, items] = await Promise.all([repos.stockMovements.list({ index: 'date', range: { gte: from, lte: to } }), listItems({ includeInactive: true })]);
  const byItem = new Map();
  for (const m of moves) {
    const r = byItem.get(m.itemId) ?? { itemId: m.itemId, name: m.itemName, unit: m.unit, consumedQty: 0, consumedCost: 0, purchasedQty: 0, purchasedCost: 0, wasteQty: 0 };
    if (m.type === 'consume') { r.consumedQty += Math.abs(m.qty); r.consumedCost += m.cost; }
    if (m.type === 'return') { r.consumedQty -= Math.abs(m.qty); r.consumedCost -= m.cost; }
    if (m.type === 'purchase') { r.purchasedQty += Math.abs(m.qty); r.purchasedCost += m.cost; }
    if (m.type === 'adjust_out') r.wasteQty += Math.abs(m.qty);
    byItem.set(m.itemId, r);
  }
  const rows = [...byItem.values()].map((r) => ({ ...r, consumedQty: Math.round(r.consumedQty * 1000) / 1000 })).sort((a, b) => b.consumedCost - a.consumedCost);
  const active = items.filter((i) => i.active !== false);
  return {
    rows,
    consumedCost: rows.reduce((n, r) => n + r.consumedCost, 0),
    purchasedCost: rows.reduce((n, r) => n + r.purchasedCost, 0),
    stockValue: Math.round(active.reduce((n, i) => n + Math.max(0, i.qty) * i.costPerUnit, 0)),
    lowCount: active.filter((i) => i.status !== 'ok').length,
  };
}

/** Headline numbers for the dashboard: this month vs the same days last month. */
export async function dashboardKpis(today = todayISO()) {
  const [y, m, d] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const monthStart = `${y}-${pad(m)}-01`;
  const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
  const lastDays = new Date(ly, lm, 0).getDate();
  const prevStart = `${ly}-${pad(lm)}-01`, prevEnd = `${ly}-${pad(lm)}-${pad(Math.min(d, lastDays))}`;
  const [cur, prev] = await Promise.all([financialReport(monthStart, today), financialReport(prevStart, prevEnd)]);
  const trendFrom = presetRange('last12', today)[0];
  const trend = await financialReport(trendFrom, today);
  return { current: cur, previous: prev, trend: trend.series };
}

/** Percent change a → b (null when a is 0). */
export const change = (prev, cur) => (prev ? (cur - prev) / Math.abs(prev) : null);
