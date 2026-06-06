# Clone2GHL — Go-Live & Hosting Guide (End to End)

Everything needed to put the backend online, submit the extension to the Chrome Web Store, and hand
the project to the client. Plan for ~60–90 minutes the first time.

**Final artifacts (already built):**
- Extension package: **`extension/dist/clone2ghl-chrome.zip`** — version **1.0.4**, pre-pointed at `https://api.clone2ghl.com`.
- (Optional) Firefox/Edge package: `extension/dist/clone2ghl-firefox.zip`.
- Legal pages: published on your marketing site at `https://clone2ghl.com/privacy-policy` and `/terms-and-conditions`.

> **Important:** "Hosting the extension" = hosting the **backend** it talks to. The extension file itself
> is uploaded to Google and served by the Chrome Web Store — you don't host that.

---

## Step 0 — Gather these before you start
- **Chrome Web Store** developer access to the existing item (ID `mjphmimkcjjhaejnlpcpekeekjmjfajk`).
- **Fly.io** account.
- **DNS** access for `clone2ghl.com` (to add an `api` record).
- **Secret values** for the backend (have them in a scratch file):
  - `JWT_SECRET` — any long random string (generate one in Step 2).
  - `OPENAI_API_KEY` — the business OpenAI key (pays all AI usage).
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER/PRO/AGENCY` — if selling via Stripe.
  - `HEYGEN_API_KEY` — if using video.
  - `EMAIL_API_KEY` — Resend API key (password-reset / activation emails).
  - `GHL_WEBHOOK_SECRET`, `ADMIN_SECRET` — any long random strings.

---

## Step 1 — Install flyctl & sign in
In PowerShell:
```powershell
iwr https://fly.io/install.ps1 -useb | iex      # installs flyctl
flyctl auth signup                               # or: flyctl auth login
```
Close and reopen PowerShell if `flyctl` isn't recognized afterward.

---

## Step 2 — Deploy the backend to Fly.io
Run from the **backend** folder. Config is already in `backend/fly.toml` (256 MB machine + a persistent
volume at `/app/data` so the database survives restarts).

```powershell
cd "c:\Users\Tiran's PC\Documents\GitHub\Clone2GHL_CE\backend"

# (a) create the app — the name must be globally unique; if taken, edit `app` in fly.toml and retry
flyctl apps create clone2ghl-api

# (b) create the persistent volume (same name + region as fly.toml's [[mounts]])
flyctl volumes create clone2ghl_data --region iad --size 1

# (c) generate a JWT secret (copy the output)
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')

# (d) set all secrets in one command (replace the ... values)
flyctl secrets set `
  JWT_SECRET=PASTE_THE_LONG_RANDOM_STRING `
  OPENAI_API_KEY=sk-... `
  ALLOWED_ORIGINS="https://clone2ghl.com,chrome-extension://mjphmimkcjjhaejnlpcpekeekjmjfajk" `
  EXTENSION_IDS=mjphmimkcjjhaejnlpcpekeekjmjfajk `
  CLIENT_URL=https://clone2ghl.com `
  APP_URL=https://clone2ghl.com `
  EMAIL_PROVIDER=resend `
  EMAIL_API_KEY=re_... `
  "EMAIL_FROM=Clone2GHL <noreply@clone2ghl.com>" `
  OWNER_EMAILS="clone2ghl@gmail.com" `
  ADMIN_SECRET=ANOTHER_LONG_RANDOM_STRING `
  GHL_WEBHOOK_SECRET=ANOTHER_LONG_RANDOM_STRING `
  STRIPE_SECRET_KEY=sk_live_... `
  STRIPE_WEBHOOK_SECRET=whsec_... `
  STRIPE_PRICE_STARTER=price_... STRIPE_PRICE_PRO=price_... STRIPE_PRICE_AGENCY=price_... `
  HEYGEN_API_KEY=...

# (e) deploy
flyctl deploy
```
(Leave out the Stripe/HeyGen lines for now if you're not enabling those yet — they can be added later
with another `flyctl secrets set`, which triggers a redeploy.)

---

## Step 3 — Attach api.clone2ghl.com
```powershell
flyctl certs add api.clone2ghl.com
```
It prints a DNS record (usually a CNAME to `clone2ghl-api.fly.dev`, plus an `_acme-challenge` for the cert).
Add those at your `clone2ghl.com` DNS provider. Wait a few minutes, then:
```powershell
flyctl certs show api.clone2ghl.com      # status should become "Ready"
```
**Verify the backend is live:** open `https://api.clone2ghl.com/health` → you should see `{"ok":true,...}`.

> Tip during review: in `backend/fly.toml` set `min_machines_running = 1` and `flyctl deploy` again so a
> Google reviewer never hits a cold start. You can set it back to `0` after approval to save money.

---

## Step 4 — Confirm the legal pages are live (accuracy matters most)
In an **incognito** window open `https://clone2ghl.com/privacy-policy` and confirm it shows the **current**
policy (mentions a cloud backend; lists OpenAI, GoHighLevel, Stripe, Resend, HeyGen). If it still shows an
older "local-only / no servers" policy, replace that page's content with `privacy-policy.html` from this repo
first — an inaccurate policy is the #1 reason this item was rejected before.

---

## Step 5 — Submit the extension (v1.0.4) to the Chrome Web Store
Go to the Developer Dashboard → open **Clone2GHL – Funnel Intelligence Platform**.

1. **Package** → **Upload new package** → choose
   `extension/dist/clone2ghl-chrome.zip` (v1.0.4). *(Re-uploading 1.0.3 fails — your live version is already 1.0.3.)*

2. **Store listing**
   - "What's new" (optional): paste the notes from `webstore-kit/CHANGELOG_v1.0.3.txt` and add:
     *"Added a self-serve account-deletion option."*
   - Keep your existing screenshots (the dashboard shot is fine).

3. **Privacy practices** — this is what gets you approved:
   - **Privacy policy URL:** `https://clone2ghl.com/privacy-policy`
   - **Single purpose:** paste from `webstore-kit/STORE_LISTING.md` → *Single Purpose Statement*.
   - **Permission justifications:** paste each one from `webstore-kit/STORE_LISTING.md` → *Suggested Permission
     Answers* (activeTab, scripting, storage, tabs, **alarms**, `<all_urls>`, the GHL hosts, OpenAI host).
     ⚠️ Justify **alarms**, NOT "notifications" — your current manifest no longer uses notifications.
   - **Remote code:** "No, I am not using remote code." (CSP is `script-src 'self'`; all code is bundled.)
   - **Data types collected — CHECK only these (they're true):**
     - ✅ Personally identifiable information (email)
     - ✅ Authentication information (password hash / tokens)
     - ✅ Financial and payment information (via Stripe)
     - ✅ Website content (the pages the user chooses to clone)
     - ✅ User activity (feature usage)
   - **UNCHECK these (your extension does NOT collect them — your current listing wrongly claims them):**
     - ❌ Location  ❌ Personal communications  ❌ Web history  ❌ Health  ❌ Personal/financial *other*
   - **Data-use certifications — check all three:** not sold to third parties; not used for unrelated
     purposes; not used for creditworthiness/lending.

4. **Submit for review.** Reviews typically take 1–3 business days.

---

## Step 6 — After approval
- Confirm the published extension ID is still `mjphmimkcjjhaejnlpcpekeekjmjfajk` (it won't change for an update).
  It already matches the `EXTENSION_IDS` / `ALLOWED_ORIGINS` you set, so CORS is correct — nothing to do.
- If you ever change the ID, update those two secrets and `flyctl deploy` again.

---

## Step 7 — Go-live smoke test
In a clean Chrome profile with the published (or unpacked `extension/dist/chrome`) extension:
1. Clone any page → it appears in **My Funnels**. (works with no account = local mode)
2. **Sign in / Register** in the dashboard → confirms the backend is reachable.
3. Run an **AI Optimize** and a **Push to GoHighLevel**.
4. Open DevTools → Network: every request should go to `https://api.clone2ghl.com` — **no `localhost`**.

---

## Step 8 — Handover to the client
Give the client:
- **Fly.io**: transfer the app to their org (`flyctl apps move`) or share access, plus the list of secret
  **names** (not values in plaintext — rotate and hand over securely).
- **DNS**: the `api` record (and Resend email-verification records if used).
- **Chrome Web Store** developer account access for the item.
- **Domain**: keep the legal pages on `clone2ghl.com` in sync with `privacy-policy.html` / `terms-and-conditions.html`.
- **Docs**: this guide, `DEPLOYMENT.md`, `CLIENT_HANDOVER_GUIDE.md`, `QA_CHECKLIST.md`.

---

## Appendix — Shipping a future update
```powershell
cd "c:\Users\Tiran's PC\Documents\GitHub\Clone2GHL_CE\extension"
# bump the version in manifest.json + manifest.firefox.json first (must exceed the published version), then:
$env:C2G_API_BASE='https://api.clone2ghl.com'; node build.mjs
# upload the new extension/dist/clone2ghl-chrome.zip
```
Backend update: `cd ..\backend; flyctl deploy`.

> Optional legal note: your CWS developer address is in **Victoria, Australia** — you may want to name that
> jurisdiction in `terms-and-conditions.html` §14 (currently left neutral with a TODO).
