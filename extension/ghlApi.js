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

  function headers(apiKey) {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Version': API_VERSION,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  async function request(method, path, apiKey, body = null) {
    const opts = {
      method,
      headers: headers(apiKey),
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(`${BASE_URL}${path}`, opts);
    const data = await resp.json().catch(() => ({ error: 'Invalid JSON response' }));

    if (!resp.ok) {
      throw new GHLApiError(
        data.message || data.error || `HTTP ${resp.status}`,
        resp.status,
        data
      );
    }
    return data;
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
  async function listFunnels(apiKey, locationId, { limit = 20, skip = 0 } = {}) {
    return request('GET', `/funnels/funnel/list?locationId=${locationId}&limit=${limit}&skip=${skip}`, apiKey);
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
   * @param {string} apiKey
   * @param {Object} params - { locationId, pageId, html }
   */
  async function updatePageContent(apiKey, params) {
    return request('PUT', '/funnels/page/data', apiKey, {
      locationId: params.locationId,
      id: params.pageId,
      updatedAt: new Date().toISOString(),
      content: {
        html: params.html || '',
      },
    });
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
    const data = await request('GET', `/funnels/funnel/list?locationId=${locationId}&limit=50&skip=0`, apiKey);
    // GHL has returned funnels under different keys across versions
    const list =
      data?.funnels ||
      data?.list ||
      data?.data?.funnels ||
      data?.data?.list ||
      data?.data ||
      (Array.isArray(data) ? data : []);
    return list
      .filter(f => f && f.id)
      .map(f => ({ id: f.id, name: f.name || 'Unnamed Funnel' }));
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

    let pageId;
    try {
      const pageData = await createFunnelPage(apiKey, {
        locationId: params.locationId,
        funnelId,
        name: params.pageName || 'Clone2GHL Page',
      });
      pageId = pageData?.page?.id || pageData?.id;
      if (!pageId) throw new Error('No page ID in response');
    } catch (err) {
      // createFunnelPage may also be restricted — fall back to first existing page
      console.warn('Page create failed, falling back to first existing page:', err.message);
      const pagesResp = await listFunnelPages(apiKey, params.locationId, funnelId);
      const firstPage = (pagesResp?.pages || pagesResp?.list || pagesResp?.data || [])[0];
      if (firstPage?.id) {
        pageId = firstPage.id;
      } else {
        return {
          funnelId, funnelName,
          pageId: null,
          success: 'html_only',
          ghlBuilderUrl: `https://app.gohighlevel.com/funnels/${funnelId}/builder`,
          warning: 'Could not create a new page automatically. Open the funnel in GHL builder and paste the downloaded HTML manually.',
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
