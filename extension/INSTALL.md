# Clone2GHL — Installation & Setup Guide

## Quick Start (5 minutes)

### Step 1: Generate Icons

1. Open `icons/make_icons.html` in your browser (double-click the file)
2. Click **"Generate & Download All Icons"**
3. Move the 3 downloaded files into the `icons/` folder:
   - `icon16.png`
   - `icon48.png`  
   - `icon128.png`

### Step 2: Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `extension/` folder (the one containing `manifest.json`)
5. The Clone2GHL extension should appear with the ⚡ purple icon

### Step 3: Configure API Keys

Click the extension icon → **Settings** tab, or open the Dashboard.

**GoHighLevel API Key (Required for export):**
1. Log into GoHighLevel
2. Click **Settings** (gear icon, bottom-left of the main sidebar)
3. In the Settings left sidebar, scroll down and click **"Private Integrations"**
   - If you don't see it, look for **"API"** or check under **"Developer"**
4. Click **"+ New Integration"**, give it a name (e.g. "Clone2GHL"), select all scopes or at minimum **Funnels**, then click Create
5. Copy the **Access Token** and paste it into the "GHL API Key" field in the extension Settings

**Location ID:**
1. Still in Settings, click **"Business Profile"** (top of left sidebar)
2. Scroll to the bottom of the page — the **Location ID** is shown there (a long alphanumeric string)
3. Copy and paste it into the "Location ID" field in the extension Settings

> **Note:** The "Integrations" page you may see (Google, Facebook, TikTok, etc.) is for third-party app connections — that is NOT where the API key is. You need **Private Integrations** in the Settings sidebar.

**OpenAI API Key (Required for AI features):**
1. Go to [platform.openai.com](https://platform.openai.com/api-keys)
2. Create a new API key
3. Paste it into the "OpenAI API Key" field in Settings
4. Note: Requires a paid OpenAI account with billing enabled

### Step 4: Run Lean Backend (Auth + Usage + Billing)

If you want cloud auth, usage metering, and Stripe billing foundation, run the backend service:

1. Open a terminal in `backend/`
2. Copy `.env.example` to `.env` and set at least `JWT_SECRET`
   - For Video Generation (HeyGen provider), also set: `HEYGEN_API_KEY`
   - For AI video script generation, set: `OPENAI_API_KEY`
   - For OpenAI prompt-to-video generation, set: `OPENAI_API_KEY` and optionally `OPENAI_VIDEO_MODEL=sora-2-pro`
3. Install dependencies:
   - `npm install`
4. Start server:
   - `npm run dev`

Default API base URL: `http://localhost:8080`

### Step 5: Connect Extension to Backend

1. Open Dashboard → Settings → Cloud Backend
2. Set Backend API Base URL (local dev: `http://localhost:8080`)
3. Register or Sign In with email/password
4. Click **Refresh Usage** to pull plan limits from backend
5. (Optional) Click **Sync Funnels** to upload local funnels to backend
6. Use **Upgrade to Pro** or **Upgrade to Agency** to open Stripe checkout when Stripe keys are configured

---

## How to Use

### Clone a Webpage
1. Navigate to any landing page or sales funnel
2. Click the ⚡ **Clone to GHL** button (bottom-right of every page)
3. Select your niche and toggle AI Optimize if desired
4. Click **"Clone This Page"**
5. Funnel saves to your Dashboard automatically

### Export to GoHighLevel
1. Open the Dashboard → **My Funnels**
2. Click on any funnel → **"→ Push to GHL"**
3. A new Funnel + Page will be created in your GHL account
4. Click the link to open it in GHL's page builder

### Use the Funnel Library
1. Dashboard → **Funnel Library**
2. Filter by niche, type, or performance
3. Click **"Clone + Customize"** to save it to My Funnels
4. Then push to GHL or run AI optimization

### AI Copy Optimizer
1. Dashboard → **AI Tools**
2. Select a funnel + niche + optional business name
3. Click **"Optimize Copy"**
4. GPT-4o rewrites all headlines, CTAs, and copy for your niche

### AI Video Generator
1. Dashboard → **AI Tools**
2. Write a prompt describing the video you want for a website hero, funnel, ad, or promo
3. Choose duration and format
4. Click **"Generate Video"**
5. The job is queued with OpenAI Sora 2 Pro by default and appears in **Video Generation** when ready

### Funnel Intelligence
1. After cloning a page, view it in **My Funnels**
2. Each funnel gets a score (0-100) with letter grade
3. Click **View** → See full analysis: headline types, CTA quality, trust signals, recommendations

### Logo Generator
1. Dashboard → **Logo Generator**
2. Enter business name + industry
3. Click **"Generate Logo"** — `gpt-image-1` creates a professional logo (with automatic fallback to DALL-E 3)
4. Download the PNG and insert it into your funnel

### Video Generation
1. Dashboard → **Video Generation**
2. Enter a short script or prompt and choose avatar/voice/template
3. Click **"Generate Video"** to queue a backend job
4. Track status in the jobs table and open the preview URL when completed
5. For avatar-style production mode, configure `HEYGEN_API_KEY` in backend `.env`
6. For OpenAI Sora videos, configure `OPENAI_API_KEY` and use provider **OpenAI Sora 2 Pro**

### Ad Intelligence
1. Dashboard → **Ad Intelligence**
2. Type a niche (e.g., "plumber", "solar panels")
3. Click your preferred platform (Facebook, Google, TikTok)
4. Browse competitor ads → visit their landing pages → use Clone2GHL to clone them

---

## Chrome Web Store Submission

### Requirements Checklist
- [ ] Icons generated: `icon16.png`, `icon48.png`, `icon128.png` in `icons/`
- [ ] Extension loads without errors in Chrome
- [ ] All features work with your API keys
- [ ] Review the [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/)
- [ ] Create a 1280x800 or 640x400 promotional screenshot
- [ ] Write a short description (132 chars max)
- [ ] Write a detailed description

### Suggested Store Listing

**Name:** Clone2GHL – Funnel Intelligence Platform

**Short Description (132 chars):**
Clone any webpage, analyze funnel intelligence, optimize with AI, and launch directly into GoHighLevel.

**Detailed Description:**
Clone2GHL is the ultimate tool for GoHighLevel users and marketing agencies. Transform any website into a GHL-ready funnel in minutes.

**Features:**
⚡ One-click page cloning — capture any website's structure, layout, and copy
🧠 Funnel Intelligence Engine — understand WHY a funnel converts with AI scoring
🤖 AI Copy Optimizer — GPT-4o rewrites headlines and CTAs for any niche
📚 Funnel Library — 15+ battle-tested templates across local service niches
🔍 Ad Intelligence — discover what's working on Facebook, Google, and TikTok
🎨 AI Logo Generator — DALL-E 3 creates branded logos instantly
🎬 Video Generation — GPT-written scripts and HeyGen avatar rendering
→ Direct GHL Export — push funnels directly to your GoHighLevel account

**Perfect for:**
- GoHighLevel agencies building funnels for clients
- Marketing consultants who need funnels fast
- Local service business owners (plumber, HVAC, roofing, dental, etc.)
- Anyone who wants to learn from winning funnels

**Privacy:** Your API keys are stored locally in Chrome storage and never transmitted to our servers. All page processing happens locally.

**Security note:** API keys are encrypted at rest inside extension storage. They are decrypted only during runtime API calls.
If a local machine profile is fully compromised, no client-only extension can provide absolute secret protection without a remote key service.

### Categories
- **Primary:** Productivity
- **Secondary:** Developer Tools

### Permissions Justification (required in submission)
- `activeTab` — To access the current page for cloning
- `storage` — To save funnels and settings locally
- `scripting` — To inject the clone button and extract page structure
- `tabs` — To open the dashboard and get current tab URL
- `notifications` — To notify when clone/export is complete

---

## Pricing Implementation (Future)

The current codebase has a free/starter/pro/agency plan structure in storage. To implement real billing:

1. Set up a backend (Cloudflare Workers recommended for $0 budget)
2. Integrate Stripe for subscription management
3. Issue plan tokens that the extension validates against your backend
4. Update `plan` and `credits` in chrome.storage based on Stripe subscription status

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Extension | Chrome Manifest V3, Vanilla JS |
| AI Optimization | OpenAI GPT-4o |
| Video Script Generation | OpenAI GPT-4.1 |
| Video Rendering | OpenAI Sora 2 Pro (with HeyGen and mock fallback) |
| Logo Generation | OpenAI gpt-image-1 (fallback: DALL-E 3) |
| Funnel Export | GoHighLevel API v2 |
| Storage | chrome.storage.local |
| Styling | Custom CSS (no framework) |

---

## Support & Troubleshooting

**Extension won't load:** Make sure you selected the `extension/` folder (not the root repo folder) in "Load unpacked".

**Clone button doesn't appear:** The page may have blocked content scripts. Try refreshing the page. Some pages with strict CSP headers may block injection.

**GHL export fails:** Verify your Private Integration Token is active and your Location ID is correct. The token must have Funnels permissions enabled.

**AI features not working:** Ensure your OpenAI API key has billing enabled and sufficient credits. GPT-4o/GPT-4.1/gpt-image-1 require a paid account.

**Logo download link doesn't work:** Provider URLs can expire. Save the image immediately after generation.

**Video generation stuck in queued:** Verify backend `.env` has the correct provider key and restart backend. Use `HEYGEN_API_KEY` for avatar videos or `OPENAI_API_KEY` for Sora videos. For local testing without either provider, use `mock`.