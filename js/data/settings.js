/**
 * Clinic-wide settings with defaults and an in-memory cache.
 * Stored under the 'settings' key-value store: key 'clinic' (info) and 'app' (preferences).
 */
import { repos } from './index.js';
import { emit } from '../core/bus.js';

export const DEFAULT_CLINIC = {
  name: 'عيادة جنة لطب الفم والأسنان',
  shortName: 'عيادة جنة',
  tagline: 'لطب الفم والأسنان',
  phone: '01008137502',
  address: 'البجلات - شارع الماسورة',
  logoMediaId: null,
};

export const DEFAULT_APP = {
  digitStyle: 'western',        // 'western' 0-9 | 'arabic' ٠-٩
  idleLogoutMinutes: 15,
  backupReminderDays: 7,
};

const cache = { clinic: { ...DEFAULT_CLINIC }, app: { ...DEFAULT_APP } };

/** Loads settings into the cache. Call once after initData(). */
export async function loadSettings() {
  cache.clinic = { ...DEFAULT_CLINIC, ...(await repos.settings.get('clinic', {})) };
  cache.app = { ...DEFAULT_APP, ...(await repos.settings.get('app', {})) };
  cache.schedule = (await repos.settings.get('schedule', {})) ?? {};
  return cache;
}

/** Synchronous read from cache. @param {'clinic'|'app'|'schedule'} key */
export const getSettings = (key) => cache[key];

/** Persists a partial update and notifies listeners. @param {'clinic'|'app'} key */
export async function updateSettings(key, patch) {
  cache[key] = { ...cache[key], ...patch };
  await repos.settings.set(key, cache[key]);
  emit('settings:changed', { key, value: cache[key] });
  return cache[key];
}
