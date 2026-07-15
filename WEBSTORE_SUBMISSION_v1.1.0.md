# Clone2GHL — Chrome Web Store Submission (v1.1.0)

## The file to upload
**`Clone2GHL_v1.1.0_chrome.zip`** (repo root — identical copy of `extension/dist/clone2ghl-chrome.zip`, version **1.1.0**)
- This is an **update** to the already-published item (extension ID `mjphmimkcjjhaejnlpcpekeekjmjfajk`).
- It points at the production backend `https://api.clone2ghl.com` (already live and serving the v1.1.0 API — verified via `GET /health`, all green).
- **No new permissions** vs the approved version — `activeTab, storage, scripting, tabs, alarms` and the same 6 host permissions. No permission/privacy answers need to change (faster review).
- Package verified: 53 entries, **0 backslash paths** (ZIP-spec compliant), `_locales/en/messages.json` present.

Also built: **`Clone2GHL_v1.1.0_firefox.zip`** for Firefox Add-ons (AMO), if/when you publish there.

## How to submit (≈3 minutes)
1. Go to the **Chrome Web Store Developer Dashboard** → open **Clone2GHL – Funnel Intelligence Platform**.
2. **Package → Upload new package** → choose `Clone2GHL_v1.1.0_chrome.zip`.
3. **Store listing / Privacy** — nothing to change (same permissions and data use as the approved version).
4. Paste the **"What's new"** text below.
5. **Submit for review.** Reviews typically take 1–3 business days. The live backend already supports everything, so it works the moment Google approves.

## "What's new" (paste-ready)
```
v1.1.0 — Full visual customizer before you push to GoHighLevel
• NEW Element editor: click anything on your cloned page to edit it — text, images,
  buttons, links, colors, spacing, borders — or double-click to type directly on the page.
• Add, move, duplicate and delete sections with a floating toolbar; insert headings,
  buttons, images, spacers, columns or custom HTML anywhere.
• Real undo/redo (Ctrl+Z / Ctrl+Y) and automatic draft recovery — closing the tab
  no longer loses your edits.
• Edit EVERY page of a multi-page clone before pushing: new "Edit pages" button with
  a page switcher; your edits arrive in GoHighLevel exactly as you styled them.
• Smarter copyright cleanup: automatically removes the source site's © notices and
  trademark symbols — without ever damaging your own text — plus a one-click
  "Fix All" review panel for logos and brand mentions.
• Faster, more reliable saving and pushing, with clear messages if storage runs low.
```

## What this version delivers (summary)
- **A complete pre-push customizing environment**: clone any website → convert to GHL-compatible pages → visually edit everything (single page or the whole multi-page set) → push natively into the GHL builder.
- **Trustworthy copyright removal**: one shared engine (in-editor + server pipeline) with bounded removal — catches notices split across tags, never deletes adjacent legitimate content (covered by automated tests).
- **Editing reliability**: snapshot undo/redo, autosave drafts with restore-on-reopen, save-before-push enforcement, and transparent storage-quota handling.
- Backend v1.1.0 is **already deployed** on production (Fly.io `clone2ghl-api`, custom domain `api.clone2ghl.com`) with the multi-page import pipeline live and a machine kept warm (no more cold-start timeouts).

## Review-safety notes (if a reviewer asks)
- No remote code: all scripts ship in the package; the dashboard editor injects only a `<style>` tag into its own sandboxed preview iframe (no inline scripts — CSP `script-src 'self'` is respected).
- User data handling unchanged from the approved version.

## After approval
Do one real end-to-end run: clone a multi-page site → "Edit pages" → customize → push into a test GHL sub-account → confirm the edited content landed. Then announce.

## Rebuild command (for future updates)
`cd extension && C2G_API_BASE=https://api.clone2ghl.com node build.mjs`
