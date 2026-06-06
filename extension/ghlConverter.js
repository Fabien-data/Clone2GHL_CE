/**
 * ghlConverter.js
 * Converts captured HTML/CSS into a GHL-compatible page format.
 *
 * GHL Page Builder supports:
 *  1. Native GHL elements (rows, columns, text, image, button, form, video…)
 *  2. Custom Code elements — raw HTML blocks users can edit
 *
 * Our strategy:
 *  - Produce clean, self-contained HTML with all CSS inlined / in a <style> block
 *  - Replace forms with GHL form embed placeholders
 *  - Replace phone numbers and business names with GHL custom value tokens
 *  - Inject GHL-editable data attributes so users know which blocks to replace
 *  - The final HTML is wrapped in a minimal template and uploaded as a
 *    custom_code element — 100% preserves the design and is fully editable
 *    (users swap individual sections with native GHL elements as needed)
 */

const GHLConverter = (() => {

  /** GHL Custom Value tokens */
  const GHL_TOKENS = {
    phone:        '{{location.phone}}',
    email:        '{{location.email}}',
    businessName: '{{location.name}}',
    address:      '{{location.address}}',
    city:         '{{location.city}}',
    state:        '{{location.state}}',
    zip:          '{{location.postalCode}}',
    website:      '{{location.website}}',
  };

  // ─── Sanitization ────────────────────────────────────────────────────────────

  /** Remove scripts, event handlers, tracking iframes */
  function sanitizeHTML(html) {
    // Remove <script> blocks
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // Remove on* event attributes
    html = html.replace(/\s+on\w+="[^"]*"/gi, '');
    html = html.replace(/\s+on\w+='[^']*'/gi, '');
    // Remove javascript: hrefs
    html = html.replace(/href="javascript:[^"]*"/gi, 'href="#"');
    // Remove tracking/chat iframes (keep video iframes)
    html = html.replace(/<iframe(?![^>]*(?:youtube|vimeo|loom|wistia|youtu\.be))[^>]*>[\s\S]*?<\/iframe>/gi, '');
    // Remove <meta http-equiv="refresh">
    html = html.replace(/<meta[^>]*http-equiv="refresh"[^>]*>/gi, '');
    return html;
  }

  /** Strip copyright and trademark boilerplate */
  function removeCopyrightContent(html) {
    html = html.replace(/©\s*\d{4}(?:\s*[-–—]\s*\d{4})?\s*[^<]{0,80}/g, '');
    html = html.replace(/Copyright\s*©?\s*\d{4}(?:\s*[-–—]\s*\d{4})?\s*[^<]{0,80}/gi, '');
    html = html.replace(/All\s+Rights?\s+Reserved\.?/gi, '');
    html = html.replace(/[™®℠]/g, '');
    return html;
  }

  // ─── Asset URL Fixups ────────────────────────────────────────────────────────

  /**
   * Ensure all asset URLs (images, videos, fonts, bg-images) are absolute.
   * Relative URLs that stayed relative after extraction would 404 in GHL.
   * We also add loading="lazy" to images for performance.
   */
  function fixAssetUrls(html, sourceOrigin) {
    if (!sourceOrigin) return html;

    // Fix src attributes (img, video, source, audio)
    html = html.replace(/(<(?:img|video|source|audio|track)[^>]*\s)src="(?!https?:|data:|blob:|\/\/|#)([^"]+)"/gi, (match, prefix, path) => {
      try {
        const abs = new URL(path, sourceOrigin).href;
        return `${prefix}src="${abs}"`;
      } catch { return match; }
    });

    // Fix srcset attributes
    html = html.replace(/srcset="([^"]+)"/gi, (match, srcset) => {
      const fixed = srcset.split(',').map(part => {
        const [url, descriptor] = part.trim().split(/\s+/);
        if (!url || /^https?:|^data:|^blob:|^\/\//.test(url)) return part.trim();
        try {
          const abs = new URL(url, sourceOrigin).href;
          return descriptor ? `${abs} ${descriptor}` : abs;
        } catch { return part.trim(); }
      }).join(', ');
      return `srcset="${fixed}"`;
    });

    // Fix CSS url() in style attributes and <style> blocks
    html = html.replace(/url\(['"]?(?!https?:|data:|blob:|\/\/)([^'"\)\s]+)['"]?\)/g, (match, path) => {
      try {
        const abs = new URL(path, sourceOrigin).href;
        return `url('${abs}')`;
      } catch { return match; }
    });

    // Add lazy loading to images that don't already have it
    html = html.replace(/<img(?![^>]*loading=)([^>]*)>/gi, '<img$1 loading="lazy">');

    return html;
  }

  // ─── Form Replacement ────────────────────────────────────────────────────────

  /** Extract field metadata (name/type/label/required) from a <form> HTML string.
   * Regex-based because the converter runs in a service worker (no DOMParser). */
  function extractFormFields(formHtml) {
    const fields = [];
    const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i')) || [])[1] || '';
    const required = (tag) => /\brequired\b/i.test(tag);

    let m;
    const inputRe = /<input\b[^>]*>/gi;
    while ((m = inputRe.exec(formHtml))) {
      const tag = m[0];
      const type = (attr(tag, 'type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
      fields.push({ type, name: attr(tag, 'name'), label: attr(tag, 'placeholder') || attr(tag, 'aria-label') || attr(tag, 'name'), required: required(tag) });
    }
    const taRe = /<textarea\b[^>]*>/gi;
    while ((m = taRe.exec(formHtml))) {
      const tag = m[0];
      fields.push({ type: 'textarea', name: attr(tag, 'name'), label: attr(tag, 'placeholder') || attr(tag, 'name'), required: required(tag) });
    }
    const selRe = /<select\b[^>]*>/gi;
    while ((m = selRe.exec(formHtml))) {
      const tag = m[0];
      fields.push({ type: 'select', name: attr(tag, 'name'), label: attr(tag, 'aria-label') || attr(tag, 'name'), required: required(tag) });
    }
    return fields;
  }

  /** Replace each <form> with a GHL placeholder that PRESERVES the original
   * fields, so the user can recreate/map them in GHL instead of guessing. */
  function buildFormPlaceholder(fields, formId) {
    const fieldRows = fields.length
      ? `<table style="width:100%;max-width:440px;margin:12px auto 0;border-collapse:collapse;font-size:13px;color:#E8D9B5;">
           ${fields.map(f => `<tr>
             <td style="text-align:left;padding:3px 8px;">${(f.label || f.name || 'field')}${f.required ? ' <span style="color:#F0BB2D">*</span>' : ''}</td>
             <td style="text-align:right;padding:3px 8px;color:#9ca3af;">${f.type}</td>
           </tr>`).join('')}
         </table>`
      : '<div style="font-size:13px;color:#9ca3af;margin-top:8px;">No structured fields detected.</div>';

    return `
<!-- GHL_FORM_EMBED${formId ? ` id="${formId}"` : ''} data-fields='${JSON.stringify(fields).replace(/'/g, '&#39;')}' -->
<div class="c2ghl-form-zone" data-ghl-replace="form"${formId ? ` data-ghl-form-id="${formId}"` : ''} style="
  padding: 28px 24px;
  background: linear-gradient(135deg, #1A1405 0%, #4A3200 100%);
  border: 2px dashed #D9A620;
  border-radius: 12px;
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  margin: 16px 0;
">
  <div style="font-size: 28px; margin-bottom: 8px;">📋</div>
  <div style="font-weight: 700; font-size: 17px; color: #F0BB2D; margin-bottom: 6px;">Add Your GHL Form Here</div>
  <div style="font-size: 13px; color: #D9A620; line-height: 1.5; max-width: 420px; margin: 0 auto;">
    Recreate these ${fields.length} field${fields.length !== 1 ? 's' : ''} in a GHL <strong>Form Element</strong> (or paste your embed code). The original fields are preserved below for mapping.
  </div>
  ${fieldRows}
  ${formId ? `<div style="margin-top:12px; font-size:12px; color:#9ca3af;">Form ID: ${formId}</div>` : ''}
</div>`.trim();
  }

  /** Replace <form> elements with field-preserving GHL placeholders. */
  function replaceFormsWithGHLPlaceholder(html, formId) {
    return html.replace(/<form[\s\S]*?<\/form>/gi, (formHtml) =>
      buildFormPlaceholder(extractFormFields(formHtml), formId));
  }

  // ─── Token Replacements ──────────────────────────────────────────────────────

  function replacePhoneNumbers(html) {
    // US/international phone patterns in text nodes (not inside attributes)
    return html.replace(
      /(?<![a-zA-Z0-9"'=\/])(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?![a-zA-Z0-9"'])/g,
      GHL_TOKENS.phone
    );
  }

  function replaceEmailAddresses(html) {
    // Replace email addresses with GHL token (but not in mailto: hrefs)
    return html.replace(
      /(?<!mailto:)([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g,
      GHL_TOKENS.email
    );
  }

  function replaceBusinessName(html, businessName) {
    if (!businessName) return html;
    const escaped = businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html.replace(new RegExp(`\\b${escaped}\\b`, 'g'), GHL_TOKENS.businessName);
  }

  // ─── GHL Editing Annotations ─────────────────────────────────────────────────

  /**
   * Add data-ghl-* attributes to common editable sections so users know
   * exactly which elements to click and replace in GHL builder.
   */
  function annotateEditableBlocks(html) {
    // Hero sections
    html = html.replace(
      /(<(?:section|div)[^>]*(?:class|id)="[^"]*(?:hero|banner|jumbotron|intro)[^"]*"[^>]*>)/gi,
      '$1<!-- 🎯 GHL: Replace with GHL Section + Text/Image elements -->'
    );
    // CTA sections
    html = html.replace(
      /(<(?:section|div)[^>]*(?:class|id)="[^"]*(?:cta|call-to-action|action)[^"]*"[^>]*>)/gi,
      '$1<!-- ⚡ GHL: Replace with GHL Button element -->'
    );
    // Testimonial sections
    html = html.replace(
      /(<(?:section|div)[^>]*(?:class|id)="[^"]*(?:testimonial|review|feedback)[^"]*"[^>]*>)/gi,
      '$1<!-- ⭐ GHL: Replace with GHL Reviews/Testimonials section -->'
    );
    return html;
  }

  // ─── Style Processing ────────────────────────────────────────────────────────

  function extractBody(html) {
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return m ? m[1] : html;
  }

  function extractStyles(html) {
    const styles = [];
    const regex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) styles.push(m[1]);
    return styles.join('\n');
  }

  function extractHead(html) {
    const m = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    return m ? m[1] : '';
  }

  /** Extract all <link rel="stylesheet"> hrefs */
  function extractExternalStylesheetLinks(html) {
    const hrefs = [];
    const regex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) hrefs.push(m[1]);
    return hrefs;
  }

  /** Extract Google Fonts <link> tags for re-inclusion */
  function extractGoogleFonts(html) {
    const fonts = [];
    const regex = /<link[^>]*href=["']([^"']*fonts\.googleapis\.com[^"']*)["'][^>]*>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) fonts.push(m[1]);
    return fonts;
  }

  // ─── Final HTML Template ─────────────────────────────────────────────────────

  /**
   * Wrap processed HTML in a clean, self-contained GHL page template.
   * This template is designed to:
   *  - Be fully portable (all styles inline or in <style>)
   *  - Support GHL custom values ({{location.*}} tokens)
   *  - Render correctly in GHL's page preview and live site
   *  - Be easily editable — each section has clear GHL edit hints
   */
  function wrapInGHLTemplate(bodyHtml, styles, meta, googleFonts, sourceOrigin) {
    const fontLinks = googleFonts
      .map(href => `  <link rel="stylesheet" href="${href}">`)
      .join('\n');

    // CORS-blocked stylesheets we couldn't inline — keep as <link> fallback
    const fallbackStylesheets = Array.isArray(meta.fallbackStylesheetLinks)
      ? meta.fallbackStylesheetLinks
          .map(href => `  <link rel="stylesheet" href="${escapeHtml(href)}">`)
          .join('\n')
      : '';

    const faviconLink = meta.favicon ? `  <link rel="icon" href="${escapeHtml(meta.favicon)}">` : '';

    const ogTags = [
      meta.ogTitle ? `  <meta property="og:title" content="${escapeHtml(meta.ogTitle)}">` : '',
      meta.ogDescription ? `  <meta property="og:description" content="${escapeHtml(meta.ogDescription)}">` : '',
      meta.ogImage ? `  <meta property="og:image" content="${escapeHtml(meta.ogImage)}">` : '',
      meta.ogType ? `  <meta property="og:type" content="${escapeHtml(meta.ogType)}">` : '',
      meta.themeColor ? `  <meta name="theme-color" content="${escapeHtml(meta.themeColor)}">` : '',
    ].filter(Boolean).join('\n');

    const htmlLang = meta.lang ? escapeHtml(meta.lang) : 'en';
    const sourceComment = sourceOrigin ? `\n  <!-- Original source: ${sourceOrigin} | Cloned by Clone2GHL -->` : '';

    return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{location.name}} | ${escapeHtml(meta.title || 'Home')}</title>
  <meta name="description" content="${escapeHtml(meta.description || '')}">
${faviconLink}
${ogTags}
${fontLinks}
${fallbackStylesheets}${sourceComment}

  <!-- GHL Tracking Code -->
  <!-- {{tracking_code}} -->

  <style>
    /* ── Clone2GHL Base Reset ── */
    *, *::before, *::after { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; padding: 0; }
    img { max-width: 100%; height: auto; }
    a { text-decoration: none; }
    input, button, select, textarea { font-family: inherit; }

    /* ── GHL Form Placeholder ── */
    .c2ghl-form-zone { cursor: pointer; transition: opacity .2s; }
    .c2ghl-form-zone:hover { opacity: .85; }

    /* ── Original Page Styles ── */
${styles || ''}
  </style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════
     CLONE2GHL PAGE — Fully GHL Compatible
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     HOW TO EDIT IN GHL:
     1. Open this page in GHL Builder
     2. Click any section to select it
     3. Replace with native GHL elements (Text, Image, Button, Form…)
     4. Use GHL Custom Values for dynamic content:
        {{location.name}}  — Business name
        {{location.phone}} — Phone number
        {{location.email}} — Email address
     ═══════════════════════════════════════════════════════════ -->

${bodyHtml}

<!-- GHL Footer Scripts -->
<!-- {{footer_scripts}} -->

</body>
</html>`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(str) {
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // ─── Main Conversion ─────────────────────────────────────────────────────────

  /**
   * Convert captured page data to GHL-ready HTML.
   *
   * @param {Object} capturedData - Output from domExtractor (has .html, .styles, .meta)
   * @param {Object} options
   * @param {boolean} options.replaceForms   - Replace <form> tags with GHL placeholders
   * @param {boolean} options.replacePhone   - Replace phone numbers with {{location.phone}}
   * @param {boolean} options.replaceEmail   - Replace emails with {{location.email}}
   * @param {string}  options.businessName   - Business name to replace with {{location.name}}
   * @param {string}  options.ghlFormId      - Optional GHL form ID for placeholder
   * @returns {{ ghlHtml, payload, meta, stats }}
   */
  function convert(capturedData, options = {}) {
    const {
      replaceForms = true,
      replacePhone = true,
      replaceEmail = false,  // off by default — often too aggressive
      businessName = null,
      ghlFormId = null,
    } = options;

    let html = capturedData.html || '';
    const meta = capturedData.meta || {};
    const sourceOrigin = meta.url ? (() => { try { const u = new URL(meta.url); return u.origin; } catch { return null; } })() : null;

    // ── 1. Sanitize ──────────────────────────────────────────────────────────
    html = sanitizeHTML(html);

    // ── 2. Remove copyright ──────────────────────────────────────────────────
    html = removeCopyrightContent(html);

    // ── 3. Fix asset URLs ────────────────────────────────────────────────────
    if (sourceOrigin) {
      html = fixAssetUrls(html, sourceOrigin);
    }

    // ── 4. Extract parts ─────────────────────────────────────────────────────
    let bodyHtml = extractBody(html);
    const googleFonts = extractGoogleFonts(html);

    // Combine styles: captured external CSS + inline <style> blocks
    const externalStyles = capturedData.styles || '';
    const inlineStyles = extractStyles(html);
    const mergedStyles = [externalStyles, inlineStyles].filter(Boolean).join('\n');

    // ── 5. Replace forms ─────────────────────────────────────────────────────
    if (replaceForms) {
      bodyHtml = replaceFormsWithGHLPlaceholder(bodyHtml, ghlFormId);
    }

    // ── 6. Replace phone numbers ─────────────────────────────────────────────
    if (replacePhone) {
      bodyHtml = replacePhoneNumbers(bodyHtml);
    }

    // ── 7. Replace email addresses ───────────────────────────────────────────
    if (replaceEmail) {
      bodyHtml = replaceEmailAddresses(bodyHtml);
    }

    // ── 8. Replace business name ─────────────────────────────────────────────
    if (businessName) {
      bodyHtml = replaceBusinessName(bodyHtml, businessName);
    }

    // ── 9. Annotate editable blocks ──────────────────────────────────────────
    bodyHtml = annotateEditableBlocks(bodyHtml);

    // ── 10. Wrap in GHL template ─────────────────────────────────────────────
    const ghlHtml = wrapInGHLTemplate(bodyHtml, mergedStyles, meta, googleFonts, sourceOrigin);

    // ── 11. Build GHL payload ────────────────────────────────────────────────
    const payload = {
      name: meta.title || 'Cloned Page',
      pathSlug: slugify(meta.title || 'clone-page'),
      seo: {
        title: `{{location.name}} | ${meta.title || ''}`,
        description: meta.description || '',
      },
      content: { html: ghlHtml },
    };

    return {
      ghlHtml,
      payload,
      meta,
      stats: {
        originalLength: (capturedData.html || '').length,
        convertedLength: ghlHtml.length,
        externalCssBytes: externalStyles.length,
        googleFontsCount: googleFonts.length,
        replacementsApplied: [
          'copyright removed',
          sourceOrigin ? 'asset URLs absolutized' : null,
          replaceForms ? 'forms → GHL placeholders' : null,
          replacePhone ? 'phones → {{location.phone}}' : null,
          replaceEmail ? 'emails → {{location.email}}' : null,
          businessName ? `"${businessName}" → {{location.name}}` : null,
          googleFonts.length ? `${googleFonts.length} Google Font(s) preserved` : null,
          externalStyles.length ? 'external CSS inlined' : null,
        ].filter(Boolean),
      },
    };
  }

  return {
    convert,
    sanitizeHTML,
    removeCopyrightContent,
    fixAssetUrls,
    replaceFormsWithGHLPlaceholder,
    replacePhoneNumbers,
    slugify,
  };
})();

if (typeof module !== 'undefined') module.exports = GHLConverter;
