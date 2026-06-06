# Cross-Browser & Web Store Compatibility

## Supported browsers
- **Chrome / Edge / Brave / Opera (Chromium, MV3):** ship `manifest.json` as-is.
  These engines run `background.js` as a service worker and load dependencies via
  `importScripts(...)`.
- **Firefox (MV3, ≥121):** ship `manifest.firefox.json` (rename to `manifest.json`
  in the Firefox build). Firefox loads background dependencies via the manifest's
  `background.scripts` array instead of `importScripts`, and provides the
  promise-based `browser` namespace.

`background.js` is engine-agnostic: it only calls `importScripts` when it exists
(Chromium SW) and aliases `globalThis.browser → chrome` on Firefox so the existing
`chrome.*` promise-style calls work unchanged.

### Firefox build (one extra step recommended)
For full API parity on older promise/callback edge cases, vendor Mozilla's
[`webextension-polyfill`](https://github.com/mozilla/webextension-polyfill) as
`extension/browser-polyfill.min.js` and prepend it to:
- `background.scripts` in `manifest.firefox.json`
- the `<script>` includes in `popup.html` / `dashboard.html` / `owner-login.html`

Then build with web-ext:
```
# Chrome/Edge/Brave
zip -r clone2ghl-chrome.zip . -x "manifest.firefox.json" "*.md"
# Firefox
cp manifest.firefox.json manifest.json && web-ext build && git checkout manifest.json
```

## Internationalization (i18n)
- `_locales/en/messages.json` is the default (`default_locale: "en"`); `_locales/es`
  is a sample translation. Missing keys fall back to English automatically.
- To localize a UI string, replace the literal with `chrome.i18n.getMessage('key')`
  and add the key to each locale file. The scaffold is in place; string migration
  is incremental.

## Chrome Web Store readiness
- **CSP:** `script-src 'self'; object-src 'self'` — no remote code, no `eval`,
  no inline scripts. Cloned page HTML is rendered only inside sandboxed iframes.
- **Permissions justification** (include in the store listing):
  - `activeTab` + `scripting` — read the current page's DOM to clone it, only when
    the user clicks Clone.
  - `tabs` — open the dashboard and (for "Discover") clone from a background tab.
  - `storage` — persist settings and saved funnels locally (sensitive keys are
    AES-GCM encrypted at rest).
  - `host_permissions: <all_urls>` — the product's purpose is to clone *any* page
    the user chooses; narrower hosts would defeat the feature. GHL/OpenAI hosts are
    listed explicitly for the API calls.
- **Privacy policy:** keep `privacy-policy.html` current — disclose that page
  content is processed for cloning, AI calls go to the configured backend/OpenAI,
  and account data is stored on the backend.

## GHL API resilience
`ghlApi.js` pins an API version but negotiates: on a version-rejection error it
falls back through `API_VERSIONS` and retries, so a GHL version deprecation
degrades gracefully instead of breaking every push.

## Accessibility
The floating clone button and its dismiss control expose `aria-label`/roles.
Continue adding ARIA labels, visible focus styles, and keyboard handlers to
dashboard modals/tabs as they evolve.
