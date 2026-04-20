# Chrome Web Store Submission Checklist

**Extension Name:** Clone2GHL – Funnel Intelligence Platform  
**Version:** 1.0.1  
**Submission Date:** [To be filled by user]  
**Status:** [In Progress / Submitted / Approved]

---

## Pre-Submission Checklist

### ✅ Step 1: Extension Package

- [ ] ZIP file created: `Clone2GHL_v1.0.1.zip`
- [ ] Location: Root of project folder (parent of `/extension`)
- [ ] Size: Verified reasonable size (≤200MB)
- [ ] Contents verified: manifest.json at root (not nested in extension/ folder)
- [ ] All required files present:
  - [ ] manifest.json
  - [ ] popup.html, popup.js, popup.css
  - [ ] dashboard.html, dashboard.js, dashboard.css
  - [ ] background.js
  - [ ] contentScript.js
  - [ ] All JS modules (domExtractor, funnelAnalyzer, aiOptimizer, ghlConverter, etc.)
  - [ ] icons/ folder with 16x16, 48x48, 128x128 PNG files
  - [ ] data/ folder with funnelLibrary.json

**Command to verify ZIP contents:**
```bash
# On Windows PowerShell:
Expand-Archive -Path Clone2GHL_v1.0.1.zip -DestinationPath ./verify
Get-ChildItem ./verify | head -20  # Should show manifest.json, popup.html, etc.
```

---

### ✅ Step 2: Store Listing Copy

- [ ] **Name (required):** "Clone2GHL – Funnel Intelligence Platform"
- [ ] **Summary (132 chars max):** "Clone any webpage, analyze funnels with AI, and launch directly into GoHighLevel in minutes."
  - Character count: ✅ Under 132 chars
- [ ] **Full Description (provided below):**
  ```
  Clone2GHL is the #1 tool for GoHighLevel agencies and funnel builders.

  ✅ ONE-CLICK PAGE CLONING — Capture any webpage's design, copy, and layout
  ✅ GHL DIRECT PUSH — Send cloned funnels straight into your GHL account via API
  ✅ AI COPY OPTIMIZER — GPT-4o rewrites headlines and CTAs for 15 niches
  ✅ FUNNEL INTELLIGENCE — Get a 0-100 conversion score with actionable insights
  ✅ LOGO GENERATOR — Create professional logos with DALL-E 3
  ✅ FUNNEL LIBRARY — 15+ high-converting templates ready to clone
  ✅ VIDEO GENERATION — AI-powered promo videos via HeyGen & OpenAI
  ✅ AD INTELLIGENCE — Research competitor ads on Facebook, Google & TikTok

  Perfect for: GoHighLevel agencies, funnel builders, marketers, and coaches.
  ```
- [ ] **Category:** Productivity
- [ ] **Language:** English

---

### ✅ Step 3: Screenshots (Required, Most Important for Conversion)

**Minimum Required:** 1 new screenshot (to demonstrate the extension after cloning)
**Recommended:** 5 screenshots (for best conversion rates)

**File Format & Sizes:**
- Primary size: **1280×800 px** ✅
- Alternative: 640×400 px (smaller version)
- Format: PNG, JPG, or GIF
- Max size per image: 10MB
- Total images: 1–5 screenshots, min 1 required

**Screenshots to Capture (in this order):**

#### Screenshot 1: My Funnels Tab
- **What to show:**
  - Dashboard with "My Funnels" tab active
  - Grid of cloned funnel cards with 3-4 sample funnels
  - URL input field and "Clone Page" button
  - Plan badge (FREE/PRO/AGENCY) in sidebar
  - Sample funnel cards showing thumbnail, name, date
- **Why:** Shows core cloning feature and funnel management
- **Recommended dimensions:** 1280×800 px
- **File name:** `screenshot_1_my_funnels.png`

#### Screenshot 2: Live Clone in Progress
- **What to show:**
  - A webpage being cloned (before/after view)
  - Dashboard showing a newly cloned funnel being edited
  - HTML editor or visual preview of cloned content
  - Evidence of cloning capability
- **Why:** Shows the "magic" of Clone2GHL—live cloning feature
- **Recommended dimensions:** 1280×800 px
- **File name:** `screenshot_2_live_clone.png`

#### Screenshot 3: AI Tools Tab
- **What to show:**
  - "AI Tools" tab with sub-options visible:
    - Copy Optimizer (GPT-4o)
    - Logo Generator (DALL-E)
    - Video Generation (HeyGen)
  - A sample optimization result or generated logo/image
  - Demonstrates AI capabilities
- **Why:** Highlights AI copy optimization and creative generation
- **Recommended dimensions:** 1280×800 px
- **File name:** `screenshot_3_ai_tools.png`

#### Screenshot 4: Funnel Intelligence Score
- **What to show:**
  - Funnel analysis results with a conversion score (0-100)
  - Insights and recommendations displayed
  - Niche context and analysis details
- **Why:** Shows unique feature (funnel intelligence analysis)
- **Recommended dimensions:** 1280×800 px
- **File name:** `screenshot_4_funnel_intelligence.png`

#### Screenshot 5: Export to GoHighLevel
- **What to show:**
  - Export modal or confirmation screen
  - Funnel name, GHL location selection, form validation
  - "Push to GHL" button
  - Success notification (if possible)
- **Why:** Shows GoHighLevel integration and export capability
- **Recommended dimensions:** 1280×800 px
- **File name:** `screenshot_5_export_ghl.png`

**Optional (for better conversion):**
- Small promo tile: 440×280 px
- Large promo image: 920×680 px
- Marquee promo: 1400×560 px (if applying for Chrome Web Store featuring)

---

### ✅ Step 4: Privacy Policy

- [ ] **Privacy Policy created:** `PRIVACY_POLICY.md`
- [ ] **Privacy Policy hosted:** [URL where it's publicly accessible]
  - Option A: GitHub Pages
  - Option B: External hosting (privacychecklist.com, etc.)
  - **URL to add in submission:** `________________________`
- [ ] **Policy covers:**
  - [ ] What data is collected
  - [ ] How data is stored (local browser storage)
  - [ ] What data is shared externally (OpenAI, GHL, HeyGen)
  - [ ] User rights (deletion, GDPR, CCPA)
  - [ ] Security measures
  - [ ] Contact information
  - [ ] No data selling clause

---

### ✅ Step 5: Permission Justifications

- [ ] **Document created:** `/extension/PERMISSIONS_JUSTIFICATION.md`
- [ ] **Contains justification for each permission:**
  - [ ] activeTab
  - [ ] scripting
  - [ ] storage
  - [ ] tabs
  - [ ] notifications
  - [ ] <all_urls>
  - [ ] https://services.leadconnectorhq.com/*
  - [ ] https://rest.gohighlevel.com/*
  - [ ] https://api.openai.com/*

**For Web Store Submission Form:**
Use the detailed justifications from the document when Google asks "Why does your extension need this permission?"

Example format they'll ask for:
```
Permission: <all_urls>
Justification: [Paste detailed explanation from PERMISSIONS_JUSTIFICATION.md]
```

---

### ✅ Step 6: Manifest Verification

**Security & Compliance Audit:**

- [ ] **Content Security Policy is restrictive:**
  - [ ] manifest.json has: `"script-src 'self'; object-src 'self'"`
  - [ ] No use of `unsafe-inline`, `unsafe-eval`, or remote script execution
  - [ ] Test: No errors in Chrome DevTools when using extension

- [ ] **No remote code execution:**
  - [ ] `grep "eval(" extension/*.js` returns nothing (no eval usage)
  - [ ] `grep "innerHTML" extension/*.js` only used for safe content
  - [ ] No dynamic script loading from external sources

- [ ] **Permissions are necessary:**
  - [ ] No permission is unused (each one is justified)
  - [ ] No request for excessive permissions

- [ ] **Icons are included:**
  - [ ] 16×16 px icon exists
  - [ ] 48×48 px icon exists
  - [ ] 128×128 px icon exists

---

### ✅ Step 7: Code Quality Check

- [ ] **JavaScript linting:** No critical errors
  ```bash
  # Optional: Run ESLint if configured
  npm run lint  # or similar
  ```

- [ ] **No console errors when using extension:**
  - [ ] Open Developer Tools (F12)
  - [ ] Look at Console tab while using Clone2GHL
  - [ ] No red error messages
  - [ ] Any warnings are non-critical

- [ ] **No malicious patterns:**
  - [ ] No keylogging
  - [ ] No hidden network requests
  - [ ] No data exfiltration
  - [ ] No cryptocurrency miners
  - [ ] No adware/spyware

---

### ✅ Step 8: Functional Testing

- [ ] **Basic features work:**
  - [ ] Extension installs without errors
  - [ ] Popup opens and shows correctly
  - [ ] Dashboard opens in new tab
  - [ ] Niche selection works
  - [ ] Clone button is accessible

- [ ] **Permissions work as expected:**
  - [ ] Can read current page (activeTab)
  - [ ] Can inject content script (scripting)
  - [ ] Can store data locally (storage)
  - [ ] Can open new tabs (tabs)
  - [ ] Can show notifications (notifications)

- [ ] **No crashing or bugs:**
  - [ ] Navigate between tabs — no crashes
  - [ ] Clone a page — no errors
  - [ ] Test on different websites — works consistently

---

## Submission Form Notes

### Developer Registration
- [ ] Chrome Web Store developer account created
- [ ] One-time $5 fee paid
- [ ] Developer Agreement accepted
- [ ] Email verified

### Submission Process

**Step 1: Go to Chrome Web Store Developer Console**
URL: `https://chrome.google.com/webstore/devconsole`

**Step 2: Click "+ New Item"**

**Step 3: Upload Your ZIP**
- Upload: `Clone2GHL_v1.0.1.zip`

**Step 4: Fill Out Store Listing**

| Field | Value | Status |
|-------|-------|--------|
| Name | Clone2GHL – Funnel Intelligence Platform | [ ] |
| Summary | Clone any webpage, analyze funnels with AI, and launch directly into GoHighLevel in minutes. | [ ] |
| Description | [Full description from Step 2] | [ ] |
| Category | Productivity | [ ] |
| Language | English | [ ] |
| Privacy Policy URL | [Your hosted privacy policy URL] | [ ] |

**Step 5: Upload Screenshots**
- [ ] Screenshot 1: My Funnels (1280×800)
- [ ] Screenshot 2: Live Clone (1280×800)
- [ ] Screenshot 3: AI Tools (1280×800)
- [ ] Screenshot 4: Funnel Intelligence (1280×800)
- [ ] Screenshot 5: Export to GHL (1280×800)

**Step 6: Justify Permissions**

Google will ask you to justify each permission. Copy/paste from your `PERMISSIONS_JUSTIFICATION.md` document:

```
Permission: activeTab
Justification: [From doc]

Permission: scripting
Justification: [From doc]

... (continue for all permissions)
```

---

## Submission & Review Timeline

- **Time to Review:** 1–3 business days (sometimes up to 7)
- **Notification:** You'll receive an email when approved or if changes needed
- **If Rejected:** Common reasons and fixes are listed below

---

## Common Rejection Reasons (Avoid These!)

### ❌ Reason 1: "<all_urls> without justification"
**How to avoid:**
- Provide detailed, specific justification for `<all_urls>`
- Explain that the domain is unknown at install time because users choose what to clone
- Clarify that you only read DOM, don't transmit without user action

### ❌ Reason 2: "Missing or invalid privacy policy URL"
**How to avoid:**
- Host your privacy policy publicly before submission
- Include the full URL (e.g., `https://yoursite.com/privacy`)
- Ensure URL is accessible (test in incognito window)

### ❌ Reason 3: "Misleading screenshots"
**How to avoid:**
- Screenshots must match actual extension UI
- Show real, unmodified interface
- Don't doctor images or exaggerate features
- Ensure text is readable

### ❌ Reason 4: "Inline scripts or unsafe CSP"
**How to avoid:**
- Your CSP is already good (`script-src 'self'`)
- No eval() usage
- No dynamic script loading

### ❌ Reason 5: "Remote code execution detected"
**How to avoid:**
- You don't load remote JS (already compliant)
- All code bundled locally
- External calls only to known APIs (OpenAI, GHL, HeyGen)

### ❌ Reason 6: "Deceptive practices"
**How to avoid:**
- Be transparent about what the extension does
- Explain API key requirements upfront
- Mention that some features require external API keys (and charges)

---

## Post-Approval Checklist

Once your extension is **approved and live:**

- [ ] Test installation from Chrome Web Store
- [ ] Verify store listing appears correctly
- [ ] Check that screenshots display properly
- [ ] Confirm extension installs smoothly for new users
- [ ] Monitor reviews and ratings (respond to feedback)
- [ ] Prepare update strategy for future versions
- [ ] Document changelog for version 1.0.2, 1.1, etc.

---

## Documentation Files Checklist

**Files created for submission:**

| File | Purpose | Path | Status |
|------|---------|------|--------|
| Clone2GHL_v1.0.1.zip | Extension package | Root folder | ✅ |
| PRIVACY_POLICY.md | Privacy policy document | `/Clone2GHL_CE/` | ✅ |
| PERMISSIONS_JUSTIFICATION.md | Permission explanations | `/extension/` | ✅ |
| USER_GUIDE.md | Comprehensive user guide (Markdown) | `/Clone2GHL_CE/` | ✅ |
| USER_GUIDE.html | User guide (HTML) | `/Clone2GHL_CE/` | ✅ |
| USER_GUIDE.pdf | User guide (PDF) | `/Clone2GHL_CE/` | 🔄 |
| WEBSTORE_SUBMISSION_CHECKLIST.md | This file | `/Clone2GHL_CE/` | ✅ |
| Screenshots (5x) | Store listing images | `/extension/assets/screenshots/` | 🔄 |

---

## Final Pre-Submission Review

**BEFORE clicking "Submit for Review":**

- [ ] I've read the entire [Google Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/)
- [ ] My extension complies with all policies
- [ ] My manifest.json is valid (no errors)
- [ ] My privacy policy is publicly accessible and complete
- [ ] I've provided detailed permission justifications
- [ ] All screenshots are professional and accurate
- [ ] My extension has been tested and works correctly
- [ ] I've checked for CSP violations, eval(), and remote code
- [ ] I'm ready to support users (support email is monitored)

---

## Sign-Off

**Submitter:** ________________________  
**Date:** ________________________  
**Status:** ☐ Ready to Submit | ☐ Submitted | ☐ Approved

**Notes:**
```
[Space for any additional notes or concerns]
```

---

**Version:** 1.0  
**Last Updated:** April 16, 2026  
**Next Review:** After submission feedback received
