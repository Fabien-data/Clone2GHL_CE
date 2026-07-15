/**
 * extension/copyrightEngine.js — shared DOM-based copyright detection & removal.
 *
 * Single source of truth for what counts as a copyright risk and how it is
 * removed. Used by the dashboard Visual Editor (auditor panel + one-time
 * auto-strip when a funnel first opens in a DOM-capable context).
 *
 * The regex fallback in ghlConverter.js (MV3 service worker — no DOM) and the
 * cheerio port in backend/src/services/copyrightEngine.js mirror the RULES
 * table below; this file is authoritative.
 *
 * Design constraints:
 *  - Removal is BOUNDED: only the matched character range is spliced out of
 *    the spanning text nodes, so adjacent legitimate text ("Privacy Policy",
 *    a tagline after the year) always survives.
 *  - A whole block is removed only when it is a "pure notice" — after
 *    stripping the ©/rights match, almost nothing remains.
 *  - Text NODES only. Attributes, scripts and styles are never touched.
 */
(function (global) {
  'use strict';

  const RULES = {
    // "© 2024", "(c) 2019–2024", "Copyright © 2024-present"
    COPYRIGHT_RX: /(?:©|\(c\)|copyright)\s*(?:©\s*)?\d{4}(?:\s*[-–—]\s*(?:\d{4}|present))?\.?/i,
    RIGHTS_RX: /all\s+rights?\s+reserved\.?/i,
    TM_RX: /[™®℠]/g,
    LOGO_HINT_RX: /logo|brand(?:mark)?|wordmark/i,
  };

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME']);
  // Small blocks we consider as candidate "notice" containers.
  const NOTICE_TAGS = new Set(['P', 'SMALL', 'SPAN', 'DIV', 'LI', 'TD', 'FOOTER', 'SECTION', 'EM', 'I', 'B', 'STRONG', 'A', 'H6']);
  // Generic words that never make useful brand tokens.
  const GENERIC_TOKENS = new Set(['www', 'home', 'index', 'welcome', 'official', 'site', 'page', 'the', 'and', 'app', 'web', 'shop', 'store', 'blog', 'online', 'group', 'inc', 'llc', 'ltd', 'co']);

  function escapeRx(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function inSkippedContext(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function textNodesOf(root) {
    const doc = root.ownerDocument || root;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (!inSkippedContext(n)) nodes.push(n);
    }
    return nodes;
  }

  /**
   * Remove every occurrence of `rx` from the element's visible text, even when
   * the match spans multiple inline tags (`©<span>2024</span> Acme`). Only the
   * matched character range is spliced out of the underlying text nodes.
   * Returns the number of matches removed.
   */
  function removeMatchedRange(el, rx) {
    let removed = 0;
    // Re-evaluate after each removal — offsets shift.
    for (let guard = 0; guard < 25; guard++) {
      const nodes = textNodesOf(el);
      const full = nodes.map((n) => n.textContent).join('');
      const m = rx.exec(full);
      if (!m) break;
      const start = m.index;
      const end = m.index + m[0].length;
      let offset = 0;
      for (const node of nodes) {
        const len = node.textContent.length;
        const nodeStart = offset;
        const nodeEnd = offset + len;
        if (nodeEnd > start && nodeStart < end) {
          const cutFrom = Math.max(0, start - nodeStart);
          const cutTo = Math.min(len, end - nodeStart);
          node.textContent = node.textContent.slice(0, cutFrom) + node.textContent.slice(cutTo);
        }
        offset = nodeEnd;
      }
      removed++;
    }
    return removed;
  }

  /** Strip ™ ® ℠ from the element's text nodes (never attributes). */
  function removeTmSymbols(root) {
    let count = 0;
    textNodesOf(root).forEach((n) => {
      if (RULES.TM_RX.test(n.textContent)) {
        n.textContent = n.textContent.replace(RULES.TM_RX, '');
        count++;
      }
      RULES.TM_RX.lastIndex = 0;
    });
    return count;
  }

  /**
   * A "pure notice" block is one that is essentially just the copyright line —
   * once the ©/rights matches are stripped, almost nothing remains. Those are
   * safe to remove wholesale; anything else gets a bounded splice so that
   * neighbours like "Privacy Policy" links survive.
   */
  function isPureNotice(el) {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 200) return false;
    if (!RULES.COPYRIGHT_RX.test(t) && !RULES.RIGHTS_RX.test(t)) return false;
    const residual = t
      .replace(RULES.COPYRIGHT_RX, '')
      .replace(RULES.RIGHTS_RX, '')
      .replace(/[\s·•|,.\-–—:;]+/g, '');
    return residual.length <= 12;
  }

  /** Deepest elements whose visible text matches a copyright/rights notice. */
  function findNoticeElements(doc) {
    const matches = [];
    doc.body.querySelectorAll('*').forEach((el) => {
      if (!NOTICE_TAGS.has(el.tagName) || inSkippedContext(el)) return;
      const t = el.textContent || '';
      if (t.length > 400) return;
      if (RULES.COPYRIGHT_RX.test(t) || RULES.RIGHTS_RX.test(t)) matches.push(el);
    });
    // Keep only the deepest matching element of each chain.
    return matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
  }

  /**
   * Derive brand-name tokens from the source domain plus on-page signals
   * (og:site_name, <title> segment, logo alt text). Multi-word phrases,
   * longest first, generic words filtered.
   */
  function deriveBrandTokens(sourceDomain, doc) {
    const tokens = new Set();
    const add = (raw) => {
      const t = String(raw || '').trim().replace(/\s{2,}/g, ' ');
      if (t.length >= 3 && t.length <= 60 && !GENERIC_TOKENS.has(t.toLowerCase())) tokens.add(t);
    };

    if (sourceDomain) {
      const base = sourceDomain.replace(/^www\./, '').replace(/\.[a-z]{2,}(\.[a-z]{2})?$/i, '');
      add(base);
      add(base.replace(/[-_]+/g, ' '));
      add(base.replace(/([a-z])([A-Z])/g, '$1 $2')); // camelCase → words
    }
    if (doc) {
      add(doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content'));
      const title = doc.querySelector('title')?.textContent || '';
      add(title.split(/[|–—-]/)[0]);
      doc.querySelectorAll('header img[alt], nav img[alt], [class*="logo"] img[alt]').forEach((img) => add(img.getAttribute('alt')));
    }
    // Longest phrases first so "Acme Plumbing Co" wins over "Acme".
    return [...tokens].sort((a, b) => b.length - a.length);
  }

  /**
   * Full-page audit. Returns risks compatible with the editor panel:
   * { el, selector, type, label, severity, description, rx? }.
   * `buildSelector(el)` is supplied by the caller (the dashboard passes its
   * buildUniqueSelector so data-c2ghl-id anchored selectors are used).
   */
  function audit(doc, { sourceDomain = '', buildSelector = null } = {}) {
    if (!doc || !doc.body) return [];
    const sel = buildSelector || ((el) => el.tagName.toLowerCase());
    const risks = [];
    const seen = new Set();
    const addRisk = (el, type, label, severity, description, extra = {}) => {
      const key = sel(el) + '|' + type;
      if (seen.has(key)) return;
      seen.add(key);
      risks.push({ el, selector: sel(el), type, label, severity, description, ...extra });
    };

    const brandTokens = deriveBrandTokens(sourceDomain, doc);

    // HIGH: logo images — header/nav placement, logo-ish class/id/filename/alt,
    // or an image wrapped in a link to the homepage.
    const logoImgs = new Set();
    doc.querySelectorAll('header img, nav img, [class*="logo"] img, [id*="logo"] img, a[href="/"] img, a[href="./"] img').forEach((img) => logoImgs.add(img));
    doc.querySelectorAll('img').forEach((img) => {
      const hint = `${img.alt || ''} ${img.className || ''} ${img.id || ''} ${(img.getAttribute('src') || '').split('/').pop()}`;
      if (RULES.LOGO_HINT_RX.test(hint)) logoImgs.add(img);
      if (brandTokens.some((t) => t.length >= 4 && (img.alt || '').toLowerCase().includes(t.toLowerCase()))) logoImgs.add(img);
    });
    logoImgs.forEach((img) => {
      if (img.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:')) {
        addRisk(img, 'brand-logo-img', 'Brand logo image', 'high', `alt="${img.alt || ''}" — ${img.src.slice(0, 60)}`);
      }
    });
    doc.querySelectorAll('header svg, nav svg, [class*="logo"] svg').forEach((svg) => {
      addRisk(svg, 'brand-logo-svg', 'SVG logo mark', 'high', `SVG in ${svg.closest('header') ? 'header' : 'nav/logo area'}`);
    });
    doc.querySelectorAll('svg > title').forEach((t) => {
      const svg = t.closest('svg');
      if (svg && brandTokens.some((b) => t.textContent.toLowerCase().includes(b.toLowerCase()))) {
        addRisk(svg, 'brand-logo-svg', 'SVG logo mark', 'high', `SVG titled "${t.textContent.trim().slice(0, 50)}"`);
      }
    });

    // HIGH: copyright notices — deepest matching block, split-tag safe.
    findNoticeElements(doc).forEach((el) => {
      addRisk(el, 'copyright-notice', 'Copyright notice', 'high', `"${el.textContent.trim().slice(0, 80)}"`);
    });

    // MEDIUM: trademark symbols.
    textNodesOf(doc.body).forEach((node) => {
      RULES.TM_RX.lastIndex = 0;
      if (RULES.TM_RX.test(node.textContent) && node.parentElement) {
        addRisk(node.parentElement, 'trademark-symbol', 'Trademark symbol', 'medium', `"${node.textContent.trim().slice(0, 80)}"`);
      }
    });

    // MEDIUM: original brand name mentions (word-boundary, multi-word aware).
    let brandCount = 0;
    for (const token of brandTokens) {
      if (brandCount >= 40) break;
      const rx = new RegExp(`\\b${escapeRx(token)}\\b`, 'i');
      for (const node of textNodesOf(doc.body)) {
        if (brandCount >= 40) break;
        if (rx.test(node.textContent) && node.parentElement) {
          addRisk(node.parentElement, 'brand-name-text', 'Original brand name', 'medium',
            `"${node.textContent.trim().slice(0, 80)}"`, { rx: rx.source });
          brandCount++;
        }
      }
    }

    // LOW: external links.
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^(#|javascript|mailto:|tel:)/i.test(href)) return;
      try {
        const url = new URL(href, 'https://x.invalid');
        if (url.hostname && url.hostname !== 'x.invalid' && url.hostname.replace(/^www\./, '') !== sourceDomain) {
          addRisk(a, 'external-link', 'External brand link', 'low', href.slice(0, 60));
        }
      } catch { /* unparseable href — ignore */ }
    });

    return risks;
  }

  /**
   * Fix one audited risk in place. Returns { changed, action }.
   * The caller wraps this in the editor's commit gateway for undo/patches.
   */
  function fixRisk(doc, risk) {
    const el = (risk.el && risk.el.isConnected) ? risk.el : doc.querySelector(risk.selector);
    if (!el) return { changed: false, action: 'missing' };

    switch (risk.type) {
      case 'copyright-notice': {
        if (isPureNotice(el)) {
          el.remove();
          return { changed: true, action: 'removed-block' };
        }
        const n = removeMatchedRange(el, RULES.COPYRIGHT_RX) + removeMatchedRange(el, RULES.RIGHTS_RX);
        removeTmSymbols(el);
        return { changed: n > 0, action: 'spliced-text' };
      }
      case 'trademark-symbol':
        return { changed: removeTmSymbols(el) > 0, action: 'spliced-text' };
      case 'brand-name-text': {
        const rx = risk.rx ? new RegExp(risk.rx, 'i') : null;
        if (!rx) return { changed: false, action: 'no-pattern' };
        return { changed: removeMatchedRange(el, rx) > 0, action: 'spliced-text' };
      }
      case 'external-link': {
        const old = el.getAttribute('href');
        el.setAttribute('href', '#');
        return { changed: old !== '#', action: 'neutralized-link', oldValue: old };
      }
      case 'brand-logo-img':
      case 'brand-logo-svg':
        el.remove();
        return { changed: true, action: 'removed-block' };
      default:
        return { changed: false, action: 'unknown-type' };
    }
  }

  function fixAll(doc, risks) {
    const results = [];
    risks.forEach((risk) => {
      const r = fixRisk(doc, risk);
      results.push({ risk, ...r });
    });
    return { fixed: results.filter((r) => r.changed).length, results };
  }

  /**
   * Conservative automatic strip: ™®℠ everywhere, pure-notice blocks removed,
   * bounded splice of ©/rights text elsewhere. Never removes logos, brand
   * names or links — those stay for the auditor's per-item review.
   */
  function strip(doc) {
    const report = { tmNodes: 0, blocksRemoved: 0, noticesSpliced: 0 };
    if (!doc || !doc.body) return report;

    report.tmNodes = removeTmSymbols(doc.body);
    findNoticeElements(doc).forEach((el) => {
      if (isPureNotice(el)) {
        el.remove();
        report.blocksRemoved++;
      } else {
        const n = removeMatchedRange(el, RULES.COPYRIGHT_RX) + removeMatchedRange(el, RULES.RIGHTS_RX);
        if (n) report.noticesSpliced++;
      }
    });
    return report;
  }

  /** Parse → strip → serialize. Dashboard/extension-page context only. */
  function stripHtmlString(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const report = strip(doc);
      const changed = report.tmNodes + report.blocksRemoved + report.noticesSpliced > 0;
      if (!changed) return { html, changed: false, report };
      return { html: '<!DOCTYPE html>' + doc.documentElement.outerHTML, changed: true, report };
    } catch (e) {
      return { html, changed: false, report: { error: String(e?.message || e) } };
    }
  }

  global.CopyrightEngine = {
    RULES,
    audit,
    fixRisk,
    fixAll,
    strip,
    stripHtmlString,
    deriveBrandTokens,
    removeMatchedRange,
    isPureNotice,
  };
})(typeof window !== 'undefined' ? window : globalThis);
