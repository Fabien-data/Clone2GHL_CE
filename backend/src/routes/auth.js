import express from 'express';
import bcrypt from 'bcryptjs';
import { config, effectivePlan } from '../config.js';
import { computeEntitlement, ensureTrialInitialized, buildUpgrade } from '../lib/entitlement.js';
import { readDb, writeDb } from '../store.js';
import { authRequired } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../lib/validate.js';
import { signAccessToken, issueRefreshToken, revokeRefreshToken, revokeAllForUser } from '../lib/authTokens.js';
import { compareToken, hashToken } from '../lib/tokens.js';
import { generateActivationCode, normalizeCode } from '../lib/activation.js';
import { sendEmail, passwordResetEmail } from '../lib/email.js';

const router = express.Router();

router.post('/register', authLimiter, validateBody({
  email: { type: 'string', required: true, email: true, maxLen: 200 },
  password: { type: 'string', required: true, min: 8, maxLen: 200 },
}), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and password (min 8 chars) are required.' });
  }

  const db = await readDb();
  if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: `u_${Date.now()}`,
    email,
    passwordHash,
    plan: 'free',
    profile: {
      displayName: '',
      company: '',
      timezone: 'UTC',
    },
    stripeCustomerId: null,
    // Free-trial fields. The 30-day window starts when the user proves a valid
    // GHL connection (POST /api/trial/start); the cumulative clone counter is
    // seeded here so increments never hit an undefined.
    trialClonesUsed: 0,
    ghlValidated: false,
    createdAt: new Date().toISOString(),
  };

  let refreshToken;
  await writeDb((draft) => {
    draft.users.push(user);
    draft.usage.push({
      userId: user.id,
      period: new Date().toISOString().slice(0, 7),
      clonesUsed: 0,
      logosUsed: 0,
      aiUsed: 0,
      updatedAt: new Date().toISOString(),
    });
    draft.preferences.push({
      userId: user.id,
      theme: 'dark',
      defaultNiche: 'general',
      notifications: true,
      updatedAt: new Date().toISOString(),
    });
    refreshToken = issueRefreshToken(draft, user.id);
    return draft;
  });

  const token = signAccessToken(user);
  return res.json({ token, refreshToken, user: { id: user.id, email: user.email, plan: user.plan } });
});

router.post('/login', authLimiter, validateBody({
  email: { type: 'string', required: true, email: true, maxLen: 200 },
  password: { type: 'string', required: true, maxLen: 200 },
}), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const db = await readDb();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

  if (!user.passwordHash) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

  let refreshToken;
  await writeDb((draft) => {
    refreshToken = issueRefreshToken(draft, user.id);
    return draft;
  });
  const token = signAccessToken(user);
  return res.json({ token, refreshToken, user: { id: user.id, email: user.email, plan: user.plan } });
});

// ── POST /api/auth/refresh ── exchange a refresh token for a new access token ──
router.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required.' });

  const db = await readDb();
  const tokenHash = hashToken(refreshToken);
  const record = db.refreshTokens.find(r => r.tokenHash === tokenHash);
  if (!record || Date.parse(record.expiresAt) < Date.now()) {
    return res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
  const user = db.users.find(u => u.id === record.userId);
  if (!user || user.status === 'suspended') return res.status(401).json({ error: 'Account unavailable.' });

  // Rotate: revoke the used token, issue a fresh pair.
  let newRefresh;
  await writeDb((draft) => {
    revokeRefreshToken(draft, refreshToken);
    newRefresh = issueRefreshToken(draft, user.id);
    return draft;
  });
  const token = signAccessToken(user);
  return res.json({ token, refreshToken: newRefresh, user: { id: user.id, email: user.email, plan: user.plan } });
});

// ── POST /api/auth/logout ── revoke a refresh token ────────────────────────────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await writeDb((draft) => { revokeRefreshToken(draft, refreshToken); return draft; });
  }
  return res.json({ ok: true });
});

// ── POST /api/auth/forgot-password ── email a reset code (no account enumeration)
router.post('/forgot-password', authLimiter, validateBody({
  email: { type: 'string', required: true, email: true, maxLen: 200 },
}), async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();
  const db = await readDb();
  const user = db.users.find(u => u.email.toLowerCase() === email);

  // Only act if the account exists, but always return the same response so an
  // attacker can't probe which emails are registered.
  if (user) {
    const code = generateActivationCode();
    const now = Date.now();
    await writeDb((draft) => {
      // One active reset per user.
      draft.passwordResets = draft.passwordResets.filter(r => r.userId !== user.id);
      draft.passwordResets.push({
        userId: user.id,
        codeHash: hashToken(normalizeCode(code)),
        expiresAt: new Date(now + config.passwordResetTtlMin * 60_000).toISOString(),
        createdAt: new Date(now).toISOString(),
      });
      return draft;
    });
    const resetUrl = config.appUrl ? `${String(config.appUrl).replace(/\/+$/, '')}/reset?email=${encodeURIComponent(user.email)}` : '';
    const tpl = passwordResetEmail({ resetUrl, code, ttlMinutes: config.passwordResetTtlMin });
    await sendEmail({ to: user.email, ...tpl });
  }

  return res.json({ ok: true, message: 'If that email is registered, a reset code has been sent.' });
});

// ── POST /api/auth/reset-password ── consume the code, set a new password ──────
router.post('/reset-password', authLimiter, validateBody({
  email: { type: 'string', required: true, email: true, maxLen: 200 },
  code: { type: 'string', required: true, maxLen: 40 },
  newPassword: { type: 'string', required: true, min: 8, maxLen: 200 },
}), async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();
  const { code, newPassword } = req.body;

  const db = await readDb();
  const user = db.users.find(u => u.email.toLowerCase() === email);
  const generic = { error: 'Invalid or expired reset code.' };
  if (!user) return res.status(401).json(generic);

  const record = db.passwordResets.find(r => r.userId === user.id);
  if (!record || Date.parse(record.expiresAt) < Date.now()) return res.status(401).json(generic);
  if (!compareToken(normalizeCode(code), record.codeHash)) return res.status(401).json(generic);

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await writeDb((draft) => {
    const target = draft.users.find(u => u.id === user.id);
    if (target) target.passwordHash = passwordHash;
    draft.passwordResets = draft.passwordResets.filter(r => r.userId !== user.id);
    revokeAllForUser(draft, user.id); // force re-login everywhere after a reset
    return draft;
  });
  return res.json({ ok: true });
});

router.get('/me', authRequired, async (req, res) => {
  let db = await readDb();
  let user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Lazily start the trial window on first touch when GHL gating is disabled
  // (soft model). When gating is on, the window starts at /api/trial/start.
  if (!config.trialRequireGhl && effectivePlan(user) === 'free' && !user.trialStartedAt) {
    await writeDb((draft) => {
      const t = draft.users.find(u => u.id === user.id);
      if (t) ensureTrialInitialized(t);
      return draft;
    });
    db = await readDb();
    user = db.users.find(u => u.id === req.user.userId);
  }

  const preferences = db.preferences.find(p => p.userId === user.id) || {
    userId: user.id,
    theme: 'dark',
    defaultNiche: 'general',
    notifications: true,
    updatedAt: new Date().toISOString(),
  };

  const ent = computeEntitlement(user);
  const needsGhl = config.trialRequireGhl && ent.plan === 'free' && ent.state !== 'plan_expired' && !user.ghlValidated;

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      plan: ent.plan, // entitled plan: lapsed/suspended reads as free
      rawPlan: user.plan,
      suspended: user.status === 'suspended',
      subscriptionSource: user.subscriptionSource || null,
      subscriptionStatus: user.subscriptionStatus || null,
      currentPeriodEnd: user.currentPeriodEnd || null,
      profile: user.profile || { displayName: '', company: '', timezone: 'UTC' },
      // Trial / upgrade state (mirrors GET /api/usage).
      state: ent.state,
      isTrial: ent.isTrial,
      trialStartedAt: ent.trialStartedAt,
      trialEndsAt: ent.trialEndsAt,
      daysLeft: ent.daysLeft,
      ghlValidated: Boolean(user.ghlValidated),
      trialActivationRequired: needsGhl,
      upgradeRequired: ent.upgradeRequired,
      upgrade: ent.upgradeRequired ? buildUpgrade(ent.reason) : null,
    },
    preferences,
  });
});

router.patch('/profile', authRequired, async (req, res) => {
  const { displayName, company, timezone } = req.body || {};

  await writeDb((draft) => {
    const user = draft.users.find(u => u.id === req.user.userId);
    if (!user) return draft;

    user.profile = {
      displayName: typeof displayName === 'string' ? displayName.trim().slice(0, 80) : (user.profile?.displayName || ''),
      company: typeof company === 'string' ? company.trim().slice(0, 120) : (user.profile?.company || ''),
      timezone: typeof timezone === 'string' && timezone.trim() ? timezone.trim().slice(0, 80) : (user.profile?.timezone || 'UTC'),
    };
    return draft;
  });

  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ profile: user.profile });
});

router.post('/change-password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Current password and new password (min 8 chars) are required.' });
  }

  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await writeDb((draft) => {
    const target = draft.users.find(u => u.id === req.user.userId);
    if (target) target.passwordHash = passwordHash;
    return draft;
  });

  return res.json({ changed: true });
});

// ── DELETE /api/auth/me ── permanently delete the account and personal data ────
// GDPR/CCPA self-serve erasure. Requires the current password to confirm.
// Invoices and the hashed anti-fraud trial record are RETAINED where the Privacy
// Policy states we may keep them for legal / abuse-prevention reasons.
router.delete('/me', authRequired, async (req, res) => {
  const { password } = req.body || {};
  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Confirm identity before an irreversible delete (only when the account has a password).
  if (user.passwordHash) {
    if (!password) return res.status(400).json({ error: 'Password confirmation is required to delete your account.' });
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Password is incorrect.' });
  }

  await writeDb((draft) => {
    const uid = user.id;
    const myFunnelIds = new Set((draft.funnels || []).filter(f => f.userId === uid).map(f => f.id));
    const drop = (key, pred) => { if (Array.isArray(draft[key])) draft[key] = draft[key].filter(r => !pred(r)); };
    drop('users',          r => r.id === uid);
    drop('funnels',        r => r.userId === uid);
    drop('funnelVersions', r => r.userId === uid || myFunnelIds.has(r.funnelId));
    drop('usage',          r => r.userId === uid);
    drop('preferences',    r => r.userId === uid);
    drop('activity',       r => r.userId === uid);
    drop('customSites',    r => r.userId === uid);
    drop('videoJobs',      r => r.userId === uid);
    drop('videoAssets',    r => r.userId === uid);
    drop('passwordResets', r => r.userId === uid);
    drop('refreshTokens',  r => r.userId === uid);
    // Retained per Privacy Policy: invoices (tax/legal), trialLocations (hashed anti-fraud), ghlEvents (purchase audit).
    return draft;
  });

  return res.json({ ok: true, deleted: true });
});

export default router;
