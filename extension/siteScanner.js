/**
 * siteScanner.js — discovers the pages of a site so the user can pick which to clone.
 * Runs in the background service worker (has fetch + <all_urls> host permission).
 *
 * Strategy (best-effort, deduped):
 *   1. robots.txt → Sitemap: entries
 *   2. sitemap.xml (and /sitemap_index.xml), following <sitemapindex> one level
 *   3. same-origin <a href> links scraped from the current page (passed in by the
 *      content script, which has the live DOM)
 *
 * Returns a deduped, same-origin, HTML-only list of { url, path, title }.
 */
const SiteScanner = (() => {
  const FETCH_TIMEOUT_MS = 12000;
  const MAX_SITEMAPS = 10;
  const MAX_RESULTS = 200;
  const NON_HTML = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|json|xml|pdf|zip|gz|mp4|webm|mp3|woff2?|ttf|eot|avif)(?:$|\?)/i;

  async function fetchText(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow', credentials: 'omit' });
      if (!resp.ok) return '';
      return await resp.text();
    } catch { return ''; }
    finally { clearTimeout(timer); }
  }

  function originOf(url) { try { return new URL(url).origin; } catch { return ''; } }

  function normalize(url, origin) {
    try {
      const u = new URL(url, origin);
      if (u.origin !== origin) return null;          // same-origin only
      u.hash = '';
      if (NON_HTML.test(u.pathname)) return null;     // skip assets
      // Collapse trailing slash (but keep root "/")
      if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
      return u.href;
    } catch { return null; }
  }

  function parseRobotsSitemaps(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (m) out.push(m[1].trim());
    }
    return out;
  }

  function parseXmlLocs(xml) {
    const locs = [];
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m;
    while ((m = re.exec(xml))) locs.push(m[1].trim());
    return locs;
  }
  function isSitemapIndex(xml) { return /<sitemapindex[\s>]/i.test(xml); }

  async function collectFromSitemaps(seedUrls, origin, seen) {
    const queue = seedUrls.slice(0, MAX_SITEMAPS);
    const pages = [];
    let fetched = 0;
    while (queue.length && fetched < MAX_SITEMAPS) {
      const sm = queue.shift();
      const xml = await fetchText(sm);
      fetched++;
      if (!xml) continue;
      const locs = parseXmlLocs(xml);
      if (isSitemapIndex(xml)) {
        for (const child of locs) if (queue.length + fetched < MAX_SITEMAPS) queue.push(child);
      } else {
        for (const loc of locs) {
          const n = normalize(loc, origin);
          if (n && !seen.has(n)) { seen.add(n); pages.push(n); }
        }
      }
    }
    return pages;
  }

  /**
   * @param {Object} opts
   * @param {string} opts.url       a URL on the target site (current tab)
   * @param {string[]} [opts.pageLinks]  hrefs scraped from the live page DOM
   * @returns {Promise<{origin, pages:[{url,path,title}]}>}
   */
  async function scan({ url, pageLinks = [] } = {}) {
    const origin = originOf(url);
    if (!origin) throw new Error('A valid site URL is required to scan.');
    const seen = new Set();
    const collected = [];

    // Always include the seed page itself.
    const seedNorm = normalize(url, origin);
    if (seedNorm) { seen.add(seedNorm); collected.push(seedNorm); }

    // 1) robots.txt → sitemaps
    let sitemapSeeds = [];
    const robots = await fetchText(`${origin}/robots.txt`);
    if (robots) sitemapSeeds = parseRobotsSitemaps(robots);
    // 2) common sitemap fallbacks
    sitemapSeeds.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);
    sitemapSeeds = [...new Set(sitemapSeeds)];

    const fromSitemaps = await collectFromSitemaps(sitemapSeeds, origin, seen);
    collected.push(...fromSitemaps);

    // 3) links scraped from the live page
    for (const href of pageLinks) {
      const n = normalize(href, origin);
      if (n && !seen.has(n)) { seen.add(n); collected.push(n); }
    }

    const pages = collected.slice(0, MAX_RESULTS).map((u) => {
      let path = '/';
      try { path = new URL(u).pathname || '/'; } catch { /* ignore */ }
      const title = path === '/' ? 'Home' : path.replace(/^\//, '').replace(/[-_/]+/g, ' ').trim();
      return { url: u, path, title };
    });
    // Home first, then alphabetical by path.
    pages.sort((a, b) => (a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path)));

    return { origin, pages };
  }

  return { scan };
})();

if (typeof module !== 'undefined') module.exports = SiteScanner;
