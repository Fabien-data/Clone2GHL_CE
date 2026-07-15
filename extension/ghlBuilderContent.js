/**
 * ghlBuilderContent.js — isolated-world content script on app.gohighlevel.com.
 *
 * Bridges the extension to the MAIN-world injector:
 *  - Ensures ghlInternal.js + builderInjector.js are running in the MAIN world
 *    (manifest registers them as world:"MAIN"; this is a runtime fallback in case
 *    that is unavailable, e.g. older Firefox).
 *  - Relays commands to the MAIN world via window.postMessage and resolves replies.
 *  - Handles C2GHL_PASTE_SET from the background/dashboard: runs the Paste-N-Pages
 *    job (create funnel? → per page: create page + save content) and streams
 *    PASTE_PROGRESS back to the dashboard. The actual authenticated I/O happens in
 *    the MAIN world; orchestration + progress reporting happen here (we have
 *    chrome.runtime; the MAIN world does not).
 */
(function () {
  'use strict';
  // GHL's builder lives in an iframe on page-builder.leadconnectorhq.com — that's
  // where the session is same-site, so paste runs there. We also run in the top frame
  // (for non-iframed builders); the paste handler de-dupes so only one frame acts.
  const IS_BUILDER_FRAME = /(^|\.)page-builder\.leadconnectorhq\.com$/i.test(location.host);
  try { if (window.top !== window && !IS_BUILDER_FRAME) return; } catch (_) { /* ignore */ }
  const NS = '__c2ghl';
  let credsLearned = false;
  let injectorReady = false;

  // ── MAIN-world injection fallback ─────────────────────────────────────────────
  function injectScript(file) {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL(file);
      s.async = false; // preserve order: ghlInternal before builderInjector
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (_) { /* ignore */ }
  }
  // If the manifest world:"MAIN" entry already ran, INJECTOR_READY arrives quickly
  // and we skip the fallback. Otherwise inject manually.
  setTimeout(() => {
    if (!injectorReady) { injectScript('ghlInternal.js'); injectScript('builderInjector.js'); }
  }, 800);

  // ── postMessage bridge ────────────────────────────────────────────────────────
  const pending = new Map();
  let seq = 0;
  function callMain(type, payload) {
    return new Promise((resolve, reject) => {
      const id = 'c' + (++seq);
      pending.set(id, { resolve, reject });
      window.postMessage({ [NS]: true, dir: 'cs->main', type, id, payload }, location.origin);
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('MAIN-world timeout')); }
      }, 35000);
    });
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (event.source !== window || !d || d[NS] !== true || d.dir !== 'main->cs') return;
    if (d.type === 'INJECTOR_READY') { injectorReady = true; credsLearned = credsLearned || !!(d.payload && d.payload.learned); return; }
    if (d.type === 'CREDS_LEARNED') { credsLearned = true; return; }
    if (d.type === 'RESULT') {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.payload && d.payload.ok) p.resolve(d.payload.data);
      else p.reject(new Error((d.payload && d.payload.error) || 'MAIN-world error'));
    }
  });

  // ── URL context helpers ───────────────────────────────────────────────────────
  function getLocationId() {
    const m = location.pathname.match(/\/location\/([^/]+)/i) || location.href.match(/location\/([^/?#]+)/i);
    return m ? m[1] : '';
  }
  function getFunnelIdFromUrl() {
    // e.g. /funnels-websites/funnels/<funnelId> or ?funnelId=...
    const m = location.href.match(/funnels?\/([0-9a-zA-Z]{12,})/) || location.href.match(/[?&]funnelId=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // ── progress relay ────────────────────────────────────────────────────────────
  function progress(step, total, message) {
    try {
      chrome.runtime.sendMessage({ action: 'PASTE_PROGRESS', step, total, message }).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  // ── Paste job ─────────────────────────────────────────────────────────────────
  // One-click flow. `target.mode`:
  //   newFunnel      → CREATE_FUNNEL {name}, then every page is a new create-step page.
  //   existingFunnel → paste every page as a new create-step page in target.funnelId.
  //   openPage       → page 1 into the page already OPEN in the builder; extras create-step.
  // Every authenticated call runs in the MAIN world (ghlInternal); on a native-node
  // rejection we retry that page once as rich-text so it still lands, then read the
  // page back to confirm sections landed. Nothing is dropped: we report per-page
  // results and only signal "all done" when every page succeeded.
  async function saveOnePage(pg, pageId, funnelId, locationId) {
    const args = { pageJson: pg.pageJson, html: pg.html, name: pg.name, pageId, funnelId, locationId };
    try { await callMain('SAVE_CONTENT', args); return true; }        // native elements
    catch (e) { await callMain('SAVE_CONTENT', { ...args, forceHtml: true }); return false; } // rich-text fallback
  }

  // Poll for the sniffed session — the tab may have just opened, so give the builder
  // a moment to fire an authenticated request before giving up.
  async function ensureCreds(maxMs) {
    const deadline = Date.now() + (maxMs || 15000);
    let status = await callMain('GET_CREDS').catch(() => ({ learned: false }));
    while ((!status || !status.learned) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      status = await callMain('GET_CREDS').catch(() => ({ learned: false }));
    }
    return status || { learned: false };
  }

  async function runPaste(cloneSet, target) {
    const pages = (cloneSet && cloneSet.pages) || [];
    const total = pages.length;
    if (!total) throw new Error('Clone set is empty.');
    target = target || {};
    const mode = target.mode || 'openPage';

    progress(0, total, 'Connecting to the GHL builder…');
    const status = await ensureCreds(15000);
    if (!status || !status.learned) {
      throw new Error('Couldn’t read your GoHighLevel session. Open (or refresh) a GHL page in this tab, then try again.');
    }

    const ctx = await callMain('GET_CTX').catch(() => ({}));
    const locationId = target.locationId || (ctx && ctx.locationId) || getLocationId() || '';
    let funnelId = target.funnelId || (ctx && ctx.funnelId) || '';
    const openPageId = (ctx && ctx.pageId) || '';

    // Create a brand-new funnel up front when requested (no open builder needed —
    // creds are learnable on the funnels-list page).
    if (mode === 'newFunnel') {
      if (!locationId) throw new Error('Couldn’t determine your GHL location — open your GoHighLevel account first.');
      progress(0, total, `Creating funnel “${target.funnelName || 'Cloned Funnel'}”…`);
      const createdFunnel = await callMain('CREATE_FUNNEL', { name: target.funnelName, locationId });
      funnelId = createdFunnel && createdFunnel.funnelId;
      if (!funnelId) throw new Error('Funnel creation returned no id.');
    } else if (mode === 'existingFunnel' && !funnelId) {
      throw new Error('No funnel selected to paste into.');
    }

    const results = [];
    for (let i = 0; i < total; i++) {
      const pg = pages[i];
      const label = pg.name || `page ${i + 1}`;
      try {
        let pageId;
        let createdPage = false;
        if (mode === 'openPage' && i === 0) {
          if (!openPageId) throw new Error('No page open in the builder — open a funnel page first.');
          pageId = openPageId;                              // paste into the open page
        } else {
          if (!funnelId) throw new Error('Could not read the funnel — open the funnel’s page in the builder.');
          progress(i, total, `Creating page “${label}” in GHL…`);
          const createdStep = await callMain('CREATE_STEP', { funnelId, name: label, locationId });
          pageId = createdStep && createdStep.pageId;
          if (!pageId) throw new Error('create-step returned no pageId');
          createdPage = true;
        }
        progress(i, total, `Pasting “${label}”…`);
        const native = await saveOnePage(pg, pageId, funnelId, locationId);
        // Best-effort read-back — never fails the paste (getPageData is unverified).
        let sectionCount = null;
        try { const v = await callMain('VERIFY_PAGE', { pageId }); if (v && v.ok) sectionCount = v.sectionCount; } catch (_) { /* ignore */ }
        results.push({ name: label, ok: true, native, pageId, createdPage, openPage: mode === 'openPage' && i === 0, sectionCount });
      } catch (err) {
        results.push({ name: label, ok: false, error: String((err && err.message) || err) });
      }
    }

    const ok = results.filter((r) => r.ok).length;
    const verified = results.filter((r) => r.ok && typeof r.sectionCount === 'number' && r.sectionCount > 0).length;
    progress(total, total, `Done — ${ok}/${total} page(s). Reload the builder to see them.`);
    return { results, ok, total, verified, allDone: ok === total, funnelId, locationId, mode };
  }

  // ── extension message handler ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    if (msg.action === 'C2GHL_BUILDER_PING') {
      sendResponse({ ready: true, credsLearned, locationId: getLocationId(), funnelId: getFunnelIdFromUrl() });
      return; // sync
    }
    if (msg.action === 'C2GHL_PASTE_SET') {
      // De-dupe: if a page-builder iframe exists and we're NOT it, let the iframe
      // (same-site session) handle the paste — don't respond from the top frame.
      if (!IS_BUILDER_FRAME && document.querySelector('iframe[src*="page-builder.leadconnectorhq.com"]')) return;
      runPaste(msg.cloneSet, msg.target)
        .then(summary => sendResponse({ success: true, summary }))
        .catch(err => sendResponse({ success: false, error: String((err && err.message) || err) }));
      return true; // async
    }
  });
})();
