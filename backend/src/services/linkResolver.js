/**
 * linkResolver.js — rewrite internal links across an import set.
 *
 * After normalization, a button/link or a custom_code <a href> that points at the
 * source URL of ANOTHER page in the same import set is rewritten to that page's
 * GHL pathSlug (e.g. https://acme.com/about → /about-us). External links untouched.
 * Mutates the results in place and returns them + a nav map.
 */

function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    let p = x.pathname.replace(/\/+$/, '') || '/';
    return `${x.origin}${p}`;
  } catch { return null; }
}

function walkElements(sections, fn) {
  for (const sec of sections || []) {
    for (const row of sec.rows || []) {
      for (const col of row.columns || []) {
        for (const el of col.elements || []) fn(el);
      }
    }
  }
}

export function resolveLinks(results) {
  const slugByUrl = new Map();
  for (const r of results) {
    if (r && r.sourceUrl && r.pathSlug) {
      const n = normUrl(r.sourceUrl);
      if (n) slugByUrl.set(n, r.pathSlug);
    }
  }
  if (slugByUrl.size < 2) return { results, nav: {} };

  const nav = {};
  for (const r of results) {
    if (!r || !r.model) continue;
    walkElements(r.model.sections, (el) => {
      if ((el.type === 'button' || el.type === 'image') && el.href) {
        const slug = slugByUrl.get(normUrl(el.href));
        if (slug) { nav[el.href] = `/${slug}`; el.href = `/${slug}`; }
      }
      if (el.type === 'html' && el.code) {
        el.code = el.code.replace(/href="([^"]+)"/g, (m, href) => {
          const slug = slugByUrl.get(normUrl(href));
          if (slug) { nav[href] = `/${slug}`; return `href="/${slug}"`; }
          return m;
        });
      }
    });
  }
  return { results, nav };
}
