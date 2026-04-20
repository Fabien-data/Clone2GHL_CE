# Clone2GHL — Permission Justifications for Chrome Web Store

This document explains why Clone2GHL requires each permission listed in the manifest.json for Chrome Web Store submission.

---

## Required Permissions Justification

### 1. **activeTab**
**Purpose:** Extract the current webpage's DOM structure and styling for cloning.

**Justification:** 
- Clone2GHL captures the complete HTML structure, CSS styles, and layout of the webpage the user is currently viewing
- This permission allows the extension to read the DOM tree and computed styles only on the tab the user actively clicks "Clone This Page" in
- The data is processed locally in the browser; no content is transmitted without explicit user action
- This is essential functionality — without it, the extension cannot perform its core feature

---

### 2. **scripting**
**Purpose:** Inject the content script that captures page structure and handles cloning logic.

**Justification:**
- Clone2GHL injects a content script (`contentScript.js`) into webpages to add the "Clone to GHL" button and listen for user interactions
- The script extracts DOM nodes, converts images to base64 data URIs (to preserve them in the clone), and prepares the page for export
- All injected code is from the extension itself; no remote JavaScript is executed
- The extension's Content Security Policy (`script-src 'self'`) prevents inline scripts and external code execution
- This permission only applies when the user is on a webpage and clicks the clone button

---

### 3. **storage**
**Purpose:** Save user data locally in encrypted browser storage.

**Justification:**
- User API keys (OpenAI, GoHighLevel, HeyGen) are stored locally using Chrome's `storage.local` API
- Cloned funnel HTML and metadata are cached locally for quick retrieval and editing
- User preferences (selected niche, plan type, dashboard settings) are persisted across sessions
- All data is encrypted at rest and never synced to external servers
- Users can delete all stored data via the Settings tab at any time
- This is necessary for the extension to maintain state between sessions

---

### 4. **tabs**
**Purpose:** Open the dashboard in a new tab and create new tabs for GoHighLevel builder integration.

**Justification:**
- When users click "Dashboard" from the popup, the extension opens the full dashboard.html in a new tab
- When users export a funnel to GoHighLevel, the extension opens the GHL builder in a new tab
- These are user-triggered actions only; no tabs are created without explicit consent
- This permission allows seamless access to the full feature set and export workflow

---

### 5. **notifications**
**Purpose:** Notify users when cloning or GoHighLevel export operations complete.

**Justification:**
- After a webpage is successfully cloned, a notification informs the user the clone is ready
- After a funnel is exported to GoHighLevel, a notification confirms successful push
- If an error occurs (rate limit, API failure), a notification alerts the user
- Notifications help guide user workflows and provide feedback on async operations
- Users can disable notifications in Chrome's notification settings if desired

---

### 6. **<all_urls>** (Host Permission)
**Purpose:** Allow the extension to run on any webpage the user chooses to clone.

**Justification:**
- Clone2GHL is designed for users to clone *any* website—e-commerce pages, landing pages, competitors' funnels, blogs, etc.
- The target website is unknown at install time; users determine which sites to clone dynamically
- The extension only reads the page's DOM and CSS; it does **not**:
  - Extract or transmit page content to third parties
  - Modify the page permanently (only in the clone)
  - Execute malicious code or perform hidden operations
  - Access sensitive data (passwords, form fields, cookies)
- Data is processed locally and only sent to GoHighLevel or OpenAI if the user explicitly chooses to export or use AI tools
- Without this permission, the extension would be limited to a pre-approved list of sites, defeating the core use case

---

## Additional Host Permissions (API-Specific)

These are specific to known external services:

### **https://services.leadconnectorhq.com/*** and **https://rest.gohighlevel.com/***
- **Purpose:** Export cloned funnels to GoHighLevel account via official API
- **Justification:** These are the official GHL API endpoints; permission is required for the export feature to function

### **https://api.openai.com/***
- **Purpose:** Send copy/content to GPT-4o for optimization and logo generation requests to DALL-E
- **Justification:** Optional AI features require communication with OpenAI's servers; users are informed before sending data

---

## Security & Privacy Assurances

1. **No Remote Code Execution:** The extension does not load or execute JavaScript from external sources. All code is packaged locally.
2. **No Data Harvesting:** User data (cloned HTML, settings) is stored locally. No tracking pixels, analytics, or data sales.
3. **Encrypted Storage:** API keys and sensitive data are encrypted at rest in Chrome's local storage.
4. **User Control:** Users can clear all data, toggle features, and disable the extension at any time.
5. **CSP Compliance:** The manifest's Content Security Policy (`script-src 'self'; object-src 'self'`) prevents inline script injection.
6. **Transparent APIs:** External APIs (GHL, OpenAI, HeyGen) are only called when users explicitly request export or AI features.

---

## Permission Risk Analysis

| Permission | Risk Level | Mitigation |
|-----------|-----------|-----------|
| activeTab | Low | Only reads DOM; no modification or tracking |
| scripting | Low | Only injects trusted extension code; CSP blocks external JS |
| storage | Low | User data encrypted locally; user can clear anytime |
| tabs | Low | User-triggered actions only; no silent tab opening |
| notifications | Low | Informational only; users can disable in Chrome settings |
| <all_urls> | Low | Only reads; content only sent on explicit user action (export/AI) |

---

## Compliance Checklist

- ✅ All permissions are necessary for core functionality
- ✅ No permissions are used for hidden tracking or data harvesting
- ✅ Users are informed of data sharing via privacy policy
- ✅ No remote code execution or dynamic script loading
- ✅ Users have full control to revoke permissions or delete data
- ✅ Privacy policy is publicly available and comprehensive
- ✅ Extension does not request excessive permissions for a cloning tool

---

**Last Updated:** April 16, 2026
**Extension Version:** 1.0.1
**Contact:** [Support URL] (to be added)
