/**
 * backend/src/middleware/rateLimit.js
 *
 * Lightweight in-memory rate limiter (no external dependency). Sufficient for a
 * single-instance deployment — if we later scale horizontally, swap the Map for
 * a shared store (Redis) behind the same interface.
 *
 * Usage: app.post('/login', rateLimit({ windowMs: 15*60_000, max: 10 }), handler)
 */

// One bucket store shared across limiter instances, keyed by `${name}:${ip}`.
const buckets = new Map();

// Opportunistic sweep of expired buckets so the Map doesn't grow unbounded.
let lastSweep = 0;
function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ windowMs = 60_000, max = 60, name = 'default' } = {}) {
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    sweep(now);

    const key = `${name}:${clientIp(req)}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;

    const remaining = Math.max(0, max - b.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));

    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.', retryAfter });
    }
    return next();
  };
}

// Convenience presets used across routes.
export const authLimiter    = rateLimit({ name: 'auth',    windowMs: 15 * 60_000, max: 20 });
export const webhookLimiter  = rateLimit({ name: 'webhook', windowMs: 60_000,      max: 120 });
export const aiLimiter       = rateLimit({ name: 'ai',      windowMs: 60_000,      max: 30 });
