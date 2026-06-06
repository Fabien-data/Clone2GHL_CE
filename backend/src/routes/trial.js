/**
 * backend/src/routes/trial.js
 *
 * Starts the one-time free trial, gated on a VALIDATED GoHighLevel connection.
 * The extension validates the GHL credentials locally (GHLApi.validateCredentials)
 * and then calls this endpoint; the backend RE-VALIDATES server-side (never trusts
 * a client-asserted boolean) and binds the trial to the GHL location so the same
 * location can't farm multiple trials by re-registering.
 *
 * POST /api/trial/start   ← extension   { apiKey, locationId } → starts/refreshes trial
 */

import express from 'express';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../lib/validate.js';
import { hashToken } from '../lib/tokens.js';
import { writeDb } from '../store.js';
import { ensureTrialInitialized, computeEntitlement, TRIAL_DAYS } from '../lib/entitlement.js';

const router = express.Router();

// Server-side proof that the GHL credentials work and the location is reachable.
// Mirrors the extension's GHLApi.validateCredentials() (GET /locations/{id}).
async function validateGhlLocation(apiKey, locationId) {
  const url = `${String(config.ghlApiBase).replace(/\/+$/, '')}/locations/${encodeURIComponent(locationId)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!resp.ok) return { valid: false, status: resp.status };
    const data = await resp.json().catch(() => ({}));
    const name = data?.location?.name || data?.name || '';
    return { valid: true, locationName: name };
  } catch {
    return { valid: false, status: 0 }; // network error / timeout / abort
  } finally {
    clearTimeout(t);
  }
}

router.post('/start', authLimiter, authRequired, validateBody({
  apiKey: { type: 'string', required: true, maxLen: 400 },
  locationId: { type: 'string', required: true, maxLen: 120 },
}), async (req, res) => {
  const apiKey = String(req.body.apiKey).trim();
  const locationId = String(req.body.locationId).trim();

  // 1) Prove the GHL connection works (unless explicitly disabled by config).
  if (config.trialRequireGhl) {
    const check = await validateGhlLocation(apiKey, locationId);
    if (!check.valid) {
      return res.status(401).json({
        valid: false,
        error: 'Could not validate your GoHighLevel connection. Check the Private Integration Token and Location ID.',
      });
    }
  }

  const locHash = hashToken(locationId);
  const now = Date.now();

  // 2) Anti-fraud + provisioning, ALL inside the serialized write lock so the
  //    "location already claimed" check is atomic with the binding. writeDb takes
  //    a fresh in-lock read, so two concurrent starts for the same location can't
  //    both pass. We only block a FRESH start (no existing trial); a user who
  //    already has a trial re-validating any location just refreshes metadata.
  let result = null;
  let notFound = false;
  let claimedByOther = false;
  await writeDb((draft) => {
    const user = draft.users.find(u => u.id === req.user.userId);
    if (!user) { notFound = true; return draft; }

    if (!user.trialStartedAt && draft.trialLocations.some(t => t.locationIdHash === locHash && t.userId !== user.id)) {
      claimedByOther = true;
      return draft; // do NOT start a trial on a location owned by someone else
    }

    const alreadyStarted = Boolean(user.trialStartedAt);
    // Idempotent: ensureTrialInitialized only sets the window when it's missing,
    // so re-validating never restarts/extends a used or expired trial.
    ensureTrialInitialized(user, now);
    user.ghlValidated = true;
    user.ghlValidatedAt = new Date(now).toISOString();
    user.ghlValidatedLocationId = locationId;

    // Bind this location to this user (once). If it's already bound (to this user)
    // we leave it; it can't be bound to another user here (guarded above).
    if (!draft.trialLocations.some(t => t.locationIdHash === locHash)) {
      draft.trialLocations.push({ locationIdHash: locHash, userId: user.id, claimedAt: new Date(now).toISOString() });
    }

    draft.activity.unshift({
      id: `act_${now}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      action: 'trial.started',
      resourceType: 'trial',
      resourceId: user.id,
      status: 'ok',
      metadata: { alreadyStarted, trialDays: TRIAL_DAYS },
      createdAt: new Date(now).toISOString(),
    });
    draft.activity = draft.activity.slice(0, 5000);

    const ent = computeEntitlement(user, now);
    result = {
      started: true,
      alreadyStarted,
      trialStartedAt: user.trialStartedAt,
      trialEndsAt: user.trialEndsAt,
      ghlValidated: true,
      clonesRemaining: ent.clonesRemaining,
      daysLeft: ent.daysLeft,
    };
    return draft;
  });

  if (notFound) return res.status(404).json({ error: 'User not found.' });
  if (claimedByOther) {
    return res.status(409).json({
      error: 'This GoHighLevel location has already used a free trial.',
      code: 'location_already_trialed',
    });
  }
  return res.json(result);
});

export default router;
