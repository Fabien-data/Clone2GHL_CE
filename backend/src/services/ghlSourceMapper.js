/**
 * ghlSourceMapper.js — high-fidelity path for cloning a GHL-built source page.
 *
 * GHL funnel/website pages render with a recognizable structure
 * (section → row → column → element wrappers, leadconnector/msgsndr assets,
 * hl-* / c-* classes). When we detect that, we preserve the row/column layout
 * exactly and classify each element, instead of re-inferring sections heuristically
 * like the generic normalizer. Result: layout-compatible, element-wise, editable.
 *
 * Falls back to the generic normalizer when the page isn't (or doesn't look) GHL.
 */
import { load } from 'cheerio';
import { normalize, classify, extractElements, styleOf, replaceTokens, htmlEl, slugify } from './normalizer.js';
import { stripHtml } from './copyrightEngine.js';

const GHL_MARKERS = [
  /leadconnectorhq/i, /msgsndr/i, /gohighlevel/i, /highlevel/i,
  /\bhl[-_]/i, /clickfunnels|cf-/i, /funnels?\/preview/i, /data-hl-/i,
  /class="[^"]*\b(?:c-section|c-row|c-column|elBox|elWrapper)\b/i,
];

/** Heuristic: does this captured page look GHL-built? */
export function isGhlSource(captured = {}) {
  const html = captured.html || '';
  const url = captured.meta?.url || '';
  let score = 0;
  for (const re of GHL_MARKERS) if (re.test(html) || re.test(url)) score++;
  return { isGhl: score >= 2, score };
}

const SECTION_SEL = '[class*="section"], section';
const ROW_SEL = '[class*="row"]';
const COL_SEL = '[class*="col"]';

function pickAll($, scope, selector) {
  // direct-ish descendants matching selector, not nested inside a deeper match
  const all = $(scope).find(selector).toArray();
  return all.filter((el) => {
    let p = el.parent;
    while (p && p !== scope) {
      if (p.tagName && $(p).is(selector)) return false; // a closer ancestor already matches
      p = p.parent;
    }
    return true;
  });
}

function columnElements($, col, opts) {
  // Prefer GHL element wrappers; otherwise fall back to the generic walker.
  const els = extractElements($, col, opts, 0);
  return els.length ? els : [htmlEl(replaceTokens($.html(col) || '', opts))];
}

export function mapGhlSource(captured = {}, options = {}) {
  const meta = captured.meta || {};
  const opts = { businessName: options.businessName || null, replaceEmail: options.replaceEmail || false };
  let $;
  try { $ = load(captured.html || '', { decodeEntities: false }); }
  catch { return normalize(captured, options); }

  $('script, noscript, template, link[rel="stylesheet"]').remove();

  const body = $('body').toArray()[0] || $.root()[0];
  const sectionEls = pickAll($, body, SECTION_SEL);
  if (!sectionEls.length) return normalize(captured, options); // markers but no structure → generic

  const sections = [];
  for (const secEl of sectionEls.slice(0, 60)) {
    const rowsEls = pickAll($, secEl, ROW_SEL);
    const rows = [];
    const rowScopes = rowsEls.length ? rowsEls : [secEl];
    for (const rowEl of rowScopes) {
      const colEls = pickAll($, rowEl, COL_SEL);
      const colScopes = colEls.length ? colEls : [rowEl];
      const columns = colScopes.map((colEl) => ({
        type: 'column',
        span: Math.max(1, Math.round(12 / colScopes.length)),
        style: styleOf($, colEl),
        elements: columnElements($, colEl, opts),
      }));
      rows.push({ type: 'row', style: styleOf($, rowEl), columns });
    }
    sections.push({ type: 'section', style: styleOf($, secEl), rows });
  }

  if (!sections.length) return normalize(captured, options);
  const title = meta.title || 'Cloned GHL Page';
  return {
    name: title,
    pathSlug: slugify(title),
    seo: { title: `{{location.name}} | ${title}`, description: meta.description || '' },
    sections,
    _source: 'ghl',
  };
}

/** Entry point used by the worker: choose the best normalizer for this page. */
export function normalizeBest(captured = {}, options = {}) {
  // Always-on conservative copyright strip (single choke point for both the
  // GHL-mapped and generic paths). Bounded removal — never eats adjacent text.
  const { html: strippedHtml, changed } = stripHtml(captured.html || '');
  if (changed) captured = { ...captured, html: strippedHtml };

  const { isGhl } = isGhlSource(captured);
  if (isGhl) {
    try {
      const mapped = mapGhlSource(captured, options);
      if (mapped && mapped.sections && mapped.sections.length) return mapped;
    } catch { /* fall through to generic */ }
  }
  return normalize(captured, options);
}
