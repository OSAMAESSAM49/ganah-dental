/**
 * Password hashing with Web Crypto: PBKDF2-SHA-256, random 16-byte salt per secret.
 * The iteration count is stored with each hash so it can be raised later without
 * breaking existing accounts (verifySecret uses the stored count).
 *
 * NOTE: this protects the stored passwords themselves. It does not make client-side
 * login a security boundary — see README.
 */

export const PBKDF2_ITERATIONS = 310_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

const enc = new TextEncoder();

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** @param {string} b64 */
export function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function derive(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

/**
 * @typedef {{ hash: string, salt: string, iterations: number, algo: 'PBKDF2-SHA256' }} SecretHash
 */

/**
 * Hashes a password/PIN.
 * @param {string} secret
 * @param {{ iterations?: number }} [opts]
 * @returns {Promise<SecretHash>}
 */
export async function hashSecret(secret, { iterations = PBKDF2_ITERATIONS } = {}) {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(secret, salt, iterations);
  return { hash: toBase64(hash), salt: toBase64(salt), iterations, algo: 'PBKDF2-SHA256' };
}

/**
 * Checks a secret against a stored hash in constant time.
 * @param {string} secret @param {SecretHash | null | undefined} stored
 */
export async function verifySecret(secret, stored) {
  if (!stored?.hash || !stored?.salt) return false;
  const actual = await derive(String(secret ?? ''), fromBase64(stored.salt), stored.iterations);
  const expected = fromBase64(stored.hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** Unambiguous alphabet (no 0/O, 1/I/L) for codes people copy by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Recovery code like "K7QM-2XPA-9RTD-HW4E". */
export function generateRecoveryCode(groups = 4, size = 4) {
  const bytes = randomBytes(groups * size);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return Array.from({ length: groups }, (_, g) => chars.slice(g * size, (g + 1) * size).join('')).join('-');
}

/** Normalizes a typed recovery code: upper-case, no spaces, dashes re-inserted. */
export function normalizeRecoveryCode(input) {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.match(/.{1,4}/g)?.join('-') ?? '';
}
