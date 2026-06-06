/**
 * backend/src/lib/email.js
 *
 * Transactional email. Two providers, no SDK dependency:
 *  - 'resend'  → POST https://api.resend.com/emails  (set EMAIL_API_KEY)
 *  - 'console' → logs the email (dev/test default; nothing is actually sent)
 *
 * Returns { sent: boolean, provider, id?, error? } and never throws, so callers
 * can degrade gracefully (e.g. a password-reset flow shouldn't 500 if email is
 * misconfigured — it just reports not-sent).
 */

import { config } from '../config.js';

const RESEND_URL = 'https://api.resend.com/emails';

export async function sendEmail({ to, subject, html, text }) {
  const provider = config.emailProvider || 'console';
  const from = config.emailFrom || 'Clone2GHL <onboarding@resend.dev>';

  if (provider === 'console' || !config.emailApiKey) {
    console.log(`[email:console] to=${to} subject="${subject}"\n${text || html || ''}`);
    return { sent: true, provider: 'console' };
  }

  if (provider === 'resend') {
    try {
      const resp = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.emailApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html, text }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error('[email:resend] failed', resp.status, data?.message);
        return { sent: false, provider, error: data?.message || `HTTP ${resp.status}` };
      }
      return { sent: true, provider, id: data?.id };
    } catch (err) {
      console.error('[email:resend] error', err.message);
      return { sent: false, provider, error: err.message };
    }
  }

  return { sent: false, provider, error: `Unknown EMAIL_PROVIDER: ${provider}` };
}

// ── Templates ────────────────────────────────────────────────────────────────

export function passwordResetEmail({ resetUrl, code, ttlMinutes = 30 }) {
  const subject = 'Reset your Clone2GHL password';
  const text = `Use this code to reset your password: ${code}\n${resetUrl ? `Or open: ${resetUrl}\n` : ''}This expires in ${ttlMinutes} minutes. If you didn't request this, ignore this email.`;
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2>Reset your password</h2>
      <p>Use this code to reset your Clone2GHL password:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:2px">${escapeHtml(code)}</p>
      ${resetUrl ? `<p><a href="${escapeAttr(resetUrl)}">Or click here to reset</a></p>` : ''}
      <p style="color:#666">This expires in ${ttlMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>
    </div>`;
  return { subject, text, html };
}

export function activationEmail({ code, plan }) {
  const subject = 'Your Clone2GHL access code 🎟';
  const steps = `1. Open the Clone2GHL extension → Settings → Cloud Backend.\n2. Under "Activate Plan", enter your purchase email and this code:\n   ${code}\n3. Click "Activate Plan". Your ${plan} plan unlocks instantly.`;
  const text = `Thanks for your purchase!\n\n${steps}\n\nKeep this code safe — it activates your account.`;
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2>Your Clone2GHL access code 🎟</h2>
      <p>Thanks for your purchase! Activate the <strong>${escapeHtml(plan)}</strong> plan in three steps:</p>
      <ol style="line-height:1.6">
        <li>Open the Clone2GHL extension → <strong>Settings → Cloud Backend</strong>.</li>
        <li>Under <strong>Activate Plan</strong>, enter your purchase email and this code:</li>
      </ol>
      <p style="font-size:26px;font-weight:700;letter-spacing:3px;text-align:center;margin:16px 0">${escapeHtml(code)}</p>
      <p>Then click <strong>Activate Plan</strong> — your plan unlocks instantly.</p>
      <p style="color:#666">Keep this code safe; it activates your account.</p>
    </div>`;
  return { subject, text, html };
}

export function renewalReminderEmail({ displayName, plan, daysLeft }) {
  const subject = `Your Clone2GHL ${plan} plan renews soon`;
  const text = `Hi ${displayName || 'there'},\nYour ${plan} plan access ends in ${daysLeft} day(s). Renew to keep your tools active.`;
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2>Your ${escapeHtml(plan)} plan renews soon</h2>
      <p>Hi ${escapeHtml(displayName || 'there')}, your access ends in <strong>${Number(daysLeft)} day(s)</strong>.</p>
      <p>Renew to keep cloning, optimizing, and pushing to GoHighLevel without interruption.</p>
    </div>`;
  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}
