# Clone2GHL — Deployment Runbook

End-to-end steps to take the backend live and ship the extension to the stores.

---

## 0. Legal pages (on the clone2ghl.com marketing site)

Chrome requires a **live, public Privacy Policy URL**. The legal pages are published on the existing marketing site:
- `https://clone2ghl.com/privacy-policy` ← **CWS "Privacy policy URL"**
- `https://clone2ghl.com/terms-and-conditions`

Keep those pages' **content** in sync with the canonical sources in this repo — [privacy-policy.html](privacy-policy.html) and [terms-and-conditions.html](terms-and-conditions.html) — whenever they change. The accuracy of the privacy page is the #1 Chrome review factor. **Verify in an incognito window** that `https://clone2ghl.com/privacy-policy` loads with no login before submitting.

---

## 1. Backend

### Option A — Fly.io (recommended: free + persistent volume)
Keeps the JSON-file DB durable on a mounted volume. Config: [backend/fly.toml](backend/fly.toml).
```bash
cd backend
# Install flyctl + sign in  (Windows PowerShell: iwr https://fly.io/install.ps1 -useb | iex)
flyctl auth login
# App name must be globally unique — edit fly.toml `app` if "clone2ghl-api" is taken
flyctl apps create clone2ghl-api
# Persistent volume (region + name must match [[mounts]] in fly.toml)
flyctl volumes create clone2ghl_data --region iad --size 1
# Secrets (NOT stored in fly.toml) — see the env table below
flyctl secrets set JWT_SECRET=... OPENAI_API_KEY=... \
  ALLOWED_ORIGINS="https://clone2ghl.com,chrome-extension://mjphmimkcjjhaejnlpcpekeekjmjfajk" \
  EXTENSION_IDS=mjphmimkcjjhaejnlpcpekeekjmjfajk \
  CLIENT_URL=https://clone2ghl.com APP_URL=https://clone2ghl.com \
  EMAIL_PROVIDER=resend EMAIL_API_KEY=... "EMAIL_FROM=Clone2GHL <noreply@clone2ghl.com>" \
  OWNER_EMAILS="clone2ghl@gmail.com" ADMIN_SECRET=... GHL_WEBHOOK_SECRET=... \
  STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  STRIPE_PRICE_STARTER=... STRIPE_PRICE_PRO=... STRIPE_PRICE_AGENCY=... HEYGEN_API_KEY=...
flyctl deploy
flyctl certs add api.clone2ghl.com    # then add the DNS records it prints (see §4)
```
Health check: `GET https://api.clone2ghl.com/health` → `{ ok: true, ... }`.
Tip: set `min_machines_running = 1` in fly.toml during CWS review so reviewers never hit a cold start.

### Option B — Render (blueprint included)
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo. It reads [render.yaml](render.yaml):
   web service from [backend/Dockerfile](backend/Dockerfile) + a 1 GB persistent disk at `/app/data` (holds `db.json` and rehosted assets).
3. In the Render dashboard set the secret env vars (see table below).
4. Deploy. Health check: `GET https://<your-service>/health` → `{ ok: true, ... }`.

### Option C — Docker anywhere
```bash
cd backend
docker build -t clone2ghl-backend .
docker run -d -p 8080:8080 --env-file .env \
  -v clone2ghl-data:/app/data clone2ghl-backend
```
Put it behind HTTPS (Caddy/Nginx/Cloudflare) — webhooks and the extension require TLS.

### Required env (see [backend/.env.example](backend/.env.example))
| Var | Notes |
| --- | --- |
| `JWT_SECRET` | long random string |
| `OPENAI_API_KEY` | the client's business key — pays all AI cost |
| `ALLOWED_ORIGINS` | exact app origin(s); never `*` |
| `EXTENSION_IDS` | published extension id(s) → allows `chrome-extension://…` origin |
| `OWNER_EMAILS`, `ADMIN_SECRET` | admin access |
| `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM` | password-reset + renewal emails |
| `CLIENT_URL` | your app origin, e.g. `https://clone2ghl.com` |
| `APP_URL` | base URL used in email links, e.g. `https://clone2ghl.com` |
| `GHL_WEBHOOK_SECRET`, `GHL_PRODUCT_MAP` | GHL purchase → activation ([docs/GHL_INTEGRATION.md](docs/GHL_INTEGRATION.md)) |
| `AI_LIMIT_*` | per-plan monthly AI caps |
| `STRIPE_*` | only if also selling via direct Stripe |

### Backups
`db.json` is written atomically with a rolling `db.json.bak`. For real durability, snapshot the `/app/data` volume on a schedule (Render disk snapshots, or a cron `cp`/`rclone` to object storage).

---

## 2. Extension

1. **Build both targets, pointed at production** — `build.mjs` rewrites `DEFAULT_BACKEND_API_BASE` in the staged copy and refuses any non-HTTPS/localhost URL, so a dev backend can never ship by accident:
   ```bash
   cd extension
   C2G_API_BASE=https://api.clone2ghl.com node build.mjs
   ```
   PowerShell: `$env:C2G_API_BASE='https://api.clone2ghl.com'; node build.mjs`
   → `dist/clone2ghl-chrome.zip` and `dist/clone2ghl-firefox.zip` (the Firefox build auto-swaps in [manifest.firefox.json](extension/manifest.firefox.json)).
3. **Submit**:
   - **Chrome Web Store** / **Edge Add-ons** → upload the chrome zip.
   - **Firefox (AMO)** → upload the firefox zip.
4. **Capture the published extension id(s)** and put them in the backend `EXTENSION_IDS`, then redeploy the backend so CORS accepts the extension origin.

### Web Store review notes
- Permissions justification: `<all_urls>` + `scripting` + `activeTab` are required to **read the page the user chooses to clone**; `tabs` is used to open the dashboard and background-clone tabs. No remote code is executed (CSP `script-src 'self'`; all logic is bundled).
- Privacy policy: [privacy-policy.html](privacy-policy.html).

---

## 3. GHL purchase → activation
Follow [docs/GHL_INTEGRATION.md](docs/GHL_INTEGRATION.md): create the GHL Workflow (Order/Payment trigger → Custom Webhook to `/api/ghl/webhook?token=<secret>` → activation email with the returned code).

---

## 4. DNS records (at your clone2ghl.com registrar)
Your marketing site already owns the apex (`clone2ghl.com`). Add only:
| Host | Type | Points to |
| --- | --- | --- |
| `api` | CNAME / A+AAAA | the values `flyctl certs add api.clone2ghl.com` prints |
| email | TXT/DKIM/MX | Resend domain verification so mail sends from `noreply@clone2ghl.com` |

## 5. Go-live smoke test
Run the checklist in [QA_CHECKLIST.md](QA_CHECKLIST.md) against the live backend in a clean browser profile.
Confirm: privacy URL loads in incognito; register / login / usage work; a clone → push to GHL succeeds; and DevTools shows requests going to `api.clone2ghl.com` with **no** `localhost` calls.
