# Clone2GHL Web Store Publish Kit

This folder contains the files you need for Chrome Web Store submission.

## Included Files

- `Clone2GHL_v1.0.1_webstore.zip`
  - Upload this ZIP in the Chrome Web Store Developer Dashboard.
  - `manifest.json` is at the root of the archive.
  - This ZIP is built from the current `extension/` folder and includes the files missing from the old ZIP, including `owner-login.html`, `owner-login.js`, and `watchlistChecker.js`.

- `screenshots/`
  - Web Store sized screenshots at `1280x800`.
  - Use these in the Store Listing > Screenshots section.

- `promo/`
  - Optional listing graphics already sized for Chrome Web Store promotional slots.
  - Includes `small_promo_tile_440x280.png`, `large_promo_tile_920x680.png`, and `marquee_promo_1400x560.png`.

- `STORE_LISTING.md`
  - Copy/paste text for the listing name, summary, description, privacy answers, and single-purpose statement.

- `privacy-policy.html`
  - Host this file publicly and paste its public URL into the Web Store privacy policy field.
  - Replace the placeholder support email and website before publishing.

## What Still Requires Manual Input

- Chrome Web Store developer account login and submission.
- A public URL for `privacy-policy.html`.
- Final support contact details in the privacy policy.

## Submission Order

1. Open the Chrome Web Store Developer Dashboard.
2. Upload `Clone2GHL_v1.0.1_webstore.zip`.
3. Add the screenshots from `screenshots/`.
4. Optionally add promo images from `promo/`.
5. Paste the fields from `STORE_LISTING.md`.
6. Host `privacy-policy.html` and paste its public URL.
7. Submit for review.

## Notes

- Promo tiles and marquee images are optional for basic publication, and ready-to-use versions are included in `promo/`.
- The extension requests `<all_urls>` because users can clone arbitrary pages. Be ready to paste the justification from `extension/PERMISSIONS_JUSTIFICATION.md` if the Web Store console asks for it.
- The extension uses direct OpenAI calls for some AI features and can also use the Clone2GHL backend for account and video workflows. The publish docs in this repo have been aligned to that behavior.