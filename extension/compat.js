/**
 * compat.js — cross-engine WebExtension shim (Chrome / Edge / Brave / Firefox).
 *
 * The codebase calls `chrome.*` with `await` (promise style). Chromium MV3
 * returns promises natively; Firefox only does so on the `browser.*` namespace.
 * This normalizes both so the same `chrome.*`-with-await code runs unchanged:
 *   - Firefox  → alias the promise-based `browser` onto `chrome`.
 *   - Chromium → expose a `browser` alias for parity (chrome is already promised).
 *
 * Must load FIRST in every context (service worker, background scripts, and each
 * extension page). It is a safe no-op where not needed.
 */
(function (g) {
  try {
    if (typeof g.browser !== 'undefined' && g.browser && g.browser.runtime) {
      // Firefox: `browser` is promise-based; make `chrome` delegate to it.
      g.chrome = g.browser;
    } else if (typeof g.chrome !== 'undefined' && typeof g.browser === 'undefined') {
      // Chromium family: `chrome` is already promise-based in MV3; add a `browser` alias.
      g.browser = g.chrome;
    }
  } catch (_) { /* non-extension context — ignore */ }

  // ── i18n ───────────────────────────────────────────────────────────────────
  // Translate static markup from _locales: [data-i18n] sets textContent,
  // [data-i18n-placeholder] sets placeholder, [data-i18n-aria] sets aria-label.
  // Missing keys leave the existing (English) text in place.
  function applyI18n(root) {
    const api = g.chrome || g.browser;
    const get = api && api.i18n && api.i18n.getMessage ? (k) => api.i18n.getMessage(k) : () => '';
    const scope = root || g.document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('[data-i18n]').forEach(el => { const m = get(el.getAttribute('data-i18n')); if (m) el.textContent = m; });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const m = get(el.getAttribute('data-i18n-placeholder')); if (m) el.setAttribute('placeholder', m); });
    scope.querySelectorAll('[data-i18n-aria]').forEach(el => { const m = get(el.getAttribute('data-i18n-aria')); if (m) el.setAttribute('aria-label', m); });
  }
  g.applyI18n = applyI18n;

  // Auto-run on our own extension pages only (never translate host pages).
  if (g.document && g.location && /^(chrome|moz)-extension:$/.test(g.location.protocol)) {
    g.document.addEventListener('DOMContentLoaded', () => applyI18n());
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
