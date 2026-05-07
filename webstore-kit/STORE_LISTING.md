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

`notifications`

Required to notify the user when clone, export, and related async workflows complete or fail.

`<all_urls>`

Required because users can choose any webpage to clone, and the target domain is not known in advance.

## Chrome Web Store Privacy Questionnaire

**Does the extension collect website content?**

Yes. The extension captures page HTML, text, image references, and styling from the active page only after the user clicks clone.

**Does the extension collect personal information?**

Yes. If the user signs into the optional Clone2GHL backend, the extension handles account email and a backend auth token. It may also store user-provided GoHighLevel and OpenAI API credentials locally.

**Is data sold to third parties?**

No.

**Is data used for advertising or profiling?**

No.

**When is data transferred off-device?**

Only when the user explicitly triggers export, AI, sync, or video workflows.

**Third parties / services involved**

- GoHighLevel API
- OpenAI API
- Optional Clone2GHL backend
- Optional video provider used by the configured backend, such as HeyGen