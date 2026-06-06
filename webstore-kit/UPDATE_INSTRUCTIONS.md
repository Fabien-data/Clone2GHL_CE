# How to Publish the v1.0.3 Update to the Chrome Web Store

This is a **version update** to an extension that is already listed.
It is quick — you are only uploading a new package, not creating a new listing.

**Extension:** Clone2GHL – Funnel Intelligence Platform
**Item ID:** `mjphmimkcjjhaejnlpcpekeekjmjfajk`
**New version:** 1.0.3
**Package to upload:** `Clone2GHL_v1.0.3_webstore.zip` (in this folder)

> **Why 1.0.3 and not 1.0.2?** Chrome will not accept a version number that has
> already been uploaded — even if that earlier upload (1.0.2) was rejected, the
> number is "used up." The code is the same; only the version number was bumped
> to 1.0.3 so the dashboard accepts it.

---

## Steps (about 5 minutes)

1. **Sign in** to the Chrome Web Store Developer Dashboard:
   https://chrome.google.com/webstore/devconsole
   (Use the developer account that owns the extension.)

2. **Open the existing item** — click **Clone2GHL – Funnel Intelligence Platform**
   in your items list. (Do NOT click "New Item" — this is an update.)

3. **Upload the new package:**
   - In the left sidebar, click **Package**.
   - Click **Upload new package**.
   - Select **`Clone2GHL_v1.0.3_webstore.zip`** from this folder.
   - The dashboard reads the version automatically (1.0.3) and accepts it.

4. **Add the release notes:**
   - Open `CHANGELOG_v1.0.3.txt` (in this folder), copy the bullet list, and
     paste it into the **"What's new"** field.
   - The rest of the store listing (name, description, screenshots, category)
     is already set — leave it as-is unless you want to change something.

5. **If the dashboard flags any missing fields** (e.g. on the *Privacy practices*
   tab):
   - Permission justifications → copy from `PERMISSIONS_JUSTIFICATION.md`.
   - Single-purpose statement & privacy answers → copy from `STORE_LISTING.md`.
   - Privacy policy URL must be live (see `privacy-policy-COMPLIANT.html`).

6. **Submit for review:**
   - Go to the **Store listing** / **Status** area and click **Submit for review**.
   - Review usually takes **1–3 business days**. You'll get an email when it's
     approved. Existing users update automatically once it goes live.

---

## Troubleshooting

- **"Invalid version number in manifest … larger version than the published
  package"** → The version you're uploading is not higher than one already
  uploaded. Ask the developer to bump `manifest.json` to the next number and
  rebuild the ZIP.
- **"At least one screenshot is required"** → Upload the images from the
  `screenshots/` folder (Store listing tab).
- **Privacy policy errors** → Make sure the privacy policy URL opens in an
  incognito window with no login required.

---

## What's in this handover folder

| File / Folder                     | What it's for                                  |
|-----------------------------------|------------------------------------------------|
| `Clone2GHL_v1.0.3_webstore.zip`   | The package to upload (Step 3).                |
| `UPDATE_INSTRUCTIONS.md`          | This guide.                                     |
| `CHANGELOG_v1.0.3.txt`            | Text for the "What's new" field (Step 4).      |
| `STORE_LISTING.md`                | Listing copy & answers, if the form asks.      |
| `PERMISSIONS_JUSTIFICATION.md`    | Permission justifications, if the form asks.    |
| `privacy-policy-COMPLIANT.html`   | The privacy policy (host it / keep URL live).  |
| `screenshots/`                    | Store listing screenshots.                      |
| `promo/`                          | Optional promo images.                          |
