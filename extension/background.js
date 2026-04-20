/**
 * background.js — Clone2GHL Service Worker
 * Orchestrates: DOM extraction, GHL conversion, AI optimization, storage, API calls.
 */

// Import utility globals via importScripts (classic service worker)
importScripts('ghlApi.js', 'ghlConverter.js', 'aiOptimizer.js', 'funnelAnalyzer.js', 'watchlistChecker.js');

const STORAGE_SOFT_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_STORED_FUNNELS = 100;
const ENCRYPTION_PREFIX = 'enc:v1';

const SENSITIVE_SETTING_KEYS = ['ghlApiKey', 'openaiApiKey', 'backendToken'];
const BACKEND_TIMEOUT_MS = 15000;

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
    backendApiBase: 'http://localhost:8080',
    backendToken: '',
    backendUser: null,
    devMode: false,
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
  await persistFunnelsSafely(funnels);
  return funnel;
}

async function persistFunnelsSafely(inputFunnels) {
  let funnels = inputFunnels.slice(0, MAX_STORED_FUNNELS);
  const totalBefore = await chrome.storage.local.getBytesInUse(null);
  const funnelsBefore = await chrome.storage.local.getBytesInUse('funnels');

  while (funnels.length > 0) {
    const payloadBytes = new TextEncoder().encode(JSON.stringify({ funnels })).length;
    const estimatedTotalAfter = totalBefore - funnelsBefore + payloadBytes;

    if (estimatedTotalAfter <= STORAGE_SOFT_LIMIT_BYTES) {
      try {
        await chrome.storage.local.set({ funnels });
        return;
      } catch (err) {
        if (String(err?.message || '').toLowerCase().includes('quota')) {
          funnels.pop();
          continue;
        }
        throw err;
      }
    }

    // Drop oldest funnels first until we are safely under quota.
    funnels.pop();
  }

  throw new Error('Storage limit reached. Please delete older funnels and try again.');
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

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || `Backend error: HTTP ${resp.status}`);
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

async function syncUsageFromBackend(settings) {
  if (!settings.backendEnabled || !settings.backendApiBase || !settings.backendToken) {
    return settings;
  }

  const usage = await backendRequest(settings, '/api/usage', { method: 'GET', useAuth: true });
  const merged = await saveSettings({
    plan: usage.plan || settings.plan,
    credits: usage.clonesRemaining >= 0 ? usage.clonesRemaining : 999,
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

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ success: true, ...result }))
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true; // Keep message channel open for async
});

async function handleMessage(message, sender) {
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
        backendUser: result.user || null,
        plan: result.user?.plan || settings.plan,
      });

      const synced = await syncUsageFromBackend(merged).catch(() => merged);
      return { user: result.user, settings: synced };
    }

    case 'BACKEND_LOGOUT': {
      const updated = await saveSettings({ backendToken: '', backendUser: null });
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
      await saveSettings({
        plan: usage.plan || settings.plan,
        credits: usage.clonesRemaining >= 0 ? usage.clonesRemaining : 999,
      });
      return { usage };
    }

    case 'BACKEND_SYNC_FUNNELS': {
      const settings = await getSettings();
      const funnels = await getFunnels();
      let synced = 0;
      for (const funnel of funnels) {
        await backendRequest(settings, '/api/funnels', {
          method: 'POST',
          useAuth: true,
          body: funnel,
        });
        synced += 1;
      }
      return { synced };
    }

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
      return { funnel: await saveFunnel(message.data) };

    case 'DELETE_FUNNEL':
      return deleteFunnel(message.id);

    // ── Page Cloning ──────────────────────────────────────────────────────────
    case 'CLONE_PAGE': {
      const settings = await getSettings();
      const backendUsageEnabled = Boolean(settings.backendEnabled && settings.backendApiBase && settings.backendToken);

      if (backendUsageEnabled && !settings.devMode) {
        await backendRequest(settings, '/api/usage/consume', { method: 'POST', useAuth: true });
      }

      // Credit check (skipped in dev mode and owner plan)
      if (!backendUsageEnabled && !settings.devMode && settings.plan !== 'owner' && settings.plan === 'free' && settings.credits <= 0) {
        throw new Error('No credits remaining. Upgrade your plan to continue cloning.');
      }

      const { capturedData, niche, optimize, businessName } = message.data;

      // Convert to GHL format
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

      // AI optimization if requested — routed through backend (no user API key needed)
      let optimizedHtml = null;
      let aiReport = null;
      if (optimize && settings.backendToken) {
        try {
          const optResult = await backendRequest(settings, 'POST', '/api/ai/optimize', {
            html: converted.ghlHtml,
            niche: niche || (analysis?.detectedNiche) || 'general',
            businessName: businessName || '',
          });
          optimizedHtml = optResult?.html || null;

          if (analysis) {
            const reportResult = await backendRequest(settings, 'POST', '/api/ai/report', {
              html: converted.ghlHtml,
              analysis,
            }).catch(() => null);
            aiReport = reportResult?.report || null;
          }
        } catch (e) {
          console.warn('AI optimization failed:', e.message);
        }
      }

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

      const optResult = await backendRequest(settings, 'POST', '/api/ai/optimize', {
        html: funnel.html,
        niche: niche || funnel.niche || 'general',
        businessName: businessName || '',
      });
      const optimizedHtml = optResult?.html || funnel.html;

      let aiReport = null;
      if (funnel.analysis) {
        const reportResult = await backendRequest(settings, 'POST', '/api/ai/report', {
          html: funnel.html,
          analysis: funnel.analysis,
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
      const { funnelId, useOptimized } = message.data;
      const settings = await getSettings();

      const apiKey = (settings.ghlApiKey || '').trim();
      const locationId = (settings.ghlLocationId || '').trim();

      if (!apiKey) throw new Error('GHL API key not configured. Add it in Settings.');
      if (!locationId) throw new Error('GHL Location ID not configured. Add it in Settings.');

      // Validate credentials before attempting the full push so the user gets
      // a clear error immediately instead of a raw GHL API error from /funnels.
      const credCheck = await GHLApi.validateCredentials(apiKey, locationId);
      if (!credCheck.valid) {
        throw new Error(credCheck.error || 'GHL credentials are invalid. Re-check your Private Integration Token in Settings.');
      }

      const funnels = await getFunnels();
      const funnel = funnels.find(f => f.id === funnelId);
      if (!funnel) throw new Error('Funnel not found.');

      const htmlToUse = (useOptimized && funnel.optimizedHtml) ? funnel.optimizedHtml : funnel.html;

      const result = await GHLApi.pushFunnelToGHL(
        apiKey,
        {
          locationId,
          pageName: funnel.name || 'Clone2GHL Page',
          html: htmlToUse,
        },
        (step, total, msg) => {
          // Broadcast progress to any open dashboard
          chrome.runtime.sendMessage({ action: 'GHL_PUSH_PROGRESS', step, total, message: msg })
            .catch(() => {});
        }
      );

      // Update funnel record with GHL IDs
      await saveFunnel({
        ...funnel,
        ghlFunnelId: result.funnelId,
        ghlPageId: result.pageId,
        status: 'exported',
        exportedAt: new Date().toISOString(),
      });

      return result;
    }

    // ── Generate Logo ─────────────────────────────────────────────────────────
    case 'GENERATE_LOGO': {
      const settings = await getSettings();
      if (!settings.backendToken) throw new Error('Sign in to your Clone2GHL account to use AI features.');
      const result = await backendRequest(settings, 'POST', '/api/ai/logo', message.data);
      return { url: result?.url, revisedPrompt: result?.revisedPrompt };
    }

    // ── Generate Headlines ────────────────────────────────────────────────────
    case 'GENERATE_HEADLINES': {
      const settings = await getSettings();
      if (!settings.backendToken) throw new Error('Sign in to your Clone2GHL account to use AI features.');
      const result = await backendRequest(settings, 'POST', '/api/ai/headlines', {
        niche: message.niche,
        offer: message.offer,
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
  async function fetchExternalStyles() {
    const chunks = [];
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
        if (resp.ok) chunks.push(fixCssUrls(await resp.text(), sheet.href));
      } catch { /* unavailable cross-origin sheet — skip */ }
    }

    // Also catch any <link> not yet reflected in document.styleSheets
    for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))) {
      const href = toAbsolute(link.getAttribute('href'));
      if (!href || href.startsWith('chrome-extension') || processedHrefs.has(href)) continue;
      try {
        const resp = await fetch(href, { mode: 'cors', credentials: 'omit' });
        if (resp.ok) chunks.push(fixCssUrls(await resp.text(), href));
      } catch { /* skip */ }
    }
    return chunks.join('\n');
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

  // ── Step 2: Fetch external CSS ────────────────────────────────────────────
  const externalCss = await fetchExternalStyles();

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

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const encryptedDefaults = await encryptSensitiveSettings({
      ghlApiKey: '',
      ghlLocationId: '',
      openaiApiKey: '',
      plan: 'free',
      credits: 2,
      theme: 'dark',
      backendEnabled: false,
      backendApiBase: 'http://localhost:8080',
      backendToken: '',
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
});
