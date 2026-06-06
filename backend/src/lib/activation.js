/**
 * backend/src/lib/activation.js
 *
 * One-time activation codes used by the GHL payment bridge (and admin manual
 * onboarding). Codes are short, human-retypable, and stored only as a bcrypt
 * hash with an expiry.
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export const ACTIVATION_CODE_TTL_DAYS = 30;

// Unambiguous alphabet — no 0/O, 1/I/L — easy to read & retype from an email.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateActivationCode() {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out; // e.g. "AB3K-9TQX"
}

export function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashCode(code) {
  return bcrypt.hash(normalizeCode(code), 10);
}

export function compareCode(code, hash) {
  return bcrypt.compare(normalizeCode(code), hash);
}

export function codeExpiryISO(now = Date.now()) {
  return new Date(now + ACTIVATION_CODE_TTL_DAYS * 86400000).toISOString();
}

// Sets a fresh activation code on a user record (mutates draft user) and returns
// the plaintext code so the caller can deliver it (e.g. via the GHL email step).
export async function issueActivationCode(user, now = Date.now()) {
  const code = generateActivationCode();
  user.activationCodeHash = await hashCode(code);
  user.activationCodeExpiresAt = codeExpiryISO(now);
  return code;
}
