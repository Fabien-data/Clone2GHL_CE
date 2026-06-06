/**
 * backend/src/lib/entitlement.js
 *
 * Single source of truth for "what is this user entitled to right now?". The
 * trial is the hard part: the `usage` table is keyed by calendar month
 * (period=YYYY-MM) and MUST keep resetting monthly for paid plans, but the free
 * trial is a one-time, NON-repeating 30-day / 6-clone window. So the trial uses a
 * cumulative `trialClonesUsed` counter on the user record instead of the monthly
 * usage row. `computeEntitlement()` is the one place that decides which counter
 * and limit apply, so every route stays consistent.
 */

import { config, planLimits, effectivePlan } from '../config.js';

export const TRIAL_DAYS = Number(config.trialDays || 30);
const DAY_MS = 86400000;
const TRIAL_MS = TRIAL_DAYS * DAY_MS;

// True when the user is on the free tier and the trial fields haven't been
// initialized yet. Callers guard their writeDb on this to avoid writing on every
// GET (the write queue serializes — a no-op write per request would add contention).
export function needsTrialInit(user) {
  if (!user) return false;
  if (effectivePlan(user) !== 'free') return false;
  return !user.trialStartedAt || typeof user.trialClonesUsed !== 'number';
}

// Lazily start/repair a free user's trial window. MUTATES the draft user.
// Idempotent: never restarts an existing window or resets the clone counter.
// This is the grandfather path for free users who predate the trial system.
export function ensureTrialInitialized(user, now = Date.now()) {
  if (!user || effectivePlan(user) !== 'free') return false;
  let changed = false;
  if (!user.trialStartedAt) {
    user.trialStartedAt = new Date(now).toISOString();
    user.trialEndsAt = new Date(now + TRIAL_MS).toISOString();
    changed = true;
  } else if (!user.trialEndsAt) {
    // Repair a window that has a start but somehow no end.
    user.trialEndsAt = new Date(Date.parse(user.trialStartedAt) + TRIAL_MS).toISOString();
    changed = true;
  }
  if (typeof user.trialClonesUsed !== 'number') {
    user.trialClonesUsed = 0;
    changed = true;
  }
  return changed;
}

// Pure entitlement computation — never mutates. `now` is injectable for tests.
// Returns the resolved plan, a state, the clone counter that gates the free tier,
// and whether the client must be pushed to upgrade (and why).
//   state: 'paid' | 'trial' | 'trial_expired' | 'plan_expired'
export function computeEntitlement(user, now = Date.now()) {
  const plan = effectivePlan(user); // handles owner / suspended / lapsed-GHL → free

  // Paid (and owner) plans are gated by the monthly `usage` table in the route
  // that has the usage row; here we only declare state + the plan limit.
  if (plan !== 'free') {
    const limit = planLimits[plan] ?? 0;
    return {
      plan,
      state: 'paid',
      isTrial: false,
      trialStartedAt: null,
      trialEndsAt: null,
      daysLeft: null,
      clonesLimit: limit,
      clonesUsed: null,                       // caller fills from monthly usage row
      clonesRemaining: limit < 0 ? -1 : null, // caller fills (unless unlimited)
      upgradeRequired: false,
      reason: null,
    };
  }

  // effectivePlan() returned 'free'. Distinguish a genuine free/trial user from a
  // PAID subscription that lapsed (raw user.plan was paid) — the latter should be
  // prompted to renew, not handed a fresh trial.
  const lapsedPaid = Boolean(user && user.plan && user.plan !== 'free' && user.status !== 'suspended');

  const limit = planLimits.free; // 6
  const used = Number(user?.trialClonesUsed || 0);
  const endsAt = user?.trialEndsAt ? Date.parse(user.trialEndsAt) : (now + TRIAL_MS);
  const expired = Number.isFinite(endsAt) && now > endsAt;
  const daysLeft = Math.max(0, Math.ceil((endsAt - now) / DAY_MS));
  let remaining = Math.max(0, limit - used);

  let state, reason, upgradeRequired, isTrial;
  if (lapsedPaid) {
    state = 'plan_expired';
    reason = 'plan_expired';
    upgradeRequired = true;
    isTrial = false;
    remaining = 0;
  } else if (expired) {
    state = 'trial_expired';
    reason = 'trial_expired';
    upgradeRequired = true;
    isTrial = true; // still "trial context" for UI messaging
    remaining = 0;
  } else if (remaining <= 0) {
    state = 'trial';
    reason = 'trial_clones_exhausted';
    upgradeRequired = true;
    isTrial = true;
  } else {
    state = 'trial';
    reason = null;
    upgradeRequired = false;
    isTrial = true;
  }

  return {
    plan: 'free',
    state,
    isTrial,
    trialStartedAt: user?.trialStartedAt || null,
    trialEndsAt: user?.trialEndsAt || null,
    daysLeft: lapsedPaid ? 0 : daysLeft,
    clonesLimit: limit,
    clonesUsed: used,
    clonesRemaining: remaining,
    upgradeRequired,
    reason,
  };
}

// Append an affiliate ref code to a URL, preserving any existing query string.
export function appendRef(url, ref) {
  if (!url) return '';
  if (!ref) return url;
  return url + (url.includes('?') ? '&' : '?') + 'ref=' + encodeURIComponent(String(ref));
}

// Build the `upgrade` object attached to 402/403 responses and GET /api/usage.
// `checkoutUrl` deep-links to the GHL order page; a captured ?ref= is appended so
// GHL's Affiliate Manager attributes the sale.
export function buildUpgrade(reason, { ref } = {}) {
  const base = config.ghlCheckoutUrl || '';
  const checkoutUrl = base ? appendRef(base, ref) : null;
  const plans = config.ghlCheckoutUrls && Object.keys(config.ghlCheckoutUrls).length
    ? config.ghlCheckoutUrls
    : null;
  return { upgradeRequired: true, reason: reason || null, checkoutUrl, plans };
}
