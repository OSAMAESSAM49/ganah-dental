/**
 * Supabase connection over plain fetch (no SDK): sign-in for the clinic account, token
 * refresh, and the four calls the sync engine needs (push, pull, upload, download).
 *
 * The URL and publishable key are public by design; Row Level Security on the server only
 * lets a signed-in member of the clinic read or write its rows. The session (tokens) is kept
 * in localStorage on this device only — never in backups or in the synced data.
 */
export const SUPABASE_URL = 'https://edepsudqcrzjodjlkagc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_UqHOu4QLW3gdXk8De6KteQ_1bfvYHho';

const SESSION_KEY = 'ganah.cloud.session';

export class CloudError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'CloudError'; this.status = status; }
}

/** @typedef {{ access_token: string, refresh_token: string, expires_at: number, user: { id: string, email: string }, clinicId?: string, clinicName?: string }} CloudSession */

/** @returns {CloudSession|null} */
export function cloudSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return null; }
}
function saveSession(s) {
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
}

async function call(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
  const h = { apikey: SUPABASE_KEY, ...headers };
  if (auth) h.Authorization = `Bearer ${(await freshSession()).access_token}`;
  if (body !== undefined && !(body instanceof Blob)) h['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, { method, headers: h, body: body instanceof Blob ? body : body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new CloudError('لا يوجد اتصال بالإنترنت', 0);
  }
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.msg ?? j.message ?? j.error_description ?? j.error ?? ''; } catch { /* not json */ }
    if (res.status === 400 && /invalid login|invalid_grant|credentials/i.test(msg)) throw new CloudError('الإيميل أو كلمة السر غير صحيحة', 400);
    throw new CloudError(msg || `خطأ من الخادم (${res.status})`, res.status);
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const toSession = (j, keep = {}) => ({
  ...keep,
  access_token: j.access_token, refresh_token: j.refresh_token,
  expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
  user: { id: j.user?.id ?? keep.user?.id, email: j.user?.email ?? keep.user?.email },
});

/** Valid access token, refreshed when it expires within a minute. */
async function freshSession() {
  const s = cloudSession();
  if (!s) throw new CloudError('لم يتم ربط هذا الجهاز بحساب العيادة', 401);
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  try {
    const j = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: s.refresh_token } });
    const next = toSession(j, s);
    saveSession(next);
    return next;
  } catch (err) {
    if (err.status === 400 || err.status === 401) { saveSession(null); throw new CloudError('انتهت جلسة حساب العيادة. سجّل الدخول مرة أخرى من الإعدادات.', 401); }
    throw err;
  }
}

/**
 * Signs in with the clinic account and finds its clinic.
 * @returns {Promise<CloudSession>}
 */
export async function cloudSignIn(email, password) {
  const j = await call('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: String(email).trim(), password } });
  saveSession(toSession(j));
  const rows = await call(`/rest/v1/clinic_members?select=clinic_id,clinics(name)&user_id=eq.${j.user.id}`);
  if (!rows?.length) {
    saveSession(null);
    throw new CloudError('هذا الحساب غير مرتبط بعيادة على السحابة. اربطه أولًا من Supabase.', 403);
  }
  const s = { ...cloudSession(), clinicId: rows[0].clinic_id, clinicName: rows[0].clinics?.name ?? '' };
  saveSession(s);
  return s;
}

export async function cloudSignOut() {
  try { await call('/auth/v1/logout', { method: 'POST' }); } catch { /* offline or expired: forget locally anyway */ }
  saveSession(null);
}

const clinic = () => {
  const id = cloudSession()?.clinicId;
  if (!id) throw new CloudError('لم يتم ربط هذا الجهاز بحساب العيادة', 401);
  return id;
};
const objectPath = (path) => path.split('/').map(encodeURIComponent).join('/');

/** The API the sync engine uses (an in-memory fake implements the same in tests). */
export const supabaseApi = {
  clinicId: clinic,
  /** @param {object[]} rows { store, id, data, deleted, client_updated_at, device_id } */
  push: (rows) => call('/rest/v1/rpc/push_records', { method: 'POST', body: { p_clinic: clinic(), p_rows: rows } }),
  /** Rows changed at or after `since` (server time), oldest first. */
  pull: (since, limit) => call(`/rest/v1/records?select=store,id,data,deleted,client_updated_at,device_id,server_updated_at&clinic_id=eq.${clinic()}&server_updated_at=gte.${encodeURIComponent(since)}&order=server_updated_at.asc&limit=${limit}`),
  /** True when the clinic has no synced records yet. */
  isEmpty: async () => !(await call(`/rest/v1/records?select=id&clinic_id=eq.${clinic()}&limit=1`))?.length,
  upload: (path, blob) => call(`/storage/v1/object/media/${objectPath(path)}`, { method: 'POST', body: blob, headers: { 'x-upsert': 'true', 'Content-Type': blob.type || 'application/octet-stream' } }),
  download: async (path) => (await call(`/storage/v1/object/authenticated/media/${objectPath(path)}`, { raw: true })).blob(),
  /** Database and image storage used (supabase/schema.sql → cloud_usage). */
  usage: () => call('/rest/v1/rpc/cloud_usage', { method: 'POST', body: { p_clinic: clinic() } }),
};
