/**
 * builderInjector.js — runs in the MAIN world of app.gohighlevel.com.
 *
 * Two jobs:
 *  1. SNIFF: wrap window.fetch + XMLHttpRequest so we observe the GHL builder's
 *     OWN authenticated requests and learn the live API base URL + auth headers
 *     (Authorization, token-id, channel, source, version, …). This is what makes
 *     the integration self-healing: we never hardcode a token, we reuse whatever
 *     the builder itself is already sending. Captured creds are stashed on the
 *     shared global `window.__C2GHL`.
 *  2. REPLAY: expose a postMessage command interface so the isolated-world content
 *     script (ghlBuilderContent.js) can ask us to create funnels/pages and save
 *     page content. We execute those calls here, in-page, so the session rides
 *     along, delegating request construction to window.C2GHLInternal.
 *
 * MAIN world has no chrome.* access — all talk to the extension goes through
 * window.postMessage (namespaced + same-window checked).
 *
 * Defensive by design: every hook is wrapped in try/catch and always falls back
 * to the original behavior. It must NEVER break the host GHL app.
 */
(function () {
  'use strict';

  const NS = '__c2ghl';
  const g = window;
  // Idempotent: we may be injected via the manifest world:"MAIN" entry AND the
  // ghlBuilderContent.js runtime fallback. Hook + bridge must install only once.
  if (g.__C2GHL_INJECTED) return;
  g.__C2GHL_INJECTED = true;
  g.__C2GHL = g.__C2GHL || { creds: null, sample: null, samples: [], writes: [], learnedAt: 0 };
  if (!Array.isArray(g.__C2GHL.writes)) g.__C2GHL.writes = [];
  if (!Array.isArray(g.__C2GHL.samples)) g.__C2GHL.samples = [];

  // GHL's builder runs in an iframe, so the sniffer runs in every frame and the
  // sub-frames forward what they learn UP to the top frame. That way the top-frame
  // console inspectors AND the (top-frame-only) paste both see the iframe's session.
  const IS_TOP = (function () { try { return window.top === window; } catch { return true; } })();
  function forwardUp(kind, data) {
    if (IS_TOP) return;
    try { window.top.postMessage({ __c2ghl_agg: true, kind, data }, '*'); } catch { /* cross-origin top — ignore */ }
  }
  if (IS_TOP) {
    g.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.__c2ghl_agg !== true) return;
      try {
        if (d.kind === 'creds' && d.data) { g.__C2GHL.creds = d.data; g.__C2GHL.learnedAt = Date.now(); }
        else if (d.kind === 'write' && d.data) { g.__C2GHL.writes.push(d.data); while (g.__C2GHL.writes.length > 50) g.__C2GHL.writes.shift(); }
        else if (d.kind === 'write-response' && d.data) { const w = g.__C2GHL.writes.find((x) => x.at === d.data.at && x.url === d.data.url); if (w) w.response = d.data.response; }
        else if (d.kind === 'sample' && d.data) { g.__C2GHL.samples.push(d.data); while (g.__C2GHL.samples.length > 12) g.__C2GHL.samples.shift(); g.__C2GHL.sample = d.data.json; }
      } catch { /* ignore */ }
    });
  }

  // Hosts whose requests are worth learning auth from.
  const API_HOST_RE = /(^|\.)leadconnectorhq\.com$|(^|\.)gohighlevel\.com$/i;

  // Header names we care to capture (lowercased). We also grab any x-* header.
  const AUTH_HEADERS = new Set([
    'authorization', 'token-id', 'channel', 'source', 'version',
    'accept', 'content-type',
  ]);

  function isApiUrl(url) {
    try { return API_HOST_RE.test(new URL(url, location.href).host); }
    catch { return false; }
  }

  /** Normalize a headers-like value (Headers | object | array) → lowercased map. */
  function readHeaders(h) {
    const out = {};
    try {
      if (!h) return out;
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach((v, k) => { out[String(k).toLowerCase()] = v; });
      } else if (Array.isArray(h)) {
        h.forEach(([k, v]) => { out[String(k).toLowerCase()] = v; });
      } else if (typeof h === 'object') {
        for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
      }
    } catch { /* ignore */ }
    return out;
  }

  /** Keep the most complete authenticated cred set we have seen. */
  function maybeLearn(url, headers) {
    try {
      if (!isApiUrl(url)) return;
      const hdrs = {};
      let hasAuth = false;
      for (const [k, v] of Object.entries(headers || {})) {
        const lk = k.toLowerCase();
        if (AUTH_HEADERS.has(lk) || lk.startsWith('x-')) {
          hdrs[lk] = v;
          if (lk === 'authorization' || lk === 'token-id') hasAuth = true;
        }
      }
      if (!hasAuth) return;
      let host = '';
      try { host = new URL(url, location.href).origin; } catch { /* ignore */ }
      g.__C2GHL.creds = { host, headers: hdrs };
      g.__C2GHL.learnedAt = Date.now();
      forwardUp('creds', g.__C2GHL.creds);
      // Announce once-ish so the content script can enable the Paste action.
      post('CREDS_LEARNED', null, { host });
    } catch { /* ignore */ }
  }

  // Capture GHL's real page-content schema (from the builder's own traffic) so the
  // native element field-names can be verified — see C2GHLInternal.sample()/writes().
  // Permissive: any reasonably-sized JSON with a builder-ish nested structure.
  function looksLikeContent(o) {
    try {
      const s = JSON.stringify(o);
      if (s.length < 400) return false;
      return /"(children|elements|rows|columns|sections|component|nodes|cells)"\s*:/.test(s)
        || /"type"\s*:\s*"(section|row|col|column|headline|paragraph|image|button|element|video|text|html|input|form)"/i.test(s);
    } catch { return false; }
  }
  function truncate(o) {
    try { return JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v))); }
    catch { return undefined; }
  }
  function pushSample(url, json) {
    try {
      const t = truncate(json);
      const entry = { url, at: Date.now(), json: t };
      g.__C2GHL.samples.push(entry);
      while (g.__C2GHL.samples.length > 12) g.__C2GHL.samples.shift();
      g.__C2GHL.sample = t; // most-recent content payload
      forwardUp('sample', entry);
    } catch { /* ignore */ }
  }
  // Auth/session/analytics endpoints whose bodies+responses carry tokens or are just
  // noise. NEVER record these (maybeLearn still reads their headers, but header VALUES
  // are never dumped). This keeps dump()/captureElements() free of credentials.
  const SENSITIVE_URL_RE = /\/(oauth|login|signin|refresh|sessions?|token|auth)\b|\/medias\/analytics\//i;
  function recordWrite(method, url, body) {
    try {
      if (!isApiUrl(url)) return null;
      if (SENSITIVE_URL_RE.test(url)) return null;   // never store auth/token endpoints
      const m = String(method || 'GET').toUpperCase();
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
      let parsed = null;
      if (typeof body === 'string' && body.length < 2000000) { try { parsed = JSON.parse(body); } catch { /* not json */ } }
      const entry = { method: m, url, at: Date.now(), body: parsed ? truncate(parsed) : undefined };
      g.__C2GHL.writes.push(entry);
      while (g.__C2GHL.writes.length > 50) g.__C2GHL.writes.shift();
      forwardUp('write', entry);
      if (parsed && looksLikeContent(parsed)) pushSample(url, parsed); // a save body IS the schema
      return entry;
    } catch { return null; }
  }

  // Attach a captured RESPONSE (status + truncated JSON) to a recorded write entry.
  // This is how create-funnel / create-step response shapes (the ids) get surfaced in
  // dump() so the integration can be verified/fixed without guesswork.
  function attachResponse(entry, status, text) {
    if (!entry) return;
    try {
      let parsed = null;
      if (typeof text === 'string' && text.length < 2000000) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
      entry.response = { status, body: parsed ? truncate(parsed) : (typeof text === 'string' ? text.slice(0, 400) : undefined) };
      forwardUp('write-response', { at: entry.at, url: entry.url, response: entry.response });
    } catch { /* ignore */ }
  }
  const CONTENT_URL_RE = /page|funnel|content|step|builder|element|section|website|store|node/i;
  function sampleFromText(url, getText) {
    try {
      if (!isApiUrl(url) || !CONTENT_URL_RE.test(url)) return;
      getText().then((t) => {
        if (!t || t.length > 2000000) return;
        let j; try { j = JSON.parse(t); } catch { return; }
        if (looksLikeContent(j)) pushSample(url, j);
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  // ── fetch hook ──────────────────────────────────────────────────────────────
  try {
    const origFetch = g.fetch;
    if (typeof origFetch === 'function') {
      g.fetch = function (input, init) {
        let url = '';
        let method = 'GET';
        let writeEntry = null;
        try {
          url = typeof input === 'string' ? input : (input && input.url) || '';
          method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET';
          let headers = readHeaders(init && init.headers);
          if ((!headers.authorization && !headers['token-id']) && input && input.headers) {
            headers = { ...readHeaders(input.headers), ...headers };
          }
          maybeLearn(url, headers);
          if (init && init.body != null && typeof init.body === 'string') writeEntry = recordWrite(method, url, init.body);
        } catch { /* ignore */ }
        const p = origFetch.apply(this, arguments);
        try {
          const M = String(method).toUpperCase();
          if (M === 'GET' && p && typeof p.then === 'function') {
            p.then((r) => { try { sampleFromText(url, () => r.clone().text()); } catch { /* ignore */ } }).catch(() => {});
          } else if (writeEntry && p && typeof p.then === 'function') {
            p.then((r) => { const st = r.status; r.clone().text().then((t) => attachResponse(writeEntry, st, t)).catch(() => {}); }).catch(() => {});
          }
        } catch { /* ignore */ }
        return p;
      };
      g.fetch.__c2ghlWrapped = true;
    }
  } catch { /* ignore */ }

  // ── XHR hook ─────────────────────────────────────────────────────────────────
  try {
    const XHR = g.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const origOpen = XHR.prototype.open;
      const origSet = XHR.prototype.setRequestHeader;
      const origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        try { this.__c2ghl = { url, method, headers: {} }; } catch { /* ignore */ }
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.setRequestHeader = function (k, v) {
        try { if (this.__c2ghl) this.__c2ghl.headers[String(k).toLowerCase()] = v; } catch { /* ignore */ }
        return origSet.apply(this, arguments);
      };
      XHR.prototype.send = function (body) {
        try {
          if (this.__c2ghl) {
            maybeLearn(this.__c2ghl.url, this.__c2ghl.headers);
            let writeEntry = null;
            if (typeof body === 'string') writeEntry = recordWrite(this.__c2ghl.method, this.__c2ghl.url, body);
            if (String(this.__c2ghl.method || 'GET').toUpperCase() === 'GET') {
              this.addEventListener('load', () => { try { sampleFromText(this.__c2ghl.url, () => Promise.resolve(this.responseText)); } catch { /* ignore */ } });
            } else if (writeEntry) {
              this.addEventListener('load', () => { try { attachResponse(writeEntry, this.status, this.responseText); } catch { /* ignore */ } });
            }
          }
        } catch { /* ignore */ }
        return origSend.apply(this, arguments);
      };
    }
  } catch { /* ignore */ }

  // ── postMessage bridge (content script ⇄ this MAIN-world script) ──────────────
  function post(type, id, payload) {
    try { g.postMessage({ [NS]: true, dir: 'main->cs', type, id, payload }, location.origin); }
    catch { /* ignore */ }
  }

  async function handleCommand(type, payload) {
    const api = g.C2GHLInternal;
    if (!api) throw new Error('C2GHLInternal not loaded');
    switch (type) {
      case 'GET_CREDS':
        return { learned: !!g.__C2GHL.creds, host: g.__C2GHL.creds?.host || null };
      case 'GET_CTX':       return api.currentContext();
      case 'CREATE_FUNNEL': return api.createFunnel(payload || {});
      case 'CREATE_STEP':   return api.createStep(payload || {});
      case 'SAVE_CONTENT':  return api.saveContent(payload || {});
      case 'VERIFY_PAGE':   return api.verifyPage(payload || {});
      case 'MEDIA_UPLOAD':  return api.uploadMedia(payload || {});
      default: throw new Error(`Unknown command: ${type}`);
    }
  }

  g.addEventListener('message', (event) => {
    const d = event.data;
    if (event.source !== g || !d || d[NS] !== true || d.dir !== 'cs->main') return;
    Promise.resolve()
      .then(() => handleCommand(d.type, d.payload))
      .then((data) => post('RESULT', d.id, { ok: true, data }))
      .catch((err) => post('RESULT', d.id, { ok: false, error: String(err && err.message || err) }));
  });

  // Let the content script know the injector is live (and whether creds exist yet).
  post('INJECTOR_READY', null, { learned: !!g.__C2GHL.creds });
})();
