/**
 * extension/upgradeLogic.js
 *
 * Pure, browser-independent helpers for the trial/upgrade UI. Dual-mode: loads as
 * a classic <script> (attaches window/self.C2GUpgrade) AND via require() in the
 * node test suite, so the shipped code and the tests exercise the same logic.
 */
(function (root) {
  // Append an affiliate ref code to a checkout URL, preserving any existing query.
  function appendRef(url, ref) {
    if (!url) return '';
    if (!ref) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'ref=' + encodeURIComponent(ref);
  }

  // Whether the top-of-page upgrade / connect-GHL banner should be shown for the
  // given synced settings. Owner/dev accounts never see it.
  function shouldShowUpgradeBanner(s) {
    if (!s) return false;
    if (s.plan === 'owner' || s.devMode) return false;
    return Boolean(s.trialActivationRequired || s.upgradeRequired);
  }

  // Resolve the checkout URL for a specific plan. Prefers a per-plan GHL deep-link
  // (checkoutUrls[plan]); falls back to the single configured URL; '' if neither.
  function planCheckoutUrl(checkoutUrls, plan, fallbackUrl) {
    var perPlan = (checkoutUrls && plan) ? checkoutUrls[plan] : '';
    return perPlan || fallbackUrl || '';
  }

  var api = { appendRef: appendRef, shouldShowUpgradeBanner: shouldShowUpgradeBanner, planCheckoutUrl: planCheckoutUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.C2GUpgrade = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
