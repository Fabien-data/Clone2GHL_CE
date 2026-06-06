# Clone2GHL Chrome Web Store Listing

## Basic Fields

**Name**

Clone2GHL – Funnel Intelligence Platform

**Summary**

Clone webpages, edit funnels, optimize copy with AI, and export directly into GoHighLevel.

**Category**

Productivity

**Language**

English (United States)

**Privacy Policy URL**

https://clone2ghl.com/privacy-policy

**Support / Contact Email**

clone2ghl@gmail.com

## Full Description

Clone2GHL helps agencies and marketers turn live webpages into editable GoHighLevel-ready funnel drafts.

Core features:

- Clone webpage structure, text, images, and styling from the page you are viewing.
- Edit cloned pages inside a visual dashboard with brand, text, image, color, and font controls.
- Analyze pages for funnel issues and surface risk areas before export.
- Optimize copy and generate logos with optional OpenAI-powered tools.
- Generate and manage video jobs through the optional Clone2GHL backend workflow.
- Export finished funnels directly into your GoHighLevel account.
- Save funnels locally, browse a funnel library, and manage a watchlist of competitor pages.

How it works:

1. Open any webpage.
2. Click the Clone2GHL action to capture the page.
3. Customize the cloned result in the dashboard.
4. Optionally run AI tools or backend video workflows.
5. Push the funnel into GoHighLevel.

Important setup notes:

- GoHighLevel export requires your GoHighLevel API key and location ID.
- Direct OpenAI features require your own OpenAI API key.
- Optional account, sync, and video-generation workflows use the Clone2GHL backend after you sign in.

Privacy and security:

- Cloned content is captured only after you explicitly trigger a clone.
- Sensitive settings are stored locally in encrypted extension storage.
- Data is only sent to OpenAI, GoHighLevel, or your configured Clone2GHL backend when you explicitly run those features.
- No remote JavaScript is executed by the extension.

## Single Purpose Statement

Clone2GHL captures user-selected webpages, converts them into editable funnel drafts, and helps users optimize and export those funnels into GoHighLevel.

## Suggested Permission Answers

`activeTab`

Required to read the DOM and styles of the page the user explicitly chooses to clone.

`scripting`

Required to inject the extension’s own content script so the clone action can capture page structure and assets.

`storage`

Required to save encrypted API keys/tokens, cloned funnel data, watchlist entries, and user preferences locally.

`tabs`

Required to open the dashboard, owner login page, and GoHighLevel export flow in new tabs when users trigger those actions.

`alarms`

Required to schedule a single periodic background alarm that refreshes the signed-in user's plan/usage state (MV3 service-worker scheduling).

`<all_urls>`

Required because users can choose any webpage to clone, and the target domain is not known in advance.

`https://services.leadconnectorhq.com/*`, `https://rest.gohighlevel.com/*`

Required to export funnels to and validate the user's GoHighLevel account via GoHighLevel's official API.

`https://api.openai.com/*`

Required for optional AI features (copy optimization, logo generation) when the user supplies their own OpenAI key.

## Chrome Web Store Privacy Questionnaire

**Does the extension collect website content?**

Yes. The extension captures page HTML, text, image references, and styling from the active page only after the user clicks clone.

**Does the extension collect personal information?**

Yes, if the user creates an optional Clone2GHL account: account email, a bcrypt password hash, and an auth token, plus billing details for paid plans (handled by Stripe). The extension also stores user-provided GoHighLevel and OpenAI API credentials locally (encrypted). Without an account, no personal information is sent to our servers.

**Is data sold to third parties?**

No.

**Is data used for advertising or profiling?**

No.

**When is data transferred off-device?**

Only when the user explicitly triggers export, AI, sync, or video workflows.

**Third parties / services involved**

- GoHighLevel API (funnel export, account validation)
- OpenAI API (AI copy, logos, scripts)
- Stripe (payment processing for paid plans)
- Resend (transactional email for accounts: password reset, activation, renewal reminders)
- HeyGen (optional avatar video generation)
- Clone2GHL backend (optional account, usage sync, AI/video routing)

## Data Handling Disclosures (CWS "Privacy practices" tab)

**Data types collected** (tick in the dashboard):
- Personally identifiable information — email address
- Authentication information — password (stored only as a bcrypt hash), auth/refresh tokens
- Financial and payment information — handled by Stripe for paid plans
- Website content — HTML/CSS/images/text of pages the user chooses to clone
- User activity — feature usage and in-app actions (for usage limits and diagnostics)

**Certifications:**
- I do not sell or transfer user data to third parties outside the approved use cases (only the sub-processors needed to run features the user invokes).
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Remote code:** The extension executes no remotely-hosted code. All scripts are packaged in the extension and a strict CSP (`script-src 'self'; object-src 'self'`) is enforced.

**Single purpose:** Clone2GHL captures user-selected webpages, converts them into editable funnel drafts, and helps users optimize and export those funnels into GoHighLevel.

**How user data is handled (paste-ready):**
Clone2GHL stores API keys and cloned content locally in encrypted browser storage; these are sent to a third party only when the user triggers an action (export to GoHighLevel, an AI tool). If the user creates an optional Clone2GHL account, our backend additionally stores account, billing, usage, and (when the user syncs) funnel data, and routes AI/video requests on the user's behalf. Sub-processors: GoHighLevel, OpenAI, Stripe, Resend, and HeyGen. We do not sell data or use it for advertising. Users can delete local data via Settings/uninstall and request account deletion at clone2ghl@gmail.com. Full policy: https://clone2ghl.com/privacy-policy