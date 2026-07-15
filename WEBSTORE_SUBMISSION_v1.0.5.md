# Clone2GHL — Chrome Web Store Submission (v1.0.5)

## The file to upload
**`extension/dist/clone2ghl-chrome.zip`** (version **1.0.5**)
- This is an **update** to the already-published item (extension ID `mjphmimkcjjhaejnlpcpekeekjmjfajk`).
- It points at the production backend `https://api.clone2ghl.com`.
- **No new permissions** vs v1.0.4 — so no permission/privacy answers need to change (faster review).
  - We actually **removed one unused** host permission (`https://rest.gohighlevel.com/*`, never called in code). Removing a permission is reviewer-friendly and never slows review; no privacy answers change.

## Build/packaging fixes applied in this build (2026-06-20)
- **Fixed a packaging blocker:** the prior zip stored paths with Windows backslashes (`_locales\en\messages.json`), which violates the ZIP spec and can make Chrome reject the package ("Could not load locale 'en'"). The build now produces spec-compliant forward-slash paths. Verified: **0 backslash paths** in the final zip.
- Removed the unused `rest.gohighlevel.com` host permission.
- Dropped two non-shipping dev/unused files from the package (`icons/make_icons.html`, `icons/logo-square.png`).
- Billing **invoices** view now shows the empty state (not a red error) under the GHL-only payment model.
- Rebuild command: `cd extension && C2G_API_BASE=https://api.clone2ghl.com node build.mjs`

## How to submit (≈3 minutes)
1. Go to the **Chrome Web Store Developer Dashboard** → open **Clone2GHL – Funnel Intelligence Platform**.
2. **Package → Upload new package** → choose `clone2ghl-chrome.zip` (it must be **v1.0.5**; 1.0.4 will be rejected as "same version").
3. **Store listing / Privacy** — nothing to change (same permissions and data use as the approved 1.0.4). Leave screenshots/policy as they are.
4. Paste the **"What's new"** text below (optional but recommended).
5. **Submit for review.** Reviews typically take 1–3 business days. The live backend already supports everything, so it works the moment Google approves.

## "What's new" (paste-ready)
```
v1.0.5 — Much easier onboarding & activation
• New one-step Welcome screen: activate your plan with just your email + code (and set a password to sign in anytime).
• Guided "Getting Started" checklist that walks you from sign-in → connect GoHighLevel → first clone.
• Built-in Help & Guide with quick-start, FAQs, and troubleshooting.
• Clearer plan & status at a glance, per-plan upgrade buttons, and a friendlier push-to-GoHighLevel experience.
```

## After approval
Nothing further to deploy — backend, payments, activation emails, and the website are already live. Do one real test purchase per plan to confirm the end-to-end flow, then announce.

## What this version delivers (summary)
- **Frictionless activation:** pay on clone2ghl.com → get an emailed code → open the extension → a Welcome modal is right there → enter email + code + password → plan active. Future logins are just email + password.
- **Guided onboarding** so new users reach their first clone fast.
- **In-extension guide** so users self-serve answers.
- All backend hardening, invoicing, per-plan checkout, and GHL workflows are already live in production.
