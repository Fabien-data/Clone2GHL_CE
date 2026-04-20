# Clone2GHL User Guide
## Complete Setup & Usage Manual (v1.0.1)

**Last Updated:** April 16, 2026  
**Version:** 1.0.1  
**Status:** Production Ready

---

## Table of Contents

1. [Quick Start (3 Minutes)](#quick-start)
2. [Installation & Initial Setup](#installation--initial-setup)
3. [For Administrators](#for-administrators)
4. [For End Users](#for-end-users)
5. [Feature Guide: Dashboard Tabs](#feature-guide-dashboard-tabs)
6. [Step-by-Step Workflows](#step-by-step-workflows)
7. [Tips & Best Practices](#tips--best-practices)
8. [FAQ & Common Questions](#faq--common-questions)
9. [Troubleshooting](#troubleshooting)
10. [Glossary](#glossary)
11. [Support & Contact](#support--contact)

---

## Quick Start

**First time? Follow this 3-minute setup:**

### For End Users (Chrome Web Store Version)
1. Go to Chrome Web Store and search for **Clone2GHL**
2. Click **"Add to Chrome"** → Confirm
3. Click the Clone2GHL icon in your Chrome toolbar
4. Select your industry/niche from the dropdown
5. Visit any website and click the **"Clone to GHL"** button (if visible), OR
6. Click **Dashboard** → **My Funnels** → Paste a URL → Click **Clone**
7. Once cloned, edit in the dashboard and **Export to GHL**

### For Administrators (Self-Hosted Backend)
1. Clone repository: `git clone [repo-url]`
2. Backend setup: See [Backend Setup](#backend-setup) section
3. Extension setup: See [Extension Setup](#extension-setup-dev-mode) section
4. Start backend: `npm start` in `/backend` folder
5. Load extension in Chrome DevTools
6. Set backend API URL in Settings (e.g., `http://localhost:8080`)

---

## Installation & Initial Setup

### A. Install from Chrome Web Store (Recommended for End Users)

**Steps:**
1. Open Google Chrome
2. Go to **chrome.google.com/webstore**
3. Search for: **"Clone2GHL"**
4. Click the Clone2GHL extension card
5. Click **"Add to Chrome"**
6. In the popup, click **"Add extension"**
7. The extension icon will appear in your Chrome toolbar (top-right)

**Pin the Extension (Optional):**
- Click the puzzle icon in Chrome toolbar
- Find Clone2GHL and click the pin icon to make it always visible

### B. Initial Configuration (First Time)

**Step 1: Open the Extension**
- Click the Clone2GHL icon in your toolbar
- A popup will appear with niche selection

**Step 2: Select Your Industry**
- Choose from 15+ options: Plumber, Electrician, HVAC, Roofing, Dentist, Coach, Agency Owner, E-commerce, SaaS, etc.
- This helps AI tools optimize copy for your niche
- You can change this anytime

**Step 3: Open the Dashboard**
- Click **"Dashboard"** in the popup OR
- Click the extension icon and select **Dashboard** tab
- The full Clone2GHL dashboard opens in a new tab

**Step 4: Configure API Keys (Optional for Basic Cloning)**
- Go to **Settings** tab
- Paste your OpenAI API key (for AI optimization and logo generation)
- Paste your GoHighLevel API key (for direct funnel export)
- Paste your HeyGen API key (for video generation, if needed)
- Click **Save**

**Note:** API keys are stored locally and encrypted. They are never sent to our servers.

---

## For Administrators

This section is for anyone self-hosting or deploying Clone2GHL with a backend server.

### Backend Setup

**Prerequisites:**
- Node.js v16 or higher
- npm (comes with Node.js)
- Git (to clone the repository)
- External API keys (OpenAI, GoHighLevel, HeyGen — required for those features)

**Step 1: Clone the Repository**

```bash
git clone https://github.com/[your-repo]/Clone2GHL_CE.git
cd Clone2GHL_CE/backend
```

**Step 2: Install Dependencies**

```bash
npm install
```

**Step 3: Configure Environment Variables**

Create a `.env` file in the `/backend` folder with:

```
# Server
PORT=8080
NODE_ENV=production

# Security
JWT_SECRET=your_super_secret_key_here (generate a random 32+ char string)

# OpenAI
OPENAI_API_KEY=sk-xxxxx (your OpenAI API key)

# HeyGen (optional, for video generation)
HEYGEN_API_KEY=xxxxx (your HeyGen API key)

# GoHighLevel (optional, managed per-user via extension settings)
# Users provide their own GHL API keys in extension Settings
```

**Step 4: Start the Backend Server**

```bash
npm start
```

**Expected Output:**
```
Server running on http://localhost:8080
Connected to database: [path/to/db.json]
```

**Step 5: Verify Backend is Running**

```bash
# In another terminal:
curl http://localhost:8080/health
# Should return: {"status": "ok"}
```

### Extension Setup (Developer Mode)

**Prerequisites:**
- Chrome browser
- Extension ZIP or source files
- Backend server running (see above)

**Step 1: Open Chrome Extensions Manager**
- Open Chrome
- Go to: **chrome://extensions**
- Toggle **"Developer mode"** (top-right, switch to ON)

**Step 2: Load Unpacked Extension**
- Click **"Load unpacked"**
- Navigate to: `Clone2GHL_CE/extension` folder
- Click **"Select Folder"**
- Clone2GHL should now appear in your extensions list

**Step 3: Configure Backend URL**
- Click the Clone2GHL extension icon
- Click **Dashboard**
- Go to **Settings** tab
- Under "Backend API URL," enter: `http://localhost:8080`
- Click **Save**

**Step 4: Test the Connection**
- In Dashboard, go to **AI Tools** tab
- Try "Optimize Copy" on a sample text
- If it works, backend is connected ✅

### API Keys Configuration

**OpenAI Setup:**
1. Go to [platform.openai.com](https://platform.openai.com/account/api-keys)
2. Sign in or create an account
3. Click **"Create new secret key"**
4. Copy the key (starts with `sk-`)
5. Add to backend `.env` file as `OPENAI_API_KEY=sk-xxxxx`

**GoHighLevel Setup:**
1. Log into your GHL account
2. Go to **Settings** → **Integrations** → **Private Integrations**
3. Create a new private integration app
4. Follow the OAuth flow
5. Copy your API key
6. Users paste this into extension **Settings** → **GoHighLevel API Key**

**HeyGen Setup (for video generation):**
1. Go to [heygen.com](https://heygen.com) and sign up
2. Go to **Account Settings** → **API Key**
3. Copy your API key
4. Add to backend `.env` as `HEYGEN_API_KEY=xxxxx`
5. Or users add directly in extension Settings

### Database Setup

Clone2GHL uses a local JSON database (`data/db.json`) to store:
- Cloned funnel templates
- Analytics data
- User activity logs

**Database Location:** `/backend/data/db.json`

**Default Schema:**
```json
{
  "funnels": [],
  "templates": [],
  "analytics": [],
  "users": []
}
```

**To Reset Database:**
```bash
rm backend/data/db.json
npm start # Will regenerate default db.json
```

### Monitoring & Logs

**View Server Logs:**
```bash
# Logs appear in terminal where you ran `npm start`
```

**Common Log Events:**
- `[INFO] Clone request from [domain]` — User cloned a page
- `[INFO] Optimization request received` — User used AI copy optimizer
- `[ERROR] OpenAI API rate limit exceeded` — Too many requests to OpenAI
- `[ERROR] Failed to push to GHL API` — Issue with GoHighLevel export

### Production Deployment

**Recommended Hosting Options:**
- **Heroku** (easiest for beginners)
- **AWS EC2** (scalable, more control)
- **DigitalOcean** (affordable, simple)
- **Vercel** (for serverless functions)
- **Your own server** (full control)

**Pre-Deployment Checklist:**
- [ ] `.env` file has all keys set (never commit `.env` to Git)
- [ ] `NODE_ENV=production` in `.env`
- [ ] JWT_SECRET is a strong, random string
- [ ] Backend passes all tests: `npm test`
- [ ] All dependencies installed: `npm install --production`
- [ ] Database backup exists

**Example: Deploy to Heroku**
```bash
# Install Heroku CLI
npm install -g heroku

# Login to Heroku
heroku login

# Create Heroku app
heroku create my-clone2ghl-app

# Set environment variables
heroku config:set OPENAI_API_KEY=sk-xxxxx
heroku config:set JWT_SECRET=your_secret

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

---

## For End Users

This section covers how to use Clone2GHL once it's installed.

### Dashboard Overview

The Clone2GHL dashboard is your control center. It has 8 main tabs (visible in the left sidebar):

| Tab | Purpose | Key Actions |
|-----|---------|-------------|
| 📁 **My Funnels** | View & manage all cloned funnels | Clone URL, edit, export to GHL, delete |
| 📚 **Funnel Library** | Browse 15+ pre-built templates | Browse by niche, clone template to My Funnels |
| 🤖 **AI Tools** | Optimize copy with GPT-4o, generate logos | Paste text, select niche, get AI suggestions |
| 🎬 **Video Generation** | Create promo videos with HeyGen | Generate script, customize duration, download |
| 🔍 **Ad Intelligence** | Research competitor ads | Search Facebook, Google, TikTok ads |
| 🎨 **Logo Generator** | Create professional logos with DALL-E | Describe logo, customize colors, download |
| 👤 **My Account** | Manage account & subscription | View plan, clone credits, upgrade options |
| ⚙️ **Settings** | Configure API keys & preferences | Add API keys, set backend URL, clear data |

### Popup Interface (Quick Access)

When you click the Clone2GHL extension icon, a small popup appears with:

**Fields:**
- **Current Page Title & URL** — Shows the page you're currently on
- **Niche Selector** — Choose your industry (Plumber, Coach, Agency, etc.)
- **"Clone This Page" Button** — Quick clone of current page

**Plan Badge:**
- Shows your current plan: FREE (limited clones), PRO, or AGENCY

---

## Feature Guide: Dashboard Tabs

### 1. 📁 My Funnels

**Purpose:** Store and manage all your cloned funnels.

**What You'll See:**
- Grid of saved funnels with thumbnail previews
- Each card shows: Funnel name, clone date, last edited date
- Search bar to find funnels by name

**Key Actions:**

**Clone a New Funnel:**
1. In the **URL Input** section, paste a website URL
2. Click **"Clone Page"**
3. Wait 5-30 seconds (depending on page complexity)
4. Once cloned, the funnel appears in the grid
5. Click on the funnel card to open the editor

**Edit a Cloned Funnel:**
1. Click on a funnel card
2. A modal opens showing the funnel preview
3. Click **"Edit in Dashboard"** 
4. Edit HTML, text, images, CSS in the editor
5. Click **"Save"** to apply changes
6. Click **"Preview"** to see live changes

**Export to GoHighLevel:**
1. Click on a funnel card
2. Click **"Export to GHL"** button
3. Choose options:
   - **Funnel Name** (auto-filled, can change)
   - **Select GHL Location** (dropdown, choose which location in GHL)
   - **Replace Form with GHL Form** (checkbox, replaces any forms with GHL forms)
4. Click **"Push to GHL"**
5. Wait for confirmation notification (usually 2-5 seconds)
6. Notification: "✅ Funnel pushed successfully to [Funnel Name]"

**Delete a Funnel:**
1. Click the **"..."** menu on a funnel card
2. Select **"Delete"**
3. Confirm deletion (you can't undo this)

**Duplicate a Funnel:**
1. Click the **"..."** menu on a funnel card
2. Select **"Duplicate"**
3. A copy is created in My Funnels

### 2. 📚 Funnel Library

**Purpose:** Browse and clone pre-built, high-converting funnel templates.

**What You'll See:**
- 15+ templates organized by category
- Each template card shows: Template name, niche, conversion rate, preview image

**Template Categories:**
- **Plumbing & HVAC** — Lead gen funnel, service pages, quote request
- **E-commerce** — Product launch, upsell, checkout
- **Coaching & Services** — Webinar signup, challenge funnel, application
- **SaaS** — Trial signup, feature comparison, upgrade flow
- **Real Estate** — Property listing, buyer lead capture
- **Dental & Medical** — Appointment booking, new patient

**Key Actions:**

**Filter Templates:**
1. Use the **Filter** dropdown to narrow by:
   - Niche (Plumber, Coach, E-commerce, etc.)
   - Conversion Rate (High > 5%, Medium 3-5%, Low < 3%)
   - Industry (Service, Product, Digital, etc.)
2. Results update in real-time

**Clone a Template:**
1. Click on a template card
2. A preview modal opens showing the full funnel
3. Read the description and review the design
4. Click **"Clone This Template"**
5. The template is added to **My Funnels**
6. Edit any text/images to match your business
7. Export to GHL when ready

**Preview Template:**
1. Click **"Preview"** on any template card
2. A full-screen view opens showing:
   - Desktop version of the funnel
   - Copy and CTA buttons
   - Form fields (if any)
3. Close the preview to see other templates

### 3. 🤖 AI Tools

**Purpose:** Optimize your marketing copy and generate graphics using AI.

**Subfeatures:**

#### A. Copy Optimizer (GPT-4o)

**Use Case:** Improve headlines, CTAs, and body copy for better conversions.

**Steps:**
1. Go to **AI Tools → Copy Optimizer**
2. Paste your text (headline, CTA, email, etc.) in the text box
3. Select your **Niche** (important for better optimization)
4. Click **"Optimize Copy"**
5. Wait 5-10 seconds for AI to generate improvements
6. View 3 variations of optimized copy
7. Click **"Copy"** to copy a variation to clipboard
8. Use in your funnel

**Niche Options:** Plumber, Electrician, HVAC, Roofing, Dentist, Coach, Agency Owner, E-commerce, SaaS, Real Estate, Digital Marketing, Coaching/Courses, Fitness, Healthcare, Legal, Accounting

**Example:**
- **Original:** "Buy now and save big"
- **Optimized (Niche: Coaching):** "Unlock exclusive lifetime access—limited spots available"

**Tips:**
- The longer your copy, the better the optimization
- Specify your angle (urgency, exclusivity, ROI, pain-point relief)
- Try multiple angles by rerunning the optimizer

#### B. Logo Generator (DALL-E 3)

**Use Case:** Create professional logos for your brand from text descriptions.

**Steps:**
1. Go to **AI Tools → Logo Generator**
2. Describe your logo: "Logo for a plumbing company with a blue wrench and water drop"
3. Choose a **Style**: Modern, Minimalist, Vintage, Professional, Playful
4. Choose **Colors**: Monochrome, Blue & Gold, Green & White, Custom RGB
5. Click **"Generate Logo"**
6. Wait 10-15 seconds for DALL-E to create the logo
7. View the generated logo
8. Like it? Click **"Download"** (saves as PNG)
9. Don't like it? Click **"Generate Again"** for new variations

**Tips:**
- Be specific: "plumbing company" beats "business"
- Include style preferences: "modern, flat design"
- Mention colors in the description for better results

**Example Prompts:**
- "Minimalist SaaS logo: blue and white, tech-forward, software company"
- "Coaching brand logo: gold and black, authoritative, personal development"

#### C. Video Generation (HeyGen)

**Use Case:** Create short promo videos from text scripts.

**Steps:**
1. Go to **AI Tools → Video Generation**
2. Enter a **Video Script** (30-120 words)
3. Choose **Avatar Style**: Professional, Casual, Animated
4. Choose **Duration**: 15s, 30s, 60s
5. Choose **Background**: Solid color, gradient, office, nature
6. Click **"Generate Video"**
7. Wait 30-60 seconds for HeyGen to create the video
8. Preview the video inline
9. Click **"Download"** to save as MP4

**Tips:**
- Keep scripts concise (HeyGen has duration limits)
- Use simple, clear language
- Include a CTA at the end ("Sign up now," "Buy today")

---

### 4. 🎬 Video Generation (HeyGen Integration)

**Purpose:** Dedicated video creation for product demos and promos.

**Features:**
- Script-to-video with AI avatars
- Multiple avatar styles (realistic, animated, professional)
- Background customization
- Auto-generated captions
- Music library integration
- Download as MP4 for use anywhere

**Workflow:**
1. Write or paste your video script
2. Select avatar and background
3. Click "Generate"
4. Review video quality
5. Download MP4 file
6. Embed in landing page or social media

---

### 5. 🔍 Ad Intelligence

**Purpose:** Research competitor ads on Facebook, Google, and TikTok.

**Use Case:** See what messaging and creatives your competitors are running.

**Workflow:**
1. Go to **Ad Intelligence**
2. Enter a **Brand Name** or **Company URL** you want to research
3. Select platform: **Facebook Ads**, **Google Ads**, **TikTok Ads**
4. Click **"Search"**
5. View competitor ads:
   - Headline and body copy
   - CTA text and button color
   - Images/videos used
   - Estimated spend and frequency
6. Analyze patterns:
   - What messaging works?
   - What visuals get engagement?
   - What CTAs convert?

**Tips:**
- Research 3-5 top competitors to spot trends
- Note headline formulas (attention → benefit → CTA)
- Analyze visuals (bright colors, faces, action scenes often perform better)
- Use insights to improve your own ads without copying

---

### 6. 🎨 Logo Generator

**Purpose:** Standalone tab for creating logos (also available in AI Tools).

**Same as AI Tools → Logo Generator** (see above).

---

### 7. 👤 My Account

**Purpose:** Manage your subscription and usage.

**What You'll See:**
- **Current Plan**: FREE, PRO, AGENCY
- **Clone Credits**: Remaining clones (e.g., "5/10 clones used this month")
- **Upgrade Button**: Link to upgrade to paid plan
- **Account Info**: Email, registration date, last login
- **Subscription Details**: When plan renews, cancellation link

**Actions:**
- **Upgrade Plan**: Click to choose PRO ($29/mo) or AGENCY ($99/mo)
- **Manage Subscription**: Billing history, payment method, cancellation
- **View Usage**: See AI calls used, video generations, clones made

---

### 8. ⚙️ Settings

**Purpose:** Configure API keys, backend URL, and clear data.

**Key Sections:**

**A. API Keys**
- **OpenAI API Key**: Paste your key from platform.openai.com
- **GoHighLevel API Key**: Paste your private integration key from GHL
- **HeyGen API Key**: Paste your API key from HeyGen (optional)
- **Save** button applies changes

**B. Backend Configuration**
- **Backend API URL**: Enter your backend server URL (e.g., `http://localhost:8080` for local testing, or `https://api.clone2ghl.com` for production)
- **Enable Dev Mode**: Toggles unlimited cloning for testing (FREE plan users only)

**C. Data & Privacy**
- **Clear All Data**: Deletes all cloned funnels, preferences, and saved data locally
- **Export Data**: Downloads a JSON file of all your data
- **Disable Analytics**: Opt-out of usage tracking (if enabled)

**D. Notifications**
- **Enable Notifications**: Toggle on/off for clone completion alerts
- **Notification Sound**: On/off for sound alerts

---

## Step-by-Step Workflows

### Workflow 1: Clone a Website in 5 Steps

**Goal:** Clone a competitor's landing page and export it to GoHighLevel.

**Step 1: Find the Page You Want to Clone**
- Open any website in a new Chrome tab
- Example: www.competitor-example.com/landing-page

**Step 2: Initiate the Clone**
- **Option A (Quick):** Click the Clone2GHL icon → Click "Clone This Page"
- **Option B (Dashboard):** Click Dashboard → My Funnels → Paste URL → Click "Clone"
- Wait 10-30 seconds (depends on page size)

**Step 3: Wait for Completion**
- You'll see a notification: "✅ Page cloned successfully"
- The new funnel appears in **My Funnels** grid

**Step 4: Edit (Optional)**
- Click on the funnel card
- Click "Edit in Dashboard"
- Modify text, images, colors, forms as needed
- Click "Save"

**Step 5: Export to GoHighLevel**
- On the funnel card, click **"Export to GHL"**
- Choose funnel name, location, and options
- Click **"Push to GHL"**
- Notification: "✅ Funnel pushed to GoHighLevel"
- Check your GHL account—the funnel is now live!

**Total Time:** 2-5 minutes (depending on edits)

---

### Workflow 2: Optimize Copy for Your Niche

**Goal:** Improve your headlines and CTAs using AI.

**Step 1: Gather Your Copy**
- Write or copy your current headlines, CTAs, email subject lines, etc.
- Example: "Get our free guide" (weak CTA)

**Step 2: Open AI Tools**
- Dashboard → **AI Tools → Copy Optimizer**

**Step 3: Set Niche Context**
- Select your **Niche** from the dropdown
- Example: If you're a coach, select "Coaching"
- This ensures AI optimizations are relevant to your audience

**Step 4: Optimize**
- Paste your original copy
- Click "Optimize Copy"
- Wait 5-10 seconds

**Step 5: Review Variations**
- You'll see 3 optimized versions
- Choose the one that best fits your brand voice
- Click "Copy" to copy to clipboard

**Step 6: Apply to Your Funnel**
- Paste in your funnel
- A/B test if possible (try different variations)

**Example:**
- **Original (Weak):** "Learn more"
- **Optimized (For coaches):** "Unlock your 5-step transformation roadmap (Free masterclass inside)"

---

### Workflow 3: Generate a Logo and Add to Your Funnel

**Goal:** Create a professional logo and add it to your cloned funnel.

**Step 1: Describe Your Logo**
- Dashboard → **AI Tools → Logo Generator**
- In text box, describe: "Minimalist plumbing company logo, blue wrench and water droplet, modern"

**Step 2: Choose Style & Colors**
- Style: Modern / Minimalist / Vintage / Professional
- Colors: Choose or enter custom RGB values
- Example: Blue (#0066CC) and white

**Step 3: Generate**
- Click "Generate Logo"
- Wait 10-15 seconds
- Review generated logo

**Step 4: Download**
- Click **"Download"** (saves as PNG, transparent background)
- Save locally (e.g., `logo.png`)

**Step 5: Add to Your Funnel**
- Go to **My Funnels** and open the funnel you want to edit
- Click **"Edit"**
- In the editor, find the logo section
- Click "Upload Image" or drag & drop your downloaded logo
- Click "Save"

**Step 6: Preview**
- Click "Preview" to see logo in context
- Check sizing, placement, colors

---

### Workflow 4: Research Competitor Ads

**Goal:** Analyze competitor ad strategies to improve your own messaging.

**Step 1: Identify Competitors**
- List 3-5 top competitors in your market
- Example: Other coaching platforms, plumbing services, SaaS companies

**Step 2: Open Ad Intelligence**
- Dashboard → **Ad Intelligence**

**Step 3: Search for Competitor Ads**
- Enter competitor brand name
- Select platform: **Facebook**, **Google**, or **TikTok**
- Click "Search"
- Wait 5-10 seconds for results

**Step 4: Analyze Patterns**
- Look at headlines, primary CTAs, images
- Take notes on what you notice:
  - Common headline formulas (e.g., "How to ...", "Free ...", Fear-based, Benefit-driven)
  - Colors and visual styles
  - CTAs and button text

**Step 5: Apply Insights**
- Create a doc: "Competitor Ad Learnings"
- Example insights:
  - "Competitors use urgency CTAs (limited time, act now)"
  - "Images show real people, not stock photos"
  - "Headlines focus on problem-solving, not features"
- Apply to your ad strategy (without copying)

---

### Workflow 5: Create a Video Promo

**Goal:** Generate an AI avatar video to promote your funnel.

**Step 1: Write a Script**
- Keep it short: 30-60 seconds of speaking (≈75-150 words)
- Structure: Hook → Problem → Solution → CTA
- Example script for a coach:
  ```
  "Tired of inconsistent clients? I used to struggle with 
  client acquisition too. Now I've built a predictable 
  funnel system that brings me 3-5 qualified leads per week.
  In this free masterclass, I'll show you my exact 3-step 
  formula. Spots are limited—sign up now at [link]."
  ```

**Step 2: Open Video Generator**
- Dashboard → **AI Tools → Video Generation** (or 🎬 **Video Generation** tab)

**Step 3: Configure Settings**
- Paste script
- Avatar Style: Professional / Casual / Animated
- Duration: 15s / 30s / 60s (should match script length)
- Background: Solid color, gradient, office, nature
- Music: Optional background music selection

**Step 4: Generate**
- Click "Generate Video"
- Wait 30-60 seconds
- Video appears as preview

**Step 5: Download & Use**
- Click "Download" (saves MP4)
- Embed in landing page, email, or social media
- Or add to your GHL funnel as a page element

---

## Tips & Best Practices

### A. Cloning Best Practices

**1. Clone High-Converting Pages**
- Focus on pages you know convert well
- Study what makes them effective
- Then adapt for your niche

**2. Respect Copyright**
- Only clone pages you're allowed to use inspiration from
- Don't publish exact copies (customize them!)
- Add your own branding, copy, and offers

**3. Simplify Complex Layouts**
- Clone pages can be complex; simplify after cloning
- Remove unnecessary elements
- Focus the customer journey on one clear CTA

**4. Test Fast**
- Clone, edit minimally, export to GHL
- Let it run for 7 days
- Analyze performance, then optimize

**5. Preserve the Best Practices**
- Keep headline, subheadline, primary CTA placement
- Maintain trust signals (testimonials, social proof)
- Keep form fields minimal

### B. AI Copy Optimization Tips

**1. Use Specific Prompts**
- ✅ "Optimize this e-commerce checkout CTA for impulse buyers"
- ❌ "Make this better"

**2. Test Multiple Variations**
- Run 3 versions of each page
- See which copy converts best
- Use winner in future pages

**3. Match Your Brand Voice**
- AI suggestions are templates
- Adapt them to your tone (formal, casual, playful)
- Don't sound robotic

**4. Niche Context Matters**
- Coaches respond to transformation language
- Plumbers respond to speed and reliability
- E-commerce responds to urgency and scarcity

### C. Logo Generation Tips

**1. Be Descriptive**
- ✅ "Blue and gold SaaS logo, tech-forward, modern flat design"
- ❌ "Tech logo"

**2. Include Style Direction**
- "Minimalist," "Bold," "Professional," "Playful"
- This significantly improves results

**3. Specify Industry/Niche**
- "Coaching logo" differs from "plumbing logo"
- AI uses industry context for better designs

**4. Test Multiple Styles**
- Generate logos in 3-4 different styles
- Choose the one that best represents your brand

### D. Export to GHL Best Practices

**1. Test Clone Before Export**
- Preview the cloned funnel in the dashboard
- Ensure all text, images, forms are correct
- Check mobile view

**2. Name Funnels Clearly**
- ✅ "Plumbing - Lead Magnet - Free Inspection"
- ❌ "Funnel 1"

**3. Replace Forms Strategically**
- Enable "Replace forms with GHL forms" if all forms should be GHL contact forms
- Disable if you want custom forms

**4. Choose Correct GHL Location**
- If you have multiple locations, select the right one
- Wrong location = funnel appears in wrong account

**5. Verify After Export**
- Check GHL account immediately after export
- Ensure funnel has all pages
- Test form submission

### E. General Productivity Tips

**1. Clone Once, Customize Many**
- Clone a high-converting template
- Customize for 3 different audiences/niches
- Export all 3 to GHL

**2. Build a Template Library**
- Save edited funnels as duplicates for future use
- Label them clearly (e.g., "Lead Magnet Template - Coaches")
- Reuse across clients or niches

**3. Batch Your Work**
- Clone 3-5 pages in one session
- Optimize all copy in next session
- Export all together

**4. Document What Works**
- Keep a spreadsheet: Clone URL → Original funnel → Performance
- Track which niches/layouts convert best
- Replicate winners

**5. Use Dev Mode for Testing**
- Settings → Enable Dev Mode for unlimited clones (testing only)
- Disable before production use

---

## FAQ & Common Questions

### Cloning & Functionality

**Q: Can I clone any website?**
A: Technically yes, the extension runs on all URLs. However, respect copyright law and robots.txt. Only clone pages you have permission to use inspiration from.

**Q: How long does cloning take?**
A: Usually 5-30 seconds depending on page complexity. Large pages with many images may take up to 1 minute.

**Q: Can I clone password-protected pages?**
A: No. The extension can only access pages you can view in your browser. Protected pages will fail to clone.

**Q: How many pages can I clone per month?**
A: **FREE plan:** 10/month. **PRO:** 100/month. **AGENCY:** Unlimited. Dev mode (testing) has unlimited clones for development.

**Q: What happens to my cloned data?**
A: All cloned data is stored locally on your device in encrypted browser storage. It is never sent to our servers. You can delete it anytime in Settings.

---

### API Keys & Integrations

**Q: Why do I need an OpenAI API key?**
A: To use AI copy optimization and logo generation, which use GPT-4o and DALL-E 3. You'll be charged by OpenAI per API call (typically $0.01-$0.10 per optimization).

**Q: How much does OpenAI cost?**
A:
- Prefix billing (text generation): ~$0.0005 per 1K tokens
- Logo/image generation: ~$0.04 per image
- Budget roughly $10-20/month for casual use, $50-100/month for heavy use

**Q: Can I use Clone2GHL without API keys?**
A: Yes! Basic cloning works without any keys. AI tools (copy optimization, logo generation, video) require their respective API keys.

**Q: Can I share my API keys with my team?**
A: All keys are stored locally in your browser. If you share a device or sync settings, others with access can use your keys. Consider creating team API keys in OpenAI/GHL instead.

**Q: What if my API key expires?**
A: If a key is invalid, you'll get an error when trying to use that feature. Go to Settings, update the key, and try again.

---

### GoHighLevel Integration

**Q: How do I connect my GoHighLevel account?**
A: Go to GHL → Settings → Integrations → Private Integrations. Create a new private app, copy the API key, and paste it into Clone2GHL Settings.

**Q: Can I push to a specific GHL location?**
A: Yes. When exporting, choose the destination location from the dropdown. The funnel will be created in that location's account.

**Q: What if the push to GHL fails?**
A: Check the error message. Common issues: invalid API key, rate limit exceeded, or GHL API down. Retry in a few minutes or check GHL status page.

**Q: Can I edit the clone after pushing to GHL?**
A: Yes. After pushing, you can edit the funnel directly in GHL. Changes in Clone2GHL won't affect the GHL version after export.

**Q: Can I pull a funnel from GHL back into Clone2GHL?**
A: No, the integration is one-way (Clone2GHL → GHL). Clone2GHL is for creation; GHL is for management.

---

### Performance & Errors

**Q: Why is cloning slow?**
A: Slow clones are usually due to:
- Large page size (many images, scripts)
- Poor internet connection
- Heavy browser load (too many tabs open)
- Third-party scripts on the page

**Workaround:** Try cloning a simpler page first, or wait and retry.

**Q: I'm getting a "Rate limit exceeded" error. What do I do?**
A: You've hit your OpenAI API rate limit. Wait 1 hour before retrying. To prevent this:
- Upgrade your OpenAI account quota
- Limit AI tool usage
- Batch requests

**Q: The extension is laggy or crashes. Help!**
A: Try:
1. Restart Chrome
2. Unload the extension and reload it (chrome://extensions)
3. Clear stored data (Settings → Clear All Data)
4. Check that you have <500 cloned funnels (large databases slow down)
5. Update Chrome to latest version

**Q: Images aren't showing up in my cloned funnel. Why?**
A: Possible causes:
- Images are JPEG/WebP format (try PNG instead)
- Images are very large (resize before cloning)
- Images are hosted on external CDN (usually converts to base64 fine)

**Workaround:** Re-upload images manually in the dashboard editor.

---

### Billing & Plans

**Q: What's included in each plan?**

| Feature | FREE | PRO | AGENCY |
|---------|------|------|--------|
| Clones/month | 10 | 100 | Unlimited |
| AI Tools | Limited | Unlimited* | Unlimited* |
| Logo Generation | 5/mo | 50/mo | Unlimited |
| Video Generation | 1/mo | 10/mo | Unlimited |
| GHL Export | ✅ | ✅ | ✅ |
| Price | $0 | $29/mo | $99/mo |

*Requires own OpenAI API key (charged separately)

**Q: Can I cancel anytime?**
A: Yes. Pro and Agency plans can be canceled in Settings → My Account. No penalties.

**Q: Do I get a refund if I cancel mid-month?**
A: Cancellation is effective at end of billing cycle. We don't prorate refunds.

**Q: Can I upgrade/downgrade anytime?**
A: Yes. Upgrades are effective immediately. Downgrades take effect at next billing cycle.

---

### Privacy & Data

**Q: Is my clone data private?**
A: Yes. All clones are stored on your local device only, encrypted in browser storage. We cannot access them.

**Q: Will Clone2GHL sell my data?**
A: No. We never sell, rent, or share user data. See Privacy Policy for details.

**Q: Can I delete my data?**
A: Yes, anytime. Settings → Cache & Data → Clear All Data. All local funnels, preferences, and keys are deleted instantly.

**Q: What about GDPR compliance?**
A: Clone2GHL is fully GDPR-compliant. All data is local, users have deletion rights, and we don't do cross-border transfers. See Privacy Policy.

---

## Troubleshooting

### Installation Issues

**Problem: Extension won't install**
- Error: "Manifest error"
- Solution:
  1. Make sure you're using Chrome (not Edge, Firefox, etc.)
  2. Download latest Clone2GHL_v1.0.1.zip
  3. Extract the ZIP
  4. Go to chrome://extensions
  5. Toggle "Developer mode" ON
  6. Click "Load unpacked"
  7. Select the extension folder

**Problem: Extension installed but icon doesn't appear**
- Solution:
  1. Go to chrome://extensions
  2. Find Clone2GHL in the list
  3. Toggle it ON (if OFF)
  4. Look for the extension icon in Chrome toolbar (top-right, might be hidden)
  5. Click the puzzle icon → Pin Clone2GHL

**Problem: "Extension requires a newer version of Chrome"**
- Solution:
  1. Update Chrome: Chrome Menu → Settings → About Chrome
  2. Chrome will auto-update; restart the browser
  3. Try installing again

---

### Cloning Issues

**Problem: "Clone failed" or page fails to clone**
- Causes: Page too complex, CORS restrictions, dynamic content
- Solutions:
  1. Try a simpler page first (test clone)
  2. Check browser console for errors (F12 → Console tab)
  3. Disable browser extensions temporarily (one might block)
  4. Try in incognito mode
  5. If all else fails, report the URL in support

**Problem: Images aren't showing in the clone**
- Causes: Image format not supported, CORS restrictions, external hosting
- Solutions:
  1. Reupload images manually in dashboard
  2. Convert images to PNG format
  3. Check image URL is accessible (might need CORS proxy)

**Problem: Styling looks wrong after clone**
- Cause: CSS selectors or dynamic styles
- Solutions:
  1. Edit CSS in dashboard editor
  2. Manually adjust sizes, colors, spacing
  3. Test different CSS frameworks (Bootstrap, Tailwind)

**Problem: Forms aren't captured**
- Solution:
  1. Forms are captured HTML but not functional yet
  2. When exporting to GHL, enable "Replace forms with GHL forms"
  3. This converts them to GHL contact forms (functional)

---

### API Key Issues

**Problem: "Invalid API key" error**
- Solution:
  1. Go to Settings
  2. Double-check your API key (copy/paste carefully)
  3. Ensure no leading/trailing spaces
  4. Verify key hasn't expired (check OpenAI/GHL dashboard)
  5. If using GHL key, ensure it's from Private Integrations, not Public

**Problem: "API rate limit exceeded"**
- Cause: Exceeded API quota
- Solutions:
  1. Stop using AI tools for 1 hour (they rate-limit)
  2. Upgrade API quota in OpenAI dashboard
  3. Wait for rate limit window to reset

**Problem: "OpenAI service unavailable"**
- Cause: OpenAI API downtime or temporarily overloaded
- Solution:
  1. Wait 5-10 minutes
  2. Try again
  3. Check status.openai.com for outages

---

### Export to GHL Issues

**Problem: "Failed to push to GHL"**
- Causes: Invalid API key, network issue, GHL API down
- Solutions:
  1. Verify GHL API key is correct (go to Settings, re-paste)
  2. Check internet connection
  3. Verify GHL is not down (try logging in to GHL directly)
  4. Try again in 1-5 minutes

**Problem: Funnel appears in wrong location**
- Cause: Selected wrong GHL location during export
- Solution:
  1. Go to GHL
  2. Manually delete the funnel
  3. In Clone2GHL, export again and choose correct location

**Problem: Forms aren't working in the GHL funnel**
- Cause: Forms weren't converted to GHL forms
- Solution:
  1. In GHL, click the form and convert to GHL contact form
  2. Or re-export from Clone2GHL with "Replace forms with GHL forms" enabled

---

### Performance Issues

**Problem: Dashboard is slow or laggy**
- Causes: Too many clones stored, browser memory full, outdated Chrome
- Solutions:
  1. Delete old clones: My Funnels → ... → Delete
  2. Clear browser cache: Chrome → Settings → Clear Browsing Data
  3. Update Chrome to latest version
  4. Restart browser

**Problem: Cloning is very slow (>1 minute)**
- Cause: Large page or poor connection
- Solutions:
  1. Close other browser tabs
  2. Try simpler pages first
  3. Check internet speed (speedtest.net)
  4. Try cloning again (might just be network lag)

**Problem: Export to GHL is frozen**
- Solution:
  1. Wait 2-3 minutes (might still be processing)
  2. Check notification for error message
  3. If truly stuck, refresh the page
  4. Try exporting again

---

### Getting Help

**If you can't find the answer here:**

1. **Check the Extension FAQ:**
   - In dashboard → Help & Support tab

2. **View Extension Logs:**
   - Open developer console: F12 → Console
   - Look for error messages
   - Screenshot and include in support request

3. **Contact Support:**
   - Email: support@clone2ghl.com
   - Include: Browser version, error message, steps to reproduce

4. **Community Forum:**
   - [Link to community]

---

## Glossary

**API Key:** An authentication token used to access external services (OpenAI, GoHighLevel, HeyGen). Treat like a password.

**Funnel:** A marketing funnel is a series of web pages designed to guide a visitor toward a specific action (signup, purchase, download).

**Clone:** A copy of a webpage's structure, design, and content, stored locally.

**CTA (Call-to-Action):** A button or text that prompts users to take an action (e.g., "Sign Up Now," "Buy Today," "Learn More").

**DOM (Document Object Model):** The structure of a webpage's HTML. Clone2GHL extracts and preserves the DOM.

**CSS:** Cascading Style Sheets—code that controls the styling and layout of a webpage.

**Base64:** An encoding format used to represent images as text. Clone2GHL converts external images to base64 to preserve them in clones.

**GoHighLevel (GHL):** A CRM and marketing automation platform popular with agencies. Clone2GHL exports funnels to GHL.

**Niche:** A specific market segment or industry (e.g., plumbing, coaching, e-commerce). Used for contextual AI optimization.

**GPT-4o:** OpenAI's advanced language model used for copy optimization.

**DALL-E 3:** OpenAI's image generation model used for logo creation.

**HeyGen:** An AI video generation platform used to create AI avatar videos.

**Conversion Rate:** The percentage of funnel visitors who complete the desired action. Higher = better.

**Trust Signal:** Elements that build credibility (testimonials, social proof, certifications, logos, etc.).

**Urgency:** Marketing technique to encourage immediate action (limited-time offer, scarcity, deadline).

---

## Support & Contact

### Getting Help

- **Extension Help Docs:** [Link inside extension Dashboard]
- **Email Support:** support@clone2ghl.com
- **Community Forum:** [forum.clone2ghl.com]
- **Bug Reporting:** [GitHub Issues link]

### Feedback & Suggestions

We'd love to hear from you! Share feature requests and feedback:
- Dashboard → Help & Support → Send Feedback
- Or email: feedback@clone2ghl.com

### Social Media

- Twitter: @Clone2GHL
- LinkedIn: Clone2GHL Company Page
- YouTube: Clone2GHL Tutorials

### Legal

- Privacy Policy: [Link in this document]
- Terms of Service: [Link]
- Cookie Policy: [Link]

---

**Version:** 1.0.1  
**Last Updated:** April 16, 2026  
**Status:** Production Ready  
**Archive:** [Link to previous versions]

---

**Thank you for using Clone2GHL!**

For the best experience:
1. Enable notifications for clone completion alerts
2. Bookmark this guide for quick reference
3. Share feedback to help us improve
4. Engage with our community for tips & best practices

Happy cloning! 🚀
