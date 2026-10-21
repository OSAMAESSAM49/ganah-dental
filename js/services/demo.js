/**
 * Demo data for trying the app and training staff: ~24 fictional patients with visits,
 * treatment plans, invoices, payments, follow-ups and prescriptions over the last six
 * months, plus demo stock receipts and monthly expenses.
 *
 * Everything is reachable from a demo patient (patient.isDemo) or flagged isDemo itself,
 * so removeDemoData() deletes it completely and resets the file / invoice / receipt /
 * prescription counters to the last real number. Names and phone numbers are made up.
 */
import { getAdapter, repos } from '../data/index.js';
import { todayISO, toISODate } from '../core/format.js';
import { addDays } from '../core/time.js';
import { createPatient } from './patients.js';
import { ensureActivePlan, addItems, setItemStatus } from './treatment.js';
import { createInvoice, recordPayment } from './billing.js';
import { listItems, receiveStock, recomputeItem } from './inventory.js';
import { createLabCase } from './labs.js';
import { createPrescription } from './prescriptions.js';
import { listDoctors } from './schedule.js';
import { completeFollowUp } from './followups.js';
import { logEvent } from './audit.js';

const PATIENTS = [
  ['أحمد محمود السيد', 'male', 34], ['منى عبد الرحمن', 'female', 29], ['محمد إبراهيم علي', 'male', 45], ['سلمى حسن فؤاد', 'female', 22],
  ['يوسف خالد عمر', 'male', 9], ['فاطمة الزهراء أحمد', 'female', 52], ['عمر سامي النجار', 'male', 31], ['نورهان مصطفى', 'female', 27],
  ['كريم عادل شوقي', 'male', 38], ['هالة سعيد يوسف', 'female', 61], ['مازن طارق حلمي', 'male', 12], ['ريم أشرف كمال', 'female', 35],
  ['إسلام فتحي رضوان', 'male', 41], ['دينا ممدوح عزت', 'female', 33], ['زياد وليد منصور', 'male', 7], ['آية جمال الدين', 'female', 24],
  ['حسام عبد الله زكي', 'male', 56], ['مريم هشام لطفي', 'female', 19], ['طارق سيد عبده', 'male', 67], ['شيماء ناصر حسين', 'female', 30],
  ['عبد الرحمن مجدي', 'male', 28], ['ياسمين رأفت', 'female', 44], ['مصطفى أنور', 'male', 50], ['جنى محمد صلاح', 'female', 11],
  ['أمير حمدي سالم', 'male', 36], ['رنا عاطف', 'female', 26], ['شريف نبيل', 'male', 47], ['هند عبد العزيز', 'female', 39],
  ['علي رمضان', 'male', 23], ['سارة وائل', 'female', 31], ['خالد فاروق', 'male', 58], ['نادين أيمن', 'female', 8],
  ['محمود جابر', 'male', 64], ['إيمان صبري', 'female', 48], ['آدم شادي', 'male', 6], ['بسمة رشاد', 'female', 37],
];
const SOURCES = ['facebook', 'friend', 'patient', 'google', 'instagram', 'sign', 'friend', 'tiktok'];
const PRICES = [[/كشف|استشارة/, 20000], [/أشعة/, 15000], [/تنظيف جير/, 60000], [/تلميع|فلورايد/, 30000], [/سيلانت/, 25000], [/تبييض/, 300000],
  [/حشو مؤقت/, 20000], [/حشو تجميلي اقتصادي/, 50000], [/حشو تجميلي/, 90000], [/حشو عصب \(ضرس\)|إعادة حشو/, 250000], [/حشو عصب/, 180000],
  [/خلع جراحي|ضرس عقل/, 120000], [/خلع/, 40000], [/كراون زيركون|إيماكس|فينير/, 450000], [/كراون/, 250000], [/بلبوتومي/, 60000], [/كوبري/, 350000]];
/** Typical treatment journeys: [procedure name, tooth|null][] */
const JOURNEYS = [
  [['كشف', null], ['تنظيف جير', null], ['حشو تجميلي عالي الجودة', 47]],
  [['كشف', null], ['حشو تجميلي عالي الجودة', 36], ['حشو تجميلي عالي الجودة', 46]],
  [['كشف', null], ['حشو عصب (ضرس)', 26], ['كراون زيركون', 26]],
  [['كشف', null], ['خلع جراحي', 38]],
  [['كشف', null], ['خلع عادي', 18], ['حشو تجميلي اقتصادي', 15]],
  [['كشف', null], ['تنظيف جير', null], ['تبييض', null]],
  [['كشف', null], ['بلبوتومي', 75], ['فلورايد', null]],
  [['كشف', null], ['حشو عصب (أمامي)', 11], ['حشو تجميلي عالي الجودة', 21]],
];
const UNIT_COST = { g: 2500, drop: 60, dose: 150, carpule: 1500, piece: 300, pair: 250, ml: 20 };

/** Small deterministic random generator so every demo set looks the same. */
function rng(seed = 7) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const iso = (day, minutes = 600) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).toISOString();
};
const priceOf = (name) => Math.round(((PRICES.find(([re]) => re.test(name))?.[1] ?? 50000) * 1.5) / 5000) * 5000;

/** Writes fields straight to a record (no audit, no updatedAt change) to back-date demo data. */
async function patch(store, id, fields) {
  const a = getAdapter();
  const r = await a.get(store, id);
  if (r) await a.put(store, { ...r, ...fields });
}

export async function demoStatus() {
  const patients = (await getAdapter().list('patients')).filter((p) => p.isDemo);
  return { patients: patients.length };
}

/** Creates the demo set. @returns {Promise<number>} number of demo patients */
export async function createDemoData() {
  if ((await demoStatus()).patients) throw new Error('البيانات التجريبية موجودة بالفعل');
  const rand = rng();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const today = todayISO();
  const procs = new Map((await repos.procedures.list()).map((p) => [p.name, p]));
  const doctor = (await listDoctors())[0] ?? null;
  const chair = 'chair-1';

  // 1. Stock for six months (so completed treatments deduct real quantities).
  const start = addDays(today, -185);
  for (const item of await listItems()) {
    await receiveStock({ itemId: item.id, qty: Math.max(10, item.minQty * 2), unitCost: UNIT_COST[item.unit] ?? 500, batchNo: 'DEMO', expiry: addDays(today, 400), supplier: 'مورد تجريبي', date: start, createExpense: true });
  }
  for (const b of (await repos.stockBatches.list()).filter((x) => x.batchNo === 'DEMO')) {
    await patch('stockBatches', b.id, { isDemo: true });
    for (const m of await repos.stockMovements.findBy('itemId', b.itemId)) if (m.batchId === b.id) await patch('stockMovements', m.id, { isDemo: true, date: start });
    const e = (await repos.expenses.findBy('refId', b.id))[0];
    if (e) await patch('expenses', e.id, { isDemo: true });
  }

  // 2. Fixed monthly expenses.
  for (let k = 5; k >= 0; k--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k);
    const day = toISODate(d);
    for (const [categoryId, amount, description] of [['rent', 350000, 'إيجار العيادة'], ['salaries', 450000, 'رواتب المساعدين'], ['utilities', 60000, 'كهرباء ومياه وإنترنت']]) {
      await repos.expenses.create({ categoryId, amount, date: day, description, method: 'cash', source: 'manual', refId: null, receiptMediaId: null, isDemo: true });
    }
  }

  // 3. Patients and their journeys.
  for (const [i, [name, gender, age]] of PATIENTS.entries()) {
    const firstDay = addDays(today, -Math.floor(3 + rand() * 160));
    const medical = { items: {} };
    if (i % 7 === 2) medical.items.allergyPenicillin = true;
    if (i % 6 === 4) medical.items.diabetes = true;
    if (i % 9 === 0 && age > 40) medical.items.anticoagulants = true;
    if (age > 55) medical.items.hypertension = true;
    const p = await createPatient({
      name, gender, phone: `010${String(90000000 + i * 1317).padStart(8, '0')}`, dob: `${new Date().getFullYear() - age}-0${1 + (i % 9)}-1${i % 9}`, dobEstimated: false,
      address: pick(['البجلات', 'المنصورة', 'دكرنس', 'منية النصر', 'الجمالية']), referralSource: SOURCES[i % SOURCES.length], medical, isDemo: true,
    });
    await patch('patients', p.id, { createdAt: iso(firstDay, 540) });

    const journey = JOURNEYS[i % JOURNEYS.length].filter(([n]) => procs.has(n));
    const plan = await ensureActivePlan(p.id);
    const items = [];
    for (const [n, tooth] of journey) {
      const [it] = await addItems(plan.id, { procedure: procs.get(n), teeth: tooth ? [tooth] : [], unitPrice: priceOf(n) });
      items.push(it);
    }

    // Visits: one per item, 1–3 weeks apart. Items in the past are done; the rest stay planned.
    let day = firstDay;
    const doneItems = [];
    for (const [k, it] of items.entries()) {
      if (k) day = addDays(day, 7 + Math.floor(rand() * 14));
      const minutes = 600 + 30 * Math.floor(rand() * 18);
      const isPast = day < today;
      const isToday = day === today;
      const noShow = isPast && rand() < 0.08;
      const appt = await repos.appointments.create({
        patientId: p.id, patientName: p.name, date: day, startMin: minutes, duration: procs.get(it.procedureName)?.durationMin ?? 30,
        doctorId: doctor?.id ?? null, chairId: chair, procedureIds: [it.procedureId], procedureNames: [it.procedureName], treatmentItemIds: [it.id],
        reason: '', notes: '', status: noShow ? 'no_show' : isPast ? 'done' : 'booked', statusHistory: [], clinicalNotes: isPast && !noShow ? 'تم العمل بدون مضاعفات.' : '',
        reminderSentAt: null, cancelReason: '',
      });
      await patch('appointments', appt.id, { createdAt: iso(addDays(day, -3)) });
      if (!isPast || noShow || isToday) continue;
      await setItemStatus(it.id, 'done');
      const doneAt = iso(day, minutes + 30);
      const fresh = await repos.treatmentItems.get(it.id);
      await patch('treatmentItems', it.id, { doneAt, doctorId: doctor?.id ?? null, statusHistory: (fresh.statusHistory ?? []).map((h) => ({ ...h, at: doneAt })) });
      for (const m of await repos.stockMovements.findBy('treatmentItemId', it.id)) await patch('stockMovements', m.id, { date: day, at: doneAt });
      for (const ev of await repos.toothEvents.findBy('patientId', p.id)) if (ev.treatmentItemId === it.id) await patch('toothEvents', ev.id, { at: doneAt });
      const offset = Math.round((new Date(today) - new Date(day)) / 86400000);
      for (const f of await repos.followUps.findBy('treatmentItemId', it.id)) {
        const due = addDays(f.dueDate, -offset);
        await patch('followUps', f.id, { dueDate: due, createdAt: doneAt });
        if (due < addDays(today, -2)) await completeFollowUp(f.id, pick(['الحالة مستقرة', 'لا يوجد ألم', 'الحالة مستقرة']));
      }
      doneItems.push({ it, day });
    }

    // Invoices: one per visit; most paid in full, some partly, one with installments.
    for (const [k, { it, day: vDay }] of doneItems.entries()) {
      const total = priceOf(it.procedureName);
      const mode = (i + k) % 7;
      const payNow = mode === 6 ? null : { amount: mode === 5 ? Math.round(total / 2 / 100) * 100 : total, method: pick(['cash', 'cash', 'cash', 'vodafone', 'instapay', 'card']) };
      const installments = mode === 4 && total >= 200000 ? [{ dueDate: addDays(vDay, 30), amount: total - Math.round(total / 3 / 100) * 100 }] : [];
      const { invoice, payment } = await createInvoice({
        patientId: p.id, itemIds: [it.id], date: vDay,
        payNow: installments.length ? { amount: Math.round(total / 3 / 100) * 100, method: 'cash' } : payNow, installments,
      });
      await patch('invoices', invoice.id, { createdAt: iso(vDay, 720) });
      if (payment) await patch('payments', payment.id, { at: iso(vDay, 725), createdAt: iso(vDay, 725) });
      if (installments.length && installments[0].dueDate < today && rand() < 0.5) {
        const pay = await recordPayment({ patientId: p.id, invoiceId: invoice.id, amount: installments[0].amount, method: 'cash', date: installments[0].dueDate });
        await patch('payments', pay.id, { at: iso(installments[0].dueDate, 700) });
      }
    }

    // Lab cases for crowns, prescriptions after extractions / root canals.
    for (const { it, day: vDay } of doneItems) {
      if (/كراون/.test(it.procedureName)) {
        const lc = await createLabCase({ patientId: p.id, patientName: p.name, treatmentItemId: it.id, labName: 'معمل النور', workType: 'crown', teeth: it.teeth, shade: 'A2', material: 'زيركون', sentAt: addDays(vDay, -10), expectedAt: addDays(vDay, -3), cost: 120000 });
        await patch('labCases', lc.id, { status: 'cemented', receivedAt: addDays(vDay, -4), tryInAt: addDays(vDay, -2), cementedAt: vDay });
      }
      const tplId = /خلع/.test(it.procedureName) ? (medical.items.allergyPenicillin ? 'rx-penicillin-allergy' : 'rx-extraction') : /عصب/.test(it.procedureName) ? 'rx-rct' : null;
      const tpl = tplId ? await repos.rxTemplates.get(tplId) : null;
      if (tpl) {
        const rx = await createPrescription({ patientId: p.id, lines: tpl.lines, date: vDay, doctorName: doctor ? doctor.displayName : '', treatmentItemId: it.id });
        await patch('prescriptions', rx.id, { createdAt: iso(vDay, 700) });
      }
    }
  }

  // Today: make sure the day view has a few patients waiting.
  const demoToday = (await repos.appointments.list({ index: 'date', range: { eq: today } })).filter((a) => a.patientName && a.status === 'booked');
  if (!demoToday.length) {
    const ps = (await getAdapter().list('patients')).filter((x) => x.isDemo).slice(0, 3);
    for (const [k, p] of ps.entries()) {
      await repos.appointments.create({
        patientId: p.id, patientName: p.name, date: today, startMin: 660 + k * 45, duration: 30, doctorId: doctor?.id ?? null, chairId: chair,
        procedureIds: [], procedureNames: ['كشف'], treatmentItemIds: [], reason: '', notes: '', status: k === 0 ? 'arrived' : 'booked', statusHistory: [], clinicalNotes: '', reminderSentAt: null, cancelReason: '',
      });
    }
  }
  for (const item of await listItems({ includeInactive: true })) await recomputeItem(item.id);
  await logEvent({ action: 'demo_create', entity: 'demo', summary: `${PATIENTS.length} مريض تجريبي` });
  return PATIENTS.length;
}

/** Deletes every demo record and resets numbering to the last real record. */
export async function removeDemoData() {
  const a = getAdapter();
  const patients = (await a.list('patients')).filter((p) => p.isDemo);
  const pids = new Set(patients.map((p) => p.id));
  const byPatient = ['appointments', 'treatmentPlans', 'treatmentItems', 'toothEvents', 'invoices', 'payments', 'followUps', 'prescriptions', 'labCases', 'media', 'stockMovements'];
  const doomed = new Map([['patients', patients.map((p) => p.id)]]);
  const demoBatches = (await a.list('stockBatches')).filter((b) => b.isDemo).map((b) => b.id);
  const batchSet = new Set(demoBatches);
  doomed.set('stockBatches', demoBatches);
  const labIds = new Set();
  for (const s of byPatient) {
    const rows = (await a.list(s)).filter((r) => pids.has(r.patientId) || (s === 'stockMovements' && (r.isDemo || batchSet.has(r.batchId))));
    if (s === 'labCases') rows.forEach((r) => labIds.add(r.id));
    doomed.set(s, rows.map((r) => r.id));
  }
  doomed.set('expenses', (await a.list('expenses')).filter((e) => e.isDemo || labIds.has(e.refId) || batchSet.has(e.refId)).map((e) => e.id));
  const allIds = new Set([...doomed.values()].flat());
  doomed.set('auditLog', (await a.list('auditLog')).filter((e) => allIds.has(e.entityId)).map((e) => e.id));

  await a.transaction([...doomed.keys()], 'readwrite', async (t) => {
    for (const [store, ids] of doomed) for (const id of ids) await t.delete(store, id);
  });

  // Counters continue from the last real record.
  const max = (rows, read) => Math.max(0, ...rows.map(read));
  const counters = {
    patientFileNo: max(await a.list('patients'), (p) => Number(String(p.fileNo).replace(/\D/g, '')) || 0),
    invoiceNo: max(await a.list('invoices'), (r) => r.number),
    receiptNo: max(await a.list('payments'), (r) => r.receiptNo),
    rxNo: max(await a.list('prescriptions'), (r) => r.number),
  };
  for (const [k, v] of Object.entries(counters)) await repos.meta.set(`counter.${k}`, v);
  for (const item of await listItems({ includeInactive: true })) await recomputeItem(item.id);
  await logEvent({ action: 'demo_remove', entity: 'demo', summary: `${patients.length} مريض تجريبي` });
}
