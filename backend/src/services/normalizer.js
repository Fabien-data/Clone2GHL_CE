/**
 * normalizer.js — turn a captured page into the neutral element model.
 *
 * This is the backend "Parser & Normalize" service. Unlike the extension's
 * service-worker converter (regex-only, no DOM), this runs a real DOM parser
 * (cheerio) so it can decompose a page into native GHL elements
 * (heading/text/image/button/form/video/divider) and fall back to custom_code
 * only where a block is too complex to classify confidently.
 *
 * Contract: backend/docs/ELEMENT_MODEL.md. Output is always valid and never throws
 * on malformed input — worst case a section collapses to one { type:'html' } element.
 */
import { load } from 'cheerio';

const MAX_DEPTH = 6;
const MAX_SECTIONS = 60;
const VIDEO_HOST_RE = /youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com|wistia|loom\.com/i;
const BUTTONISH_RE = /\b(btn|button|cta|call-to-action|c-button)\b/i;
const BLOCK_TAGS = new Set(['div', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav', 'ul', 'ol', 'table', 'form', 'figure', 'blockquote']);
const STYLE_KEYS = ['text-align', 'color', 'background', 'background-color', 'font-size', 'font-weight', 'padding', 'margin', 'max-width', 'border-radius'];

// ── tokens ─────────────────────────────────────────────────────────────────────
const PHONE_RE = /(?<![a-zA-Z0-9"'=/])(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?![a-zA-Z0-9"'])/g;
const EMAIL_RE = /(?<!mailto:)([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

export function replaceTokens(str, { businessName, replaceEmail = false } = {}) {
  if (!str) return str;
  let out = String(str).replace(PHONE_RE, '{{location.phone}}');
  if (replaceEmail) out = out.replace(EMAIL_RE, '{{location.email}}');
  if (businessName) {
    const esc = businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${esc}\\b`, 'g'), '{{location.name}}');
  }
  return out;
}

export function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'page';
}

// ── style ────────────────────────────────────────────────────────────────────
export function styleOf($, el) {
  const style = {};
  const inline = ($(el).attr('style') || '');
  for (const decl of inline.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const key = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (val && STYLE_KEYS.includes(key)) style[toCamel(key)] = val;
  }
  const align = ($(el).attr('align') || '').toLowerCase();
  if (align && !style.textAlign) style.textAlign = align;
  return Object.keys(style).length ? style : undefined;
}
function toCamel(k) { return k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

// ── url helpers ────────────────────────────────────────────────────────────────
function absolutize(url, origin) {
  if (!url || /^(https?:|data:|blob:|#|mailto:|tel:)/i.test(url)) return url;
  try { return new URL(url, origin).href; } catch { return url; }
}

function applyAssets($, origin, rehostMap = {}) {
  $('img').each((_, el) => {
    let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || '';
    src = absolutize(src, origin);
    if (rehostMap[src]) src = rehostMap[src];
    if (src) $(el).attr('src', src);
  });
  $('a[href]').each((_, el) => { $(el).attr('href', absolutize($(el).attr('href'), origin)); });
  $('source[src]').each((_, el) => { $(el).attr('src', absolutize($(el).attr('src'), origin)); });
}

// ── element factories ────────────────────────────────────────────────────────
export function htmlEl(code) { return { type: 'html', code: String(code || '').trim() }; }
function section(rows, style) { return { type: 'section', style, rows }; }
function oneColSection(elements, style) {
  return section([{ type: 'row', columns: [{ type: 'column', span: 12, elements }] }], style);
}
export function sectionFromHtml(html, style) { return oneColSection([htmlEl(html)], style); }

// ── classification ─────────────────────────────────────────────────────────────
const INLINE_TAGS = new Set(['span', 'b', 'i', 'em', 'strong', 'small', 'label', 'sub', 'sup', 'code', 'mark', 'u', 'br', 'abbr', 'time']);
const INTERESTING_RE = /^(h[1-6]|img|form|video|iframe|hr|ul|ol|table|blockquote|figure|pre)$/;

// Recurse into a container (to pull native elements) when it holds recognizable
// content or several non-inline children; otherwise treat it as a single text node.
function shouldRecurse($, node) {
  const kids = $(node).children().toArray().map((c) => (c.tagName || '').toLowerCase());
  if (kids.some((t) => INTERESTING_RE.test(t))) return true;
  return kids.filter((t) => t && !INLINE_TAGS.has(t)).length >= 2;
}

function extractFormFields($, formEl) {
  const fields = [];
  $(formEl).find('input,textarea,select').each((_, f) => {
    const type = ($(f).attr('type') || (f.tagName === 'textarea' ? 'textarea' : f.tagName === 'select' ? 'select' : 'text')).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;
    fields.push({
      type, name: $(f).attr('name') || '',
      label: $(f).attr('placeholder') || $(f).attr('aria-label') || $(f).attr('name') || '',
      required: $(f).attr('required') != null,
    });
  });
  return fields;
}

export function classify($, node, opts = {}, depth = 0) {
  const tag = (node.tagName || '').toLowerCase();
  if (!tag) return null;

  if (/^h[1-6]$/.test(tag)) {
    const text = $(node).text().trim();
    return text ? { type: 'heading', level: Number(tag[1]), text: replaceTokens(text, opts), style: styleOf($, node) } : null;
  }
  if (tag === 'img') {
    const src = $(node).attr('src');
    return src ? { type: 'image', src, alt: $(node).attr('alt') || '', style: styleOf($, node) } : null;
  }
  if (tag === 'hr') return { type: 'divider', style: styleOf($, node) };
  if (tag === 'form') return { type: 'form', fields: extractFormFields($, node), action: $(node).attr('action') || '', style: styleOf($, node) };
  if (tag === 'video') {
    const src = $(node).attr('src') || $(node).find('source').attr('src') || '';
    return src ? { type: 'video', provider: 'file', src, style: styleOf($, node) } : htmlEl($.html(node));
  }
  if (tag === 'iframe') {
    const src = $(node).attr('src') || '';
    if (VIDEO_HOST_RE.test(src)) return { type: 'video', provider: /vimeo/i.test(src) ? 'vimeo' : 'youtube', src, style: styleOf($, node) };
    return null; // non-video iframe already stripped; ignore
  }
  if (tag === 'button' || (tag === 'a' && BUTTONISH_RE.test($(node).attr('class') || '') )) {
    const text = $(node).text().trim();
    return text ? { type: 'button', text: replaceTokens(text, opts), href: $(node).attr('href') || '', style: styleOf($, node) } : null;
  }
  if (tag === 'p') {
    const html = ($(node).html() || '').trim();
    return html ? { type: 'text', html: replaceTokens(html, opts), style: styleOf($, node) } : null;
  }
  // Lists / tables / quotes: keep exact markup as custom_code for fidelity.
  if (['ul', 'ol', 'table', 'blockquote', 'figure', 'pre'].includes(tag)) {
    return htmlEl(replaceTokens($.html(node), opts));
  }

  // Container: recurse to pull out native elements.
  if (depth < MAX_DEPTH && shouldRecurse($, node)) {
    const inner = extractElements($, node, opts, depth + 1);
    if (inner.length) return inner;
  }

  // Leaf-ish content (div/span with only text+inline) → text element.
  const text = $(node).text().trim();
  if (text && !shouldRecurse($, node)) {
    return { type: 'text', html: replaceTokens(($(node).html() || '').trim(), opts), style: styleOf($, node) };
  }

  // Anything else with content → custom_code fallback.
  const outer = ($.html(node) || '').trim();
  return outer && text ? htmlEl(replaceTokens(outer, opts)) : null;
}

export function extractElements($, container, opts = {}, depth = 0) {
  const out = [];
  for (const child of $(container).children().toArray()) {
    const res = classify($, child, opts, depth);
    if (Array.isArray(res)) out.push(...res);
    else if (res) out.push(res);
  }
  return out;
}

// ── section discovery ──────────────────────────────────────────────────────────
function topLevelSections($, body) {
  let scope = body;
  // Descend through single generic wrappers (e.g. <div id="root">).
  for (let i = 0; i < 5; i++) {
    const kids = $(scope).children().toArray().filter((c) => (c.tagName || '').toLowerCase() !== 'script');
    if (kids.length === 1 && BLOCK_TAGS.has((kids[0].tagName || '').toLowerCase())) scope = kids[0];
    else break;
  }
  const kids = $(scope).children().toArray().filter((c) => {
    const t = (c.tagName || '').toLowerCase();
    return t && t !== 'script' && t !== 'style';
  });
  return kids.length ? kids : [scope];
}

function buildSection($, el, opts) {
  const style = styleOf($, el);
  let elements = extractElements($, el, opts, 0);
  // If the section itself is a leaf (no block children) classify it directly.
  if (!elements.length) {
    const direct = classify($, el, opts, 0);
    if (Array.isArray(direct)) elements = direct;
    else if (direct) elements = [direct];
  }
  if (!elements.length) {
    const outer = ($.html(el) || '').trim();
    return outer ? sectionFromHtml(replaceTokens(outer, opts), style) : null;
  }
  return oneColSection(elements, style);
}

/**
 * @param {Object} captured  { html, styles, meta, structure }
 * @param {Object} options   { businessName, rehostMap, replaceEmail }
 * @returns {{ name, pathSlug, seo, sections }}
 */
export function normalize(captured = {}, options = {}) {
  const meta = captured.meta || {};
  let origin = '';
  try { origin = meta.url ? new URL(meta.url).origin : ''; } catch { origin = ''; }
  const opts = { businessName: options.businessName || null, replaceEmail: options.replaceEmail || false };

  let $;
  try { $ = load(captured.html || '', { decodeEntities: false }); }
  catch { return fallbackPage(captured, meta); }

  // Strip noise; keep video iframes.
  $('script, noscript, template, link[rel="stylesheet"]').remove();
  $('iframe').each((_, el) => { if (!VIDEO_HOST_RE.test($(el).attr('src') || '')) $(el).remove(); });
  $('*').each((_, el) => { if (el.type === 'comment') $(el).remove(); });
  applyAssets($, origin, options.rehostMap || {});

  const bodyArr = $('body').toArray();
  const body = bodyArr.length ? bodyArr[0] : $.root()[0];
  const sectionEls = topLevelSections($, body).slice(0, MAX_SECTIONS);

  const sections = [];
  for (const el of sectionEls) {
    try { const s = buildSection($, el, opts); if (s) sections.push(s); }
    catch { /* skip a bad section, keep going */ }
  }
  if (!sections.length) return fallbackPage(captured, meta);

  const title = meta.title || 'Cloned Page';
  return {
    name: title,
    pathSlug: slugify(title),
    seo: { title: `{{location.name}} | ${title}`, description: meta.description || '' },
    sections,
  };
}

function fallbackPage(captured, meta) {
  const title = (meta && meta.title) || 'Cloned Page';
  return {
    name: title,
    pathSlug: slugify(title),
    seo: { title: `{{location.name}} | ${title}`, description: (meta && meta.description) || '' },
    sections: [sectionFromHtml(captured.html || '')],
  };
}
