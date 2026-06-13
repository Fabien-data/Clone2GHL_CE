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

  // No deliverable provider: either 'console' is selected (dev) or 'resend' was
  // selected but EMAIL_API_KEY is empty (a misconfigured production mailer). Log the
  // message and report sent:false so callers reflect reality — the old code returned
  // sent:true here, which silently hid an unconfigured mailer (the GHL webhook then
  // reported emailSent:true while no activation email ever left the server).
  if (provider === 'console' || !config.emailApiKey) {
    if (provider !== 'console' && !config.emailApiKey) {
      console.warn(`[email] EMAIL_PROVIDER=${provider} but EMAIL_API_KEY is empty — email NOT sent. to=${to} subject="${subject}"`);
    } else {
      console.log(`[email:console] to=${to} subject="${subject}"\n${text || html || ''}`);
    }
    return { sent: false, provider: 'console', logged: true };
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
  const installUrl = config.extensionInstallUrl || 'https://chromewebstore.google.com/detail/mjphmimkcjjhaejnlpcpekeekjmjfajk';
  const subject = 'Your Clone2GHL access code 🎟';
  const text = [
    `Thanks for your purchase! Activate your ${plan} plan in 3 steps:`,
    ``,
    `1. Install the Clone2GHL extension (skip if you already have it):`,
    `   ${installUrl}`,
    `2. Click the Clone2GHL icon in your browser, then "Activate Plan"`,
    `   (or open the dashboard -> Settings -> Cloud Backend -> "Activate Plan").`,
    `3. Enter your purchase email and this activation code:`,
    ``,
    `   ${code}`,
    ``,
    `Click "Activate Plan" and your ${plan} plan unlocks instantly.`,
    `Keep this code safe - it activates your account.`,
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
      <h2>Your Clone2GHL access code 🎟</h2>
      <p>Thanks for your purchase! Activate your <strong>${escapeHtml(plan)}</strong> plan in three steps:</p>
      <ol style="line-height:1.7">
        <li><strong>Install the extension</strong> (skip if you already have it):<br>
          <a href="${escapeAttr(installUrl)}">Get Clone2GHL on the Chrome Web Store →</a></li>
        <li>Click the <strong>Clone2GHL</strong> icon in your browser, then <strong>"Activate Plan"</strong><br>
          <span style="color:#666">(or open the dashboard → Settings → Cloud Backend → "Activate Plan")</span></li>
        <li>Enter your <strong>purchase email</strong> and this code:</li>
      </ol>
      <p style="font-size:28px;font-weight:700;letter-spacing:3px;text-align:center;margin:18px 0;padding:14px 0;background:#f5f5f5;border-radius:8px">${escapeHtml(code)}</p>
      <p>Then click <strong>Activate Plan</strong> — your ${escapeHtml(plan)} plan unlocks instantly.</p>
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
