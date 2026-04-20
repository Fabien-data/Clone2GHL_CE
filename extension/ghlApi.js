/**
 * ghlApi.js
 * GoHighLevel API v2 client.
 * Handles: funnel creation, page creation, page content upload.
 *
 * Base URL: https://services.leadconnectorhq.com
 * Auth: Bearer {Private Integration Token or OAuth Access Token}
 * Required header: Version: 2021-07-28
 */

const GHLApi = (() => {
  const BASE_URL = 'https://services.leadconnectorhq.com';
  const API_VERSION = '2021-07-28';
  const REQUEST_TIMEOUT_MS = 20000;
  const MAX_RETRIES = 2;

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function shouldRetry(status) {
    return status === 408 || status === 429 || status >= 500;
  }

  function validateLocationId(locationId) {
    if (!locationId || typeof locationId !== 'string') return false;
    return /^[A-Za-z0-9_-]{8,}$/.test(locationId);
  }

  function headers(apiKey) {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Version': API_VERSION,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeFunnel(item) {
    if (!item || typeof item !== 'object') return null;
    const id = item.id || item._id || item.funnelId || item.funnel_id;
    if (!id) return null;
    return {
      id,
      name: item.name || item.title || item.funnelName || 'Unnamed Funnel',
    };
  }

  function extractFunnelsFromAnyShape(payload) {
    const candidates = [
      payload,
      payload?.data,
      payload?.data?.data,
      payload?.result,
      payload?.results,
      payload?.response,
      payload?.response?.data,
      payload?.payload,
    ];

    for (const node of candidates) {
      if (!node) continue;

      const arraysToTry = [
        asArray(node),
        asArray(node.funnels),
        asArray(node.list),
        asArray(node.items),
        asArray(node.records),
        asArray(node.results),
        asArray(node.docs),
        asArray(node.rows),
      ];

      for (const arr of arraysToTry) {
        if (!arr.length) continue;
        const normalized = arr.map(normalizeFunnel).filter(Boolean);
        if (normalized.length) return normalized;
      }
    }

    return [];
  }

  function clampInt(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function buildFunnelListPath(locationId, limit, offset, useLegacySkip = false) {
    const safeLimit = clampInt(limit, 20, 1, 20);
    const safeOffset = clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const encodedLocation = encodeURIComponent(locationId || '');

    if (useLegacySkip) {
      return `/funnels/funnel/list?locationId=${encodedLocation}&limit=${safeLimit}&skip=${safeOffset}`;
    }

    return `/funnels/funnel/list?locationId=${encodedLocation}&limit=${safeLimit}&offset=${safeOffset}`;
  }

  async function fetchFunnelsPage(apiKey, locationId, { limit = 20, offset = 0 } = {}) {
    const primaryPath = buildFunnelListPath(locationId, limit, offset, false);
    try {
      return await request('GET', primaryPath, apiKey);
    } catch (err) {
      // Backward compatibility for tenants that still expect "skip" instead of "offset".
      const fallbackPath = buildFunnelListPath(locationId, limit, offset, true);
      return request('GET', fallbackPath, apiKey);
    }
  }

  async function request(method, path, apiKey, body = null) {
    const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!trimmedKey) {
      throw new GHLApiError('Missing API key.', 401, null);
    }

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const opts = {
          method,
          headers: headers(trimmedKey),
          signal: controller.signal,
        };
        if (body) opts.body = JSON.stringify(body);

        const resp = await fetch(`${BASE_URL}${path}`, opts);
        const data = await resp.json().catch(() => ({ error: 'Invalid JSON response' }));

        if (!resp.ok) {
          const err = new GHLApiError(
            data.message || data.error || `HTTP ${resp.status}`,
            resp.status,
            data
          );

          if (attempt < MAX_RETRIES && shouldRetry(resp.status)) {
            await wait(500 * (attempt + 1));
            continue;
          }
          throw err;
        }

        return data;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES && (err.name === 'AbortError' || shouldRetry(err.status || 0))) {
          await wait(500 * (attempt + 1));
          continue;
        }
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (lastError?.name === 'AbortError') {
      throw new GHLApiError('Request timed out while contacting GoHighLevel.', 408, null);
    }
    throw lastError;
  }

  class GHLApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'GHLApiError';
      this.status = status;
      this.data = data;
    }
  }

  // ─── Locations ────────────────────────────────────────────────────────────

  /** Verify the API key by fetching location info */
  async function getLocation(apiKey, locationId) {
    return request('GET', `/locations/${locationId}`, apiKey);
  }

  // ─── Funnels ──────────────────────────────────────────────────────────────

  /** List all funnels for a location */
  async function listFunnels(apiKey, locationId, { limit = 20, skip = 0, offset = null } = {}) {
    const finalOffset = offset == null ? skip : offset;
    return fetchFunnelsPage(apiKey, locationId, { limit, offset: finalOffset });
  }

  /**
   * Create a new funnel
   * @param {string} apiKey
   * @param {Object} params - { locationId, name, type }
   */
  async function createFunnel(apiKey, params) {
    return request('POST', '/funnels/funnel', apiKey, {
      locationId: params.locationId,
      name: params.name || 'Clone2GHL Funnel',
      type: params.type || 'funnel',
    });
  }

  // ─── Funnel Pages ─────────────────────────────────────────────────────────

  /** List all pages in a funnel */
  async function listFunnelPages(apiKey, locationId, funnelId) {
    return request('GET', `/funnels/page?locationId=${locationId}&funnelId=${funnelId}`, apiKey);
  }

  /**
   * Create a page inside a funnel
   * @param {string} apiKey
   * @param {Object} params - { locationId, funnelId, name, stepId? }
   */
  async function createFunnelPage(apiKey, params) {
    return request('POST', '/funnels/page', apiKey, {
      locationId: params.locationId,
      funnelId: params.funnelId,
      name: params.name || 'Clone2GHL Page',
      ...(params.stepId ? { stepId: params.stepId } : {}),
    });
  }

  /**
   * Update page content (HTML) via the page data endpoint.
   * Tries the documented body shape first, then a fallback shape used by some
   * GHL tenants that expect `body` instead of `content.html`.
   * @param {string} apiKey
   * @param {Object} params - { locationId, pageId, html }
   */
  async function updatePageContent(apiKey, params) {
    const html = params.html || '';
    // Primary shape (documented GHL v2 API)
    try {
      return await request('PUT', '/funnels/page/data', apiKey, {
        locationId: params.locationId,
        id: params.pageId,
        updatedAt: new Date().toISOString(),
        content: { html },
      });
    } catch (primaryErr) {
      // Fallback: some tenants use a `body` field at the top level
      try {
        return await request('PUT', '/funnels/page/data', apiKey, {
          locationId: params.locationId,
          id: params.pageId,
          updatedAt: new Date().toISOString(),
          body: html,
        });
      } catch {
        // Re-throw the original error so callers get the real message
        throw primaryErr;
      }
    }
  }

  // ─── Websites (alternative to funnels) ───────────────────────────────────

  /** List websites for a location */
  async function listWebsites(apiKey, locationId) {
    return request('GET', `/websites/?locationId=${locationId}`, apiKey);
  }

  // ─── Full Clone Flow ──────────────────────────────────────────────────────

  /**
   * Fetch the user's existing funnels.
   * Tries multiple known GHL API response shapes.
   * Returns an array of { id, name } objects.
   */
  async function getExistingFunnels(apiKey, locationId) {
    const firstPage = await fetchFunnelsPage(apiKey, locationId, { limit: 20, offset: 0 });
    const firstFunnels = extractFunnelsFromAnyShape(firstPage);
    if (firstFunnels.length) return firstFunnels;

    // Some accounts return data only after the first page token/offset.
    const secondPage = await fetchFunnelsPage(apiKey, locationId, { limit: 20, offset: 20 })
      .catch(() => null);
    const secondFunnels = extractFunnelsFromAnyShape(secondPage);
    if (secondFunnels.length) return secondFunnels;

    // Final fallback: website objects can include funnel metadata in some tenants.
    const websites = await listWebsites(apiKey, locationId).catch(() => null);
    return extractFunnelsFromAnyShape(websites);
  }

  /**
   * Full auto push flow:
   * 1. Fetch existing funnels → auto-pick "Clone2GHL" funnel or the first one
   * 2. Create a new page in that funnel
   * 3. Upload HTML to the page
   *
   * GHL API v2 does not expose a funnel-creation endpoint, so we always
   * work with existing funnels and add pages to them.
   *
   * @param {string} apiKey
   * @param {Object} params  — { locationId, pageName, html }
   * @param {Function} onProgress — callback(step, total, message)
   * @returns {Object} { funnelId, funnelName, pageId, ghlBuilderUrl, success }
   */
  async function pushFunnelToGHL(apiKey, params, onProgress) {
    if (!apiKey) throw new Error('Missing GHL API key.');
    if (!validateLocationId(params?.locationId)) {
      throw new Error('Invalid GHL Location ID format. Please verify your Location ID in Settings.');
    }

    const progress = (step, total, msg) => onProgress && onProgress(step, total, msg);

    // ── Step 1: Find an existing funnel to use ────────────────────────────────
    progress(1, 3, 'Finding your GHL funnels…');

    let funnelId, funnelName;
    const funnels = await getExistingFunnels(apiKey, params.locationId);

    if (funnels.length === 0) {
      throw new Error(
        'No funnels found in your GHL account. Please create at least one funnel in GoHighLevel first (Funnels & Websites → New Funnel), then try again.'
      );
    }

    // Prefer a funnel named "Clone2GHL" if the user has one, otherwise use the first
    const preferred = funnels.find(f => /clone2ghl/i.test(f.name)) || funnels[0];
    funnelId   = preferred.id;
    funnelName = preferred.name;

    // ── Step 2: Create a new page inside that funnel ──────────────────────────
    progress(2, 3, `Adding page to funnel "${funnelName}"…`);

    /** Extract page ID from any shape GHL returns */
    function extractPageId(resp) {
      if (!resp || typeof resp !== 'object') return null;
      return (
        resp?.page?.id ||
        resp?.data?.page?.id ||
        resp?.data?.id ||
        resp?.result?.id ||
        resp?.id ||
        null
      );
    }

    /** Extract first page from any shape GHL returns for page list */
    function extractFirstPage(resp) {
      if (!resp || typeof resp !== 'object') return null;
      const candidates = [
        resp?.funnelPages,
        resp?.pages,
        resp?.list,
        resp?.data?.funnelPages,
        resp?.data?.pages,
        resp?.data,
        resp?.results,
        resp?.items,
      ];
      for (const arr of candidates) {
        if (Array.isArray(arr) && arr.length) return arr[0];
      }
      return null;
    }

    let pageId;
    try {
      const pageData = await createFunnelPage(apiKey, {
        locationId: params.locationId,
        funnelId,
        name: params.pageName || 'Clone2GHL Page',
      });
      pageId = extractPageId(pageData);
      if (!pageId) throw new Error('No page ID in create response');
    } catch (err) {
      // createFunnelPage may be restricted — fall back to first existing page
      console.warn('Page create failed, falling back to first existing page:', err.message);
      try {
        const pagesResp = await listFunnelPages(apiKey, params.locationId, funnelId);
        const firstPage = extractFirstPage(pagesResp);
        if (firstPage?.id) {
          pageId = firstPage.id;
        }
      } catch (listErr) {
        console.warn('Page list also failed:', listErr.message);
      }
      if (!pageId) {
        return {
          funnelId, funnelName,
          pageId: null,
          success: 'html_only',
          ghlBuilderUrl: `https://app.gohighlevel.com/funnels/${funnelId}/builder`,
          warning: 'Could not create or find a page automatically. Open the funnel in GHL builder and paste the downloaded HTML manually.',
        };
      }
    }

    // ── Step 3: Upload HTML content ───────────────────────────────────────────
    progress(3, 3, 'Uploading page content…');

    try {
      await updatePageContent(apiKey, {
        locationId: params.locationId,
        pageId,
        html: params.html,
      });
    } catch (err) {
      console.warn('Content upload warning:', err.message);
      return {
        funnelId, funnelName, pageId,
        success: 'partial',
        ghlBuilderUrl: `https://app.gohighlevel.com/funnels/${funnelId}/builder`,
        warning: `Page added to "${funnelName}" but HTML upload failed (${err.message}). Open the page in GHL builder and paste the HTML manually.`,
      };
    }

    return {
      funnelId, funnelName, pageId,
      success: 'full',
      ghlBuilderUrl: `https://app.gohighlevel.com/funnels/${funnelId}/builder`,
    };
  }

  // ─── Token validation ─────────────────────────────────────────────────────

  /**
   * Test if API key and location ID are valid by making a lightweight request.
   * Returns { valid: bool, locationName: string, error: string|null }
   */
  async function validateCredentials(apiKey, locationId) {
    if (!apiKey || !locationId) {
      return { valid: false, error: 'API key and Location ID are required.' };
    }
    try {
      const data = await getLocation(apiKey, locationId);
      const name = data?.location?.name || data?.name || 'Your Location';
      return { valid: true, locationName: name, error: null };
    } catch (err) {
      if (err.status === 401) return { valid: false, error: 'Invalid API key. Check your GHL Private Integration Token.' };
      if (err.status === 404) return { valid: false, error: 'Location ID not found. Check your Location ID in GHL settings.' };
      return { valid: false, error: err.message };
    }
  }

  return {
    listFunnels,
    createFunnel,
    listFunnelPages,
    createFunnelPage,
    updatePageContent,
    listWebsites,
    getExistingFunnels,
    pushFunnelToGHL,
    validateCredentials,
    GHLApiError,
  };
})();

if (typeof module !== 'undefined') module.exports = GHLApi;
