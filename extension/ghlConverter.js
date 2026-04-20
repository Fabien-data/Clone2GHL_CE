/**
 * ghlConverter.js
 * Converts captured HTML/CSS into a GHL-compatible page format.
 *
 * GHL Page Builder stores page content as structured HTML.
 * This converter:
 *  1. Sanitizes and normalizes the captured HTML
 *  2. Replaces forms with GHL form placeholders
 *  3. Replaces text tokens with GHL custom values
 *  4. Packages everything as a GHL page import payload
 */

const GHLConverter = (() => {

  /** GHL Custom Value tokens for common business data */
  const GHL_TOKENS = {
    phone: '{{location.phone}}',
    email: '{{location.email}}',
    businessName: '{{location.name}}',
    address: '{{location.address}}',
    city: '{{location.city}}',
    state: '{{location.state}}',
    zip: '{{location.postalCode}}',
    website: '{{location.website}}',
  };

  /** GHL-compatible font stack fallbacks */
  const SAFE_FONTS = [
    'Arial', 'Helvetica', 'Georgia', 'Verdana', 'Trebuchet MS',
    'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS',
  ];

  /**
   * Sanitize HTML for GHL:
   * - Strip dangerous attributes
   * - Fix font references
   * - Ensure all images have data-src fallbacks
   */
  function sanitizeHTML(html) {
    // Remove script tags
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // Remove on* event handlers
    html = html.replace(/\s+on\w+="[^"]*"/gi, '');
    html = html.replace(/\s+on\w+='[^']*'/gi, '');
    // Keep Google Fonts — they affect visual fidelity; GHL can override fonts later
    // Remove non-video iframes (tracking pixels, chat widgets, etc.)
    html = html.replace(/<iframe(?![^>]*(?:youtube|vimeo|loom|wistia))[^>]*>[\s\S]*?<\/iframe>/gi, '');
    return html;
  }

  /**
   * Remove copyright notices, trademark symbols, and legal boilerplate
   * so cloned pages can be freely customized without IP liability.
   */
  function removeCopyrightContent(html) {
    // © YEAR or © YEAR–YEAR followed by company name or trailing text
    html = html.replace(/©\s*\d{4}(?:\s*[-–—]\s*\d{4})?\s*[^<]{0,80}/g, '');
    // "Copyright 2024" patterns
    html = html.replace(/Copyright\s*©?\s*\d{4}(?:\s*[-–—]\s*\d{4})?\s*[^<]{0,80}/gi, '');
    // "All Rights Reserved"
    html = html.replace(/All\s+Rights?\s+Reserved\.?/gi, '');
    // Trademark / registered / service mark symbols
    html = html.replace(/[™®℠]/g, '');
    return html;
  }

  /**
   * Replace detected forms with a GHL-compatible form embed placeholder.
   * GHL forms are inserted via their embed code or the form widget.
   */
  function replaceFormsWithGHLPlaceholder(html, formId) {
    const placeholder = formId
      ? `<!-- GHL_FORM_EMBED id="${formId}" --><div class="c2ghl-form-placeholder" data-ghl-form-id="${formId}" style="padding:24px;background:#f8fafc;border:2px dashed #7c3aed;border-radius:8px;text-align:center;color:#7c3aed;font-family:Arial,sans-serif;">
  <p style="font-weight:700;margin-bottom:8px;">📋 GHL Form Embed</p>
  <p style="font-size:.875rem;">Replace this placeholder with your GHL form embed code in the page editor.</p>
</div>`
      : `<!-- GHL_FORM_PLACEHOLDER --><div class="c2ghl-form-placeholder" style="padding:24px;background:#f8fafc;border:2px dashed #7c3aed;border-radius:8px;text-align:center;color:#7c3aed;font-family:Arial,sans-serif;">
  <p style="font-weight:700;margin-bottom:8px;">📋 GHL Form Widget</p>
  <p style="font-size:.875rem;">Add your GHL form widget here in the page editor.</p>
</div>`;

    // Replace <form>...</form> with placeholder
    return html.replace(/<form[\s\S]*?<\/form>/gi, placeholder);
  }

  /**
   * Replace phone numbers in text with GHL custom value token.
   * Pattern: US phone numbers in various formats.
   */
  function replacePhoneNumbers(html) {
    return html.replace(
      /(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
      GHL_TOKENS.phone
    );
  }

  /**
   * Replace generic business name occurrences if detectable.
   * Only runs if sourceDomain is passed.
   */
  function replaceBusinessName(html, businessName) {
    if (!businessName) return html;
    const escaped = businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html.replace(new RegExp(escaped, 'g'), GHL_TOKENS.businessName);
  }

  /**
   * Wrap the page HTML in a GHL-ready template that includes:
   * - Responsive meta tags
   * - GHL tracking script placeholder
   * - Clean, minimal CSS reset
   */
  function wrapInGHLTemplate(bodyHtml, inlineStyles, meta) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta.title || 'Untitled Page')}</title>
  <meta name="description" content="${escapeHtml(meta.description || '')}">
  <!-- Clone2GHL | Original: ${escapeHtml(meta.url || '')} | Captured: ${meta.capturedAt || ''} -->

  <!-- GHL Tracking Script Placeholder -->
  <!-- {{tracking_code}} -->

  <style>
    /* === Clone2GHL Reset === */
    *, *::before, *::after { box-sizing: border-box; }
    img { max-width: 100%; height: auto; }
    a { text-decoration: none; }
    button, input, select, textarea { font-family: inherit; }

    /* === Original Page Styles === */
    ${inlineStyles || ''}
  </style>
</head>
<body>
${bodyHtml}

<!-- GHL Footer Script Placeholder -->
<!-- {{footer_scripts}} -->
</body>
</html>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Extract just the <body> content from a full HTML document.
   */
  function extractBody(html) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
  }

  /**
   * Extract <style> content from a full HTML document.
   */
  function extractStyles(html) {
    const styles = [];
    const regex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      styles.push(match[1]);
    }
    return styles.join('\n');
  }

  /**
   * Build a GHL page creation payload.
   * This matches the expected format for GHL's internal page builder.
   */
  function buildGHLPagePayload(params) {
    const {
      name,
      locationId,
      funnelId,
      html,
      pathSlug,
      seoTitle,
      seoDescription,
    } = params;

    return {
      name: name || 'Clone2GHL Page',
      pathSlug: pathSlug || slugify(name || 'clone-page'),
      ...(funnelId ? { funnelId } : {}),
      ...(locationId ? { locationId } : {}),
      seo: {
        title: seoTitle || name || '',
        description: seoDescription || '',
      },
      content: {
        html: html,
      },
    };
  }

  function slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  /**
   * Main conversion function.
   *
   * @param {Object} capturedData - Output from domExtractor.extractPage()
   * @param {Object} options - { replaceForms, replacePhone, businessName, ghlFormId }
   * @returns {Object} { ghlHtml, payload, meta }
   */
  function convert(capturedData, options = {}) {
    const {
      replaceForms = true,
      replacePhone = true,
      businessName = null,
      ghlFormId = null,
    } = options;

    let html = capturedData.html || '';
    const meta = capturedData.meta || {};

    // Step 1: Sanitize (removes scripts, event handlers, non-video iframes)
    html = sanitizeHTML(html);

    // Step 2: Remove copyright notices and trademark symbols
    html = removeCopyrightContent(html);

    // Step 3: Extract parts
    let bodyHtml = extractBody(html);

    // Merge styles: external CSS fetched at capture time (capturedData.styles)
    // comes first as the base layer; inline <style> tags override on top.
    const externalStyles = capturedData.styles || '';
    const inlineStyles = extractStyles(html);
    const mergedStyles = [externalStyles, inlineStyles].filter(Boolean).join('\n');

    // Step 4: Replace forms with GHL placeholder
    if (replaceForms) {
      bodyHtml = replaceFormsWithGHLPlaceholder(bodyHtml, ghlFormId);
    }

    // Step 5: Replace phone numbers with GHL token
    if (replacePhone) {
      bodyHtml = replacePhoneNumbers(bodyHtml);
    }

    // Step 6: Replace business name with GHL token
    if (businessName) {
      bodyHtml = replaceBusinessName(bodyHtml, businessName);
    }

    // Step 7: Wrap in GHL-ready template
    const ghlHtml = wrapInGHLTemplate(bodyHtml, mergedStyles, meta);

    // Step 8: Build payload
    const payload = buildGHLPagePayload({
      name: meta.title || 'Cloned Page',
      html: ghlHtml,
      seoTitle: meta.title,
      seoDescription: meta.description,
    });

    return {
      ghlHtml,
      payload,
      meta,
      stats: {
        originalLength: (capturedData.html || '').length,
        convertedLength: ghlHtml.length,
        externalCssBytes: externalStyles.length,
        replacementsApplied: [
          'copyright notices removed',
          replaceForms ? 'forms → GHL placeholder' : null,
          replacePhone ? 'phones → {{location.phone}}' : null,
          businessName ? `"${businessName}" → {{location.name}}` : null,
          externalStyles.length ? 'external stylesheets inlined' : null,
        ].filter(Boolean),
      },
    };
  }

  return { convert, buildGHLPagePayload, sanitizeHTML, removeCopyrightContent, slugify };
})();

if (typeof module !== 'undefined') module.exports = GHLConverter;
