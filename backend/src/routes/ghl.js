/**
 * backend/src/routes/ghl.js
 *
 * Bridges GoHighLevel (GHL) payments → extension activation.
 *
 * The client sells the extension plans as PRODUCTS in GHL, with Stripe connected
 * through GHL Payments (not directly to us). A GHL Workflow fires a Custom Webhook
 * to us on purchase / renewal; we provision the account, set the plan, extend the
 * subscription window, and mint a one-time activation code. The buyer enters that
 * code in the extension to claim a login token.
 *
 * POST /api/ghl/webhook   ← GHL workflow (shared-secret auth)   provision + issue code
 * POST /api/ghl/activate  ← extension                           code → JWT
 * POST /api/ghl/cancel    ← GHL workflow (shared-secret auth)   mark cancelled
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { readDb, writeDb } from '../store.js';
import { issueActivationCode, normalizeCode, compareCode } from '../lib/activation.js';
import { safeEqual } from '../lib/tokens.js';
import { signAccessToken, issueRefreshToken } from '../lib/authTokens.js';
import { sendEmail, activationEmail } from '../lib/email.js';
import { authLimiter, webhookLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// ── Shared-secret guard for inbound GHL workflow calls ──────────────────────────
// Accepts EITHER a constant-time match of the shared token (header X-GHL-Token or
// ?token=) OR, if GHL_WEBHOOK_HMAC is set, a valid HMAC-SHA256 signature of the
// raw JSON body in header X-GHL-Signature (forge-resistant even if the URL leaks).
function ghlSecretRequired(req, res, next) {
  if (!config.ghlWebhookSecret && !config.ghlWebhookHmac) {
    return res.status(503).json({ error: 'GHL integration not enabled. Set GHL_WEBHOOK_SECRET.' });
  }

  const presented = req.headers['x-ghl-token'] || req.query.token || '';
  if (config.ghlWebhookSecret && safeEqual(presented, config.ghlWebhookSecret)) {
    return next();
  }

  const sig = req.headers['x-ghl-signature'];
  if (config.ghlWebhookHmac && sig) {
    const expected = createHmac('sha256', config.ghlWebhookHmac)
      .update(JSON.stringify(req.body || {}))
      .digest('hex');
    if (safeEqual(sig, expected)) return next();
  }

  return res.status(401).json({ error: 'Invalid GHL webhook token.' });
}

// GHL custom-webhook payloads are not standardized — pull each field from the
// common aliases so the client's field mapping is forgiving.
function extractOrder(body = {}) {
  const contact = body.contact || body.customer || {};
  const product = body.product || {};
  const email = (
    body.email || body.customerEmail || body.contactEmail ||
    contact.email || ''
  ).trim().toLowerCase();
  const name = (
    body.name || body.fullName || body.full_name ||
    contact.name ||
    [contact.firstName || contact.first_name, contact.lastName || contact.last_name].filter(Boolean).join(' ') ||
    ''
  ).trim();
  const productId = String(body.productId || body.product_id || product.id || '').trim();
  const productName = String(body.productName || body.product_name || product.name || (typeof body.product === 'string' ? body.product : '')).trim();
  const transactionId = String(
    body.transactionId || body.transaction_id || body.orderId || body.order_id || body.id || ''
  ).trim();
  const ghlContactId = String(body.contactId || body.contact_id || contact.id || '').trim();
  return { email, name, productId, productName, transactionId, ghlContactId };
}

function resolvePlan({ productId, productName }) {
  const map = config.ghlProductMap || {};
  if (productId && map[productId.toLowerCase()]) return map[productId.toLowerCase()];
  if (productName && map[productName.toLowerCase()]) return map[productName.toLowerCase()];
  return null;
}

// ── POST /api/ghl/webhook ── provision/renew from a GHL purchase ────────────────
router.post('/webhook', webhookLimiter, ghlSecretRequired, async (req, res) => {
  const order = extractOrder(req.body);
  if (!order.email) return res.status(400).json({ error: 'Missing customer email in payload.' });

  const resolved = resolvePlan(order);
  if (!resolved) {
    // Unknown product — acknowledge so GHL stops retrying, but don't guess a plan.
    return res.json({ received: true, matched: false, reason: 'product_not_mapped' });
  }
  const { plan, type: productType } = resolved;

  const now = Date.now();
  // Idempotency: ignore an event we've already processed. Prefer the real
  // transaction id; fall back to a per-day email+product key so a retried webhook
  // that omits a transaction id doesn't double-provision.
  const dedupeKey = order.transactionId
    || `${order.email}:${(order.productId || order.productName || '').toLowerCase()}:${new Date(now).toISOString().slice(0, 10)}`;
  {
    const db = await readDb();
    if (db.ghlEvents.some(e => (e.dedupeKey || e.transactionId) === dedupeKey)) {
      return res.json({ received: true, duplicate: true });
    }
  }

  let activationCode = null; // plaintext returned only for not-yet-activated accounts

  await writeDb(async (draft) => {
    let user = draft.users.find(u => u.email.toLowerCase() === order.email);

    if (!user) {
      user = {
        id: `u_${now}`,
        email: order.email,
        passwordHash: null, // set later, optionally, during activation
        plan,
        profile: { displayName: order.name || '', company: '', timezone: 'UTC' },
        stripeCustomerId: null,
        status: 'active',
        createdAt: new Date(now).toISOString(),
      };
      draft.users.push(user);
      draft.usage.push({
        userId: user.id,
        period: new Date(now).toISOString().slice(0, 7),
        clonesUsed: 0,
        logosUsed: 0,
        aiUsed: 0,
        updatedAt: new Date(now).toISOString(),
      });
      draft.preferences.push({
        userId: user.id, theme: 'dark', defaultNiche: 'general', notifications: true,
        updatedAt: new Date(now).toISOString(),
      });
    }

    // Lifetime (one-time) products never expire → null. Recurring products get a
    // rolling window that each renewal payment re-extends. Extend from the LATER
    // of (now, existing currentPeriodEnd) so an early renewal never shortens an
    // active window.
    const base = (productType !== 'lifetime' && user.currentPeriodEnd && Date.parse(user.currentPeriodEnd) > now)
      ? Date.parse(user.currentPeriodEnd)
      : now;
    const periodEnd = productType === 'lifetime'
      ? null
      : new Date(base + config.ghlPeriodDays * 86400000).toISOString();

    // Apply subscription state (also covers renewals of existing accounts).
    user.plan = plan;
    user.subscriptionSource = 'ghl';
    user.subscriptionStatus = 'active';
    user.productType = productType;          // 'lifetime' | 'recurring'
    user.currentPeriodEnd = periodEnd;        // null for lifetime → effectivePlan never expires it
    if (order.ghlContactId) user.ghlContactId = order.ghlContactId;
    if (order.transactionId) user.ghlOrderId = order.transactionId;
    if (user.status === 'suspended') user.status = 'active';

    // Only mint a code for accounts the buyer hasn't claimed yet. Renewals of an
    // already-activated account just extend the window — no new code emailed.
    if (!user.activatedAt) {
      activationCode = await issueActivationCode(user, now);
    }

    // Record the event for idempotency + an audit trail.
    draft.ghlEvents.unshift({
      transactionId: order.transactionId || null,
      dedupeKey,
      userId: user.id,
      email: user.email,
      plan,
      productType,
      type: 'payment',
      createdAt: new Date(now).toISOString(),
    });
    if (draft.ghlEvents.length > 10000) draft.ghlEvents.length = 10000;

    return draft;
  });

  // Email the activation code directly (Resend/console). This keeps the GHL
  // workflow to a single webhook step — no response-capture/AI-Extract needed.
  // Never throws; degrades gracefully if email is unconfigured. Only first-time
  // (not-yet-activated) accounts get a code.
  let emailSent = false;
  if (activationCode) {
    const tmpl = activationEmail({ code: activationCode, plan });
    const r = await sendEmail({ to: order.email, ...tmpl });
    emailSent = Boolean(r.sent);
  }

  // Also return the code in the response as a fallback (so a GHL workflow can
  // email it instead if backend email is intentionally disabled).
  return res.json({
    received: true,
    matched: true,
    plan,
    productType,
    email: order.email,
    activationCode, // null on renewals of an already-activated account
    emailSent,
  });
});

// ── POST /api/ghl/activate ── extension claims access with email + code ─────────
router.post('/activate', authLimiter, async (req, res) => {
  const { email, code, password } = req.body || {};
  const normEmail = String(email || '').trim().toLowerCase();
  const normCode = normalizeCode(code);
  if (!normEmail || !normCode) {
    return res.status(400).json({ error: 'Email and activation code are required.' });
  }
  if (password != null && String(password).length > 0 && String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const db = await readDb();
  const user = db.users.find(u => u.email.toLowerCase() === normEmail);
  const generic = { error: 'Invalid or expired activation code.' };
  if (!user || !user.activationCodeHash) return res.status(401).json(generic);
  if (user.activationCodeExpiresAt && Date.parse(user.activationCodeExpiresAt) < Date.now()) {
    return res.status(401).json(generic);
  }

  const ok = await compareCode(normCode, user.activationCodeHash);
  if (!ok) return res.status(401).json(generic);

  let refreshToken;
  await writeDb(async (draft) => {
    const target = draft.users.find(u => u.id === user.id);
    if (!target) return draft;
    target.activatedAt = new Date().toISOString();
    target.activationCodeHash = null;
    target.activationCodeExpiresAt = null;
    if (password) target.passwordHash = await bcrypt.hash(String(password), 10);
    refreshToken = issueRefreshToken(draft, user.id);
    return draft;
  });

  const token = signAccessToken(user);
  return res.json({ token, refreshToken, user: { id: user.id, email: user.email, plan: user.plan } });
});

// ── POST /api/ghl/cancel ── GHL cancellation / refund workflow ──────────────────
// Marks the subscription cancelled; access runs out at currentPeriodEnd (handled
// by effectivePlan), so we don't yank access mid-period.
router.post('/cancel', ghlSecretRequired, async (req, res) => {
  const order = extractOrder(req.body);
  if (!order.email) return res.status(400).json({ error: 'Missing customer email in payload.' });

  let found = false;
  await writeDb((draft) => {
    const user = draft.users.find(u => u.email.toLowerCase() === order.email);
    if (user) {
      user.subscriptionStatus = 'cancelled';
      found = true;
    }
    return draft;
  });
  return res.json({ received: true, found });
});

export default router;
