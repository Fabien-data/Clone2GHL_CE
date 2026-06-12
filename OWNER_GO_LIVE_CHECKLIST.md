# Clone2GHL — Owner Go-Live Checklist (money path)

The code is production-hardened and tested. **What stands between "submitted" and "customers can pay
and use it" is the configuration below.** Do these in order; the whole thing is ~45–60 min.

This is the current, authoritative checklist. (`GO_LIVE_GUIDE.md` covers the one-time hosting/Chrome
Web Store submission; this doc covers everything the payment → activation flow needs to actually work.)

> **How activation works:** buyer pays on clone2ghl.com (GHL) → GHL workflow calls
> `POST /api/ghl/webhook` → backend provisions the account, mints a one-time **activation code**,
> emails it (Resend) **and** returns it in the response → buyer opens the extension →
> **Settings → Cloud Backend → Activate Plan**, enters email + code → plan unlocks. Email is the most
> fragile link, so we deliver the code **two ways** (Resend email + a GHL fallback).

---

## 1. Set the backend environment variables

Set these where your backend is hosted — **Render dashboard → Environment**, or **Fly.io**
`flyctl secrets set KEY=value ...`. The names/values are identical on either host.

**REQUIRED — the server refuses to boot in production without these, and payments fail without them:**

| Variable | What to put | Why |
|---|---|---|
| `JWT_SECRET` | a long random string (generate below) | tokens are forgeable without it |
| `EMAIL_PROVIDER` | `resend` | use real email, not console |
| `EMAIL_API_KEY` | your Resend API key (`re_…`) | else activation/reset emails silently don't send |
| `EMAIL_FROM` | `Clone2GHL <noreply@clone2ghl.com>` (verified domain) | unverified domain → mail bounces/spams |
| `GHL_WEBHOOK_SECRET` | a long random string (generate below) | else every payment webhook returns 503 |
| `GHL_PRODUCT_MAP` | `Starter Plan=starter:recurring, Pro Plan=pro:recurring, Agency Plan=agency:lifetime` (match your real GHL product names/IDs) | maps a purchase to a plan |
| `GHL_CHECKOUT_URL` | your clone2ghl.com GHL order page URL | the in-app Upgrade button's destination |
| `OWNER_EMAILS` | `clone2ghl@gmail.com, tirandewnith@gmail.com` | unlocks the Admin panel + manual activation |

**Recommended:**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://clone2ghl.com,chrome-extension://mjphmimkcjjhaejnlpcpekeekjmjfajk` |
| `EXTENSION_IDS` | `mjphmimkcjjhaejnlpcpekeekjmjfajk` |
| `CLIENT_URL` / `APP_URL` | `https://clone2ghl.com` |
| `BILLING_STRIPE_ENABLED` | `false` (GHL is the only payment rail) |
| `OPENAI_API_KEY` | business OpenAI key (AI copy/logo features) |
| `HEYGEN_API_KEY` | only if using video |
| `GHL_WEBHOOK_HMAC` | optional, extra forgery protection |
| `TRIAL_REQUIRE_GHL` | `true` (anti-fraud; default) |

Generate the random secrets:
```bash
node -e "console.log('JWT_SECRET        ='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('GHL_WEBHOOK_SECRET='+require('crypto').randomBytes(24).toString('base64url'))"
```

`backend/.env.example` is the complete, annotated template if you prefer copying from a file.

## 2. Attach the persistent disk (data safety)

All accounts, subscriptions, and invoices live in `backend/data/db.json`.
- **Render:** confirm the disk in `render.yaml` (`/app/data`, 1 GB) is actually attached to the service.
- **Fly.io:** confirm the volume is mounted at `/app/data` (`fly.toml`).

⚠️ Without an attached volume, **every redeploy wipes all customer data.** The backend logs a loud
`[preflight] WARN … NOT on a mounted volume` at boot if it detects this.

Set up a periodic backup of `db.json` (download/copy to storage) — cheap insurance.

## 3. Verify your sending domain in Resend

In Resend → Domains → add `clone2ghl.com` → add the SPF/DKIM DNS records it gives you → wait for
"Verified". `EMAIL_FROM` must use that verified domain. Send yourself a test to confirm delivery.

## 4. Configure GoHighLevel

1. **Products:** the products buyers purchase must match `GHL_PRODUCT_MAP` (by name or ID, case-insensitive).
2. **Purchase workflow** — on a successful payment, fire a **Custom Webhook**:
   - URL: `https://api.clone2ghl.com/api/ghl/webhook?token=YOUR_GHL_WEBHOOK_SECRET`
   - Method: POST, JSON body including at least the buyer **email** and the **product name/ID**
     (e.g. `{ "email": "{{contact.email}}", "productName": "Pro Plan", "transactionId": "{{order.id}}" }`).
   - **Fallback (recommended):** also add a step that **emails the buyer the `activationCode`** from the
     webhook's JSON response — so they're covered even if Resend hiccups.
3. **Refund/cancel workflow** → POST to `https://api.clone2ghl.com/api/ghl/cancel?token=YOUR_GHL_WEBHOOK_SECRET`
   with the buyer email. For a **refund/chargeback**, include `"type": "refund"` so access is revoked
   immediately; a plain cancellation (no refund flag) lets access run to the period end.
4. **Checkout/upgrade page:** make sure `GHL_CHECKOUT_URL` points at the order page (affiliate `?ref=` is
   appended automatically for attribution).

## 5. Verify the live deploy

Open `https://api.clone2ghl.com/health` — you want:
```json
{ "ok": true, "ghlAuth": true, "ghlProducts": 3, "emailDeliverable": true,
  "checkoutUrl": true, "stripeEnabled": false }
```
If any of those is `false`/`0`, the matching env var above is missing.

## 6. End-to-end live test (do this before announcing)

1. Make a **GHL test-mode** (or real, then refund) purchase of each plan.
2. Confirm the activation code arrives **by email** *and* appears in the webhook response.
3. In a clean Chrome profile with the published extension: **Settings → Cloud Backend → Activate Plan**,
   enter the email + code → confirm the plan unlocks and limits update.
4. Do a clone / AI optimize / push to GHL to confirm features work on the paid plan.
5. Trigger a **refund** → confirm access drops to free on the next action.
6. Confirm a **renewal** webhook extends access (re-send the purchase webhook).

## 7. Safety net — you can always activate manually

If anything in the automation hiccups, the **Admin panel** (visible to `OWNER_EMAILS` accounts in the
extension dashboard) lets you grant/extend a plan, re-issue an activation code, suspend, or impersonate
a user. So no buyer is ever permanently stuck.
