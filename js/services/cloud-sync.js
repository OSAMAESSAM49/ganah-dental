/**
 * Runs sync in the app: connects this device to the clinic account, schedules sync rounds
 * (on start, every minute, a few seconds after local changes, when the connection returns),
 * and publishes a status for the UI ('sync:status' on the bus).
 *
 *   Main device: connectMainDevice() — uploads everything on this device (cloud must be empty).
 *   Extra device: joinCloud() — replaces this device's data with the cloud copy.
 */
import { getAdapter, repos } from '../data/index.js';
import { loadSettings } from '../data/settings.js';
import { LOCAL_ONLY, onLocalWrite } from '../data/tracking.js';
import { emit } from '../core/bus.js';
import { cloudSession, cloudSignIn, cloudSignOut, supabaseApi, CloudError } from './cloud.js';
import { createSyncEngine, localState } from './sync.js';
import { logEvent } from './audit.js';

const ENABLED_KEY = 'ganah.sync.enabled';
const ROUND_MS = 60_000;
const AFTER_WRITE_MS = 4_000;

/** @type {ReturnType<typeof createSyncEngine> | null} */
let engine = null;
let timer = 0, writeTimer = 0, started = false;
/** @type {{ state: 'off'|'syncing'|'ok'|'offline'|'error'|'auth', pending: number, lastSyncAt: string|null, error: string, clinicName: string, email: string }} */
let status = { state: 'off', pending: 0, lastSyncAt: null, error: '', clinicName: '', email: '' };

const isEnabled = () => { try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; } };
const setEnabled = (on) => { try { if (on) localStorage.setItem(ENABLED_KEY, '1'); else localStorage.removeItem(ENABLED_KEY); } catch { /* blocked */ } };

export const syncStatus = () => status;
function publish(patch) {
  const s = cloudSession();
  status = { ...status, ...patch, pending: engine?.pending() ?? 0, lastSyncAt: engine?.lastSyncAt() ?? null, clinicName: s?.clinicName ?? '', email: s?.user?.email ?? '' };
  emit('sync:status', status);
}

/** Refreshes the UI after a pull changed local data. */
async function afterPull(stores) {
  if (stores.has('settings')) {
    const all = await loadSettings();
    for (const key of ['clinic', 'app', 'schedule', 'messages']) emit('settings:changed', { key, value: all[key] });
  }
  for (const store of stores) emit('data:changed', { store, action: 'sync', id: null });
}

function ensureEngine() {
  engine ??= createSyncEngine({ adapter: getAdapter(), api: supabaseApi, state: localState(), onChange: (st) => { afterPull(st).catch((e) => console.error(e)); } });
  return engine;
}

/** One sync round now (never throws; the outcome is in the status). */
export async function syncNow() {
  if (!engine || !isEnabled()) return status;
  if (!cloudSession()) { publish({ state: 'auth', error: 'سجّل الدخول بحساب العيادة من الإعدادات ← المزامنة' }); return status; }
  if (navigator.onLine === false) { publish({ state: 'offline', error: '' }); return status; }
  publish({ state: 'syncing', error: '' });
  try {
    await engine.syncNow();
    publish({ state: 'ok', error: '' });
  } catch (err) {
    console.warn('[sync]', err);
    if (err instanceof CloudError && err.status === 401) publish({ state: 'auth', error: err.message });
    else if (err instanceof CloudError && err.status === 0) publish({ state: 'offline', error: '' });
    else publish({ state: 'error', error: err.message || 'تعذّرت المزامنة' });
  }
  return status;
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(syncNow, ROUND_MS);
}

/** Called once at boot, right after the database opens. */
export function startCloudSync() {
  if (!isEnabled()) { publish({ state: 'off' }); return; }
  const e = ensureEngine();
  if (!started) {
    started = true;
    // Sync a few seconds after local changes (the engine records them itself).
    onLocalWrite(() => {
      publish({});
      clearTimeout(writeTimer);
      writeTimer = setTimeout(syncNow, AFTER_WRITE_MS);
    });
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => publish({ state: 'offline' }));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  }
  schedule();
  publish({ state: e.pending() ? 'syncing' : 'ok' });
  setTimeout(syncNow, 1500);
}

/** Wipes every synced store on this device (local-only meta stays). */
async function wipeLocal() {
  const raw = getAdapter().raw;
  const stores = getAdapter().storeNames().filter((s) => !LOCAL_ONLY.has(s));
  await raw.transaction(stores, 'readwrite', async (t) => { for (const s of stores) await t.clear(s); });
  for (const k of ['patientFileNo', 'invoiceNo', 'receiptNo', 'rxNo']) await getAdapter().raw.put('meta', { key: `counter.${k}`, value: 0, updatedAt: new Date().toISOString() });
}

/**
 * First device: sign in and upload all data. When the cloud already has data the caller
 * must choose joinCloud() instead (returns { cloudHasData: true } without changing anything).
 */
export async function connectMainDevice(email, password) {
  await cloudSignIn(email, password);
  if (!(await supabaseApi.isEmpty())) return { cloudHasData: true };
  setEnabled(true);
  const e = ensureEngine();
  e.reset();
  e.queueAll();
  startCloudSync();
  await logEvent({ action: 'sync_connect', entity: 'sync', summary: `ربط الجهاز الأساسي بـ ${cloudSession()?.user?.email ?? ''}` });
  const s = await syncNow();
  return { cloudHasData: false, status: s };
}

/**
 * Extra device (or replacing this device's data): sign in, wipe local data, download the
 * clinic's data. Afterwards the app must reload.
 * @param {{ signedIn?: boolean }} [o] skip sign-in when connectMainDevice already did it
 */
export async function joinCloud(email, password, { signedIn = false } = {}) {
  if (!signedIn) await cloudSignIn(email, password);
  if (await supabaseApi.isEmpty()) throw new CloudError('لا توجد بيانات على السحابة بعد. اربط الجهاز الأساسي أولًا.', 404);
  setEnabled(true);
  await wipeLocal();
  const e = ensureEngine();
  e.reset();
  publish({ state: 'syncing' });
  await e.syncNow();
  await repos.meta.set('setupDone', true);
  await logEvent({ action: 'sync_join', entity: 'sync', summary: `ربط جهاز إضافي بـ ${cloudSession()?.user?.email ?? ''}` });
  return syncNow();
}

/** Stops syncing on this device (data stays on the device and in the cloud). */
export async function disconnectCloud() {
  if (engine) { try { await syncNow(); } catch { /* best effort */ } engine.stop(); engine.reset(); engine = null; }
  clearInterval(timer);
  setEnabled(false);
  await cloudSignOut();
  publish({ state: 'off', error: '' });
}

/** Signs in again after the session expired (keeps the queue and position). */
export async function reconnectCloud(email, password) {
  await cloudSignIn(email, password);
  return syncNow();
}

export const cloudEnabled = isEnabled;
