/**
 * background.js — Clone2GHL Service Worker
 * Orchestrates: DOM extraction, GHL conversion, AI optimization, storage, API calls.
 */

// Cross-engine bootstrap: Chrome MV3 runs background.js as a service worker and
// loads dependencies via importScripts. Firefox loads them via the manifest's
// background.scripts array (no importScripts in an event page), so guard the call.
if (typeof importScripts === 'function') {
  importScripts('compat.js', 'ghlApi.js', 'ghlConverter.js', 'aiOptimizer.js', 'funnelAnalyzer.js', 'watchlistChecker.js', 'siteScanner.js');
}
// compat.js (loaded above on Chromium, or via manifest background.scripts on
// Firefox) normalizes chrome/browser. Fallback alias in case it was not loaded:
if (typeof globalThis.browser !== 'undefined' && globalThis.browser?.runtime) {
  globalThis.chrome = globalThis.browser;
}

const STORAGE_SOFT_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_STORED_FUNNELS = 100;
const ENCRYPTION_PREFIX = 'enc:v1';

const SENSITIVE_SETTING_KEYS = ['ghlApiKey', 'openaiApiKey', 'backendToken', 'backendRefreshToken'];
const BACKEND_TIMEOUT_MS = 15000;

// DEPLOY: set this to the hosted backend URL before publishing the extension
// (e.g. 'https://api.clone2ghl.com'). Leave as localhost for local development.
const DEFAULT_BACKEND_API_BASE = 'http://localhost:8080';

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(`${ENCRYPTION_PREFIX}:`);
}

async function getSettingsCryptoMeta() {
  const data = await chrome.storage.local.get('settingsCrypto');
  if (data.settingsCrypto?.secretKey) return data.settingsCrypto;

  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const settingsCrypto = {
    version: 1,
    secretKey: bytesToBase64(keyBytes),
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ settingsCrypto });
  return settingsCrypto;
}

async function getAesKey() {
  const { secretKey } = await getSettingsCryptoMeta();
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(secretKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptValue(value) {
  if (!value || isEncryptedValue(value)) return value || '';
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await getAesKey();
  const encoded = new TextEncoder().encode(value);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const payload = bytesToBase64(new Uint8Array(cipherBuffer));
  return `${ENCRYPTION_PREFIX}:${bytesToBase64(iv)}:${payload}`;
}

async function decryptValue(value) {
  if (!isEncryptedValue(value)) return value || '';
  const parts = value.split(':');
  if (parts.length !== 4) return '';

  try {
    const iv = base64ToBytes(parts[2]);
    const payload = base64ToBytes(parts[3]);
    const key = await getAesKey();
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return '';
  }
}

async function decryptSensitiveSettings(settings) {
  const output = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    output[key] = await decryptValue(output[key]);
  }
  return output;
}

async function encryptSensitiveSettings(settings) {
  const output = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    output[key] = await encryptValue(output[key]);
  }
  return output;
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  const defaults = {
    ghlApiKey: '',
    ghlLocationId: '',
    plan: 'free',
    credits: 6,
    theme: 'dark',
    backendEnabled: false,
    backendApiBase: DEFAULT_BACKEND_API_BASE,
    backendToken: '',
    backendRefreshToken: '',
    backendUser: null,
    devMode: false,
    ghlDomains: [], // extra white-label GHL builder domains (besides app.gohighlevel.com)
  };
  const merged = { ...defaults, ...(data.settings || {}) };
  const decrypted = await decryptSensitiveSettings(merged);

  const needsMigration = SENSITIVE_SETTING_KEYS.some(key => {
    const rawValue = merged[key];
    return typeof rawValue === 'string' && rawValue.length > 0 && !isEncryptedValue(rawValue);
  });

  if (needsMigration) {
    const encrypted = await encryptSensitiveSettings(decrypted);
    await chrome.storage.local.set({ settings: encrypted });
  }

  return decrypted;
}

async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  const encrypted = await encryptSensitiveSettings(merged);
  await chrome.storage.local.set({ settings: encrypted });
  return merged;
}

async function getFunnels() {
  const data = await chrome.storage.local.get('funnels');
  return data.funnels || [];
}

async function saveFunnel(funnel) {
  const funnels = await getFunnels();
  const existingIdx = funnels.findIndex(f => f.id === funnel.id);
  if (existingIdx >= 0) {
    funnels[existingIdx] = { ...funnels[existingIdx], ...funnel, updatedAt: new Date().toISOString() };
  } else {
    funnels.unshift({ ...funnel, createdAt: new Date().toISOString() });
  }
  const evicted = await persistFunnelsSafely(funnels, funnel.id);
  return { funnel, evicted };
}

// Persists under the storage soft limit, evicting the OLDEST funnels first.
// Never evicts `protectId` (the funnel being saved). Returns the names of any
// evicted funnels so the UI can tell the user instead of dropping silently.
async function persistFunnelsSafely(inputFunnels, protectId = null) {
  let funnels = inputFunnels.slice(0, MAX_STORED_FUNNELS);
  const evicted = [];
  const totalBefore = await chrome.storage.local.getBytesInUse(null);
  const funnelsBefore = await chrome.storage.local.getBytesInUse('funnels');

  const dropOldest = () => {
    // Drop from the end (oldest), but never the funnel we're saving.
    for (let i = funnels.length - 1; i >= 0; i--) {
      if (!protectId || funnels[i].id !== protectId) {
        evicted.push(funnels[i].name || funnels[i].id);
        funnels.splice(i, 1);
        return true;
      }
    }
    return false;
  };

  while (funnels.length > 0) {
    const payloadBytes = new TextEncoder().encode(JSON.stringify({ funnels })).length;
    const estimatedTotalAfter = totalBefore - funnelsBefore + payloadBytes;

    if (estimatedTotalAfter <= STORAGE_SOFT_LIMIT_BYTES) {
      try {
        await chrome.storage.local.set({ funnels });
        return evicted;
      } catch (err) {
        if (String(err?.message || '').toLowerCase().includes('quota')) {
          if (!dropOldest()) break;
          continue;
        }
        throw err;
      }
    }

    if (!dropOldest()) break;
  }

  throw new Error(protectId
    ? 'This page is too large to store — remove large uploaded images and try again.'
    : 'Storage limit reached. Please delete older funnels and try again.');
}

async function deleteFunnel(id) {
  const funnels = await getFunnels();
  const updated = funnels.filter(f => f.id !== id);
  await chrome.storage.local.set({ funnels: updated });
  return { deleted: true };
}

function buildBackendUrl(base, path) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function backendRequest(settings, path, options = {}) {
  const {
    method = 'GET',
    body = null,
    useAuth = true,
    authToken = null,
    _retried = false,
  } = options;

  if (!settings.backendApiBase) {
    throw new Error('Backend API base URL is not configured.');
  }

  const token = authToken ?? settings.backendToken;
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth) {
    if (!token) throw new Error('Not authenticated. Please sign in first.');
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const resp = await fetch(buildBackendUrl(settings.backendApiBase, path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    // Access token expired → transparently refresh once and retry, so users
    // never get silently logged out mid-session.
    if (resp.status === 401 && useAuth && !authToken && !_retried && settings.backendRefreshToken) {
      const newToken = await refreshAccessToken(settings);
      if (newToken) {
        const fresh = await getSettings();
        return backendRequest(fresh, path, { ...options, _retried: true });
      }
    }

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Preserve status + structured body so callers/UI can act on upgrade or
      // connect-GHL prompts (e.g. 402 upgrade{}, 403 ghlRequired).
      const err = new Error(data.error || `Backend error: HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Backend request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Exchange the stored refresh token for a new access token. Rotates both tokens
// (the backend invalidates the old refresh token). Returns the new access token
// on success, or null (and clears tokens) if the refresh token is no longer valid.
let refreshInFlight = null;
async function refreshAccessToken(settings) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const resp = await fetch(buildBackendUrl(settings.backendApiBase, '/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: settings.backendRefreshToken }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.token) {
        // Refresh token rejected — force a clean re-auth.
        await saveSettings({ backendToken: '', backendRefreshToken: '', backendUser: null });
        return null;
      }
      await saveSettings({
        backendToken: data.token,
        backendRefreshToken: data.refreshToken || settings.backendRefreshToken,
        backendUser: data.user || settings.backendUser,
      });
      return data.token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function syncUsageFromBackend(settings, prefetchedUsage = null) {
  if (!settings.backendEnabled || !settings.backendApiBase || !settings.backendToken) {
    return settings;
  }

  const usage = prefetchedUsage || await backendRequest(settings, '/api/usage', { method: 'GET', useAuth: true });
  const merged = await saveSettings({
    plan: usage.plan || settings.plan,
    credits: usage.clonesRemaining >= 0 ? usage.clonesRemaining : 999,
    featureFlags: usage.featureFlags || null,
    logosUsed: usage.logosUsed || 0,
    logosLimit: typeof usage.logosLimit === 'number' ? usage.logosLimit : 0,
    logosRemaining: typeof usage.logosRemaining === 'number' ? usage.logosRemaining : 0,
    aiUsed: usage.aiUsed || 0,
    aiLimit: typeof usage.aiLimit === 'number' ? usage.aiLimit : 0,
    aiRemaining: typeof usage.aiRemaining === 'number' ? usage.aiRemaining : 0,
    subscriptionStatus: usage.subscriptionStatus || null,
    currentPeriodEnd: usage.currentPeriodEnd || null,
    suspended: Boolean(usage.suspended),
    // ── Trial / upgrade state (drives popup + dashboard banners) ──────────────
    state: usage.state || null,
    isTrial: Boolean(usage.isTrial),
    trialEndsAt: usage.trialEndsAt || null,
    daysLeft: typeof usage.daysLeft === 'number' ? usage.daysLeft : null,
    trialClonesRemaining: typeof usage.trialClonesRemaining === 'number' ? usage.trialClonesRemaining : null,
    ghlValidated: Boolean(usage.ghlValidated),
    trialActivationRequired: Boolean(usage.trialActivationRequired),
    upgradeRequired: Boolean(usage.upgradeRequired),
    upgradeReason: usage.upgrade?.reason || null,
    // Store the BASE checkout URL (no ref); the captured referral code is appended
    // client-side at click time so it works for both proactive and forced upgrades.
    upgradeUrl: usage.checkoutUrl || usage.upgrade?.checkoutUrl || '',
    // Per-plan GHL checkout deep-links { starter, pro, agency } so each pricing
    // button routes to the right order page. Always present from /api/usage;
    // fall back to upgrade.plans for forced-upgrade responses. {} when unset.
    checkoutUrls: usage.checkoutUrls || usage.upgrade?.plans || {},
  });
  return merged;
}

async function deductCredit() {
  const settings = await getSettings();
  if (settings.devMode) return true;           // dev mode bypasses all credit checks
  if (settings.plan === 'owner') return true;  // owner account — unlimited
  if (settings.plan !== 'free') return true;   // paid plans have unlimited
  if (settings.credits <= 0) return false;
  await saveSettings({ credits: settings.credits - 1 });
  return true;
}

function generateId() {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Wait for a tab to reach status 'complete' (or time out). Shared by the silent
// single-clone flow and the multi-page Copy-Selected capture.
function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Page load timed out. The site may be slow or blocked.'));
    }, timeoutMs);
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tabId);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Open a URL in a background (invisible) tab, capture it with extractPageInContext,
// then close the tab. Returns the captured-page data (or throws).
async function extractUrlInBackgroundTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    const loadedTabId = await waitForTabComplete(tab.id, 30000);
    const results = await chrome.scripting.executeScript({
      target: { tabId: loadedTabId },
      func: extractPageInContext,
      world: 'MAIN',
    });
    const data = results[0]?.result;
    if (!data || data.error) throw new Error(data?.error || 'Extraction returned no data.');
    return data;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ── White-label GHL builder support ──────────────────────────────────────────
// GHL agencies run the builder on custom domains (e.g. app.youragency.com), not
// just app.gohighlevel.com. We track those domains and register the builder
// content scripts for them dynamically so paste works everywhere.
function getGhlDomains(settings) {
  const set = new Set(['app.gohighlevel.com']);
  for (const d of (settings?.ghlDomains || [])) {
    const h = String(d || '').trim().toLowerCase();
    if (h) set.add(h);
  }
  return [...set];
}

async function ghlBuilderUrls() {
  return getGhlDomains(await getSettings()).map((d) => `https://${d}/*`);
}

// Find an already-open GHL tab our content script can drive. Prefers a tab that has
// already sniffed the session (credsLearned), else returns any ready tab, else null.
async function findReadyGhlTab() {
  const tabs = await chrome.tabs.query({ url: await ghlBuilderUrls() });
  let best = null;
  for (const t of tabs) {
    const ping = await chrome.tabs.sendMessage(t.id, { action: 'C2GHL_BUILDER_PING' }).catch(() => null);
    if (ping?.ready) {
      const cand = { tabId: t.id, funnelId: ping.funnelId || '', locationId: ping.locationId || '', credsLearned: !!ping.credsLearned };
      if (cand.credsLearned) return cand;   // best possible — session already learned
      best = best || cand;
    }
  }
  return best;
}

// Ensure there's a GHL tab we can drive. If none is ready and a locationId is given,
// open the funnels-list page — it fires authenticated XHRs, so the injector sniffs
// the session there WITHOUT needing an open builder — and wait for it to become ready.
async function ensureGhlCredsTab({ openLocationId, onProgress } = {}) {
  const existing = await findReadyGhlTab();
  if (existing) return existing;
  if (!openLocationId) return null;
  if (onProgress) onProgress('Opening your GoHighLevel account…');
  const url = `https://app.gohighlevel.com/v2/location/${openLocationId}/funnels-websites/funnels`;
  const tab = await chrome.tabs.create({ url, active: true });
  const deadline = Date.now() + 16000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 900));
    const ping = await chrome.tabs.sendMessage(tab.id, { action: 'C2GHL_BUILDER_PING' }).catch(() => null);
    if (ping?.ready && ping.credsLearned) {
      return { tabId: tab.id, funnelId: ping.funnelId || '', locationId: ping.locationId || openLocationId, credsLearned: true };
    }
  }
  // Ready-but-not-yet-creds is fine: the content script polls the session further.
  return { tabId: tab.id, funnelId: '', locationId: openLocationId, credsLearned: false };
}

// Shared paste orchestration used by both the multi-page banner (PASTE_SET) and the
// per-funnel button (PUSH_FUNNEL_NATIVE). Acquires a creds-ready GHL tab (auto-opening
// the funnels list when creating a funnel — no open builder needed), then hands the
// clone-set + target contract to the content script which creates the funnel/pages and
// writes native content.
async function orchestratePaste(stored, data) {
  const settings = await getSettings();
  data = data || {};
  const createFunnel = !!data.createFunnel;
  const existingFunnelId = data.funnelId || '';
  const mode = createFunnel ? 'newFunnel' : (existingFunnelId ? 'existingFunnel' : 'openPage');
  const locationId = data.locationId || settings.ghlLocationId || '';
  const emit = (m) => { try { chrome.runtime.sendMessage({ action: 'PASTE_PROGRESS', step: 0, total: (stored.pages || []).length, message: m }).catch(() => {}); } catch (_) { /* ignore */ } };

  let tab = await findReadyGhlTab();
  if (!tab && (mode === 'newFunnel' || mode === 'existingFunnel')) {
    if (!locationId) throw new Error('Set your GHL Location ID in Settings first, then try again.');
    tab = await ensureGhlCredsTab({ openLocationId: locationId, onProgress: emit });
  }
  if (!tab) throw new Error('Open the GoHighLevel builder in a tab, then try again.');
  chrome.tabs.update(tab.tabId, { active: true }).catch(() => {});

  const target = {
    mode,
    funnelName: data.funnelName || stored.name || 'Cloned Funnel',
    funnelId: existingFunnelId || tab.funnelId || '',
    locationId: locationId || tab.locationId || '',
  };
  const resp = await chrome.tabs.sendMessage(tab.tabId, { action: 'C2GHL_PASTE_SET', cloneSet: stored, target });
  if (!resp?.success) throw new Error(resp?.error || 'Paste failed in the builder tab.');
  return { summary: resp.summary };
}

// Register the MAIN-world injector + bridge for any EXTRA (white-label) domains.
// app.gohighlevel.com is already covered by the static manifest entry.
async function registerBuilderScripts(domains) {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  const extra = (domains || []).filter((d) => d && d !== 'app.gohighlevel.com');
  const ids = ['c2ghl-builder-main', 'c2ghl-builder-bridge'];
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  } catch { /* none yet */ }
  if (!extra.length) return;
  const matches = extra.map((d) => `https://${d}/*`);
  try {
    await chrome.scripting.registerContentScripts([
      { id: 'c2ghl-builder-main', matches, js: ['ghlInternal.js', 'builderInjector.js'], runAt: 'document_start', world: 'MAIN', allFrames: true },
      { id: 'c2ghl-builder-bridge', matches, js: ['compat.js', 'ghlBuilderContent.js'], runAt: 'document_start', allFrames: true },
    ]);
    console.log('[c2ghl] builder scripts registered for', matches.join(', '));
  } catch (e) { console.warn('[c2ghl] registerContentScripts failed:', e.message); }
}

// Client-side conversion fallback (offline / pipeline disabled): emits the v1
// section-level custom_code model (a subset of the neutral element model).
function clientConvertPage(url, data) {
  const model = GHLConverter.convertToPageJson(data, { replaceForms: true, replacePhone: true, businessName: null });
  return {
    name: model.name || data.meta?.title || url,
    pathSlug: model.pathSlug,
    sourceUrl: data.meta?.url || url,
    source: 'client',
    pageJson: { name: model.name, pathSlug: model.pathSlug, seo: model.seo, sections: model.sections, fallbackHtml: model.fallbackHtml },
  };
}

// Send captured pages to the backend import pipeline (normalize → element model,
// GHL-aware, assets rehosted, internal links resolved) and poll until ready.
// Returns clone-set page records; any page the server couldn't normalize falls
// back to the client converter so the set is always complete.
async function backendNormalizePages(settings, captured, name, prog, total) {
  const payload = captured.map(({ data }) => ({
    html: data.html, styles: data.styles, imageSrcs: data.imageSrcs, meta: data.meta, structure: data.structure,
  }));
  const start = await backendRequest(settings, '/api/import/jobs', {
    method: 'POST', useAuth: true, body: { pages: payload, name: name || undefined, rehost: true },
  });
  if (!start?.jobId) throw new Error('Import did not start.');
  const job = await pollImportJob(settings, start.jobId, (msg) => prog(total, msg));
  const results = job.results || [];
  return captured.map(({ url, data }, i) => {
    const r = results[i];
    if (r && r.model && !r.error) {
      return { name: r.name || data.meta?.title || url, pathSlug: r.pathSlug, sourceUrl: r.sourceUrl || data.meta?.url || url, source: r.source || 'server', pageJson: r.model };
    }
    return clientConvertPage(url, data); // per-page fallback
  });
}

// Re-derive a native element model (pageJson) from (possibly edited) HTML.
// Prefers the server pipeline (element-wise, GHL-aware); always falls back to
// the client converter so it never fails. Shared by NORMALIZE_HTML,
// PUSH_FUNNEL_NATIVE and the PASTE_SET stale-page refresh.
async function derivePageJson(settings, { html, styles = '', name = 'Cloned Page', sourceUrl = '' }) {
  const meta = { title: name, url: sourceUrl };
  const captured = { html, styles, imageSrcs: [], meta, structure: {} };
  if (settings.usePipeline !== false && settings.backendToken) {
    try {
      const pages = await backendNormalizePages(settings, [{ url: meta.url, data: captured }], name, () => {}, 1);
      if (pages[0]?.pageJson) return { pageJson: pages[0].pageJson, source: pages[0].source || 'server' };
    } catch (_) { /* fall through to client convert */ }
  }
  const page = clientConvertPage(meta.url, captured);
  return { pageJson: page.pageJson, source: 'client' };
}

async function pollImportJob(settings, jobId, onMsg) {
  const startedAt = Date.now();
  const TIMEOUT_MS = 120000;
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const resp = await backendRequest(settings, `/api/import/jobs/${jobId}`, { method: 'GET', useAuth: true });
    const job = resp?.job;
    if (job?.status === 'ready') return job;
    if (job?.status === 'error') throw new Error('Import job failed on the server.');
    if (onMsg && job) onMsg(`Processing on server… (${job.ok ?? 0}/${job.total ?? '?'})`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('Import timed out.');
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ success: true, ...result }))
    .catch(err => sendResponse({
      success: false,
      error: err.message,
      status: err.status || null,
      // Structured backend body (upgrade{}, ghlRequired, reason, …) so the popup
      // and dashboard can show the right CTA.
      data: err.data || null,
    }));
  return true; // Keep message channel open for async
});

async function handleMessage(message, sender) {
  // Progress/broadcast messages fan out to every extension context (including this
  // service worker via content-script sends). They carry no request here — ack & ignore.
  if (['DISCOVER_CLONE_PROGRESS', 'DISCOVER_CLONE_COMPLETE', 'CLONE_COMPLETE',
       'PASTE_PROGRESS', 'CAPTURE_PROGRESS', 'CLONE_CLIPBOARD_UPDATED'].includes(message.action)) {
    return {};
  }

  switch (message.action) {

    // ── Settings ─────────────────────────────────────────────────────────────
    case 'GET_SETTINGS':
      return { settings: await getSettings() };

    case 'SAVE_SETTINGS':
      return { settings: await saveSettings(message.data) };

    // ── Backend Auth / Billing ──────────────────────────────────────────────
    case 'BACKEND_REGISTER': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/register', {
        method: 'POST',
        useAuth: false,
        body: { email: message.email, password: message.password },
      });

      const merged = await saveSettings({
        backendEnabled: true,
        backendToken: result.token,
        backendRefreshToken: result.refreshToken || '',
        backendUser: result.user || null,
        plan: result.user?.plan || settings.plan,
      });

      const synced = await syncUsageFromBackend(merged).catch(() => merged);
      return { user: result.user, settings: synced };
    }

    case 'BACKEND_LOGIN': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/login', {
        method: 'POST',
        useAuth: false,
        body: { email: message.email, password: message.password },
      });

      const merged = await saveSettings({
        backendEnabled: true,
        backendToken: result.token,
        backendRefreshToken: result.refreshToken || '',
        backendUser: result.user || null,
        plan: result.user?.plan || settings.plan,
      });

      const synced = await syncUsageFromBackend(merged).catch(() => merged);
      return { user: result.user, settings: synced };
    }

    // Activate a plan bought through the client's GoHighLevel checkout, using the
    // one-time code emailed to the buyer after payment. Mirrors BACKEND_LOGIN:
    // exchanges email + code for a backend token, then syncs plan/feature flags.
    case 'GHL_ACTIVATE': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/ghl/activate', {
        method: 'POST',
        useAuth: false,
        body: { email: message.email, code: message.code, password: message.password || undefined },
      });

      const merged = await saveSettings({
        backendEnabled: true,
        backendToken: result.token,
        backendRefreshToken: result.refreshToken || '',
        backendUser: result.user || null,
        plan: result.user?.plan || settings.plan,
      });

      const synced = await syncUsageFromBackend(merged).catch(() => merged);
      return { user: result.user, settings: synced };
    }

    // Start the one-time free trial. Requires the user to be signed in and to
    // have a working GHL connection (the backend re-validates server-side and
    // binds the trial to the GHL location). Returns the trial window + synced usage.
    case 'GHL_START_TRIAL': {
      const settings = await getSettings();
      const apiKey = String(message.apiKey ?? settings.ghlApiKey ?? '').trim();
      const locationId = String(message.locationId ?? settings.ghlLocationId ?? '').trim();
      if (!apiKey || !locationId) {
        throw new Error('Add your GoHighLevel API key and Location ID first, then start your trial.');
      }
      const result = await backendRequest(settings, '/api/trial/start', {
        method: 'POST', useAuth: true, body: { apiKey, locationId },
      });
      const synced = await syncUsageFromBackend(settings).catch(() => settings);
      return { trial: result, settings: synced };
    }

    case 'BACKEND_FORGOT_PASSWORD': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/forgot-password', {
        method: 'POST', useAuth: false, body: { email: message.email },
      });
      return { ...result };
    }

    case 'BACKEND_RESET_PASSWORD': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/reset-password', {
        method: 'POST', useAuth: false,
        body: { email: message.email, code: message.code, newPassword: message.newPassword },
      });
      return { ...result };
    }

    case 'BACKEND_LOGOUT': {
      const settings = await getSettings();
      // Best-effort revoke the refresh token server-side, then clear locally.
      if (settings.backendRefreshToken) {
        await backendRequest(settings, '/api/auth/logout', {
          method: 'POST', useAuth: false, body: { refreshToken: settings.backendRefreshToken },
        }).catch(() => {});
      }
      const updated = await saveSettings({ backendToken: '', backendRefreshToken: '', backendUser: null });
      return { settings: updated };
    }

    case 'BACKEND_ME': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/me', { method: 'GET', useAuth: true });
      const merged = await saveSettings({ backendUser: result.user || null, plan: result.user?.plan || settings.plan });
      const synced = await syncUsageFromBackend(merged).catch(() => merged);
      return { user: result.user, preferences: result.preferences || null, settings: synced };
    }

    case 'BACKEND_UPDATE_PROFILE': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/profile', {
        method: 'PATCH',
        useAuth: true,
        body: {
          displayName: message.displayName,
          company: message.company,
          timezone: message.timezone,
        },
      });

      const me = await backendRequest(settings, '/api/auth/me', { method: 'GET', useAuth: true });
      const merged = await saveSettings({ backendUser: me.user || settings.backendUser, plan: me.user?.plan || settings.plan });
      return { profile: result.profile, user: me.user, preferences: me.preferences || null, settings: merged };
    }

    case 'BACKEND_CHANGE_PASSWORD': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/change-password', {
        method: 'POST',
        useAuth: true,
        body: {
          currentPassword: message.currentPassword,
          newPassword: message.newPassword,
        },
      });
      return result;
    }

    case 'BACKEND_DELETE_ACCOUNT': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/auth/me', {
        method: 'DELETE',
        useAuth: true,
        body: { password: message.password },
      });
      // Account is deleted server-side — clear all local auth/session state.
      const updated = await saveSettings({ backendToken: '', backendRefreshToken: '', backendUser: null, plan: 'free' });
      return { ...result, settings: updated };
    }

    case 'BACKEND_GET_PREFERENCES': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/preferences', { method: 'GET', useAuth: true });
      return { preferences: result.preferences };
    }

    case 'BACKEND_SAVE_PREFERENCES': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/preferences', {
        method: 'PATCH',
        useAuth: true,
        body: message.preferences || {},
      });
      return { preferences: result.preferences };
    }

    // ── Admin / Owner endpoints ────────────────────────────────────────────────
    case 'BACKEND_ADMIN_WHOAMI': {
      const settings = await getSettings();
      try {
        const result = await backendRequest(settings, '/api/admin/whoami', { method: 'GET', useAuth: true });
        await saveSettings({ isOwner: Boolean(result.isOwner), ownerEmail: result.email || null });
        return result;
      } catch (err) {
        // Not signed in or backend unavailable → treat as not-owner
        return { isOwner: false, email: null, ownerConfigured: false, error: err.message };
      }
    }

    case 'BACKEND_ADMIN_STATS': {
      const settings = await getSettings();
      return await backendRequest(settings, '/api/admin/stats', { method: 'GET', useAuth: true });
    }

    case 'BACKEND_ADMIN_USERS': {
      const settings = await getSettings();
      const q = new URLSearchParams();
      if (message.limit) q.set('limit', String(message.limit));
      if (message.offset) q.set('offset', String(message.offset));
      if (message.plan) q.set('plan', String(message.plan));
      if (message.search) q.set('search', String(message.search));
      const qs = q.toString() ? `?${q}` : '';
      return await backendRequest(settings, `/api/admin/users${qs}`, { method: 'GET', useAuth: true });
    }

    case 'BACKEND_ADMIN_USER_SET_PLAN': {
      const settings = await getSettings();
      if (!message.userId || !message.plan) throw new Error('userId + plan required');
      return await backendRequest(settings, `/api/admin/users/${encodeURIComponent(message.userId)}/plan`, {
        method: 'PATCH', useAuth: true, body: { plan: message.plan },
      });
    }

    case 'BACKEND_ADMIN_USER_RESET_USAGE': {
      const settings = await getSettings();
      if (!message.userId) throw new Error('userId required');
      return await backendRequest(settings, `/api/admin/users/${encodeURIComponent(message.userId)}/reset-usage`, {
        method: 'POST', useAuth: true,
      });
    }

    case 'BACKEND_ADMIN_USER_DELETE': {
      const settings = await getSettings();
      if (!message.userId) throw new Error('userId required');
      return await backendRequest(settings, `/api/admin/users/${encodeURIComponent(message.userId)}`, {
        method: 'DELETE', useAuth: true,
      });
    }

    case 'BACKEND_ADMIN_ANALYTICS': {
      const settings = await getSettings();
      const days = Number(message.days || 30);
      return await backendRequest(settings, `/api/admin/analytics?days=${days}`, { method: 'GET', useAuth: true });
    }

    case 'BACKEND_ADMIN_INVOICES': {
      const settings = await getSettings();
      const q = new URLSearchParams();
      if (message.limit) q.set('limit', String(message.limit));
      if (message.offset) q.set('offset', String(message.offset));
      if (message.status) q.set('status', String(message.status));
      if (message.search) q.set('search', String(message.search));
      const qs = q.toString() ? `?${q}` : '';
      return await backendRequest(settings, `/api/admin/invoices${qs}`, { method: 'GET', useAuth: true });
    }

    // ── Admin business-ops (M3) ──────────────────────────────────────────────
    case 'BACKEND_ADMIN_USER_DETAIL': {
      const settings = await getSettings();
      if (!message.userId) throw new Error('userId required');
      return await backendRequest(settings, `/api/admin/users/${encodeURIComponent(message.userId)}`, { method: 'GET', useAuth: true });
    }

    case 'BACKEND_ADMIN_IMPERSONATE': {
      const settings = await getSettings();
      if (!message.userId) throw new Error('userId required');
      return await backendRequest(settings, `/api/admin/users/${encodeURIComponent(message.userId)}/impersonate`, { method: 'POST', useAuth: true });
    }

    case 'BACKEND_ADMIN_USER_ACTION': {
      // Generic suspend / unsuspend / extend / activation-code on a user.
      const settings = await getSettings();
      const { userId, op, body } = message;
      if (!userId || !op) throw new Error('userId + op required');
      const map = {
        suspend: ['POST', `/suspend`], unsuspend: ['POST', `/unsuspend`],
        extend: ['POST', `/extend`], 'activation-code': ['POST', `/activation-code`],
        'reset-ai-usage': ['POST', `/reset-ai-usage`],
      };
      const [method, suffix] = map[op] || [];
      if (!method) throw new Error(`Unknown admin op: ${op}`);
      return await backendRequest(settings, `/api/admin/users/${encodeURIComponent(userId)}${suffix}`, { method, useAuth: true, body: body || undefined });
    }

    case 'BACKEND_ADMIN_RENEWALS': {
      const settings = await getSettings();
      const days = Number(message.days || 7);
      return await backendRequest(settings, `/api/admin/renewals?days=${days}`, { method: 'GET', useAuth: true });
    }

    case 'BACKEND_ADMIN_AI_COSTS': {
      const settings = await getSettings();
      const q = message.month ? `?month=${encodeURIComponent(message.month)}` : '';
      return await backendRequest(settings, `/api/admin/ai-costs${q}`, { method: 'GET', useAuth: true });
    }

    case 'BACKEND_ADMIN_BULK': {
      const settings = await getSettings();
      return await backendRequest(settings, '/api/admin/bulk', {
        method: 'POST', useAuth: true,
        body: { action: message.bulkAction, ids: message.ids, plan: message.plan, days: message.days },
      });
    }

    case 'BACKEND_ADMIN_AUDIT': {
      const settings = await getSettings();
      const q = new URLSearchParams();
      if (message.limit) q.set('limit', String(message.limit));
      if (message.action) q.set('action', String(message.action));
      if (message.userId) q.set('userId', String(message.userId));
      const qs = q.toString() ? `?${q}` : '';
      return await backendRequest(settings, `/api/admin/audit${qs}`, { method: 'GET', useAuth: true });
    }

    case 'BACKEND_ADMIN_EXPORT_CSV': {
      // CSV isn't JSON — fetch raw text with the auth header and return it.
      const settings = await getSettings();
      const resp = await fetch(buildBackendUrl(settings.backendApiBase, '/api/admin/export/users.csv'), {
        headers: { Authorization: `Bearer ${settings.backendToken}` },
      });
      if (!resp.ok) throw new Error(`Export failed: HTTP ${resp.status}`);
      return { csv: await resp.text() };
    }

    case 'BACKEND_INVOICES_LIST': {
      const settings = await getSettings();
      try {
        return await backendRequest(settings, '/api/billing/invoices', { method: 'GET', useAuth: true });
      } catch (err) {
        // The billing/invoices route is only mounted when Stripe is enabled. Under
        // the GHL-only payment model it returns 404 — treat that as "no invoices"
        // so the billing view shows the empty state instead of a red error.
        if (err?.status === 404) return { invoices: [] };
        throw err;
      }
    }

    case 'BACKEND_SITES_LIST': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/sites', { method: 'GET', useAuth: true });
      return { sites: result.sites || [] };
    }

    case 'BACKEND_SITES_CREATE': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/sites', {
        method: 'POST', useAuth: true, body: message.site || {},
      });
      return { site: result.site };
    }

    case 'BACKEND_SITES_UPDATE': {
      const settings = await getSettings();
      const id = message.id;
      if (!id) throw new Error('Site id required');
      const result = await backendRequest(settings, `/api/sites/${encodeURIComponent(id)}`, {
        method: 'PATCH', useAuth: true, body: message.patch || {},
      });
      return { site: result.site };
    }

    case 'BACKEND_SITES_DELETE': {
      const settings = await getSettings();
      const id = message.id;
      if (!id) throw new Error('Site id required');
      const result = await backendRequest(settings, `/api/sites/${encodeURIComponent(id)}`, {
        method: 'DELETE', useAuth: true,
      });
      return result;
    }

    case 'BACKEND_LOG_ACTIVITY': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/activity/log', {
        method: 'POST',
        useAuth: true,
        body: {
          action: message.actionName,
          resourceType: message.resourceType,
          resourceId: message.resourceId,
          status: message.status,
          metadata: message.metadata,
        },
      });
      return { event: result.event };
    }

    case 'BACKEND_GET_ACTIVITY': {
      const settings = await getSettings();
      const q = new URLSearchParams();
      if (message.limit) q.set('limit', String(message.limit));
      if (message.offset) q.set('offset', String(message.offset));
      if (message.actionName) q.set('action', String(message.actionName));
      const result = await backendRequest(settings, `/api/activity${q.toString() ? `?${q.toString()}` : ''}`, {
        method: 'GET',
        useAuth: true,
      });
      return result;
    }

    case 'BACKEND_GET_ANALYTICS': {
      const settings = await getSettings();
      const days = Number(message.days || 30);
      const result = await backendRequest(settings, `/api/analytics/summary?days=${days}`, {
        method: 'GET',
        useAuth: true,
      });
      return { analytics: result };
    }

    case 'BACKEND_VIDEO_GENERATE': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/videos/generate', {
        method: 'POST',
        useAuth: true,
        body: {
          script: message.script,
          prompt: message.prompt,
          funnelId: message.funnelId,
          avatar: message.avatar,
          voice: message.voice,
          template: message.template,
          provider: message.provider,
          seconds: message.seconds,
          size: message.size,
          model: message.model,
        },
      });
      return { job: result.job };
    }

    case 'BACKEND_VIDEO_SCRIPT': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/videos/script', {
        method: 'POST',
        useAuth: true,
        body: {
          niche: message.niche,
          offer: message.offer,
          tone: message.tone,
          durationSec: message.durationSec,
          cta: message.cta,
        },
      });
      return {
        script: result.script,
        hook: result.hook,
        ctaLine: result.ctaLine,
        sceneHints: result.sceneHints,
        model: result.model,
      };
    }

    case 'BACKEND_VIDEO_PROVIDER_STATUS': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/videos/provider-status', {
        method: 'GET',
        useAuth: true,
      });
      return result;
    }

    case 'BACKEND_VIDEO_GET_JOB': {
      const settings = await getSettings();
      const result = await backendRequest(settings, `/api/videos/jobs/${message.jobId}`, {
        method: 'GET',
        useAuth: true,
      });
      return { job: result.job };
    }

    case 'BACKEND_VIDEO_LIST_JOBS': {
      const settings = await getSettings();
      const limit = Number(message.limit || 20);
      const result = await backendRequest(settings, `/api/videos/jobs?limit=${limit}`, {
        method: 'GET',
        useAuth: true,
      });
      return { jobs: result.jobs || [] };
    }

    case 'BACKEND_VIDEO_CANCEL_JOB': {
      const settings = await getSettings();
      const result = await backendRequest(settings, `/api/videos/jobs/${message.jobId}/cancel`, {
        method: 'POST',
        useAuth: true,
      });
      return { job: result.job };
    }

    case 'BACKEND_GET_USAGE': {
      const settings = await getSettings();
      const usage = await backendRequest(settings, '/api/usage', { method: 'GET', useAuth: true });
      // Persist the FULL plan/trial/upgrade state (reuses the sync field-mapping).
      const synced = await syncUsageFromBackend(settings, usage);
      return { usage, settings: synced };
    }

    case 'BACKEND_SYNC_FUNNELS': {
      // Bidirectional sync: pull cloud funnels, merge by last-write-wins on
      // updatedAt, then push local funnels the cloud is missing or behind on.
      const settings = await getSettings();
      const local = await getFunnels();
      const localById = new Map(local.map(f => [f.id, f]));

      const remoteResp = await backendRequest(settings, '/api/funnels', { method: 'GET', useAuth: true });
      const remote = remoteResp.funnels || [];
      const remoteById = new Map(remote.map(f => [f.id, f]));

      const tOf = f => Date.parse(f?.updatedAt || f?.createdAt || 0) || 0;
      let pushed = 0, pulled = 0;

      // Pull: remote funnels newer than (or absent from) local.
      const merged = [...local];
      for (const rf of remote) {
        const lf = localById.get(rf.id);
        if (!lf) { merged.unshift(rf); pulled += 1; }
        else if (tOf(rf) > tOf(lf)) {
          const idx = merged.findIndex(f => f.id === rf.id);
          if (idx >= 0) merged[idx] = rf;
          pulled += 1;
        }
      }
      await persistFunnelsSafely(merged);

      // Push: local funnels the cloud lacks or that are newer locally.
      for (const lf of local) {
        const rf = remoteById.get(lf.id);
        if (!rf || tOf(lf) > tOf(rf)) {
          await backendRequest(settings, `/api/funnels/${encodeURIComponent(lf.id)}`, {
            method: 'PUT', useAuth: true, body: lf,
          }).then(() => { pushed += 1; }).catch(() => {});
        }
      }

      return { synced: pushed + pulled, pushed, pulled };
    }

    // ── Version history (server-side snapshots from cloud sync) ──────────────
    case 'BACKEND_FUNNEL_VERSIONS': {
      const settings = await getSettings();
      if (!message.funnelId) throw new Error('funnelId required');
      return await backendRequest(settings, `/api/funnels/${encodeURIComponent(message.funnelId)}/versions`, { method: 'GET', useAuth: true });
    }

    case 'BACKEND_FUNNEL_RESTORE': {
      const settings = await getSettings();
      if (!message.funnelId || !message.versionId) throw new Error('funnelId + versionId required');
      const res = await backendRequest(settings, `/api/funnels/${encodeURIComponent(message.funnelId)}/restore`, {
        method: 'POST', useAuth: true, body: { versionId: message.versionId },
      });
      // Mirror the restored content into the local copy so the UI reflects it.
      if (res.funnel) {
        const funnels = await getFunnels();
        const local = funnels.find(f => f.id === message.funnelId);
        if (local) await saveFunnel({ ...local, html: res.funnel.html, optimizedHtml: res.funnel.optimizedHtml, updatedAt: res.funnel.updatedAt });
      }
      return res;
    }

    // ── Fidelity backfill for funnels cloned before scoring existed ──────────
    case 'ANALYZE_FIDELITY': {
      const funnels = await getFunnels();
      const funnel = funnels.find(f => f.id === message.funnelId);
      if (!funnel) throw new Error('Funnel not found.');
      const fidelity = FunnelAnalyzer.scoreFidelity({
        html: funnel.optimizedHtml || funnel.html || '',
        styles: '',
        structure: funnel.analysis?.structure || {},
      });
      await saveFunnel({ ...funnel, fidelity });
      return { fidelity };
    }

    // Rehost hot-linked images in a funnel's HTML via the backend (Pro/Agency).
    case 'REHOST_FUNNEL_ASSETS': {
      const settings = await getSettings();
      const funnels = await getFunnels();
      const funnel = funnels.find(f => f.id === message.funnelId);
      if (!funnel) throw new Error('Funnel not found.');

      const html = funnel.optimizedHtml || funnel.html || '';
      const urls = [...new Set((html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi) || [])
        .map(t => (t.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1])
        .filter(u => /^https?:\/\//i.test(u)))];
      if (!urls.length) return { rehosted: 0, message: 'No external images to rehost.' };

      const res = await backendRequest(settings, '/api/assets/rehost', {
        method: 'POST', useAuth: true, body: { urls },
      });
      const map = res.map || {};
      let rewritten = html;
      for (const [orig, next] of Object.entries(map)) {
        rewritten = rewritten.split(orig).join(next);
      }
      // The rewritten (rehosted) HTML is persisted below; the dashboard's clone
      // preview exposes a "Copy for GHL" action that copies this HTML to the
      // clipboard for a direct paste into a GHL Custom JS/HTML element (see
      // copyHtmlAndGuidePaste in dashboard.js). GHL has no API to write pages.
      // Persist the rewritten HTML back onto the funnel (whichever field held it).
      const patch = funnel.optimizedHtml ? { optimizedHtml: rewritten } : { html: rewritten };
      await saveFunnel({ ...funnel, ...patch });
      return { rehosted: res.rehosted || 0, failed: (res.failed || []).length, total: urls.length };
    }
// TODO: BACKEND_FUNNEL_EXPORT (zip of HTML + assets) for Pro/Agency
    case 'BACKEND_CHECKOUT': {
      const settings = await getSettings();
      const result = await backendRequest(settings, '/api/billing/checkout', {
        method: 'POST',
        useAuth: true,
        body: { plan: message.plan },
      });
      return { url: result.url };
    }

    case 'OPEN_DASHBOARD':
      await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      return { opened: true };

    case 'VALIDATE_GHL': {
      const s = await getSettings();
      return GHLApi.validateCredentials(message.apiKey || s.ghlApiKey, message.locationId || s.ghlLocationId);
    }

    case 'VALIDATE_OPENAI': {
      return AiOptimizer.validateApiKey(message.apiKey);
    }

    // ── GHL Funnel List (for picker UI) ──────────────────────────────────────
    case 'GET_GHL_FUNNELS': {
      const s = await getSettings();
      if (!s.ghlApiKey || !s.ghlLocationId) throw new Error('GHL credentials not configured.');
      const funnels = await GHLApi.getExistingFunnels(s.ghlApiKey, s.ghlLocationId);
      return { funnels };
    }

    // ── Funnel Storage ────────────────────────────────────────────────────────
    case 'GET_FUNNELS':
      return { funnels: await getFunnels() };

    case 'SAVE_FUNNEL':
      return await saveFunnel(message.data); // { funnel, evicted }

    case 'DELETE_FUNNEL':
      return deleteFunnel(message.id);

    // ── Page Cloning ──────────────────────────────────────────────────────────
    case 'CLONE_PAGE': {
      const settings = await getSettings();
      const backendUsageEnabled = Boolean(settings.backendEnabled && settings.backendApiBase && settings.backendToken);

      // Local-mode pre-check (the authoritative backend gate runs AFTER a
      // successful conversion below, so a conversion failure never burns a credit).
      if (!backendUsageEnabled && !settings.devMode && settings.plan !== 'owner' && settings.plan === 'free' && settings.credits <= 0) {
        throw new Error('No credits remaining. Upgrade your plan to continue cloning.');
      }

      const { capturedData, niche, optimize, businessName } = message.data;

      // Convert to GHL format (may throw on a malformed capture — must run BEFORE
      // we consume a credit so failures cost the user nothing).
      const converted = GHLConverter.convert(capturedData, {
        replaceForms: true,
        replacePhone: true,
        businessName: businessName || null,
      });

      // Analyze the funnel
      let analysis = null;
      try {
        const structure = message.data.structure || {};
        analysis = FunnelAnalyzer.analyze(structure);
      } catch (e) {
        console.warn('Analysis skipped:', e.message);
      }

      // Atomic usage gate + increment, only after the clone built successfully.
      // A 402/403 here throws (carrying upgrade/ghl details) before any AI cost.
      if (backendUsageEnabled) {
        await backendRequest(settings, '/api/usage/consume', { method: 'POST', useAuth: true, body: { ref: settings.capturedRef || undefined } });
      }

      // AI optimization if requested — routed through backend (no user API key needed)
      let optimizedHtml = null;
      let aiReport = null;
      if (optimize && settings.backendToken) {
        try {
          const optResult = await backendRequest(settings, '/api/ai/optimize', {
            method: 'POST', useAuth: true,
            body: {
              html: converted.ghlHtml,
              niche: niche || (analysis?.detectedNiche) || 'general',
              businessName: businessName || '',
            },
          });
          optimizedHtml = optResult?.html || null;

          if (analysis) {
            const reportResult = await backendRequest(settings, '/api/ai/report', {
              method: 'POST', useAuth: true,
              body: { html: converted.ghlHtml, analysis },
            }).catch(() => null);
            aiReport = reportResult?.report || null;
          }
        } catch (e) {
          console.warn('AI optimization failed:', e.message);
        }
      }

      // Score how faithfully the page was captured (CSS/assets/forms/responsive).
      let fidelity = null;
      try {
        fidelity = FunnelAnalyzer.scoreFidelity({
          html: capturedData.html || converted.ghlHtml,
          styles: capturedData.styles,
          structure: message.data.structure || {},
        });
      } catch (e) { console.warn('Fidelity scoring skipped:', e.message); }

      // Build funnel record
      const funnel = {
        id: generateId(),
        name: capturedData.meta?.title || 'Cloned Page',
        sourceUrl: capturedData.meta?.url || '',
        niche: niche || analysis?.detectedNiche || 'general',
        status: optimize && optimizedHtml ? 'optimized' : 'draft',
        html: converted.ghlHtml,
        optimizedHtml: optimizedHtml || null,
        analysis: analysis || null,
        aiReport: aiReport || null,
        fidelity: fidelity || null,
        meta: capturedData.meta || {},
        ghlFunnelId: null,
        ghlPageId: null,
      };

      await saveFunnel(funnel);
      if (!backendUsageEnabled) {
        await deductCredit();
      } else {
        await syncUsageFromBackend(settings).catch(() => {});
      }

      // Notify dashboard to auto-open editor
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'CLONE_COMPLETE', funnelId: funnel.id }).catch(() => {});
        });
      });

      return { funnel };
    }

    // ── AI Optimize Existing ──────────────────────────────────────────────────
    case 'OPTIMIZE_FUNNEL': {
      const { funnelId, niche, businessName } = message.data;
      const settings = await getSettings();
      if (!settings.backendToken) throw new Error('Sign in to your Clone2GHL account to use AI features.');

      const funnels = await getFunnels();
      const funnel = funnels.find(f => f.id === funnelId);
      if (!funnel) throw new Error('Funnel not found.');

      const optResult = await backendRequest(settings, '/api/ai/optimize', {
        method: 'POST', useAuth: true,
        body: {
          html: funnel.html,
          niche: niche || funnel.niche || 'general',
          businessName: businessName || '',
        },
      });
      const optimizedHtml = optResult?.html || funnel.html;

      let aiReport = null;
      if (funnel.analysis) {
        const reportResult = await backendRequest(settings, '/api/ai/report', {
          method: 'POST', useAuth: true,
          body: { html: funnel.html, analysis: funnel.analysis },
        }).catch(() => null);
        aiReport = reportResult?.report || null;
      }

      await saveFunnel({ ...funnel, optimizedHtml, aiReport, status: 'optimized' });
      return { optimizedHtml, aiReport };
    }

    // ── Analyze Existing Funnel ───────────────────────────────────────────────
    case 'ANALYZE_FUNNEL': {
      const structure = message.data;
      const analysis = FunnelAnalyzer.analyze(structure);
      return { analysis };
    }

    // ── Push to GHL ───────────────────────────────────────────────────────────
    case 'PUSH_TO_GHL': {
      // GoHighLevel's public API is READ-ONLY for funnels and pages — there is no
      // endpoint to create a page or write page content (it remains an open
      // feature request on GHL's side). So "Push to GHL" does NOT call the API to
      // write content. Instead it prepares the page HTML for a guided copy → paste
      // into a GHL "Custom JS/HTML" element and deep-links to the funnels area of
      // the user's location. The dashboard does the clipboard copy (it's a focused
      // page; the service worker can't reach the clipboard).
      const { funnelId, useOptimized } = message.data;
      const settings = await getSettings();
      const locationId = (settings.ghlLocationId || '').trim();

      const funnels = await getFunnels();
      const funnel = funnels.find(f => f.id === funnelId);
      if (!funnel) throw new Error('Funnel not found in local storage.');

      const html = (useOptimized && funnel.optimizedHtml) ? funnel.optimizedHtml : funnel.html;
      if (!html || html.length < 200) {
        throw new Error('Funnel HTML is empty or invalid. Please re-clone the site.');
      }

      const builderUrl = locationId
        ? `https://app.gohighlevel.com/v2/location/${locationId}/funnels-websites/funnels`
        : 'https://app.gohighlevel.com/';

      // Saving locally is the real state change; mark the funnel ready to paste.
      await saveFunnel({ ...funnel, status: 'exported', exportedAt: new Date().toISOString() });

      return {
        success: 'ready',
        html,
        builderUrl,
        funnelName: funnel.name || 'Clone2GHL Page',
        pageName: funnel.name || 'Clone2GHL Page',
      };
    }


    // ── Generate Logo ─────────────────────────────────────────────────────────
    case 'GENERATE_LOGO': {
      const settings = await getSettings();
      if (!settings.backendToken) throw new Error('Sign in to your Clone2GHL account to use AI features.');
      const result = await backendRequest(settings, '/api/ai/logo', { method: 'POST', useAuth: true, body: message.data });
      return { url: result?.url, revisedPrompt: result?.revisedPrompt };
    }

    // ── Generate Image (for image panel AI replacement) ───────────────────────
    case 'GENERATE_IMAGE': {
      const settings = await getSettings();
      if (!settings.backendToken) throw new Error('Sign in to your Clone2GHL account to use AI features.');
      const result = await backendRequest(settings, '/api/ai/logo', {
        method: 'POST', useAuth: true,
        body: {
          businessName: message.subject || 'placeholder image',
          industry: message.industry || 'general',
          style: message.style || 'modern',
          colors: [],
        },
      });
      return { url: result?.url, revisedPrompt: result?.revisedPrompt };
    }

    // ── Generate Headlines ────────────────────────────────────────────────────
    case 'GENERATE_HEADLINES': {
      const settings = await getSettings();
      if (!settings.backendToken) throw new Error('Sign in to your Clone2GHL account to use AI features.');
      const result = await backendRequest(settings, '/api/ai/headlines', {
        method: 'POST', useAuth: true,
        body: { niche: message.niche, offer: message.offer },
      });
      return { headlines: result?.headlines || [] };
    }

    // ── Extract Page (trigger content script) ─────────────────────────────────
    case 'EXTRACT_PAGE': {
      const tabId = message.tabId || sender.tab?.id;
      if (!tabId) throw new Error('No tab ID available');

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractPageInContext,
        world: 'MAIN',
      });

      return results[0]?.result || { error: 'Extraction failed' };
    }

    // ── Competitor Watchlist ─────────────────────────────────────────────────
    case 'WATCHLIST_GET':
      return { watchlist: await WatchlistChecker.getWatchlist() };

    case 'WATCHLIST_ADD': {
      const entry = {
        id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        url: message.url,
        label: message.label || '',
        niche: message.niche || 'general',
        addedAt: new Date().toISOString(),
        lastCheckedAt: null,
        snapshot: null,
        changes: [],
      };
      await WatchlistChecker.addEntry(entry);
      return { entry };
    }

    case 'WATCHLIST_REMOVE':
      await WatchlistChecker.removeEntry(message.id);
      return { removed: true };

    case 'WATCHLIST_FETCH_HTML': {
      const { html, fetchedAt } = await WatchlistChecker.fetchPageHtml(message.url);
      return { html, fetchedAt };
    }

    case 'WATCHLIST_SAVE_ENTRY':
      await WatchlistChecker.saveEntry(message.entry);
      return { saved: true };

    // ── Email Sequence Generator ──────────────────────────────────────────────
    case 'GENERATE_EMAIL_SEQUENCE': {
      const { niche, offer, tone, count } = message.data;
      const settings = await getSettings();

      // Backend path (when signed in)
      if (settings.backendEnabled && settings.backendApiBase && settings.backendToken) {
        try {
          const result = await backendRequest(settings, '/api/ai/email-sequence', {
            method: 'POST',
            useAuth: true,
            body: { niche, offer, tone, count },
          });
          return { emails: result.emails, source: 'backend' };
        } catch (err) {
          console.warn('Backend email-seq failed, falling back to local:', err.message);
        }
      }

      // Local template fallback — always works offline
      const emails = AiOptimizer.generateEmailSequenceLocal(
        niche || 'general',
        offer || '',
        tone || 'professional',
        count || 5
      );
      return { emails, source: 'local' };
    }

    // ── Owner Access ──────────────────────────────────────────────────────────
    case 'OWNER_UNLOCK': {
      const merged = await saveSettings({
        plan: 'owner',
        devMode: true,
        credits: 9999,
      });
      return { settings: merged };
    }

    case 'OWNER_LOCK': {
      // Revert to free plan; user can re-login any time
      const merged = await saveSettings({
        plan: 'free',
        devMode: false,
        credits: 6,
      });
      return { settings: merged };
    }

    // ── Silent Discover Clone (opens URL in bg tab, extracts, closes tab) ────────
    case 'CLONE_FROM_URL_SILENT': {
      const { url, niche, optimize } = message;
      if (!url) throw new Error('URL is required for silent clone.');

      const settings = await getSettings();

      // Local-mode pre-check only. The authoritative backend gate runs AFTER a
      // successful conversion (below) so failed extraction/conversion costs nothing.
      const backendUsageEnabled = Boolean(settings.backendEnabled && settings.backendApiBase && settings.backendToken);
      if (!backendUsageEnabled && !settings.devMode && settings.plan !== 'owner' && settings.plan === 'free' && settings.credits <= 0) {
        throw new Error('No credits remaining. Upgrade your plan to continue cloning.');
      }

      // Broadcast progress helper
      function broadcastProgress(step, total, msg) {
        chrome.runtime.sendMessage({ action: 'DISCOVER_CLONE_PROGRESS', step, total, message: msg, url }).catch(() => {});
      }

      broadcastProgress(1, 5, 'Opening website…');

      // Open tab invisibly
      const tab = await chrome.tabs.create({ url, active: false });

      // Wait for tab to finish loading (max 30s)
      const loadedTabId = await new Promise((resolve, reject) => {
        const TIMEOUT = 30000;
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('Page load timed out. The site may be slow or blocked.'));
        }, TIMEOUT);

        function listener(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(tabId);
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });

      broadcastProgress(2, 5, 'Scanning website structure…');

      // Inject extraction
      let extractedData;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: loadedTabId },
          func: extractPageInContext,
          world: 'MAIN',
        });
        extractedData = results[0]?.result;
      } catch (err) {
        chrome.tabs.remove(tab.id).catch(() => {});
        throw new Error(`Extraction failed: ${err.message}`);
      }

      broadcastProgress(3, 5, 'Collecting assets and sections…');
      chrome.tabs.remove(tab.id).catch(() => {}); // close background tab

      if (!extractedData || extractedData.error) {
        throw new Error(extractedData?.error || 'Extraction returned no data.');
      }

      // Convert to GHL format
      const converted = GHLConverter.convert(extractedData, {
        replaceForms: true,
        replacePhone: true,
        businessName: null,
      });

      broadcastProgress(4, 5, 'Building GHL layout…');

      // Analyze
      let analysis = null;
      try {
        analysis = FunnelAnalyzer.analyze(extractedData.structure || extractedData);
      } catch (e) { /* skip */ }

      // Atomic usage gate + increment, only after a successful conversion. A
      // 402/403 here throws (with upgrade/ghl details) before any AI cost.
      if (backendUsageEnabled) {
        await backendRequest(settings, '/api/usage/consume', { method: 'POST', useAuth: true, body: { ref: settings.capturedRef || undefined } });
      }

      // AI optimize if signed in
      let optimizedHtml = null;
      if (optimize && settings.backendToken) {
        try {
          const optResult = await backendRequest(settings, '/api/ai/optimize', {
            method: 'POST', useAuth: true,
            body: { html: converted.ghlHtml, niche: niche || analysis?.detectedNiche || 'general', businessName: '' },
          });
          optimizedHtml = optResult?.html || null;
        } catch (e) { /* skip */ }
      }

      broadcastProgress(5, 7, 'Saving funnel…');

      const funnel = {
        id: generateId(),
        name: extractedData.meta?.title || new URL(url).hostname.replace('www.', ''),
        sourceUrl: extractedData.meta?.url || url,
        niche: niche || analysis?.detectedNiche || 'general',
        status: optimizedHtml ? 'optimized' : 'draft',
        html: converted.ghlHtml,
        optimizedHtml: optimizedHtml || null,
        analysis: analysis || null,
        aiReport: null,
        meta: extractedData.meta || {},
        ghlFunnelId: null,
        ghlPageId: null,
      };

      await saveFunnel(funnel);
      if (!backendUsageEnabled) {
        await deductCredit();
      } else {
        await syncUsageFromBackend(settings).catch(() => {});
      }

      // GoHighLevel has no public write API for funnel pages, so we can't auto-push
      // content into a funnel. The clone is fully saved locally (the real work);
      // the user finishes with a one-click copy → paste via "Push to GHL" in My
      // Funnels. We surface whether GHL is connected so the dashboard can prompt
      // the right next step.
      const hasGhl = Boolean((settings.ghlApiKey || '').trim() && (settings.ghlLocationId || '').trim());
      const pushSkipped = !hasGhl;
      broadcastProgress(7, 7, hasGhl
        ? 'Saved. Open “Push to GHL” to copy & paste into your funnel.'
        : 'Saved locally. Add GHL credentials in Settings to enable one-click push.');

      // Notify dashboard
      chrome.runtime.sendMessage({ action: 'DISCOVER_CLONE_COMPLETE', funnelId: funnel.id, url }).catch(() => {});

      return {
        funnel,
        sectionCount: analysis?.sectionCount || 0,
        pushResult: null,
        pushError: null,
        pushSkipped,
        readyToPush: hasGhl,
        ghlFunnelId: null,
        ghlPageId: null,
      };
    }

    // ── Multi-page pipeline: Scan → Select → Copy Selected → Paste N Pages ─────
    case 'SCAN_SITE': {
      const { url, pageLinks } = message.data || {};
      return await SiteScanner.scan({ url, pageLinks: pageLinks || [] });
    }

    case 'CAPTURE_SELECTED': {
      const { urls, name } = message.data || {};
      if (!Array.isArray(urls) || !urls.length) throw new Error('No pages selected.');

      const settings = await getSettings();
      const backendUsageEnabled = Boolean(settings.backendEnabled && settings.backendApiBase && settings.backendToken);
      if (!backendUsageEnabled && !settings.devMode && settings.plan !== 'owner' && settings.plan === 'free' && settings.credits <= 0) {
        throw new Error('No credits remaining. Upgrade your plan to continue cloning.');
      }

      const total = urls.length;
      const prog = (i, msg) => chrome.runtime.sendMessage({ action: 'CAPTURE_PROGRESS', step: i, total, message: msg }).catch(() => {});

      // 1) Capture every selected page in the browser (the backend can't reach the DOM).
      const captured = [];
      const errors = [];
      for (let i = 0; i < total; i++) {
        const pageUrl = urls[i];
        prog(i, `Capturing page ${i + 1} of ${total}…`);
        try {
          const data = await extractUrlInBackgroundTab(pageUrl);
          // Authoritative usage gate per page, after a successful capture.
          if (backendUsageEnabled) {
            await backendRequest(settings, '/api/usage/consume', { method: 'POST', useAuth: true, body: {} });
          }
          captured.push({ url: pageUrl, data });
          if (!backendUsageEnabled) await deductCredit(); else await syncUsageFromBackend(settings).catch(() => {});
        } catch (e) {
          errors.push({ url: pageUrl, error: String(e?.message || e) });
        }
      }
      if (!captured.length) throw new Error(`Could not capture any of the ${total} selected page(s).`);

      // 2) Normalize → element model. Prefer the backend pipeline (real DOM parser,
      //    element-wise, GHL-aware); fall back to the client converter (custom_code).
      const usePipeline = backendUsageEnabled && settings.usePipeline !== false;
      let pages = null;
      if (usePipeline) {
        prog(total, 'Processing pages on the server…');
        try { pages = await backendNormalizePages(settings, captured, name, prog, total); }
        catch (e) { console.warn('[import] backend pipeline failed, using client converter:', e?.message); pages = null; }
      }
      if (!pages) pages = captured.map(({ url, data }) => clientConvertPage(url, data));
      prog(total, 'Done.');

      // Attach editable HTML per page so the dashboard editor can customize the
      // set before pasting. Client-converted pages already carry it as
      // pageJson.fallbackHtml (referenced, not duplicated); server-normalized
      // pages get a client-side conversion of the in-hand capture.
      pages.forEach((p, i) => {
        if (!p.pageJson?.fallbackHtml && !p.html) {
          try { p.html = GHLConverter.convert(captured[i].data, { replaceForms: true, replacePhone: true }).ghlHtml; }
          catch (_) { p.html = captured[i]?.data?.html || ''; }
        }
        p.pageJsonStale = false;
        p.updatedAt = new Date().toISOString();
      });

      // A clone set holds full HTML per page and can be large — drop the tail (loudly)
      // rather than silently exceed the storage budget.
      let kept = pages;
      const dropped = [];
      const sizeOf = (arr) => new TextEncoder().encode(JSON.stringify(arr)).length;
      while (kept.length > 1 && sizeOf(kept) > 6 * 1024 * 1024) {
        dropped.push(kept[kept.length - 1].name);
        kept = kept.slice(0, -1);
      }

      const host = (() => { try { return new URL(urls[0]).hostname.replace('www.', ''); } catch { return 'Cloned site'; } })();
      const cloneSet = {
        id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: name || host,
        createdAt: new Date().toISOString(),
        status: 'ready',
        pages: kept,
        errors,
        dropped,
      };
      await chrome.storage.local.set({ cloneClipboard: cloneSet });
      chrome.runtime.sendMessage({ action: 'CLONE_CLIPBOARD_UPDATED', count: kept.length }).catch(() => {});

      return { cloneSet: { id: cloneSet.id, name: cloneSet.name, count: kept.length, errors, dropped } };
    }

    case 'GET_CLONE_CLIPBOARD': {
      const cs = (await chrome.storage.local.get('cloneClipboard')).cloneClipboard || null;
      if (!cs) return { cloneSet: null };
      // Light summary only (omit big HTML) for the dashboard list.
      return {
        cloneSet: {
          id: cs.id, name: cs.name, createdAt: cs.createdAt, status: cs.status,
          count: (cs.pages || []).length,
          pages: (cs.pages || []).map(p => ({ name: p.name, path: p.pathSlug, sourceUrl: p.sourceUrl })),
          errors: cs.errors || [], dropped: cs.dropped || [],
        },
      };
    }

    case 'CLEAR_CLONE_CLIPBOARD': {
      await chrome.storage.local.remove('cloneClipboard');
      chrome.runtime.sendMessage({ action: 'CLONE_CLIPBOARD_UPDATED', count: 0 }).catch(() => {});
      return { cleared: true };
    }

    // Full HTML of one captured page — for the multi-page editor. (The list
    // endpoint above intentionally stays summary-only.)
    case 'GET_CLONE_PAGE': {
      const cs = (await chrome.storage.local.get('cloneClipboard')).cloneClipboard;
      const idx = message.data?.index;
      const page = cs?.pages?.[idx];
      if (!page) throw new Error('Page not found — recapture with “Copy Selected”.');
      const html = page.html || page.pageJson?.fallbackHtml || '';
      if (!html) throw new Error('This page has no editable HTML — recapture it.');
      return { page: { index: idx, name: page.name, pathSlug: page.pathSlug, sourceUrl: page.sourceUrl, html } };
    }

    // Persist edited page HTML back into the clone set. The stored pageJson is
    // now stale; PASTE_SET re-derives it before pasting so edits reach GHL.
    case 'SAVE_CLONE_PAGES': {
      const cs = (await chrome.storage.local.get('cloneClipboard')).cloneClipboard;
      if (!cs || !(cs.pages || []).length) throw new Error('Nothing to save — the captured set is gone.');
      const updates = message.data?.pages || [];
      let saved = 0;
      for (const { index, html } of updates) {
        const page = cs.pages[index];
        if (!page || !html) continue;
        page.html = html;
        page.pageJsonStale = true;
        page.updatedAt = new Date().toISOString();
        saved++;
      }
      if (saved) await chrome.storage.local.set({ cloneClipboard: cs });
      return { saved };
    }

    case 'IMPORT_HISTORY': {
      const settings = await getSettings();
      if (!settings.backendToken) return { jobs: [] };
      const res = await backendRequest(settings, '/api/import/jobs', { method: 'GET', useAuth: true }).catch(() => ({ jobs: [] }));
      return { jobs: res?.jobs || [] };
    }

    // Auto-enable Clone2GHL on a white-label GHL builder domain (sent by the
    // content script when it detects a GHL-built page on a new host).
    case 'REGISTER_GHL_DOMAIN': {
      const host = String(message.host || '').trim().toLowerCase();
      if (!host || host === 'app.gohighlevel.com') return { registered: false };
      const settings = await getSettings();
      const list = new Set(settings.ghlDomains || []);
      const isNew = !list.has(host);
      if (isNew) { list.add(host); await saveSettings({ ghlDomains: [...list] }); }
      await registerBuilderScripts(getGhlDomains(await getSettings()));
      // Inject into the current tab immediately so the user needn't reload twice.
      const tabId = sender?.tab?.id;
      if (tabId) {
        try { await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', files: ['ghlInternal.js', 'builderInjector.js'] }); } catch (_) { /* ignore */ }
        try { await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['compat.js', 'ghlBuilderContent.js'] }); } catch (_) { /* ignore */ }
      }
      return { registered: true, host, isNew };
    }

    case 'GET_BUILDER_STATUS': {
      const tabs = await chrome.tabs.query({ url: await ghlBuilderUrls() });
      if (!tabs.length) return { open: false };
      for (const t of tabs) {
        const ping = await chrome.tabs.sendMessage(t.id, { action: 'C2GHL_BUILDER_PING' }).catch(() => null);
        if (ping?.ready) return { open: true, tabId: t.id, credsLearned: !!ping.credsLearned, locationId: ping.locationId || '', funnelId: ping.funnelId || '' };
      }
      return { open: true, credsLearned: false };
    }

    // Re-derive a native element model (pageJson) from edited HTML so in-extension
    // editor changes actually reach the native paste. Prefers the server pipeline
    // (element-wise), always falls back to the client converter so it never fails.
    case 'NORMALIZE_HTML': {
      const html = message.data?.html || '';
      if (!html || html.length < 50) throw new Error('Nothing to normalize.');
      const settings = await getSettings();
      return derivePageJson(settings, {
        html,
        styles: message.data?.styles || '',
        name: message.data?.name || 'Cloned Page',
        sourceUrl: message.data?.sourceUrl || '',
      });
    }

    case 'PASTE_SET': {
      const stored = (await chrome.storage.local.get('cloneClipboard')).cloneClipboard;
      if (!stored || !(stored.pages || []).length) {
        throw new Error('Nothing to paste. Capture pages first with “Copy Selected”.');
      }
      // Pages edited in the dashboard carry stale pageJson — re-derive from the
      // edited HTML first so the native paste lands the edited content.
      const staleCount = stored.pages.filter((p) => p.pageJsonStale && p.html).length;
      if (staleCount) {
        const settings = await getSettings();
        chrome.runtime.sendMessage({ action: 'PASTE_PROGRESS', step: 0, total: staleCount, message: `Processing ${staleCount} edited page(s)…` }).catch(() => {});
        for (const page of stored.pages) {
          if (!page.pageJsonStale || !page.html) continue;
          const { pageJson, source } = await derivePageJson(settings, {
            html: page.html, name: page.name, sourceUrl: page.sourceUrl || '',
          });
          page.pageJson = pageJson;
          page.source = source;
          page.pageJsonStale = false;
        }
        await chrome.storage.local.set({ cloneClipboard: stored });
      }
      return orchestratePaste(stored, message.data);
    }

    // Per-funnel one-click native push. Re-derives the native element model from the
    // funnel's CURRENT html (so in-extension editor edits round-trip), wraps it as a
    // one-page clone set, and runs the same create-funnel → paste → verify flow.
    case 'PUSH_FUNNEL_NATIVE': {
      const funnels = await getFunnels();
      const funnel = funnels.find((f) => f.id === message.funnelId);
      if (!funnel) throw new Error('Funnel not found.');
      const html = funnel.optimizedHtml || funnel.html || '';
      if (!html || html.length < 100) throw new Error('This funnel has no content to push.');
      const settings = await getSettings();
      const { pageJson } = await derivePageJson(settings, {
        html, name: funnel.name || 'Cloned Page', sourceUrl: funnel.sourceUrl || '',
      });
      const stored = { name: funnel.name, pages: [{ name: funnel.name, pageJson, html }] };
      const res = await orchestratePaste(stored, message.data);
      try { await saveFunnel({ ...funnel, status: 'exported', exportedAt: Date.now(), pageJson }); } catch (_) { /* non-fatal */ }
      return res;
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

// ─── Content Script: extractPageInContext ─────────────────────────────────────
// Injected into the page's main world via chrome.scripting.executeScript.
// Captures full layout: lazy images, CSS backgrounds, external styles, SVGs, CSS vars.
async function extractPageInContext() {

  // ── Helpers ───────────────────────────────────────────────────────────────
  function toAbsolute(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
    try { return new URL(url, document.baseURI).href; } catch { return url; }
  }

  function fixCssUrls(cssText, sheetHref) {
    const base = sheetHref || document.baseURI;
    return cssText.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g, (match, rawUrl) => {
      if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || /^https?:\/\//i.test(rawUrl)) return match;
      try { return `url('${new URL(rawUrl, base).href}')`; } catch { return match; }
    });
  }

  // ── Fetch external CSS ────────────────────────────────────────────────────
  // Try CSSStyleSheet API first (fast, works for same-origin sheets even without CORS),
  // then fall back to fetch for cross-origin sheets that expose CORS headers.
  // When both inlining paths fail, record the href as a fallback <link> so the
  // cloned page can still load the stylesheet at render time.
  async function fetchExternalStyles() {
    const chunks = [];
    const fallbackLinks = [];
    const processedHrefs = new Set();

    for (const sheet of Array.from(document.styleSheets)) {
      if (!sheet.href || sheet.href.startsWith('chrome-extension')) continue;
      processedHrefs.add(sheet.href);
      try {
        const rules = Array.from(sheet.cssRules || []);
        if (rules.length) {
          chunks.push(fixCssUrls(rules.map(r => r.cssText).join('\n'), sheet.href));
          continue;
        }
      } catch { /* cross-origin SecurityError — fall through to fetch */ }
      try {
        const resp = await fetch(sheet.href, { mode: 'cors', credentials: 'omit' });
        if (resp.ok) {
          chunks.push(fixCssUrls(await resp.text(), sheet.href));
          continue;
        }
      } catch { /* unavailable cross-origin sheet */ }
      fallbackLinks.push(sheet.href);
    }

    // Also catch any <link> not yet reflected in document.styleSheets
    for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))) {
      const href = toAbsolute(link.getAttribute('href'));
      if (!href || href.startsWith('chrome-extension') || processedHrefs.has(href)) continue;
      try {
        const resp = await fetch(href, { mode: 'cors', credentials: 'omit' });
        if (resp.ok) { chunks.push(fixCssUrls(await resp.text(), href)); continue; }
      } catch { /* skip */ }
      fallbackLinks.push(href);
    }
    return { cssText: chunks.join('\n'), fallbackLinks };
  }

  // ── Wait for SPAs to hydrate (React/Vue/Next/etc) ───────────────────────────
  // Resolves once either: (a) the DOM is quiet for `quietMs` after readyState=complete,
  // or (b) `maxMs` is reached. Avoids extracting half-rendered SPA shells.
  function waitForHydration({ quietMs = 1500, maxMs = 8000 } = {}) {
    return new Promise(resolve => {
      const start = Date.now();
      let lastMutation = Date.now();
      const observer = new MutationObserver(() => { lastMutation = Date.now(); });
      observer.observe(document.body || document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true,
      });
      const tick = () => {
        const now = Date.now();
        if (now - start >= maxMs || (document.readyState === 'complete' && now - lastMutation >= quietMs)) {
          observer.disconnect();
          resolve();
          return;
        }
        setTimeout(tick, 200);
      };
      setTimeout(tick, Math.min(quietMs, 1000));
    });
  }

  function extractCtaButtons() {
    const selector = [
      'button', 'a.btn', 'a.button', 'a[href][role="button"]',
      '[role="button"]', 'input[type="submit"]', 'input[type="button"]',
      '[class*="cta"] button', '[class*="cta"] a',
    ].join(',');
    return Array.from(document.querySelectorAll(selector))
      .map(el => ({
        text: (el.textContent || el.value || '').trim(),
        tag: el.tagName,
        href: el.tagName === 'A' ? el.getAttribute('href') || '' : '',
        role: el.getAttribute('role') || '',
      }))
      .filter(btn => {
        if (!btn.text || btn.text.length >= 100) return false;
        if (btn.tag === 'A' && (!btn.href || btn.href === '#')) return false;
        return true;
      })
      .slice(0, 10);
  }

  // ── Step 0: Wait for SPA hydration / lazy content ────────────────────────
  try { await waitForHydration({ quietMs: 1500, maxMs: 8000 }); } catch { /* ignore */ }

  // ── Step 1: Capture computed background images BEFORE cloning ─────────────
  // Must run on the live DOM to access getComputedStyle. We tag each element
  // with a unique marker so we can find it in the clone and inline the style.
  const computedBgMap = new Map();
  let bgIdx = 0;
  try {
    const bgQuery = 'header,footer,main,section,article,aside,nav,div,figure,span,li';
    document.querySelectorAll(bgQuery).forEach(el => {
      const cs = getComputedStyle(el);
      const bgImage = cs.backgroundImage;
      if (!bgImage || bgImage === 'none') return;
      const marker = `c2bg${bgIdx++}`;
      el.setAttribute('data-c2ghl-bg', marker);
      computedBgMap.set(marker, {
        backgroundImage: bgImage,
        backgroundSize: cs.backgroundSize,
        backgroundPosition: cs.backgroundPosition,
        backgroundRepeat: cs.backgroundRepeat,
        backgroundColor: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null,
      });
    });
  } catch { /* ignore */ }

  // ── Step 1b: Capture open shadow-DOM / web-component content ──────────────
  // cloneNode(true) does NOT serialize shadow roots, so custom elements would come
  // through empty. Tag each OPEN shadow host on the live DOM and stash its rendered
  // innerHTML (markup + scoped <style>); we inline it into the clone after cloning.
  // Bounded to avoid runaway work on component-heavy apps.
  const shadowMap = new Map();
  let shadowIdx = 0;
  try {
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length && shadowIdx < 400; i++) {
      const sr = all[i].shadowRoot;
      if (sr && sr.innerHTML && sr.innerHTML.length < 200000) {
        const marker = `c2sh${shadowIdx++}`;
        all[i].setAttribute('data-c2ghl-shadow', marker);
        shadowMap.set(marker, sr.innerHTML);
      }
    }
  } catch { /* ignore */ }

  // ── Step 1c: Snapshot computed styles onto elements that become native leaves ─
  // External CSS can be CORS-blocked (unreadable), which strips an element's look.
  // For the element types that map to native GHL leaves, bake a curated set of
  // computed properties into inline styles — so the look survives AND the native
  // converter can read them (element.style → mapStyle → GHL style panel). Existing
  // inline styles win. Bounded + curated to respect the storage budget.
  const computedStyleMap = new Map();
  try {
    const CS_PROPS = ['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-align', 'line-height', 'text-transform', 'border-radius'];
    const els = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li,blockquote,figcaption');
    let n = 0;
    for (let i = 0; i < els.length && n < 1200; i++) {
      const el = els[i];
      if (el.closest('script,style,svg')) continue;
      const cs = getComputedStyle(el);
      const decls = [];
      for (const p of CS_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== 'rgba(0, 0, 0, 0)' && v !== '0px') decls.push(`${p}:${v}`);
      }
      if (!decls.length) continue;
      const marker = `c2cs${n++}`;
      el.setAttribute('data-c2ghl-cs', marker);
      computedStyleMap.set(marker, decls.join(';'));
    }
  } catch { /* ignore */ }

  // ── Step 2: Fetch external CSS ────────────────────────────────────────────
  const { cssText: externalCss, fallbackLinks: fallbackStylesheetLinks } = await fetchExternalStyles();

  // ── Step 3: Extract CSS custom properties (:root variables) ──────────────
  let cssVarsBlock = '';
  try {
    const rootCs = getComputedStyle(document.documentElement);
    const vars = [];
    for (let i = 0; i < rootCs.length; i++) {
      const prop = rootCs.item(i);
      if (prop.startsWith('--')) vars.push(`  ${prop}: ${rootCs.getPropertyValue(prop).trim()};`);
    }
    if (vars.length) cssVarsBlock = `:root {\n${vars.join('\n')}\n}`;
  } catch { /* ignore */ }

  // ── Step 4: Clone DOM ─────────────────────────────────────────────────────
  const clone = document.documentElement.cloneNode(true);

  // Remove noise — avoid touching cookie/popup/chat overlays that shouldn't be in the clone
  const noiseSelectors = [
    'script', 'noscript',
    'iframe:not([src*="youtube"]):not([src*="vimeo"]):not([src*="loom"])',
    '[id*="cookie-banner"],[class*="cookie-banner"]',
    '[id*="cookie-notice"],[class*="cookie-notice"]',
    '[id*="gdpr"],[class*="gdpr"]',
    '[id*="chat-widget"],[class*="chat-widget"]',
    '[id*="intercom"],[class*="drift"],[id*="crisp"],[class*="crisp"]',
    'ins.adsbygoogle,[id*="google_ads"],[id*="fb-root"]',
    '.grecaptcha-badge',
  ];
  for (const sel of noiseSelectors) {
    try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch { /* invalid selector — skip */ }
  }

  // Remove <link> tags — CSS already captured above
  clone.querySelectorAll('link').forEach(el => el.remove());

  // ── Step 5: Resolve lazy-loaded images ────────────────────────────────────
  // Many sites (Nike, Amazon, etc.) use data-src / data-lazy / data-nimg for
  // lazy loading. Swap those into real src so images appear in the clone.
  const LAZY_ATTRS = [
    'data-src', 'data-lazy', 'data-lazy-src', 'data-original',
    'data-url', 'data-delayed-url', 'data-nimg', 'data-img',
    'data-image', 'data-lazyload', 'data-srcset-orig',
  ];
  const PLACEHOLDER_SIGNATURES = [
    'data:image/gif;base64,R0lGOD',  // 1x1 gif
    'data:image/png;base64,iVBORw0KGgoAAAANS',  // 1x1 png
    'blank.gif', 'spacer.gif', 'placeholder', 'transparent.png',
  ];

  clone.querySelectorAll('img').forEach(img => {
    const currentSrc = img.getAttribute('src') || '';
    const isPlaceholder = !currentSrc || PLACEHOLDER_SIGNATURES.some(p => currentSrc.includes(p));

    for (const attr of LAZY_ATTRS) {
      const val = img.getAttribute(attr);
      if (val && !PLACEHOLDER_SIGNATURES.some(p => val.includes(p))) {
        if (isPlaceholder) img.setAttribute('src', toAbsolute(val));
        img.removeAttribute(attr);
        break;
      }
    }

    // Fix final src
    const finalSrc = img.getAttribute('src');
    if (finalSrc && !finalSrc.startsWith('data:')) {
      img.setAttribute('src', toAbsolute(finalSrc));
      img.setAttribute('data-original-src', toAbsolute(finalSrc));
    }
    img.setAttribute('loading', 'eager');
  });

  // ── Step 6: Fix <picture> source elements ─────────────────────────────────
  clone.querySelectorAll('picture source').forEach(source => {
    for (const attr of ['srcset', 'data-srcset', 'data-src']) {
      const val = source.getAttribute(attr);
      if (!val) continue;
      const fixed = val.replace(/([^\s,]+)(\s+\d+[wx])?(\s*,?\s*)/g, (m, url, desc, sep) => {
        if (!url || url === ',' || url.startsWith('data:')) return m;
        return toAbsolute(url) + (desc || '') + (sep || '');
      });
      source.setAttribute('srcset', fixed);
      if (attr !== 'srcset') source.removeAttribute(attr);
      break;
    }
  });

  // ── Step 7: Fix img srcset ────────────────────────────────────────────────
  clone.querySelectorAll('img[srcset], img[data-srcset]').forEach(img => {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    if (!srcset) return;
    const fixed = srcset.replace(/([^\s,]+)(\s+\d+[wx])?(\s*,?\s*)/g, (m, url, desc, sep) => {
      if (!url || url === ',' || url.startsWith('data:')) return m;
      return toAbsolute(url) + (desc || '') + (sep || '');
    });
    img.setAttribute('srcset', fixed);
    img.removeAttribute('data-srcset');
  });

  // ── Step 8: Apply captured CSS background images to clone ─────────────────
  if (computedBgMap.size > 0) {
    clone.querySelectorAll('[data-c2ghl-bg]').forEach(el => {
      const marker = el.getAttribute('data-c2ghl-bg');
      const bg = computedBgMap.get(marker);
      if (!bg) { el.removeAttribute('data-c2ghl-bg'); return; }

      const fixedBgImage = bg.backgroundImage.replace(
        /url\(['"]?([^'")\s]+)['"]?\)/g,
        (_, url) => (url.startsWith('data:') || url.startsWith('blob:')) ? `url('${url}')` : `url('${toAbsolute(url)}')`
      );

      const existing = (el.getAttribute('style') || '').replace(/;\s*$/, '');
      const parts = [
        existing,
        `background-image:${fixedBgImage}`,
        bg.backgroundSize && bg.backgroundSize !== 'auto' ? `background-size:${bg.backgroundSize}` : '',
        bg.backgroundPosition ? `background-position:${bg.backgroundPosition}` : '',
        bg.backgroundRepeat && bg.backgroundRepeat !== 'repeat' ? `background-repeat:${bg.backgroundRepeat}` : '',
        bg.backgroundColor ? `background-color:${bg.backgroundColor}` : '',
      ].filter(Boolean).join(';');

      el.setAttribute('style', parts);
      el.removeAttribute('data-c2ghl-bg');
    });
    // Clean markers from live DOM
    document.querySelectorAll('[data-c2ghl-bg]').forEach(el => el.removeAttribute('data-c2ghl-bg'));
  }

  // ── Step 8b: Inline captured shadow-DOM content into the clone ────────────
  if (shadowMap.size > 0) {
    try {
      clone.querySelectorAll('[data-c2ghl-shadow]').forEach(el => {
        const marker = el.getAttribute('data-c2ghl-shadow');
        const inner = marker && shadowMap.get(marker);
        el.removeAttribute('data-c2ghl-shadow');
        if (inner && !el.innerHTML.trim()) el.innerHTML = inner;
      });
    } catch { /* ignore */ }
    document.querySelectorAll('[data-c2ghl-shadow]').forEach(el => el.removeAttribute('data-c2ghl-shadow'));
  }

  // ── Step 8c: Bake captured computed styles into the clone (existing inline wins) ─
  if (computedStyleMap.size > 0) {
    try {
      clone.querySelectorAll('[data-c2ghl-cs]').forEach(el => {
        const marker = el.getAttribute('data-c2ghl-cs');
        const computed = marker && computedStyleMap.get(marker);
        el.removeAttribute('data-c2ghl-cs');
        if (!computed) return;
        const existing = (el.getAttribute('style') || '').replace(/;\s*$/, '');
        el.setAttribute('style', existing ? `${computed};${existing}` : computed); // computed first → explicit inline overrides
      });
    } catch { /* ignore */ }
    document.querySelectorAll('[data-c2ghl-cs]').forEach(el => el.removeAttribute('data-c2ghl-cs'));
  }

  // ── Step 9: Fix background-image in inline styles ─────────────────────────
  clone.querySelectorAll('[style*="background"]').forEach(el => {
    const style = el.getAttribute('style');
    if (!style) return;
    el.setAttribute('style', style.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (_, url) =>
      url.startsWith('data:') ? `url('${url}')` : `url('${toAbsolute(url)}')`
    ));
  });

  // ── Step 10: Fix SVG <use> references ────────────────────────────────────
  clone.querySelectorAll('use').forEach(use => {
    const href = use.getAttribute('href') || use.getAttribute('xlink:href');
    if (href && !href.startsWith('#')) use.setAttribute('href', toAbsolute(href));
  });

  // ── Step 11: Neutralize navigation links ─────────────────────────────────
  clone.querySelectorAll('a[href]').forEach(a => {
    a.setAttribute('data-original-href', a.getAttribute('href'));
    a.setAttribute('href', '#');
  });

  // ── Step 12: Remove tracking / event attributes ───────────────────────────
  clone.querySelectorAll('*').forEach(el => {
    ['onclick','onload','onerror','onmouseover','onmouseout','onsubmit',
     'data-ga','data-gtm','data-analytics','data-track','data-tracking'].forEach(a => el.removeAttribute(a));
  });

  // ── Step 13: Collect styles ───────────────────────────────────────────────
  const inlineStyles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');
  const styles = [cssVarsBlock, externalCss, inlineStyles].filter(Boolean).join('\n');

  // ── Step 14: Structural data ──────────────────────────────────────────────
  const headlines = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 10)
    .map(el => ({ tag: el.tagName, text: el.textContent.trim(), level: parseInt(el.tagName[1]) }));
  const ctaButtons = extractCtaButtons();
  const forms = Array.from(document.querySelectorAll('form')).map(form => ({
    fields: Array.from(form.querySelectorAll('input,select,textarea')).map(f => ({
      type: f.type || f.tagName.toLowerCase(), name: f.name || '', placeholder: f.placeholder || '',
    })),
  }));
  const testimonials = Array.from(document.querySelectorAll('[class*="testimonial"],[class*="review"],blockquote'))
    .slice(0, 5).map(el => el.textContent.trim().slice(0, 200));

  return {
    html: clone.outerHTML,
    styles,
    imageSrcs: Array.from(clone.querySelectorAll('img[src]')).map(i => i.getAttribute('src')).filter(s => s && !s.startsWith('data:')),
    meta: {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      url: window.location.href,
      domain: window.location.hostname,
      capturedAt: new Date().toISOString(),
      favicon: toAbsolute(
        document.querySelector('link[rel="icon"]')?.getAttribute('href') ||
        document.querySelector('link[rel="shortcut icon"]')?.getAttribute('href') ||
        document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ||
        '/favicon.ico'
      ),
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
      ogImage: toAbsolute(document.querySelector('meta[property="og:image"]')?.content || ''),
      ogType: document.querySelector('meta[property="og:type"]')?.content || '',
      themeColor: document.querySelector('meta[name="theme-color"]')?.content || '',
      lang: document.documentElement.lang || '',
      fallbackStylesheetLinks: fallbackStylesheetLinks || [],
    },
    structure: {
      headlines,
      ctaButtons,
      forms,
      testimonials,
      bodyText: document.body.innerText.slice(0, 5000),
      sections: Array.from(document.querySelectorAll('section,[class*="hero"],[class*="feature"],[class*="testimonial"]'))
        .slice(0, 20).map(el => ({ tag: el.tagName, className: el.className, textLength: el.textContent.trim().length })),
      images: Array.from(document.querySelectorAll('img[src]')).slice(0, 20)
        .map(img => ({ src: toAbsolute(img.getAttribute('src') || ''), alt: img.alt })),
      trustSignals: Array.from(document.querySelectorAll('[class*="trust"],[class*="badge"],[class*="guarantee"]'))
        .slice(0, 10).map(el => el.textContent.trim().slice(0, 100)),
      pricingElements: Array.from(document.querySelectorAll('[class*="price"],[class*="pricing"],.price,.cost'))
        .slice(0, 10).map(el => el.textContent.trim().slice(0, 80)),
    },
  };
}

// ─── Extension install / update ───────────────────────────────────────────────

const USAGE_SYNC_ALARM = 'c2g-usage-sync';
const USAGE_SYNC_PERIOD_MIN = 360; // 6 h

// Refresh plan/trial/usage state from the backend without the user acting, so a
// purchase or expiry on clone2ghl.com is reflected in the extension within a few
// hours (and immediately when the dashboard/popup opens). Best-effort.
async function backgroundSyncUsage() {
  try {
    const settings = await getSettings();
    if (settings.backendEnabled && settings.backendApiBase && settings.backendToken) {
      await syncUsageFromBackend(settings);
    }
  } catch { /* offline / signed-out — ignore */ }
}

function ensureUsageSyncAlarm() {
  try { chrome.alarms?.create(USAGE_SYNC_ALARM, { periodInMinutes: USAGE_SYNC_PERIOD_MIN }); } catch { /* alarms unavailable */ }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const encryptedDefaults = await encryptSensitiveSettings({
      ghlApiKey: '',
      ghlLocationId: '',
      openaiApiKey: '',
      plan: 'free',
      credits: 6, // matches planLimits.free — backend is authoritative once signed in
      theme: 'dark',
      backendEnabled: false,
      backendApiBase: DEFAULT_BACKEND_API_BASE,
      backendToken: '',
      backendRefreshToken: '',
      backendUser: null,
      devMode: false,
    });

    // Set default settings
    await chrome.storage.local.set({
      settings: encryptedDefaults,
      funnels: [],
    });
    // Open dashboard on first install
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }
  ensureUsageSyncAlarm();
  backgroundSyncUsage();
});

// Sync on browser startup and on a periodic alarm so plan/trial state never goes
// stale even if the user keeps the browser open for days.
chrome.runtime.onStartup?.addListener(() => {
  ensureUsageSyncAlarm();
  backgroundSyncUsage();
  getSettings().then((s) => registerBuilderScripts(getGhlDomains(s))).catch(() => {});
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === USAGE_SYNC_ALARM) backgroundSyncUsage();
});

// Register builder scripts for saved white-label GHL domains on service-worker init.
// registerContentScripts persists across restarts, so this is cheap + idempotent.
getSettings().then((s) => registerBuilderScripts(getGhlDomains(s))).catch(() => {});
