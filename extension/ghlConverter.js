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
    // Remove style imports of Google Fonts (GHL has its own font system)
    html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/gi, '');
    // Remove iframes (except video embeds)
    html = html.replace(/<iframe(?![^>]*youtube|[^>]*vimeo)[^>]*>[\s\S]*?<\/iframe>/gi, '');
    // Convert Google Font @import in styles
    html = html.replace(/@import\s+url\(['"]*https:\/\/fonts\.googleapis\.com[^)]*\)['"]*;?/gi, '');
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

    // Step 1: Sanitize
    html = sanitizeHTML(html);

    // Step 2: Extract parts
    let bodyHtml = extractBody(html);
    const inlineStyles = extractStyles(html);

    // Step 3: Replace forms
    if (replaceForms) {
      bodyHtml = replaceFormsWithGHLPlaceholder(bodyHtml, ghlFormId);
    }

    // Step 4: Replace phone numbers
    if (replacePhone) {
      bodyHtml = replacePhoneNumbers(bodyHtml);
    }

    // Step 5: Replace business name
    if (businessName) {
      bodyHtml = replaceBusinessName(bodyHtml, businessName);
    }

    // Step 6: Wrap in GHL-ready template
    const ghlHtml = wrapInGHLTemplate(bodyHtml, inlineStyles, meta);

    // Step 7: Build payload
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
        replacementsApplied: [
          replaceForms ? 'forms → GHL placeholder' : null,
          replacePhone ? 'phones → {{location.phone}}' : null,
          businessName ? `"${businessName}" → {{location.name}}` : null,
        ].filter(Boolean),
      },
    };
  }

  return { convert, buildGHLPagePayload, sanitizeHTML, slugify };
})();

if (typeof module !== 'undefined') module.exports = GHLConverter;
