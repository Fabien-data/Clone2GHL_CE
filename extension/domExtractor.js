/**
 * domExtractor.js
 * Extracts DOM structure, computed CSS, and images from the current page.
 * Runs inside the page context via chrome.scripting.executeScript.
 */

const DomExtractor = (() => {

  /** Convert a relative URL to absolute using the page's base URL */
  function toAbsolute(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
    try { return new URL(url, document.baseURI).href; } catch { return url; }
  }

  /** Fetch a remote URL and return as base64 data URI */
  async function toBase64DataUri(url) {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) return url;
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(url);
        reader.readAsDataURL(blob);
      });
    } catch {
      return url;
    }
  }

  /** Inline all external stylesheets into <style> tags */
  async function inlineExternalStyles() {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    const inlined = [];
    for (const link of links) {
      try {
        const href = toAbsolute(link.href);
        if (!href || href.startsWith('chrome-extension')) continue;
        const resp = await fetch(href, { mode: 'cors' });
        if (resp.ok) {
          const css = await resp.text();
          inlined.push(css);
        }
      } catch { /* skip cross-origin */ }
    }
    return inlined.join('\n');
  }

  /** Collect all inline <style> content */
  function getInlineStyles() {
    return Array.from(document.querySelectorAll('style'))
      .map(s => s.textContent)
      .join('\n');
  }

  /** Extract critical computed styles from key elements */
  function getComputedStyleSnapshot() {
    const selectors = ['body', 'h1', 'h2', 'p', 'a', 'button', '.hero', '.cta', 'section'];
    const snapshot = {};
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      snapshot[sel] = {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        padding: cs.padding,
        margin: cs.margin,
        maxWidth: cs.maxWidth,
        lineHeight: cs.lineHeight,
        fontWeight: cs.fontWeight,
        textAlign: cs.textAlign,
      };
    }
    return snapshot;
  }

  /**
   * Deep-clone the DOM, removing junk, fixing URLs.
   * Returns { html: string, images: string[] }
   */
  async function extractPage() {
    const clone = document.documentElement.cloneNode(true);

    // Remove noise elements
    const noiseSelectors = [
      'script', 'noscript', 'iframe[src*="ads"]', 'iframe[src*="analytics"]',
      '[id*="cookie"]', '[class*="cookie"]', '[id*="popup"]', '[class*="popup"]',
      '[id*="chat"]', '[class*="chat"]', '[id*="intercom"]', '[class*="drift"]',
      '[id*="fb-root"]', '[id*="google_ads"]', 'ins.adsbygoogle',
      'link[rel="stylesheet"]', // we'll inline separately
    ];
    for (const sel of noiseSelectors) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }

    // Remove tracking attributes
    clone.querySelectorAll('*').forEach(el => {
      ['data-ga', 'data-gtm', 'onclick', 'onload', 'onerror'].forEach(attr => {
        el.removeAttribute(attr);
      });
    });

    // Fix all image src → absolute URL
    const imgElements = clone.querySelectorAll('img[src]');
    for (const img of imgElements) {
      const abs = toAbsolute(img.getAttribute('src'));
      img.setAttribute('src', abs);
      img.setAttribute('data-original-src', abs);
    }

    // Fix background-image inline styles
    clone.querySelectorAll('[style*="background"]').forEach(el => {
      const style = el.getAttribute('style');
      if (!style) return;
      el.setAttribute('style', style.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (match, url) => {
        return `url('${toAbsolute(url)}')`;
      }));
    });

    // Fix anchor hrefs (mark as original, remove navigation)
    clone.querySelectorAll('a[href]').forEach(a => {
      a.setAttribute('data-original-href', a.getAttribute('href'));
      a.setAttribute('href', '#');
    });

    // Fix form actions
    clone.querySelectorAll('form[action]').forEach(form => {
      form.setAttribute('data-original-action', form.getAttribute('action'));
      form.removeAttribute('action');
    });

    // Remove all existing <script> and <link> remaining
    clone.querySelectorAll('script, link').forEach(el => el.remove());

    // Collect unique image sources
    const imageSrcs = Array.from(clone.querySelectorAll('img[src]'))
      .map(img => img.getAttribute('src'))
      .filter(src => src && !src.startsWith('data:'));

    // Collect metadata
    const meta = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      url: window.location.href,
      domain: window.location.hostname,
      capturedAt: new Date().toISOString(),
      viewport: `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
    };

    // Get final HTML string
    const html = clone.outerHTML;

    return { html, imageSrcs, meta };
  }

  /**
   * Structural analysis — extracts key funnel components.
   * Returns a structured object for the GHL converter and Funnel Analyzer.
   */
  function extractStructure() {
    const ctaSelector = [
      'button',
      'a.btn',
      'a.button',
      'a[href][role="button"]',
      '[role="button"]',
      'input[type="submit"]',
      'input[type="button"]',
      '[class*="cta"] button',
      '[class*="cta"] a',
    ].join(', ');

    const headlines = Array.from(document.querySelectorAll('h1, h2, h3'))
      .slice(0, 10)
      .map(el => ({ tag: el.tagName, text: el.textContent.trim(), level: parseInt(el.tagName[1]) }));

    const ctaButtons = Array.from(document.querySelectorAll(ctaSelector))
      .map(el => {
        const text = (el.textContent || el.value || '').trim();
        return {
          text,
          tag: el.tagName,
          type: el.type || '',
          href: el.tagName === 'A' ? el.getAttribute('href') || '' : '',
        };
      })
      .filter(btn => {
        if (!btn.text || btn.text.length >= 100) return false;
        if (btn.tag === 'A' && (!btn.href || btn.href === '#')) return false;
        return true;
      })
      .slice(0, 10);

    const forms = Array.from(document.querySelectorAll('form')).map(form => ({
      fields: Array.from(form.querySelectorAll('input, select, textarea')).map(f => ({
        type: f.type || f.tagName.toLowerCase(),
        name: f.name || f.placeholder || '',
        placeholder: f.placeholder || '',
      })),
      action: form.action || '',
    }));

    const images = Array.from(document.querySelectorAll('img[src]'))
      .slice(0, 20)
      .map(img => ({
        src: toAbsolute(img.src),
        alt: img.alt,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      }));

    const sections = Array.from(document.querySelectorAll(
      'section, .section, [class*="hero"], [class*="feature"], [class*="testimonial"], [class*="pricing"], [class*="cta-section"]'
    )).slice(0, 20).map(el => ({
      tag: el.tagName,
      className: el.className,
      id: el.id,
      textLength: el.textContent.trim().length,
    }));

    const testimonials = Array.from(document.querySelectorAll(
      '[class*="testimonial"], [class*="review"], blockquote'
    )).slice(0, 5).map(el => el.textContent.trim().slice(0, 200));

    const trustSignals = Array.from(document.querySelectorAll(
      '[class*="trust"], [class*="badge"], [class*="seal"], [class*="guarantee"], [class*="award"]'
    )).slice(0, 10).map(el => el.textContent.trim().slice(0, 100));

    const pricingElements = Array.from(document.querySelectorAll(
      '[class*="price"], [class*="pricing"], .price, .cost'
    )).slice(0, 10).map(el => el.textContent.trim().slice(0, 80));

    const bodyText = document.body.innerText.slice(0, 5000);

    return {
      headlines,
      ctaButtons,
      forms,
      images,
      sections,
      testimonials,
      trustSignals,
      pricingElements,
      bodyText,
    };
  }

  return { extractPage, extractStructure, toBase64DataUri, inlineExternalStyles, getInlineStyles, getComputedStyleSnapshot };
})();

// Export for use as module in service worker context
if (typeof module !== 'undefined') module.exports = DomExtractor;
