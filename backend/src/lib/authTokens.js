/**
 * backend/src/lib/authTokens.js
 *
 * Access + refresh token plumbing. Access tokens are short-lived JWTs; refresh
 * tokens are opaque high-entropy strings stored only as a SHA-256 hash in the
 * `refreshTokens` collection. Shared by register / login / GHL activation /
 * refresh so token issuance is consistent in one place.
 */

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { generateToken, hashToken } from './tokens.js';

const MAX_REFRESH_PER_USER = 5; // ~5 active devices/sessions

export function signAccessToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, plan: user.plan },
    config.jwtSecret,
    { expiresIn: config.accessTokenTtl },
  );
}

// Mutates `draft`: stores a new hashed refresh token, prunes expired ones, and
// caps the number of live tokens per user. Returns the plaintext token (shown
// to the client exactly once).
export function issueRefreshToken(draft, userId) {
  const token = generateToken();
  const now = Date.now();
  draft.refreshTokens.push({
    tokenHash: hashToken(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + config.refreshTokenTtlDays * 86400000).toISOString(),
  });

  // Drop expired tokens globally.
  draft.refreshTokens = draft.refreshTokens.filter(r => Date.parse(r.expiresAt) > now);

  // Cap per-user to the most recent N.
  const mine = draft.refreshTokens.filter(r => r.userId === userId);
  if (mine.length > MAX_REFRESH_PER_USER) {
    const toDrop = new Set(
      mine
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(0, mine.length - MAX_REFRESH_PER_USER)
        .map(r => r.tokenHash),
    );
    draft.refreshTokens = draft.refreshTokens.filter(r => !toDrop.has(r.tokenHash));
  }

  return token;
}

export function revokeRefreshToken(draft, token) {
  const h = hashToken(token);
  draft.refreshTokens = draft.refreshTokens.filter(r => r.tokenHash !== h);
}

export function revokeAllForUser(draft, userId) {
  draft.refreshTokens = draft.refreshTokens.filter(r => r.userId !== userId);
}
