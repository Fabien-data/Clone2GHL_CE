import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { config, planLimits, logoLimits, aiLimits, flagsForPlan, effectivePlan } from '../config.js';
import { computeEntitlement, ensureTrialInitialized, buildUpgrade } from '../lib/entitlement.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

// True when a brand-new/grandfathered free user must first connect a valid GHL
// account before the trial is usable (config-gated). A lapsed paid sub does NOT
// hit this — it gets an upgrade prompt instead.
function trialActivationRequired(user, ent) {
  return config.trialRequireGhl
    && ent.plan === 'free'
    && ent.state !== 'plan_expired'
    && !user.ghlValidated;
}

// Lazily prepare a free user's trial fields. When GHL gating is OFF we start the
// 30-day window on first touch (soft model). When gating is ON the window starts
// at /api/trial/start (after server-side validation), so here we only ensure the
// cumulative counter exists. Only writes when something is actually missing.
async function backfillTrialIfNeeded(userId) {
  const db = await readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user || effectivePlan(user) !== 'free') return user;

  const startWindow = !config.trialRequireGhl && !user.trialStartedAt;
  const initCounter = typeof user.trialClonesUsed !== 'number';
  if (!startWindow && !initCounter) return user;

  await writeDb((draft) => {
    const target = draft.users.find(u => u.id === userId);
    if (!target) return draft;
    if (startWindow) ensureTrialInitialized(target);
    else if (initCounter) target.trialClonesUsed = 0;
    return draft;
  });
  const after = await readDb();
  return after.users.find(u => u.id === userId);
}

router.get('/', authRequired, async (req, res) => {
  const user = await backfillTrialIfNeeded(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const db = await readDb();
  const period = currentPeriod();
  const usage = db.usage.find(u => u.userId === user.id && u.period === period) || { clonesUsed: 0, logosUsed: 0, aiUsed: 0 };
  const ent = computeEntitlement(user);
  const plan = ent.plan;
  const logoLimit = logoLimits[plan] ?? 0;
  const aiLimit = aiLimits[plan] ?? 0;

  // Trial users are gated by the cumulative trial counter; paid users by the
  // monthly usage row. ent already resolved the right clone numbers for trials.
  const onTrial = ent.state === 'trial' || ent.state === 'trial_expired';
  const clonesLimit = ent.clonesLimit;
  const clonesUsed = onTrial ? ent.clonesUsed : usage.clonesUsed;
  const clonesRemaining = onTrial
    ? ent.clonesRemaining
    : (clonesLimit < 0 ? -1 : Math.max(0, clonesLimit - usage.clonesUsed));

  const needsGhl = trialActivationRequired(user, ent);

  return res.json({
    plan,
    suspended: user.status === 'suspended',
    subscriptionStatus: user.subscriptionStatus || null,
    subscriptionSource: user.subscriptionSource || null,
    currentPeriodEnd: user.currentPeriodEnd || null,
    clonesUsed,
    clonesLimit,
    clonesRemaining,
    logosUsed: usage.logosUsed || 0,
    logosLimit: logoLimit,
    logosRemaining: logoLimit < 0 ? -1 : Math.max(0, logoLimit - (usage.logosUsed || 0)),
    aiUsed: usage.aiUsed || 0,
    aiLimit,
    aiRemaining: aiLimit < 0 ? -1 : Math.max(0, aiLimit - (usage.aiUsed || 0)),
    featureFlags: flagsForPlan(plan),

    // ── Trial / upgrade state ────────────────────────────────────────────────
    state: ent.state,
    isTrial: ent.isTrial,
    trialStartedAt: ent.trialStartedAt,
    trialEndsAt: ent.trialEndsAt,
    daysLeft: ent.daysLeft,
    trialClonesRemaining: onTrial ? ent.clonesRemaining : null,
    trialClonesUsed: onTrial ? ent.clonesUsed : null,
    ghlValidated: Boolean(user.ghlValidated),
    trialActivationRequired: needsGhl,
    upgradeRequired: ent.upgradeRequired,
    upgrade: ent.upgradeRequired ? buildUpgrade(ent.reason, { ref: req.query.ref }) : null,
    // Base GHL checkout/upgrade URL (no ref). Always present so the extension can
    // offer "Upgrade" proactively; the client appends a captured ?ref= itself.
    checkoutUrl: config.ghlCheckoutUrl || '',
  });
});

router.post('/consume', authRequired, async (req, res) => {
  const user = await backfillTrialIfNeeded(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const period = currentPeriod();
  const ent = computeEntitlement(user);
  const onTrial = ent.state === 'trial' || ent.state === 'trial_expired';
  const ref = req.body?.ref || req.query.ref;

  // ── Gate 1: must connect a valid GHL account to start the trial ─────────────
  if (trialActivationRequired(user, ent)) {
    return res.status(403).json({
      error: 'Connect your GoHighLevel account to start your free trial.',
      ghlRequired: true,
      code: 'ghl_required',
    });
  }

  // ── Gate 2: trial exhausted / expired, or lapsed plan → upgrade ─────────────
  if (ent.upgradeRequired) {
    return res.status(402).json({
      error: ent.state === 'trial_expired'
        ? 'Your 30-day free trial has ended. Upgrade to keep cloning.'
        : ent.state === 'plan_expired'
          ? 'Your plan has expired. Upgrade to keep cloning.'
          : 'Free trial limit reached. Upgrade to keep cloning.',
      plan: ent.plan,
      clonesLimit: ent.clonesLimit,
      upgradeRequired: true,
      reason: ent.reason,
      upgrade: buildUpgrade(ent.reason, { ref }),
    });
  }

  // ── Gate 3: paid plan monthly cap ───────────────────────────────────────────
  if (!onTrial) {
    const limit = planLimits[ent.plan] ?? 2;
    const db = await readDb();
    const row = db.usage.find(u => u.userId === user.id && u.period === period) || { clonesUsed: 0 };
    if (limit >= 0 && row.clonesUsed >= limit) {
      return res.status(402).json({
        error: 'Plan limit reached.',
        plan: ent.plan,
        clonesLimit: limit,
        upgradeRequired: true,
        reason: 'plan_limit',
        upgrade: buildUpgrade('plan_limit', { ref }),
      });
    }
  }

  let resultUsed = 0;
  await writeDb((draft) => {
    const target = draft.users.find(u => u.id === user.id);
    if (!target) return draft;

    if (onTrial) {
      // Cumulative, NON-repeating trial counter on the user record.
      target.trialClonesUsed = Number(target.trialClonesUsed || 0) + 1;
      resultUsed = target.trialClonesUsed;
    } else {
      let row = draft.usage.find(u => u.userId === user.id && u.period === period);
      if (!row) {
        row = { userId: user.id, period, clonesUsed: 0, logosUsed: 0, aiUsed: 0, updatedAt: new Date().toISOString() };
        draft.usage.push(row);
      }
      row.clonesUsed += 1;
      row.updatedAt = new Date().toISOString();
      resultUsed = row.clonesUsed;
    }

    draft.activity.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      action: 'usage.consumed',
      resourceType: 'usage',
      resourceId: onTrial ? 'trial' : period,
      status: 'ok',
      metadata: { clonesUsed: resultUsed, plan: ent.plan, trial: onTrial },
      createdAt: new Date().toISOString(),
    });
    draft.activity = draft.activity.slice(0, 5000);
    return draft;
  });

  const limit = ent.clonesLimit;
  return res.json({
    consumed: true,
    clonesUsed: resultUsed,
    clonesRemaining: limit < 0 ? -1 : Math.max(0, limit - resultUsed),
  });
});

export default router;
