/**
 * backend/src/lib/tokens.js
 *
 * High-entropy opaque tokens (password reset, refresh tokens). Unlike the short
 * human activation codes in lib/activation.js, these are 256-bit URL-safe random
 * strings stored only as a SHA-256 hash and compared in constant time.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function generateToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

// Constant-time comparison of a presented token against a stored hash.
export function compareToken(token, storedHash) {
  if (!token || !storedHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(String(storedHash), 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Constant-time comparison of two plain secrets (e.g. webhook shared secret).
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
