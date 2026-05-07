# Clone2GHL Privacy Policy

**Last Updated: April 16, 2026**  
**Effective Date: April 16, 2026**

---

## 1. Overview

Clone2GHL ("Extension," "we," "us," or "our") is a Chrome Web Extension that enables users to clone webpages, analyze funnel performance, optimize marketing copy with AI, and export funnels directly to GoHighLevel.

This Privacy Policy explains how we collect, use, store, and protect your information when you use Clone2GHL. By installing and using this extension, you agree to the terms outlined in this policy.

---

## 2. Data We Collect

### A. Data You Provide Directly

**API Credentials and Account Access:**
- GoHighLevel API key and location ID
- OpenAI API key
- Clone2GHL backend sign-in email and auth token
- Your password may be transmitted to the Clone2GHL backend only during sign-in or registration and is not stored by the extension after authentication

**Cloned Webpage Content:**
- When you click "Clone This Page," the extension captures:
  - HTML markup of the visible page
  - CSS styles (computed styles only, not internal stylesheets)
  - Images (converted to base64 data URIs for preservation)
  - Text content and structure
  - These are stored locally in your browser

**User Account Information:**
- Niche/industry selection (e.g., Plumber, Electrician, Coach, etc.)
- Plan type (Free, Pro, Agency)
- Dashboard settings and preferences
- Saved funnels, watchlist entries, and templates

### B. Data Collected Automatically

**Extension Usage & Behavior:**
- Which dashboard tabs you access
- Whether you clone pages, use AI tools, export to GHL, sync with backend, or create video jobs
- Funnel Intelligence analysis results (generated locally)
- Error logs (if features fail)

**Page Information (During Cloning):**
- URL of the page you clone
- Page title and metadata
- Time of cloning
- Local browser storage of the above

---

## 3. How We Use Your Data

### A. Core Functionality
- **Cloning:** Your data is used to preserve and recreate page layouts within the GHL ecosystem
- **AI Optimization:** Your copy (headlines, CTAs, body text) may be processed by OpenAI directly or by the Clone2GHL backend, depending on the feature you choose
- **Logo Generation:** Your text prompts are sent to OpenAI to generate logo images
- **Video Generation:** Video prompts/scripts and related settings may be sent to the Clone2GHL backend, which can use OpenAI, HeyGen, or a configured provider to fulfill the request
- **Export to GHL:** Cloned funnel data is exported to your GoHighLevel account via their official REST API
- **Cloud Features:** If you sign into the Clone2GHL backend, account state, usage information, sync requests, and backend workflow data are processed by that backend

### B. Service Improvement
- We do NOT use your data to improve our algorithms, train models, or perform analytics
- Usage patterns may be logged locally to diagnose extension issues

### C. Legal Compliance
- We may disclose data if legally required by law enforcement or court order

---

## 4. Data Storage & Location

### A. Browser Storage (Local)
**What's Stored:**
- GoHighLevel API key, OpenAI API key, and backend auth token (encrypted in extension storage)
- Cloned webpage HTML and CSS
- User preferences (niche, plan, dashboard settings)
- Saved funnels, watchlist entries, template/library data, and related metadata

**Where It's Stored:**
- Locally on your device in Chrome's `chrome-extension://` storage
- If you enable Chrome Sync, data may sync across your Chrome-signed devices (you control this in Chrome Settings)

**Access & Retention:**
- ONLY accessible to you and the Clone2GHL extension
- Data persists until you manually delete it (Settings → Clear Data)
- If you uninstall the extension, all stored data is automatically deleted

### B. External Storage (Optional)
**When You Use Export / AI / Backend Features:**
- Cloned funnel HTML is **sent to GoHighLevel's servers** when you click "Push to GHL" (at your request)
- Copy optimization requests may be **sent to OpenAI's servers** or the **Clone2GHL backend** when you click an AI action
- Logo generation requests are **sent to OpenAI's servers** when you generate a logo
- Video generation requests may be **sent to the Clone2GHL backend**, which may then communicate with OpenAI, HeyGen, or another configured provider
- Sign-in, sync, usage refresh, and backend workflow requests are **sent to the Clone2GHL backend** only when you explicitly use those features
- **These are NOT automatic.** Data is only sent when you explicitly trigger these actions.

---

## 5. Data Sharing

### A. We Do NOT Share Your Data
We do NOT:
- Sell or rent your data to third parties
- Share your data with marketers, advertisers, or data brokers
- Use your cloned pages for our own benefit or training
- Use your data for advertising or profiling

### B. Third-Party Data Processing
When you use the following features, data is shared directly with these services **at your request**:

| Service | Data Shared | Purpose | Privacy Link |
|---------|------------|---------|--------------|
| GoHighLevel API | Cloned HTML, export data | Create funnel in your GHL account | [GHL Privacy Policy](https://gohighlevel.com/privacy-policy) |
| OpenAI | Copy text, prompts, logo requests | Direct AI optimization and image generation | [OpenAI Privacy Policy](https://openai.com/privacy/) |
| Clone2GHL Backend | Account email, auth/session data, optional sync and workflow payloads | Account features, sync, usage, and backend workflows | [Support URL to be added] |
| Optional backend video provider (for example HeyGen) | Video prompts or scripts routed through backend | Generate video output when backend provider is enabled | [Provider privacy policy, if applicable] |

**Important:** You control these sharing decisions. You must:
1. Provide your API keys or sign into the backend (indicating consent to use that service)
2. Click "Optimize," "Export," "Generate," "Sync," or another workflow action (triggering data transmission)

We recommend reviewing the privacy policies of these services before connecting your API keys.

---

## 6. Data Security

### A. Encryption
- API keys are stored using Chrome's built-in encryption (chrome-extension local storage is encrypted)
- Data is not transmitted without TLS/SSL encryption over the network
- We do NOT store passwords or unencrypted keys on external servers

### B. Browser Isolation
- The extension runs in a sandboxed context within Chrome
- Cannot access other extensions' data, browser history, or cookies from other sites
- Content Security Policy (`script-src 'self'; object-src 'self'`) prevents inline script injection

### C. Optional Backend Integration
- Clone2GHL supports an optional backend for account, usage, sync, and video workflows
- If you do not sign in, those backend features are not used
- If you do sign in, the backend can process the data needed to fulfill the workflow you requested

---

## 7. User Rights & Control

### A. Access Your Data
You can access all your stored data through the Clone2GHL dashboard:
- Settings tab → View stored clone history
- My Funnels tab → See all clocked pages

### B. Delete Your Data
**Option 1: Clear via Extension**
1. Open Clone2GHL Dashboard
2. Go to Settings
3. Click "Clear All Data"
4. Confirm deletion

**Option 2: Clear via Chrome**
1. Open Chrome Settings → Privacy & Security → Clear Browsing Data
2. Select "All Time"
3. Check "Cookies and other site data"
4. Click "Clear Data" (this also clears extension storage)

**Option 3: Uninstall Extension**
1. Right-click Clone2GHL extension icon
2. Select "Remove from Chrome"
3. All data automatically deleted

### C. Disable Sharing
- Remove your API keys from Settings to stop data sharing with external services
- Disable features you don't want to use (you won't be prompted again)

### D. Chrome Sync Opt-Out
If you don't want data synced across your Chrome devices:
1. Chrome Settings → Sync and Google Services
2. Toggle "Sync Everything" OFF
3. Deselect "Extensions"

---

## 8. Children's Privacy

Clone2GHL is not intended for children under 13. We do not knowingly collect data from children under 13. If we become aware of such collection, we will delete it immediately.

If you believe we have collected data from a child, contact us immediately at wazwide@gmail.com.

---

## 9. Third-Party Links

This Privacy Policy does not apply to external websites linked in the extension (GoHighLevel, OpenAI, HeyGen, etc.). We encourage you to review their privacy policies before connecting your accounts.

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of material changes by:
- Updating the "Last Updated" date at the top of this policy
- Posting a notice in the extension or via email (if applicable)

Your continued use of Clone2GHL after changes constitutes acceptance of the updated policy.

---

## 11. Data Retention Duration

| Data Type | Retention | Deletion Method |
|-----------|-----------|-----------------|
| Cloned pages | Indefinite (until user deletes) | Manual via Settings or uninstall |
| API keys | Indefinite (until user removes) | Manual via Settings |
| User preferences | Indefinite (until user clears data) | Manual via Settings or uninstall |
| Local logs | Until browser cache cleared | Automatic browser cleanup |

---

## 12. Contact & Data Requests

If you have questions about this Privacy Policy, wish to exercise your rights, or believe your data has been mishandled:

**Contact Information:**
- Email: wazwide@gmail.com
- Website: https://preview-1777215622669307854.vibepreview.com/
- Extension Support: https://preview-1777215622669307854.vibepreview.com/

For GDPR, CCPA, or other regulatory requests, contact us with:
- Your name and email
- Specific request (access, deletion, portability)
- Details about what data you're requesting

We will respond within 30 days of receiving your request.

---

## 13. Compliance Statements

### A. GDPR Compliance (EU Residents)
If you're in the EU, you have the right to:
- Access your personal data
- Delete your data ("right to be forgotten")
- Restrict processing
- Data portability
- Object to processing

Clone2GHL complies with GDPR by:
- Storing all personal data locally (not on external servers)
- Allowing you to delete data at any time
- Not processing data for marketing or profiling
- Providing transparent data sharing disclosures

### B. CCPA Compliance (California Residents)
If you're in California, you have the right to:
- Know what data is collected
- Delete your data
- Opt-out of data sales

Clone2GHL complies with CCPA by:
- This policy discloses all data collection
- Providing easy deletion methods
- We do NOT sell your data to any third parties

---

## 14. Summary: How We Handle Your Data

| Question | Answer |
|----------|--------|
| **Where is my data stored?** | Locally on your device using Chrome's encrypted storage |
| **Can you access my cloned pages?** | No. All storage is local; we have no backend servers |
| **Can you see my API keys?** | No. Keys are encrypted and stored locally |
| **Will you sell my data?** | No, never. Selling data is prohibited |
| **Can I delete my data?** | Yes, anytime via Settings or by uninstalling |
| **What if I'm in the EU/California?** | Full GDPR & CCPA compliance; see Section 13 |
| **How do you protect my data?** | Encryption, browser sandboxing, CSP, local-only storage |

---

## 15. Acknowledgment

By installing Clone2GHL, you acknowledge that you have read, understood, and agree to this Privacy Policy. If you do not agree, please uninstall the extension.

---

**Version:** 1.0  
**Status:** Active  
**Next Review:** April 16, 2027
