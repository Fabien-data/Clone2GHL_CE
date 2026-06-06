# Clone2GHL — Final Submission Guide (for the client)

Everything you need to (1) finish the domain, (2) provide the API keys, and (3) submit the Chrome
extension so it's approved on the first try. Copy-paste text is provided for every field.

**Already done by the developer:** backend deployed, privacy/terms pages live on clone2ghl.com,
final extension package (v1.0.4) built.

---

## Part 1 — Add the DNS records (so the app works at api.clone2ghl.com)
At your `clone2ghl.com` DNS manager, add:

| Type | Name / Host | Value |
|------|-------------|-------|
| A | `api` | `66.241.125.27` |
| AAAA | `api` | `2a09:8280:1::121:38b3:0` |

If your DNS is on **Cloudflare**, set both to **"DNS only"** (grey cloud, not orange).
After ~5–30 min, `https://api.clone2ghl.com/health` should show `{"ok":true}`.

---

## Part 2 — API keys to provide
Send these to the developer (or add them yourself if you have Fly.io access). The core product works
without them, but these unlock full functionality:

| Key | Enables | Required for launch? |
|-----|---------|----------------------|
| `OPENAI_API_KEY` | AI copy, logos, reports, video scripts | Yes (core selling point) |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + price IDs | Card billing for paid plans | If selling via Stripe |
| `EMAIL_API_KEY` (Resend) | Password-reset / activation emails | Recommended |
| `HEYGEN_API_KEY` | Avatar video generation | Optional |
| `GHL_WEBHOOK_SECRET` + product map | Selling plans through GoHighLevel | If selling via GHL |

The developer adds each with: `flyctl secrets set OPENAI_API_KEY=sk-...` (auto-redeploys).

---

## Part 3 — Submit the extension to the Chrome Web Store

Go to **https://chrome.google.com/webstore/devconsole** → open **Clone2GHL – Funnel Intelligence Platform**.

### 3.1 Upload the package
**Package** → **Upload new package** → choose `clone2ghl-chrome.zip` (v1.0.4) sent by the developer.

### 3.2 Privacy practices  ← this is what gets you approved
**Privacy policy URL:**
```
https://clone2ghl.com/privacy-policy
```

**Single purpose** (paste):
```
Clone2GHL captures user-selected webpages, converts them into editable funnel drafts, and helps users optimize and export those funnels into GoHighLevel.
```

**Permission justifications** (paste each next to the matching permission):
- **activeTab** — Required to read the DOM and styles of the page the user explicitly chooses to clone.
- **scripting** — Required to inject the extension's own content script so the clone action can capture page structure and assets.
- **storage** — Required to save encrypted API keys/tokens, cloned funnel data, watchlist entries, and user preferences locally.
- **tabs** — Required to open the dashboard and the GoHighLevel export flow in new tabs when the user triggers those actions.
- **alarms** — Required to schedule a single periodic background alarm that refreshes the signed-in user's plan/usage state (MV3 service-worker scheduling).
- **host permission `<all_urls>`** — Required because users can choose any webpage to clone; the target domain is not known in advance. The extension only reads a page after the user clicks "Clone."
- **`https://services.leadconnectorhq.com/*`, `https://rest.gohighlevel.com/*`** — Required to export funnels to and validate the user's GoHighLevel account via GoHighLevel's official API.
- **`https://api.openai.com/*`** — Required for optional AI features when the user supplies their own OpenAI key.

> ⚠️ Justify **alarms** — do NOT mention "notifications" (the extension no longer uses that permission).

**Remote code:** choose **"No, I am not using remote code."**

**Data types collected — CHECK only these:**
- ✅ Personally identifiable information (email)
- ✅ Authentication information (password hash / tokens)
- ✅ Financial and payment information (via Stripe)
- ✅ Website content (pages the user chooses to clone)
- ✅ User activity (feature usage)

**LEAVE UNCHECKED (the extension does NOT collect these):**
- ❌ Location  ❌ Personal communications  ❌ Web history  ❌ Health

**Data usage — tick all three certifications:**
- I do not sell or transfer user data to third parties outside the approved use cases.
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### 3.3 "What's new" (optional)
```
- Updated privacy policy and data disclosures.
- Improved GoHighLevel export reliability.
- Added a self-serve account-deletion option.
- General fixes and stability improvements.
```

### 3.4 Submit
Click **Submit for review**. Approval typically takes 1–3 business days.

---

## Part 4 — After approval
- Confirm the extension still works end-to-end: install from the store, clone a page, sign in, push to GoHighLevel.
- In the browser DevTools → Network, all requests should go to `https://api.clone2ghl.com` (no `localhost`).

Questions: clone2ghl@gmail.com
