/**
 * backend/src/lib/preflight.js
 *
 * Boot-time configuration validation. In PRODUCTION, hard blockers that would
 * silently break the payment → activation money path are FATAL (server.js exits 1);
 * in dev/test they are downgraded to warnings. Soft issues are always warnings.
 *
 * Pure and side-effect-free: returns { errors, warnings }. server.js owns the
 * decision to exit, so importing config (or this module) never kills a process —
 * which keeps `npm test` and tooling safe.
 */

import { statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Probe whether `data/` sits on its own mounted volume. Compares the device id
// of the data dir against its parent: a different device => a real mount
// (persistent); the same device => the data dir is just a folder on the
// container's ephemeral filesystem. Returns mounted=null when undeterminable
// (e.g. Windows dev, or the dir doesn't exist yet) so callers can skip the check.
export function probeDataDir(cwd = process.cwd()) {
  const dir = path.resolve(cwd, 'data');
  try {
    const dev = statSync(dir).dev;
    const parentDev = statSync(path.dirname(dir)).dev;
    return { path: dir, mounted: dev !== parentDev };
  } catch {
    return { path: dir, mounted: null };
  }
}

// `cfg` and `probe` are injectable for tests.
export function runPreflight(cfg = config, probe = probeDataDir) {
  const errors = [];
  const warnings = [];
  const prod = cfg.nodeEnv === 'production';
  const blocker = (msg) => (prod ? errors : warnings).push(msg);

  // ── Hard blockers (FATAL in production) ──────────────────────────────────
  const weakSecrets = new Set(['dev-secret-change-me', '', 'changeme', 'secret', 'jwt-secret']);
  if (weakSecrets.has(String(cfg.jwtSecret)) || String(cfg.jwtSecret).length < 16) {
    blocker('JWT_SECRET is unset, the dev default, or shorter than 16 chars — tokens (including owner/admin) would be forgeable. Set a long random JWT_SECRET.');
  }
  if (!cfg.ghlWebhookSecret && !cfg.ghlWebhookHmac) {
    blocker('GHL webhook auth is unset (GHL_WEBHOOK_SECRET or GHL_WEBHOOK_HMAC) — every GHL payment webhook returns 503 and no buyer gets activated.');
  }
  if (cfg.emailProvider === 'resend' && !cfg.emailApiKey) {
    blocker('EMAIL_PROVIDER=resend but EMAIL_API_KEY is empty — activation and password-reset emails will silently NOT send. Set EMAIL_API_KEY.');
  }
  if (Object.keys(cfg.ghlProductMap || {}).length === 0 && (cfg.ghlWebhookSecret || cfg.ghlWebhookHmac)) {
    blocker('GHL_PRODUCT_MAP is empty or unparseable while the GHL webhook is enabled — every purchase returns matched:false. e.g. "Pro Plan=pro:recurring, Agency Plan=agency:lifetime".');
  }

  // ── Soft issues (always warnings) ────────────────────────────────────────
  if (/onboarding@resend\.dev/i.test(String(cfg.emailFrom || ''))) {
    warnings.push('EMAIL_FROM is the resend.dev test address — set a verified sending domain (e.g. "Clone2GHL <noreply@clone2ghl.com>") or activation mail will land in spam / bounce.');
  }
  if (!cfg.ghlCheckoutUrl) {
    warnings.push('GHL_CHECKOUT_URL is empty — the in-extension Upgrade button has no GHL destination, hurting conversion.');
  }
  if ((cfg.allowedOrigins || []).length === 0 && (cfg.extensionIds || []).length === 0) {
    warnings.push('ALLOWED_ORIGINS and EXTENSION_IDS are both empty — browser/extension callers may be CORS-blocked.');
  }
  if (prod) {
    const dd = probe();
    if (dd.mounted === false) {
      warnings.push(`Data dir ${dd.path} is NOT on a mounted volume — a redeploy may WIPE all users, subscriptions, and invoices. Attach the Render persistent disk at /app/data.`);
    }
  }

  return { errors, warnings };
}
