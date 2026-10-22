/**
 * Offline-first sync between this device's IndexedDB and the clinic's cloud copy.
 *
 *   push: every locally changed record (tracked by data/tracking.js) is sent with its _rev;
 *         the server keeps the newest. Deleted records are sent as tombstones. Images and
 *         other Blobs are uploaded to Storage and replaced by { __file, __blob } references.
 *   pull: rows changed on the server since the last pull (re-reading the last minute, since a
 *         slow upload may commit late) are applied when newer than the local copy.
 *
 * Numbering clashes (two devices created file G-00042 offline) are resolved the same way on
 * every device: the record created first keeps the number, the other gets the next free one
 * and is pushed again. The engine is created with explicit dependencies so tests can run two
 * "devices" against an in-memory server.
 */
import { onLocalWrite, keyPathOf, LOCAL_ONLY, newRev } from '../data/tracking.js';
import { buildSearchText } from './patients.js';

const PAGE = 500;
const PUSH_BATCH = 200;
const OVERLAP_MS = 60_000;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** Unique numbers that may clash between devices: field, index, counter, how to make the next one. */
const NUMBERED = {
  patients: { field: 'fileNo', index: 'fileNo', counter: 'patientFileNo', read: (v) => Number(String(v).replace(/\D/g, '')) || 0, make: (n) => `G-${String(n).padStart(5, '0')}` },
  invoices: { field: 'number', index: 'number', counter: 'invoiceNo', read: Number, make: (n) => n },
  payments: { field: 'receiptNo', index: 'receiptNo', counter: 'receiptNo', read: Number, make: (n) => n },
  prescriptions: { field: 'number', index: null, counter: 'rxNo', read: Number, make: (n) => n },
};

/** Version stamp used to compare copies of a record. Exported for tests. */
export const revOf = (r) => (r ? r._rev ?? r.updatedAt ?? r.createdAt ?? r.at ?? '' : '');

/** Does the incoming row win over the local copy? Pure; exported for tests. */
export function incomingWins(local, row) {
  if (!local) return !row.deleted;
  return revOf(local) < (row.client_updated_at ?? '');
}

/** Which of two records keeps a clashing number: the one created first (then the smaller id). */
export const keepsNumber = (a, b) => ((a.createdAt ?? '') < (b.createdAt ?? '') || ((a.createdAt ?? '') === (b.createdAt ?? '') && String(a.id) < String(b.id)));

/** localStorage-backed state for the default engine. */
export function localState(key = 'ganah.sync') {
  return {
    load() { try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; } },
    save(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
}

/**
 * @param {{ adapter: any, api: any, state: { load(): any, save(v: any): void }, deviceId?: string,
 *           onChange?: (stores: Set<string>) => void }} deps
 *   adapter: the tracked adapter (with .raw); onChange: stores updated by a pull (UI refresh)
 */
export function createSyncEngine({ adapter, api, state, deviceId, onChange = () => {} }) {
  const raw = adapter.raw ?? adapter;
  // outbox: key → change number · tombs: key → when it was deleted here (until uploaded)
  const s = { outbox: {}, tombs: {}, seq: 0, fullStores: [], cursor: null, ...state.load() };
  s.deviceId ||= deviceId || crypto.randomUUID();
  const save = () => state.save({ outbox: s.outbox, tombs: s.tombs, seq: s.seq, fullStores: s.fullStores, cursor: s.cursor, deviceId: s.deviceId, lastSyncAt: s.lastSyncAt });
  save();

  const syncedStores = () => adapter.storeNames().filter((n) => !LOCAL_ONLY.has(n));
  const keyOf = (store, id) => `${store}\u0001${id}`;
  const markDirty = (store, id) => { s.outbox[keyOf(store, id)] = ++s.seq; };

  const stopTracking = onLocalWrite((events, source) => {
    if (source !== adapter) return;
    for (const e of events) {
      if (e.cleared) { if (!s.fullStores.includes(e.store)) s.fullStores.push(e.store); }
      else {
        markDirty(e.store, e.id);
        if (e.deleted) s.tombs[keyOf(e.store, e.id)] = newRev(); else delete s.tombs[keyOf(e.store, e.id)];
      }
    }
    save();
  });

  /* ---------- Blobs ---------- */

  async function encode(v, store, id, counter) {
    if (v instanceof Blob) {
      const mime = v.type || 'application/octet-stream';
      const path = `${api.clinicId()}/${store}/${id}/${counter.n++}.${EXT[mime] ?? 'bin'}`;
      await api.upload(path, v);
      return { __file: path, __blob: mime };
    }
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await encode(x, store, id, counter)); return out; }
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = await encode(x, store, id, counter);
      return out;
    }
    return v;
  }

  async function decode(v) {
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await decode(x)); return out; }
    if (v && typeof v === 'object') {
      if (typeof v.__file === 'string' && typeof v.__blob === 'string') {
        const b = await api.download(v.__file);
        return b.type === v.__blob ? b : new Blob([b], { type: v.__blob });
      }
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = await decode(x);
      return out;
    }
    return v;
  }

  /* ---------- Push ---------- */

  async function push() {
    for (const store of s.fullStores.splice(0)) {
      if (!adapter.storeNames().includes(store) || LOCAL_ONLY.has(store)) continue;
      for (const r of await raw.list(store)) markDirty(store, r[keyPathOf(store)]);
    }
    save();
    const entries = Object.entries(s.outbox);
    let pushed = 0;
    for (let i = 0; i < entries.length; i += PUSH_BATCH) {
      const batch = entries.slice(i, i + PUSH_BATCH);
      const rows = [];
      for (const [key] of batch) {
        const [store, id] = key.split('\u0001');
        if (!adapter.storeNames().includes(store)) continue;
        const rec = await raw.get(store, id);
        if (!rec) { rows.push({ store, id, data: null, deleted: true, client_updated_at: s.tombs[key] ?? newRev(), device_id: s.deviceId }); continue; }
        rows.push({ store, id, data: await encode(rec, store, id, { n: 0 }), deleted: false, client_updated_at: revOf(rec), device_id: s.deviceId });
      }
      if (rows.length) await api.push(rows);
      for (const [key, seq] of batch) if (s.outbox[key] === seq) { delete s.outbox[key]; delete s.tombs[key]; }
      pushed += rows.length;
      save();
    }
    return pushed;
  }

  /* ---------- Pull ---------- */

  /** Applies one page of server rows in a single transaction. */
  async function applyPage(rows) {
    const known = new Set(adapter.storeNames());
    const usable = rows.filter((r) => known.has(r.store) && !LOCAL_ONLY.has(r.store));
    if (!usable.length) return new Set();
    // Downloads cannot happen inside an IndexedDB transaction: decode first.
    const decoded = [];
    for (const r of usable) decoded.push({ ...r, data: r.deleted ? null : await decode(r.data) });
    const stores = [...new Set(decoded.map((r) => r.store))];
    const touched = new Set();
    const redo = [];
    await raw.transaction([...stores, 'meta'], 'readwrite', async (t) => {
      const counters = {};
      const counter = async (name) => (counters[name] ??= (await t.get('meta', `counter.${name}`))?.value ?? 0);
      const setCounter = (name, v) => { if (v > (counters[name] ?? 0)) counters[name] = v; };
      for (const row of decoded) {
        const key = keyPathOf(row.store);
        const local = await t.get(row.store, row.id);
        // Deleted here but not uploaded yet: only a newer edit from another device brings it back.
        const tomb = !local && s.tombs[keyOf(row.store, row.id)];
        if (tomb && (row.deleted || (row.client_updated_at ?? '') <= tomb)) continue;
        if (!incomingWins(local, row)) continue;
        if (row.deleted) { await t.delete(row.store, row.id); touched.add(row.store); continue; }
        const rec = { ...row.data, _rev: row.client_updated_at };
        const num = NUMBERED[row.store];
        if (num) {
          await counter(num.counter);
          setCounter(num.counter, num.read(rec[num.field]));
          if (num.index) {
            const clash = (await t.list(row.store, { index: num.index, range: { eq: rec[num.field] } })).find((x) => x[key] !== row.id);
            if (clash) {
              const loser = keepsNumber(clash, rec) ? rec : clash;
              const next = (counters[num.counter] ?? 0) + 1;
              counters[num.counter] = next;
              loser[num.field] = num.make(next);
              loser._rev = newRev();
              if (row.store === 'patients') loser.searchText = buildSearchText(loser);
              if (loser === clash) await t.put(row.store, clash);
              redo.push({ store: row.store, id: loser[key] });
            }
          }
        }
        if (row.store === 'users') {
          const clash = (await t.list('users', { index: 'username', range: { eq: rec.username } })).find((x) => x.id !== row.id);
          if (clash) {
            const loser = keepsNumber(clash, rec) ? rec : clash;
            loser.username = `${loser.username}.${String(loser.id).slice(0, 4)}`;
            loser._rev = newRev();
            if (loser === clash) await t.put('users', clash);
            redo.push({ store: 'users', id: loser.id });
          }
        }
        await t.put(row.store, rec);
        touched.add(row.store);
      }
      for (const [name, value] of Object.entries(counters)) {
        const cur = (await t.get('meta', `counter.${name}`))?.value ?? 0;
        if (value > cur) await t.put('meta', { key: `counter.${name}`, value, updatedAt: new Date().toISOString() });
      }
    });
    // Renumbered records must reach the other devices.
    for (const r of redo) markDirty(r.store, r.id);
    save();
    return touched;
  }

  async function pull() {
    let since = s.cursor ? new Date(Date.parse(s.cursor) - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
    let newest = s.cursor;
    const touched = new Set();
    for (;;) {
      const rows = (await api.pull(since, PAGE)) ?? [];
      for (const st of await applyPage(rows)) touched.add(st);
      if (rows.length) newest = !newest || rows.at(-1).server_updated_at > newest ? rows.at(-1).server_updated_at : newest;
      if (rows.length < PAGE) break;
      if (rows.at(-1).server_updated_at === since) break; // a page of identical stamps: avoid looping forever
      since = rows.at(-1).server_updated_at;
    }
    s.cursor = newest;
    save();
    if (touched.size) onChange(touched);
    return touched;
  }

  let running = null;
  return {
    get deviceId() { return s.deviceId; },
    pending: () => Object.keys(s.outbox).length + s.fullStores.length,
    lastSyncAt: () => s.lastSyncAt ?? null,
    /** Queue every local record for upload (first connection of the main device). */
    queueAll() { s.fullStores = syncedStores(); save(); },
    /** Forget the pull position so the next pull reads everything again. */
    resetCursor() { s.cursor = null; save(); },
    /** One full round: pull, then push. Concurrent calls share the same run. */
    syncNow() {
      running ??= (async () => {
        try {
          // Push first so the server already holds this device's changes (and deletions).
          const pushed = await push();
          const touched = await pull();
          s.lastSyncAt = new Date().toISOString();
          save();
          return { pulled: touched, pushed };
        } finally { running = null; }
      })();
      return running;
    },
    stop() { stopTracking(); },
    /** Forget everything about sync on this device (after signing out of the cloud). */
    reset() { s.outbox = {}; s.tombs = {}; s.seq = 0; s.fullStores = []; s.cursor = null; s.lastSyncAt = null; save(); },
  };
}
