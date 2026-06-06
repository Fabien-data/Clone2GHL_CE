/**
 * ghlApi.js
 * GoHighLevel API v2 client — robust push flow.
 *
 * Base URL: https://services.leadconnectorhq.com
 * Auth: Bearer {Private Integration Token}
 * Required header: Version: 2021-07-28
 */

const GHLApi = (() => {
  const BASE_URL = 'https://services.leadconnectorhq.com';
  // Known GHL API versions, newest-acceptable first. The client uses the active
  // version; the fallback list is the foundation for version negotiation (M5):
  // on a version-deprecation error we can retry with the next entry.
  const API_VERSIONS = ['2021-07-28', '2021-04-15'];
  let API_VERSION = API_VERSIONS[0];
  const REQUEST_TIMEOUT_MS = 25000;
  const MAX_RETRIES = 3;

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function shouldRetry(status) {
    return status === 408 || status === 429 || status >= 500;
  }

  // Heuristic: does this error look like an API-version rejection/deprecation?
  function isVersionError(status, msg) {
    if (status !== 400 && status !== 412 && status !== 426) return false;
    return /version/i.test(String(msg || ''));
  }

  function validateLocationId(locationId) {
    if (!locationId || typeof locationId !== 'string') return false;
    return /^[A-Za-z0-9_-]{8,}$/.test(locationId.trim());
  }

  function headers(apiKey) {
    return {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Version': API_VERSION,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  function slugify(str) {
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .slice(0, 60) || 'clone-page';
  }

  function asArray(v) { return Array.isArray(v) ? v : []; }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ─── Core HTTP ──────────────────────────────────────────────────────────────

  async function request(method, path, apiKey, body = null) {
    const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!trimmedKey) throw new GHLApiError('Missing API key.', 401, null);

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
        if (body !== null) opts.body = JSON.stringify(body);

        const resp = await fetch(`${BASE_URL}${path}`, opts);

        // GHL sometimes returns 204 No Content on success
        if (resp.status === 204) return { success: true };

        const text = await resp.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

        if (!resp.ok) {
          const msg = data?.message || data?.error || data?.msg || `HTTP ${resp.status}`;
          const err = new GHLApiError(msg, resp.status, data);

          // Version negotiation: if GHL rejects the pinned API version, fall back
          // to the next known version and retry — so a GHL version deprecation
          // degrades gracefully instead of breaking every push.
          if (isVersionError(resp.status, msg)) {
            const next = API_VERSIONS.find(v => v !== API_VERSION);
            if (next && API_VERSION !== next) {
              console.warn(`[GHL] API version ${API_VERSION} rejected — falling back to ${next}`);
              API_VERSION = next;
              if (attempt < MAX_RETRIES) { await wait(300); continue; }
            }
          }

          if (attempt < MAX_RETRIES && shouldRetry(resp.status)) {
            await wait(600 * (attempt + 1));
            continue;
          }
          throw err;
        }

        return data;
      } catch (err) {
        lastError = err;
        if (err instanceof GHLApiError) throw err; // don't retry auth errors etc.
        if (attempt < MAX_RETRIES && (err.name === 'AbortError' || shouldRetry(err.status || 0))) {
          await wait(600 * (attempt + 1));
          continue;
        }
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (lastError?.name === 'AbortError') {
      throw new GHLApiError('Request timed out while contacting GoHighLevel. Check your internet connection.', 408, null);
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

  // ─── Funnel Normalization ────────────────────────────────────────────────────

  function normalizeFunnel(item) {
    if (!item || typeof item !== 'object') return null;
    const id = item.id || item._id || item.funnelId || item.funnel_id;
    if (!id) return null;
    return { id, name: item.name || item.title || item.funnelName || 'Unnamed Funnel' };
  }

  function extractFunnelsFromAnyShape(payload) {
    const candidates = [
      payload, payload?.data, payload?.data?.data,
      payload?.result, payload?.results, payload?.response,
      payload?.response?.data, payload?.payload,
    ];
    for (const node of candidates) {
      if (!node) continue;
      const arraysToTry = [
        asArray(node), asArray(node.funnels), asArray(node.list),
        asArray(node.items), asArray(node.records), asArray(node.results),
        asArray(node.docs), asArray(node.rows),
      ];
      for (const arr of arraysToTry) {
        if (!arr.length) continue;
        const normalized = arr.map(normalizeFunnel).filter(Boolean);
        if (normalized.length) return normalized;
      }
    }
    return [];
  }

  // ─── Locations ──────────────────────────────────────────────────────────────

  async function getLocation(apiKey, locationId) {
    return request('GET', `/locations/${locationId}`, apiKey);
  }

  // ─── Funnels ────────────────────────────────────────────────────────────────

  async function listFunnels(apiKey, locationId, { limit = 20, offset = 0 } = {}) {
    const encodedLoc = encodeURIComponent(locationId || '');
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 20);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    // Try offset param first, fall back to skip
    try {
      return await request('GET', `/funnels/funnel/list?locationId=${encodedLoc}&limit=${safeLimit}&offset=${safeOffset}`, apiKey);
    } catch {
      return request('GET', `/funnels/funnel/list?locationId=${encodedLoc}&limit=${safeLimit}&skip=${safeOffset}`, apiKey);
    }
  }

  /**
   * Create a new funnel in GHL.
   * GHL v2 does support this — POST /funnels/funnel
   */
  async function createFunnel(apiKey, params) {
    return request('POST', '/funnels/funnel', apiKey, {
      locationId: params.locationId,
      name: params.name || 'Clone2GHL Funnel',
      type: params.type || 'funnel',
    });
  }

  async function getExistingFunnels(apiKey, locationId) {
    const first = await listFunnels(apiKey, locationId, { limit: 20, offset: 0 });
    const funnels = extractFunnelsFromAnyShape(first);
    if (funnels.length) return funnels;

    // Try page 2
    const second = await listFunnels(apiKey, locationId, { limit: 20, offset: 20 }).catch(() => null);
    const funnels2 = extractFunnelsFromAnyShape(second);
    if (funnels2.length) return funnels2;

    return [];
  }

  // ─── Funnel Pages ───────────────────────────────────────────────────────────

  async function listFunnelPages(apiKey, locationId, funnelId) {
    return request('GET', `/funnels/page?locationId=${encodeURIComponent(locationId)}&funnelId=${encodeURIComponent(funnelId)}`, apiKey);
  }

  /**
   * Create a page inside a funnel.
   * GHL v2 POST /funnels/page
   */
  async function createFunnelPage(apiKey, params) {
    const body = {
      locationId: params.locationId,
      funnelId: params.funnelId,
      name: params.name || 'Clone2GHL Page',
    };
    if (params.stepId) body.stepId = params.stepId;

    // Try primary endpoint
    try {
      return await request('POST', '/funnels/page', apiKey, body);
    } catch (err) {
      // Some tenants use a different path
      return request('POST', `/funnels/${params.funnelId}/pages`, apiKey, body);
    }
  }

  /**
   * Extract page ID from any GHL response shape.
   */
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

  /**
   * Extract first page from list response.
   */
  function extractFirstPage(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const candidates = [
      resp?.funnelPages, resp?.pages, resp?.list,
      resp?.data?.funnelPages, resp?.data?.pages,
      resp?.data, resp?.results, resp?.items,
    ];
    for (const arr of candidates) {
      if (Array.isArray(arr) && arr.length) return arr[0];
    }
    return null;
  }

  // ─── Page Content Upload ─────────────────────────────────────────────────────

  /**
   * Build a GHL Page Builder compatible body object.
   *
   * GHL's page builder stores content as a JSON document with rows/columns/elements.
   * We inject the entire cloned HTML as a single "custom_code" element so it renders
   * faithfully and the user can then swap sections with native GHL elements.
   *
   * Structure: body → rows[] → columns[] → elements[]
   */
  function buildGHLPageBody(html, pageName) {
    const rowId = generateUUID();
    const colId = generateUUID();
    const elemId = generateUUID();

    return {
      body: {
        type: 'body',
        id: generateUUID(),
        children: [
          {
            type: 'row',
            id: rowId,
            metadata: { name: pageName || 'Cloned Page' },
            styles: {
              width: '100%',
              'max-width': '100%',
              margin: '0 auto',
              padding: '0',
            },
            children: [
              {
                type: 'column',
                id: colId,
                styles: {
                  width: '100%',
                  padding: '0',
                },
                children: [
                  {
                    type: 'custom_code',
                    id: elemId,
                    metadata: {
                      name: 'Cloned Website HTML',
                      description: 'Full cloned website — replace sections with native GHL elements',
                    },
                    styles: {
                      width: '100%',
                      padding: '0',
                      margin: '0',
                    },
                    code: html,
                    codeType: 'html',
                  },
                ],
              },
            ],
          },
        ],
      },
    };
  }

  /**
   * Upload page content. Tries multiple known GHL API shapes in order:
   * 1. PUT /funnels/page/data with structured body JSON (GHL builder format)
   * 2. PUT /funnels/page/data with content.html
   * 3. PUT /funnels/page/data with raw body string
   * 4. PATCH /funnels/page/{pageId} with content field
   */
  async function updatePageContent(apiKey, params) {
    const { locationId, pageId, html, pageName } = params;
    const pageBody = buildGHLPageBody(html, pageName);

    // Strategy 1: GHL page builder JSON body (preferred — fully editable in GHL)
    try {
      return await request('PUT', '/funnels/page/data', apiKey, {
        locationId,
        id: pageId,
        updatedAt: new Date().toISOString(),
        ...pageBody,
      });
    } catch (err1) {
      console.warn('[GHL] Strategy 1 failed:', err1.message);
    }

    // Strategy 2: content.html shape
    try {
      return await request('PUT', '/funnels/page/data', apiKey, {
        locationId,
        id: pageId,
        updatedAt: new Date().toISOString(),
        content: { html },
      });
    } catch (err2) {
      console.warn('[GHL] Strategy 2 failed:', err2.message);
    }

    // Strategy 3: body string at top level
    try {
      return await request('PUT', '/funnels/page/data', apiKey, {
        locationId,
        id: pageId,
        updatedAt: new Date().toISOString(),
        body: html,
      });
    } catch (err3) {
      console.warn('[GHL] Strategy 3 failed:', err3.message);
    }

    // Strategy 4: PATCH the page directly
    try {
      return await request('PATCH', `/funnels/page/${pageId}`, apiKey, {
        locationId,
        content: { html },
        updatedAt: new Date().toISOString(),
      });
    } catch (err4) {
      console.warn('[GHL] Strategy 4 failed:', err4.message);
      throw new GHLApiError(
        `All content upload strategies failed. Last error: ${err4.message}`,
        err4.status || 500,
        null
      );
    }
  }

  // ─── Websites ────────────────────────────────────────────────────────────────

  async function listWebsites(apiKey, locationId) {
    return request('GET', `/websites/?locationId=${locationId}`, apiKey);
  }

  // ─── Credential Validation ───────────────────────────────────────────────────

  async function validateCredentials(apiKey, locationId) {
    if (!apiKey || !locationId) {
      return { valid: false, error: 'API key and Location ID are required.' };
    }
    try {
      const data = await getLocation(apiKey, locationId);
      const name = data?.location?.name || data?.name || 'Your Location';
      return { valid: true, locationName: name, error: null };
    } catch (err) {
      if (err.status === 401) return { valid: false, error: 'Invalid API key. Please check your GHL Private Integration Token in Settings.' };
      if (err.status === 403) return { valid: false, error: 'Access denied. Make sure your API key has Funnels scope enabled.' };
      if (err.status === 404) return { valid: false, error: 'Location ID not found. Verify your Location ID in GHL → Settings → Business Profile.' };
      return { valid: false, error: err.message };
    }
  }

  // ─── Full Push Flow ──────────────────────────────────────────────────────────

  /**
   * pushFunnelToGHL — the main export pipeline.
   *
   * Strategy:
   * 1. Try to create a NEW "Clone2GHL" funnel (clean slate every time)
   * 2. If creation fails → find existing funnels, prefer one named "Clone2GHL"
   * 3. Create a new page in the funnel
   * 4. Upload the HTML as a GHL-editable custom_code element
   *
   * @param {string} apiKey
   * @param {{ locationId, pageName, html }} params
   * @param {Function} onProgress  (step, total, message) => void
   * @returns {{ funnelId, funnelName, pageId, ghlBuilderUrl, success }}
   */
  async function pushFunnelToGHL(apiKey, params, onProgress) {
    if (!apiKey) throw new Error('Missing GHL API key.');
    if (!validateLocationId(params?.locationId)) {
      throw new Error('Invalid GHL Location ID. Please verify it in Settings (GHL → Settings → Business Profile → Location ID).');
    }

    const progress = (step, total, msg) => onProgress && onProgress(step, total, msg);
    const loc = params.locationId.trim();
    const pageName = params.pageName || 'Clone2GHL Page';
    const html = params.html || '';

    // ── Step 1: Get or create funnel ─────────────────────────────────────────
    progress(1, 4, 'Setting up GHL funnel…');

    let funnelId, funnelName;

    // Try to create a fresh funnel named after the page
    try {
      const createResp = await createFunnel(apiKey, {
        locationId: loc,
        name: `Clone2GHL — ${pageName}`.slice(0, 100),
        type: 'funnel',
      });
      const newId = (
        createResp?.funnel?.id || createResp?.data?.id ||
        createResp?.id || createResp?.funnelId
      );
      if (newId) {
        funnelId = newId;
        funnelName = `Clone2GHL — ${pageName}`;
        console.log('[GHL] Created new funnel:', funnelId);
      }
    } catch (createErr) {
      console.warn('[GHL] Could not create funnel, using existing:', createErr.message);
    }

    // Fallback: find existing funnels
    if (!funnelId) {
      const existing = await getExistingFunnels(apiKey, loc);
      if (existing.length === 0) {
        throw new Error(
          'No funnels found in your GHL account and could not create one automatically. ' +
          'Please go to GoHighLevel → Funnels & Websites → Create New Funnel, then try again.'
        );
      }
      const preferred = existing.find(f => /clone2ghl/i.test(f.name)) || existing[0];
      funnelId = preferred.id;
      funnelName = preferred.name;
      console.log('[GHL] Using existing funnel:', funnelId, funnelName);
    }

    const ghlBuilderUrl = `https://app.gohighlevel.com/v2/location/${loc}/funnels/${funnelId}`;

    // ── Step 2: Create a new page ─────────────────────────────────────────────
    progress(2, 4, `Adding page to funnel "${funnelName}"…`);

    let pageId = null;
    let pageCreationFailed = false;

    try {
      const pageData = await createFunnelPage(apiKey, {
        locationId: loc,
        funnelId,
        name: pageName,
        stepId: slugify(pageName) + '-' + Date.now(),
      });
      pageId = extractPageId(pageData);
      console.log('[GHL] Created page:', pageId);
    } catch (pageErr) {
      console.warn('[GHL] Page creation failed:', pageErr.message);
      pageCreationFailed = true;
    }

    // Fallback: use first existing page
    if (!pageId) {
      try {
        const pagesResp = await listFunnelPages(apiKey, loc, funnelId);
        const firstPage = extractFirstPage(pagesResp);
        if (firstPage?.id) {
          pageId = firstPage.id;
          console.log('[GHL] Falling back to existing page:', pageId);
        }
      } catch (listErr) {
        console.warn('[GHL] Could not list pages:', listErr.message);
      }
    }

    if (!pageId) {
      // Return partial success — user can open GHL and paste HTML
      return {
        funnelId, funnelName,
        pageId: null,
        success: 'html_only',
        ghlBuilderUrl,
        warning: 'Created the funnel but could not create or find a page. Open the funnel in GHL, create a page, then add a Custom Code element and paste the HTML.',
      };
    }

    // ── Step 3: Upload HTML content ───────────────────────────────────────────
    progress(3, 4, 'Uploading page content to GHL…');

    try {
      await updatePageContent(apiKey, { locationId: loc, pageId, html, pageName });
      console.log('[GHL] Content uploaded to page:', pageId);
    } catch (uploadErr) {
      console.warn('[GHL] Content upload failed:', uploadErr.message);
      return {
        funnelId, funnelName, pageId,
        success: 'partial',
        ghlBuilderUrl,
        warning: `Page created in "${funnelName}" but content upload failed (${uploadErr.message}). Open the page in GHL builder → Add Element → Custom Code → paste the HTML.`,
      };
    }

    // ── Step 4: Done ──────────────────────────────────────────────────────────
    progress(4, 4, 'Funnel pushed successfully!');

    return {
      funnelId,
      funnelName,
      pageId,
      success: 'full',
      ghlBuilderUrl,
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

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
    buildGHLPageBody,
    GHLApiError,
  };
})();

if (typeof module !== 'undefined') module.exports = GHLApi;
