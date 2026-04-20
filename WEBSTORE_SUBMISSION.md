# Clone2GHL — Chrome Web Store Submission Guide

## Overview

**Extension name:** Clone2GHL – Funnel Intelligence Platform  
**Version:** 1.0.1  
**Manifest version:** 3  
**Category:** Productivity  
**Primary audience:** GoHighLevel agencies, funnel builders, digital marketers, coaches

---

## What the Extension Does

Clone2GHL lets users clone any webpage's design and content, analyze its conversion potential with AI, optimize the copy for a specific niche, and push the result directly into their GoHighLevel (GHL) account — all from the browser.

Users do **not** need an OpenAI API key or any third-party credentials beyond a Clone2GHL subscription and their GHL API key. All AI features (GPT-4o copy rewriting, DALL-E 3 logo generation, AI headline generation, funnel intelligence analysis, and video generation) are handled server-side by the Clone2GHL backend. The subscription covers all AI costs.

---

## Pricing Plans

| Plan | Price | Clones/Month | AI Features |
|------|-------|-------------|-------------|
| **FREE** | $0 | 6 | Basic copy optimization (limited) |
| **STARTER** | $27/month | 24 | Basic AI rewrite & optimization |
| **PRO** | $97/month | 300 | Full AI suite: copy, 50 logo gens, funnel library, ad intelligence |
| **AGENCY** | $199/month | Unlimited | Everything in Pro + team access + priority support + DFY discounts |

### Plan Details

**🟢 FREE**
- Clone up to 6 pages per month
- Limited AI copy optimization
- Basic funnel access
- No credit card required

**🔵 STARTER — $27/month**
- Clone up to 24 pages per month
- Basic AI rewrite & optimization
- Standard funnel access
- Ideal for individuals getting into funnel building

**🔥 PRO — $97/month** *(Most Popular)*
- Clone up to 300 pages per month
- 50 AI logo generations per month
- Full AI funnel optimization (copy, structure, CTA)
- Access to Funnel Library (winning funnels by niche, 15+ templates)
- Ad Intelligence (Facebook Ads Library, Google Ads Transparency, TikTok Creative Center)
- AI video generation via HeyGen & OpenAI

**🟣 AGENCY — $199/month**
- Unlimited page cloning
- 200 AI logo generations per month
- Full AI optimization suite
- Funnel Library + Ad Intelligence
- Team access
- Priority support
- Done-For-You (DFY) discounts

---

## Feature List

| Feature | Description |
|---------|-------------|
| One-click page cloning | Captures DOM, CSS, images, and layout from any webpage |
| GHL direct push | Sends cloned funnels to GoHighLevel via API v2 |
| AI copy optimizer | GPT-4o rewrites headlines, CTAs, and body copy for 15 niches |
| Funnel intelligence | 0–100 conversion score with insights and recommendations |
| Logo generator | DALL-E 3 creates professional logos from business details |
| Funnel library | 15+ high-converting pre-built templates ready to customize |
| Headline generator | 5 AI-generated headline variations per request |
| Video generation | AI promo videos via HeyGen and OpenAI (Pro/Agency) |
| Ad intelligence | Quick access to competitor ad research on Facebook, Google, TikTok |
| GHL token replacement | Automatically swaps phone numbers and business names with GHL custom values |
| Encryption | AES-GCM encryption for all stored API credentials |

---

## Chrome Web Store Submission — Step by Step

### Step 1 — Package the Extension

Run from the `extension/` directory:

**PowerShell:**
```powershell
cd "path\to\Clone2GHL_CE\extension"
Compress-Archive -Path * -DestinationPath "..\Clone2GHL_v1.0.1.zip"
```

**Mac/Linux:**
```bash
cd path/to/Clone2GHL_CE/extension
zip -r ../Clone2GHL_v1.0.1.zip . --exclude "*.DS_Store"
```

> **Important:** Zip the *contents* of the `extension/` folder, not the folder itself. `manifest.json` must be at the root of the ZIP.

---

### Step 2 — Developer Account Setup

1. Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
2. Sign in with a Google account
3. Pay the **one-time $5 developer registration fee**
4. Accept the Developer Agreement

---

### Step 3 — Create a New Item

1. Click **"+ New Item"** in the developer console
2. Upload `Clone2GHL_v1.0.1.zip`
3. Google will auto-parse `manifest.json`

---

### Step 4 — Store Listing Fields

**Name (45 chars max):**
```
Clone2GHL – Funnel Intelligence Platform
```

**Summary (132 chars max):**
```
Clone any webpage, analyze funnels with AI, and push directly into GoHighLevel in minutes.
```

**Full Description:**
```
Clone2GHL is the #1 tool for GoHighLevel agencies and funnel builders.

✅ ONE-CLICK PAGE CLONING — Capture any webpage's design, copy, and layout instantly
✅ GHL DIRECT PUSH — Send cloned funnels straight into your GHL account via API
✅ AI COPY OPTIMIZER — GPT-4o rewrites headlines and CTAs for 15 niches (plumber, HVAC, dental, real estate, gym, solar, coaching, legal, and more)
✅ FUNNEL INTELLIGENCE — Get a 0–100 conversion score with actionable insights and recommendations
✅ LOGO GENERATOR — Create professional logos instantly with DALL-E 3
✅ FUNNEL LIBRARY — 15+ high-converting templates ready to clone and customize
✅ VIDEO GENERATION — AI-powered promo videos via HeyGen & OpenAI (Pro/Agency plans)
✅ AD INTELLIGENCE — Research competitor ads on Facebook, Google & TikTok

🔑 NO API KEYS REQUIRED — Just buy a plan and connect your GHL account. We handle all AI costs.

💡 HOW IT WORKS:
1. Visit any landing page or website
2. Click the Clone2GHL button in your toolbar or the floating ⚡ button on the page
3. Select your niche and toggle AI optimization
4. Your cloned funnel appears in the dashboard — ready to preview, optimize, and push to GHL

🎯 PERFECT FOR:
- GoHighLevel agencies building funnels for clients
- Solo funnel builders who want to move fast
- Marketers reverse-engineering high-converting pages
- Coaches and consultants launching offers quickly

📦 PLANS:
- FREE: 6 clones/month — try it before you upgrade
- STARTER ($27/mo): 24 clones/month + basic AI
- PRO ($97/mo): 300 clones + full AI suite + funnel library + logo generation + ad intelligence
- AGENCY ($199/mo): Unlimited clones + team access + priority support + DFY discounts
```

**Category:** Productivity  
**Language:** English (United States)

---

### Step 5 — Required Visual Assets

> These are required for submission. Without them, the listing cannot go live.

| Asset | Dimensions | Format | Notes |
|-------|-----------|--------|-------|
| Screenshots | 1280×800 or 640×400 | PNG or JPG | Min 1, max 5 — required |
| Small promo tile | 440×280 | PNG | Shown in search results |
| Large promo image | 920×680 | PNG | Shown on detail page |
| Marquee promo | 1400×560 | PNG | For editorial featuring |

**Recommended screenshots to take (in order):**
1. **Dashboard — My Funnels tab** showing funnel cards with conversion scores
2. **A live clone in action** — the floating ⚡ button on a real landing page
3. **AI Tools tab** — the AI Copy Optimizer or Headline Generator in use
4. **Funnel Intelligence score** — showing the 0–100 grade with insights
5. **Pricing / Settings** — showing the GHL connection and plan info

*Tip: Take screenshots at exactly 1280×800 using Chrome DevTools device emulation or a screen capture tool set to that resolution.*

---

### Step 6 — Privacy Policy

A privacy policy URL is **required** before submission. The policy must cover:

- **Data collected:** GHL API key (stored locally, encrypted), funnel HTML content, user email (for backend account)
- **Data transmitted:** GHL API key sent to GHL servers, funnel HTML and niche sent to Clone2GHL backend for AI processing, Stripe handles payment data
- **Data NOT collected:** Browsing history, personal data from cloned pages beyond what the user explicitly clones
- **Data retention:** Local storage cleared when extension is removed; backend data retained per account until deletion requested
- **Third parties:** GoHighLevel API, OpenAI API (via our backend), Stripe (billing), HeyGen (video, Pro/Agency)
- **No data sold** to third parties

Host on GitHub Pages (`docs/privacy.html`), Notion, or any public URL.

**Sample privacy policy URL format:**  
`https://clone2ghl.com/privacy` or `https://yourgithub.io/clone2ghl/privacy`

---

### Step 7 — Permission Justifications

Google requires a written justification for each permission. Use these:

| Permission | Justification |
|-----------|--------------|
| `activeTab` | Required to read the current page's DOM and CSS structure when the user initiates a clone action. The extension only accesses the active tab when the user explicitly clicks Clone. |
| `scripting` | Required to inject the content script that captures the page's HTML, styles, and layout for cloning. Only executes on user action. |
| `storage` | Required to persist cloned funnels, encrypted API credentials, user preferences, and plan information locally on the user's device. |
| `tabs` | Required to open the Clone2GHL dashboard and the GoHighLevel funnel builder in new tabs after a successful clone or export. |
| `notifications` | Required to notify the user when a clone completes, when a GHL push succeeds or fails, or when a video generation job finishes. |
| `<all_urls>` | Required because the extension must run on any user-chosen webpage — the target domain is unknown at install time. The extension only reads page structure when the user explicitly initiates a clone. No passive tracking occurs. |

---

### Step 8 — Single Purpose Statement

> Google requires a clear single purpose statement.

```
Clone2GHL captures webpage designs and content, converts them to GoHighLevel-compatible 
funnels, and optionally optimizes them with AI — enabling agencies and marketers to 
build and launch funnels in GHL faster.
```

---

### Step 9 — Submit for Review

1. Complete all fields and upload all assets
2. Add your privacy policy URL
3. Click **"Submit for review"**
4. Review typically takes **1–3 business days** (up to 7 in some cases)
5. You'll receive an email when approved or if changes are requested

---

## Common Rejection Reasons & How to Avoid Them

| Rejection Reason | Status | Notes |
|-----------------|--------|-------|
| `<all_urls>` without justification | **Addressed above** | Be explicit in the justification field |
| Missing privacy policy | **Must add before submit** | Required field |
| Misleading screenshots | Avoid | Screenshots must show real extension UI |
| Remote code execution | **Not applicable** | Extension loads no remote JS |
| Inline scripts | **Not applicable** | CSP is `script-src 'self'` — clean |
| `eval()` usage | **Verify** | Run `grep -r "eval(" extension/` to confirm none |
| Excessive permissions | **Addressed** | All permissions are justified above |

---

## Post-Submission Checklist

- [ ] ZIP file uploaded with `manifest.json` at root
- [ ] Store name, summary, and description filled in
- [ ] At least 1 screenshot uploaded (1280×800 or 640×400)
- [ ] Privacy policy URL added
- [ ] Permission justifications written for all permissions
- [ ] Single purpose statement filled in
- [ ] Developer account registration fee paid ($5 one-time)
- [ ] Submitted for review

---

## Updating the Extension (Future Versions)

1. Increment the `version` field in `manifest.json` (e.g., `1.0.1` → `1.0.2`)
2. Repackage the ZIP
3. In the developer console, click **"Upload new package"** on the existing listing
4. Add a changelog in the "What's new" field
5. Submit for review — updates typically review faster than new submissions

---

## Support & Resources

- Chrome Web Store Developer Console: [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
- Chrome Extension Documentation: [developer.chrome.com/docs/extensions](https://developer.chrome.com/docs/extensions)
- Manifest V3 Migration Guide: [developer.chrome.com/docs/extensions/migrating](https://developer.chrome.com/docs/extensions/migrating)
- Chrome Web Store Review Policies: [developer.chrome.com/docs/webstore/program-policies](https://developer.chrome.com/docs/webstore/program-policies)
