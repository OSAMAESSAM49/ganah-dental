/**
 * Supabase free-plan usage for the system-status card and the sync settings: database size
 * out of 500 MB, images out of 1 GB, and roughly how many more patients fit.
 * The last reading is kept on the device so it still shows offline.
 */
import { html, ico } from '../core/dom.js';
import { formatBytes, formatDateTime, digits, formatPercent, formatNumber } from '../core/format.js';
import { supabaseApi } from '../services/cloud.js';

export const FREE_DB_BYTES = 500 * 1024 * 1024;
export const FREE_STORAGE_BYTES = 1024 * 1024 * 1024;
/** A patient with a full history (visits, plans, invoices, stock use, audit…) ≈ 80 KB on disk. */
const DEFAULT_BYTES_PER_PATIENT = 80 * 1024;
const CACHE_KEY = 'ganah.cloud.usage';

/**
 * Turns the server's numbers into what the screen shows. Pure; exported for tests.
 * Once the clinic has 100+ patients, the estimate uses its own average (rows → disk ≈ ×1.4).
 */
export function summarizeUsage(raw, at = new Date().toISOString()) {
  const own = raw.patients >= 100 ? Math.round((raw.records_bytes * 1.4) / raw.patients) : 0;
  const perPatient = Math.max(DEFAULT_BYTES_PER_PATIENT, own);
  const free = Math.max(0, FREE_DB_BYTES - raw.db_bytes);
  return {
    at,
    dbBytes: raw.db_bytes,
    dbPct: raw.db_bytes / FREE_DB_BYTES,
    storageBytes: raw.storage_bytes,
    storagePct: raw.storage_bytes / FREE_STORAGE_BYTES,
    patients: raw.patients,
    records: raw.records,
    perPatient,
    morePatients: Math.floor(free / perPatient),
  };
}

export function cachedUsage() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null'); } catch { return null; }
}

/** Fresh reading from Supabase (falls back to the last one when offline). */
export async function loadUsage() {
  try {
    const u = summarizeUsage(await supabaseApi.usage());
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(u)); } catch { /* storage blocked */ }
    return { usage: u, stale: false };
  } catch {
    return { usage: cachedUsage(), stale: true };
  }
}

const tone = (pct) => (pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warning' : 'success');
const round100 = (n) => (n >= 1000 ? Math.floor(n / 100) * 100 : n);

/** List item for the dashboard's system-status card. */
export function usageItem({ usage, stale }) {
  if (!usage) {
    return html`<li class="list__item cloud-usage" data-cloud-usage>${ico('cloud-off', { size: 20 })}<div class="list__main"><span class="list__title">مساحة السحابة</span>
      <span class="list__meta muted">${stale ? 'تعذّر الاتصال بالسحابة الآن' : 'جارٍ التحميل…'}</span></div></li>`;
  }
  return html`<li class="list__item cloud-usage" data-cloud-usage>${ico('cloud', { size: 20 })}
    <div class="list__main">
      <span class="list__title">مساحة السحابة</span>
      <span class="list__meta muted">${formatBytes(usage.dbBytes)} من 500 م.ب (خطة Supabase المجانية) · تكفي تقريبًا لـ <strong>${digits(formatNumber(round100(usage.morePatients), { decimals: 0 }))}</strong> مريض إضافي</span>
      <span class="progress progress--${tone(usage.dbPct)}" role="progressbar" aria-valuenow="${Math.round(usage.dbPct * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="المستخدم من مساحة قاعدة البيانات"><span class="progress__bar" style="inline-size: ${Math.max(1, Math.min(100, usage.dbPct * 100))}%"></span></span>
      <span class="list__meta muted text-sm">${digits(usage.patients)} مريض على السحابة · الصور ${formatBytes(usage.storageBytes)} من 1 ج.ب${stale ? ` · آخر قراءة ${formatDateTime(usage.at)}` : ''}</span>
    </div>
    <span class="badge badge--${tone(usage.dbPct)}">${formatPercent(usage.dbPct * 100, { decimals: usage.dbPct < 0.1 ? 1 : 0 })}</span>
  </li>`;
}
