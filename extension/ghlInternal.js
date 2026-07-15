/**
 * ghlInternal.js — runs in the MAIN world of app.gohighlevel.com.
 *
 * The ONE place that knows GHL's internal/undocumented builder endpoints, headers,
 * and page-content JSON schema. Everything brittle lives here so a GHL change is a
 * one-file fix. Auth (host + headers) is taken LIVE from what builderInjector.js
 * sniffed off the builder's own requests (window.__C2GHL.creds); the CONFIG.fallback
 * below is only used when sniffing has found nothing yet.
 *
 * ⚠️ These endpoints are NOT the public API. They are undocumented and may change.
 * Fill CONFIG.fallback from extension/docs/GHL_INTERNAL_API.md after a live capture.
 * Every call throws on failure so the caller can fall back to manual copy/paste.
 */
(function () {
  'use strict';
  const g = window;
  if (g.C2GHLInternal) return; // idempotent (may be injected twice — see builderInjector)

  // Bump on any schema/endpoint change so a loaded builder tab can confirm fresh code
  // (check window.C2GHLInternal.BUILD in the console).
  const BUILD = 'native-2026-07-15e';

  // ── CONFIG — fill the fallbacks from docs/GHL_INTERNAL_API.md ──────────────────
  // Path templates support {locationId} {funnelId} {pageId} {stepId} placeholders.
  const CONFIG = {
    fallback: {
      host: 'https://backend.leadconnectorhq.com',          // CONFIRMED (captured live)
      // The builder authenticates with a `token-id` header (NOT Bearer). The sniffer
      // supplies the real token-id/channel/source/version live; these are only gap-fillers.
      headers: { version: '2021-07-28', channel: 'APP', source: 'WEB_USER' },
      endpoints: {
        // All CONFIRMED from a live builder capture (app.aiwazaudit.com) — see docs/GHL_INTERNAL_API.md.
        createFunnel: { method: 'POST', path: '/funnels/funnel/create' },       // body { locationId, name, type:'funnel' }
        createStep:   { method: 'POST', path: '/funnels/funnel/create-step' },  // body { step:{id,name,url,pages,type,split,control_traffic}, funnelId }
        getPageData:  { method: 'GET',  path: '/funnels/builder/page/data?pageId={pageId}' }, // base-page fetch (unverified — falls back to a template)
        // CONFIRMED persist endpoint (the builder's debounced autosave) — body { funnelId, pageData }.
        saveContent:  { method: 'POST', path: '/funnels/builder/autosave/{pageId}' },
        // Live-edit sync (fires on every change, write:false) — kept as a fallback.
        syncChanges:  { method: 'POST', path: '/funnels/builder/prebuilt-section/sync/changes' }, // body { pageData, locationId, write:false, isPublished:false, pageId }
      },
    },
    // Response id extraction — first matching path wins (dot/array paths, incl. array indices).
    idPaths: {
      funnel: ['funnel._id', 'funnel.id', 'funnel.funnelId', 'data.funnel._id', '_id', 'id', 'funnelId', 'data._id', 'data.id'],
      // create-step returns the step (with its auto-created page); the builder pageId
      // lives on the step's first page. Cover the likely shapes defensively.
      page:   ['step.pages.0.id', 'step.pages.0._id', 'pages.0.id', 'pages.0._id', 'page._id', 'page.id', 'step._id', 'step.id', 'data.step.pages.0.id', '_id', 'id', 'data._id'],
    },
    schema: {
      customCodeType: 'custom-code',  // CONFIRMED: meta/tagName 'c-custom-code'
      customCodeProp: 'extra.customCode.value.rawCustomCode', // CONFIRMED: where the raw HTML lives
      // Native container node types + the property holding child nodes at each level.
      container: { section: 'section', row: 'row', column: 'column', childKey: 'children' },
      // Native element node types (GHL builder). Verify against the captured sample:
      // open the browser console on the builder and run  window.C2GHLInternal.sample()
      // to see GHL's REAL element JSON, then correct these names + settingsKey once.
      el: { heading: 'headline', text: 'paragraph', image: 'image', button: 'button', video: 'video', divider: 'divider', spacer: 'spacer', form: 'form' },
      settingsKey: 'meta',      // where a node carries its settings/content
    },
    // Emit NATIVE GHL elements (not a custom-code block). Custom-code is used only
    // for genuinely unmappable blocks, or as an automatic fallback if a native save
    // is rejected. Set false to force the old custom-code behavior.
    nativeElements: true,
    timeoutMs: 30000,
  };

  // ── creds (sniffed) ────────────────────────────────────────────────────────────
  function creds() {
    const learned = g.__C2GHL && g.__C2GHL.creds;
    const host = (learned && learned.host) || CONFIG.fallback.host;
    // Learned headers (the real bearer/token-id/etc.) take precedence; fall back fills gaps.
    const headers = Object.assign({}, CONFIG.fallback.headers, (learned && learned.headers) || {});
    if (!headers['content-type']) headers['content-type'] = 'application/json';
    if (!headers.accept) headers.accept = 'application/json';
    return { host, headers, learned: !!learned };
  }

  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? encodeURIComponent(vars[k]) : `{${k}}`));
  }

  function pick(obj, paths) {
    for (const p of paths) {
      const val = p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
      if (val != null && val !== '') return val;
    }
    return null;
  }

  // Dot-path writer (the write-side mirror of pick). setPath(o,'extra.image.value.url',v)
  // creates intermediate objects as needed. Used by the NATIVE element factories to
  // inject content into a captured GHL node template.
  function setPath(obj, path, val) {
    const keys = String(path).split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    }
    o[keys[keys.length - 1]] = val;
    return obj;
  }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  async function apiFetch(ep, vars, body) {
    const { host, headers } = creds();
    const url = host.replace(/\/+$/, '') + fill(ep.path, vars);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
    let resp;
    try {
      resp = await g.fetch(url, {
        method: ep.method,
        headers,
        // GHL's API authenticates via the Bearer token (sniffed), NOT cookies, and
        // returns Access-Control-Allow-Origin: * — so we must NOT send credentials,
        // or the browser blocks the cross-origin request (credentials+wildcard CORS).
        credentials: 'omit',
        body: body != null ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }

    const text = await resp.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!resp.ok) {
      const msg = (data && (data.message || data.error)) || `HTTP ${resp.status}`;
      const e = new Error(`GHL internal ${ep.method} ${ep.path} → ${msg}`);
      e.status = resp.status; e.data = data;
      throw e;
    }
    return data;
  }

  // ── public ops ───────────────────────────────────────────────────────────────

  async function createFunnel({ name, locationId }) {
    const ep = CONFIG.fallback.endpoints.createFunnel;
    const data = await apiFetch(ep, { locationId }, {
      name: name || 'Clone2GHL Funnel',
      locationId,
      type: 'funnel',
    });
    const id = pick(data, CONFIG.idPaths.funnel);
    if (!id) throw new Error('createFunnel: no funnel id in response');
    return { funnelId: id, raw: data };
  }

  function uuid() {
    try { return crypto.randomUUID(); }
    catch { return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  }

  // Create a page inside a funnel. GHL models a page as a "step" — POST
  // /funnels/funnel/create-step with a client-generated step id; GHL creates the
  // step's page and returns it. Body shape CONFIRMED from a live capture.
  async function createStep({ funnelId, name, locationId }) {
    const ep = CONFIG.fallback.endpoints.createStep;
    const data = await apiFetch(ep, { funnelId, locationId }, {
      step: {
        id: uuid(),
        name: name || 'Cloned Page',
        url: '',
        pages: [],
        type: 'optin_funnel_page',
        split: false,
        control_traffic: 100,
      },
      funnelId,
    });
    const pageId = pick(data, CONFIG.idPaths.page);
    if (!pageId) throw new Error('createStep: no page id in response');
    return { pageId, raw: data };
  }

  // (custom-code leaf factory is customCodeNode(), defined below with the other
  //  confirmed node factories — the old stub here was never a valid GHL node.)

  // ── element-model rendering ────────────────────────────────────────────────
  // Until Phase-0 supplies native element node shapes, every neutral Element is
  // emitted as a custom_code node rendering the right HTML — but wrapped in NATIVE
  // section/row/column nodes, so layout is already editable in GHL. To go fully
  // native per element, replace the relevant branch of elementToNode with a native
  // node factory (single edit point).
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function camelToKebab(k) { return k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); }
  function styleStr(style) {
    if (!style || typeof style !== 'object') return '';
    const css = Object.entries(style).map(([k, v]) => `${camelToKebab(k)}:${v}`).join(';');
    return css ? ` style="${escAttr(css)}"` : '';
  }

  // ── neutral style → native GHL `styles` wrappers ─────────────────────────────
  // Native nodes carry styles as {value} / {unit,value} objects (see textStyles()).
  // We translate the COMMON editable vocabulary so pasted elements are visually
  // faithful AND adjustable in GHL's own style panel; the long tail (cascade,
  // media-queries) still rides along as inline HTML inside a custom-code leaf.
  function pxUnit(v) {
    // "16px" / 16 / "16" → { unit:'px', value:16 }; "2em" → { unit:'em', value:2 }; else null.
    if (v == null) return null;
    const m = String(v).trim().match(/^(-?\d*\.?\d+)\s*(px|em|rem|%|vh|vw)?$/i);
    if (!m) return null;
    return { unit: (m[2] || 'px').toLowerCase(), value: parseFloat(m[1]) };
  }
  function parseBoxShorthand(v) {
    // "10px 20px" → {top:10,right:20,bottom:10,left:20} (numbers, px assumed). null if unparseable.
    if (v == null) return null;
    const parts = String(v).trim().split(/\s+/).map((p) => parseFloat(p));
    if (!parts.length || parts.some((n) => Number.isNaN(n))) return null;
    const a = parts[0], b = parts.length > 1 ? parts[1] : a, c = parts.length > 2 ? parts[2] : a, d = parts.length > 3 ? parts[3] : b;
    return { top: a, right: b, bottom: c, left: d };
  }
  function mapStyle(style /*, kind */) {
    const o = {};
    if (!style || typeof style !== 'object') return o;
    const align = style.textAlign || style.align;
    if (align) o.textAlign = { value: align };
    if (style.color) o.color = { value: style.color };
    if (style.fontWeight != null) o.fontWeight = { value: String(style.fontWeight) };
    if (style.borderRadius != null) o.borderRadius = { value: /^\d+$/.test(String(style.borderRadius)) ? style.borderRadius + 'px' : String(style.borderRadius) };
    const bg = style.backgroundColor || style.background;
    if (bg) o.backgroundColor = { value: bg };
    const pad = parseBoxShorthand(style.padding);
    if (pad) { o.paddingTop = { unit: 'px', value: pad.top }; o.paddingRight = { unit: 'px', value: pad.right }; o.paddingBottom = { unit: 'px', value: pad.bottom }; o.paddingLeft = { unit: 'px', value: pad.left }; }
    return o;
  }
  // fontSize → the desktop/mobile size fields text nodes carry in `extra`.
  function fontSizeExtra(style) {
    if (!style || style.fontSize == null) return null;
    const fs = pxUnit(style.fontSize);
    if (!fs) return null;
    return { desktopFontSize: fs, mobileFontSize: { unit: fs.unit, value: fs.unit === 'px' ? Math.max(12, Math.round(fs.value * 0.72)) : fs.value } };
  }

  function videoEmbed(el) {
    if (el.provider === 'youtube' || el.provider === 'vimeo') {
      return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden"><iframe src="${escAttr(el.src)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen></iframe></div>`;
    }
    return `<video src="${escAttr(el.src)}" controls style="max-width:100%"></video>`;
  }
  function formPlaceholder(el) {
    const rows = (el.fields || []).map((f) => `<tr><td style="padding:3px 8px">${esc(f.label || f.name || 'field')}${f.required ? ' *' : ''}</td><td style="padding:3px 8px;color:#888">${esc(f.type)}</td></tr>`).join('');
    return `<div data-ghl-replace="form" style="padding:24px;border:2px dashed #D9A620;border-radius:12px;text-align:center"><div style="font-weight:700;color:#D9A620">Add a GHL Form here</div><table style="margin:8px auto 0;font-size:13px">${rows}</table></div>`;
  }
  function renderElementHtml(el) {
    switch (el && el.type) {
      case 'heading': { const lv = Math.min(6, Math.max(1, el.level || 2)); return `<h${lv}${styleStr(el.style)}>${esc(el.text)}</h${lv}>`; }
      case 'text': return `<div${styleStr(el.style)}>${el.html || ''}</div>`;
      case 'image': return `<img src="${escAttr(el.src)}" alt="${escAttr(el.alt || '')}"${styleStr(Object.assign({ maxWidth: '100%' }, el.style))}>`;
      case 'button': return `<a href="${escAttr(el.href || '#')}"${styleStr(Object.assign({ display: 'inline-block' }, el.style))}>${esc(el.text)}</a>`;
      case 'video': return videoEmbed(el);
      case 'form': return formPlaceholder(el);
      case 'divider': return `<hr${styleStr(el.style)}>`;
      case 'spacer': return `<div style="height:${escAttr(el.height || '40px')}"></div>`;
      case 'html': default: return (el && el.code) || '';
    }
  }

  // ── GHL-native page generator (matches the live captured schema) ─────────────
  // A page is { sections:[…] }; each section = { id, metaData, elements:[…flat…],
  // sequence } with nesting via `child:[ids]`. Containers are c-section/c-row/
  // c-column; text elements (c-heading/c-paragraph/c-rich-text) carry HTML in
  // extra.text.value — all NATIVE & editable in GHL (never a custom-code block).
  const GA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function gid(prefix) { let s = ''; for (let i = 0; i < 10; i++) s += GA[Math.floor(Math.random() * GA.length)]; return `${prefix}-${s}`; }

  function defWrapper() { return { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 }, width: { value: 'auto', unit: '' }, height: { value: 'auto', unit: '' } }; }
  function animClass() { return { entranceAnimation: { value: null }, animationScale: { value: 1 }, animationDuration: { value: 1 }, animationDelay: { value: 0 }, animationEasing: { value: 'linear' } }; }
  function textStyles(over) {
    return Object.assign({
      backgroundColor: { value: 'var(--transparent)' }, color: { value: 'var(--text-color)' }, inlineColors: { value: [] },
      boldTextColor: { value: 'var(--text-color)' }, italicTextColor: { value: 'var(--text-color)' }, underlineTextColor: { value: 'var(--text-color)' },
      linkTextColor: { value: 'var(--link-color)' }, iconColor: { value: 'var(--text-color)' }, fontFamily: { value: '' },
      fontWeight: { value: 'normal' }, boxShadow: { value: 'none' },
      paddingLeft: { unit: 'px', value: 0 }, paddingRight: { value: 0, unit: 'px' }, paddingTop: { unit: 'px', value: 10 }, paddingBottom: { unit: 'px', value: 10 },
      opacity: { value: '1' }, textShadow: { value: 'none' }, borderColor: { value: 'var(--black)' }, borderWidth: { value: '0px' }, borderStyle: { value: 'none' }, borderRadius: { value: '0px' },
      lineHeight: { value: 1.3, unit: 'em' }, textTransform: { value: 'none' }, letterSpacing: { value: '0', unit: 'px' }, textAlign: { value: 'center' },
    }, over || {});
  }
  function leafBase(meta, tagName, title, tag) {
    const id = gid(meta);
    return { id, type: 'element', child: [], meta, tagName, title, tag, class: animClass(), wrapper: defWrapper(), customCss: [], mobileStyles: {}, mobileWrapper: {} };
  }
  function headingNode(text, level, style) {
    const lv = Math.min(6, Math.max(1, level || 1));
    const n = leafBase('heading', 'c-heading', 'Headline', `h${lv}`);
    n.extra = { nodeId: 'c' + n.id, visibility: { value: { hideDesktop: false, hideMobile: false } }, text: { value: `<h${lv}>${esc(text)}</h${lv}>` }, mobileFontSize: { value: 32, unit: 'px' }, desktopFontSize: { value: 48, unit: 'px' }, typography: { value: 'var(--headlinefont)' }, inlineTypographies: { value: [] }, icon: { value: { name: '', unicode: '', fontFamily: '' } }, customClass: { value: [] }, elementVersion: { value: 2 } };
    n.styles = textStyles({ fontWeight: { value: 'normal', desktop: '700' }, paddingTop: { unit: 'px', value: 0 }, paddingBottom: { unit: 'px', value: 0 } });
    Object.assign(n.styles, mapStyle(style));                 // honor source color/align/weight/padding when present
    const fs = fontSizeExtra(style); if (fs) Object.assign(n.extra, fs);
    return n;
  }
  function paragraphNode(html, style) {
    const n = leafBase('paragraph', 'c-paragraph', 'Paragraph', 'p');
    n.extra = { nodeId: 'c' + n.id, visibility: { value: { hideDesktop: false, hideMobile: false } }, text: { value: `<p>${html || ''}</p>` }, mobileFontSize: { value: 16, unit: 'px' }, desktopFontSize: { value: 16, unit: 'px' }, typography: { value: 'var(--contentfont)' }, inlineTypographies: { value: [] }, icon: { value: { name: '', unicode: '', fontFamily: '' } }, customClass: { value: [] }, elementVersion: { value: 2 } };
    n.styles = textStyles({ fontWeight: { value: 'medium', desktop: '400' } });
    Object.assign(n.styles, mapStyle(style));
    const fs = fontSizeExtra(style); if (fs) Object.assign(n.extra, fs);
    return n;
  }
  function richTextNode(html, style) {
    const n = leafBase('rich-text', 'c-rich-text', 'Rich Text', 'p');
    n.extra = { nodeId: 'c' + n.id, visibility: { value: { hideDesktop: false, hideMobile: false } }, text: { value: String(html || '') }, itemSpacing: { value: 0, unit: 'px' }, mobileFontSize: { value: 14, unit: 'px' }, desktopFontSize: { value: 14, unit: 'px' }, typography: { value: 'var(--contentfont)' }, inlineTypographies: { value: [] }, customClass: { value: [] }, elementVersion: { value: 2 } };
    n.class = { entranceAnimation: { value: null } };
    n.styles = textStyles({ fontWeight: { value: 'medium', desktop: '400' }, paddingLeft: { unit: 'px', value: 5 }, paddingRight: { value: 5, unit: 'px' }, lineHeight: { value: 1.5, unit: 'em' }, textAlign: { value: 'left' } });
    Object.assign(n.styles, mapStyle(style));
    const fs = fontSizeExtra(style); if (fs) Object.assign(n.extra, fs);
    return n;
  }

  // Custom Code (raw HTML/CSS/JS) leaf — CONFIRMED schema from a live capture. Unlike
  // c-rich-text (which GHL sanitizes: strips <style>, classes, complex markup), the
  // custom-code element renders its rawCustomCode VERBATIM — so it's the only faithful
  // way to land a cloned page's HTML+CSS. This is the core of the fidelity fix.
  function customCodeNode(html) {
    const id = gid('custom-code');
    return {
      id, type: 'element', child: [], meta: 'custom-code', tagName: 'c-custom-code', title: 'Custom Code', tag: '',
      class: {},
      // A COMPLETE styles object is required: the builder's backgroundStyle/bgStyle
      // computed reads styles.backgroundColor.value (etc.), so an empty {} makes the
      // editor throw "Cannot read properties of undefined (reading 'value')" and
      // white-screen. Paddings/margins stay 0 so full-bleed cloned HTML isn't boxed.
      styles: {
        boxShadow: { value: 'none' },
        paddingLeft: { unit: 'px', value: 0 }, paddingRight: { value: 0, unit: 'px' }, paddingTop: { unit: 'px', value: 0 }, paddingBottom: { unit: 'px', value: 0 },
        marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 },
        backgroundColor: { value: 'var(--transparent)' }, background: { value: 'none' }, backdropFilter: { value: 'none' }, opacity: { value: '1' },
        borderColor: { value: 'var(--black)' }, borderWidth: { value: '0px' }, borderStyle: { value: 'none' }, borderRadius: { value: '0px' },
      },
      wrapper: defWrapper(), customCss: [], mobileStyles: {}, mobileWrapper: {},
      extra: {
        nodeId: 'c' + id,
        visibility: { value: { hideDesktop: false, hideMobile: false } },
        bgImage: { value: { mediaType: 'image', url: '', opacity: '1', options: 'bgCover', svgCode: '', videoUrl: '', videoThumbnail: '', videoLoop: true } },
        customCode: { value: { rawCustomCode: String(html == null ? '' : html) } },
        customClass: { value: [] },
        elementVersion: { value: 2 },
      },
    };
  }

  const BLOCK_HTML_RE = /<(h[1-6]|ul|ol|table|blockquote|figure|pre|img|iframe|video|hr|div)\b/i;
  // Markup GHL's rich-text editor mangles (strips/reflows) — keep these as custom-code
  // so they render EXACTLY, even for the `text` element type.
  const COMPLEX_HTML_RE = /<(table|figure|iframe|video|img|script|style|svg|form|canvas)\b/i;

  // ── NATIVE element schema table (Tier-2, filled from a Phase-0 capture) ────────
  // Each entry maps a neutral Element → a real GHL builder node. Until the schema
  // is captured, `confirmed` stays false and leafFromElement falls back to a
  // per-ELEMENT custom-code node (full visual fidelity, siblings stay native).
  //
  // To finish an entry after running window.C2GHLInternal.dump() on a live builder:
  //   1) paste GHL's real node for that element into `template` (blank the content),
  //   2) point the 2–3 `fields` dot-paths at where content/link/styles live,
  //   3) flip `confirmed:true`.  No other code changes — the registry auto-switches.
  const NATIVE = {
    // CONFIRMED from a live capture (2026-07-15). Template = GHL's real c-image node,
    // content blanked; make() clones it and injects src/alt/link so GHL accepts it verbatim.
    image: {
      confirmed: true,
      fields: { src: 'extra.imageProperties.value.url', alt: 'extra.imageProperties.value.altText', href: 'extra.visitWebsite.value.url' },
      template: {
        extra: {
          nodeId: '', visibility: { value: { hideDesktop: false, hideMobile: false } },
          imageActions: { value: 'none' }, visitWebsite: { value: { url: '', newTab: false } },
          downloadFile: { value: { fileUrl: '', fileName: '' } },
          imageProperties: { value: { url: '', altText: '', compression: true, placeholderBase64: '', servingUrl: '', imageMeta: '' } },
          customClass: { value: [] }, hideElements: { value: [] }, showElements: { value: [] }, scrollToElement: { value: '' },
          phoneNumber: { value: '' }, emailAddress: { value: '' }, stepPath: { value: '' }, popupId: { value: '' }, elementVersion: { value: 2 },
        },
        mobileExtra: {},
        class: { imageEffects: { value: 'img-effects-none' }, entranceAnimation: { value: null }, animationScale: { value: 1 }, animationDuration: { value: 1 }, animationDelay: { value: 0 }, animationEasing: { value: 'linear' } },
        styles: { paddingLeft: { unit: 'px', value: 10 }, paddingRight: { value: 10, unit: 'px' }, paddingTop: { unit: 'px', value: 10 }, paddingBottom: { unit: 'px', value: 10 }, backgroundColor: { value: 'var(--transparent)' }, opacity: { value: '1' }, textAlign: { value: 'center' }, boxShadow: { value: 'none' }, width: { value: 'auto', unit: '' }, height: { value: 'auto', unit: '' }, borderColor: { value: 'var(--black)' }, borderWidth: { value: '0px' }, borderStyle: { value: 'none' }, borderRadius: { value: '0px' } },
        wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 }, width: { value: 'auto', unit: '' }, height: { value: 'auto', unit: '' } },
        customCss: [], mobileStyles: {}, mobileWrapper: {}, id: '', type: 'element', child: [], meta: 'image', tagName: 'c-image', title: 'Image', tag: '',
      },
      make(el) {
        const n = clone(this.template); n.id = gid('image'); setPath(n, 'extra.nodeId', 'c' + n.id);
        setPath(n, this.fields.src, el.src || ''); setPath(n, this.fields.alt, el.alt || '');
        if (el.href) { setPath(n, this.fields.href, el.href); setPath(n, 'extra.imageActions.value', 'website'); }
        Object.assign(n.styles, mapStyle(el.style)); return n;
      },
    },
    // CONFIRMED from a live capture (2026-07-15). Link buttons set action='website'.
    button: {
      confirmed: true,
      fields: { text: 'extra.text.value', href: 'extra.visitWebsite.value.url' },
      template: {
        extra: {
          nodeId: '', visibility: { value: { hideDesktop: false, hideMobile: false } },
          text: { value: '' }, subText: { value: '' },
          mobileFontSize: { value: 18, unit: 'px' }, desktopFontSize: { value: 16, unit: 'px' },
          subTextDesktopFontSize: { value: 15, unit: 'px' }, subTextMobileFontSize: { value: 15, unit: 'px' },
          typography: { value: 'var(--headlinefont)' },
          iconStart: { value: { name: '', unicode: '', fontFamily: '' } }, iconEnd: { value: { name: '', unicode: '', fontFamily: '' } },
          action: { value: 'website' }, visitWebsite: { value: { url: '', newTab: false } },
          downloadFile: { value: { fileUrl: '', fileName: '' } },
          hideElements: { value: [] }, showElements: { value: [] }, scrollToElement: { value: '' },
          phoneNumber: { value: '' }, emailAddress: { value: '' },
          productId: { value: '' }, storeProductId: { value: '' }, storeProductPriceId: { value: 'all' }, storeCollectionId: { value: '' },
          stepPath: { value: '' }, saleAction: { value: 'go-to-next-funnel-step' }, popupId: { value: '' }, customClass: { value: [] },
        },
        class: { buttonBgStyle: { value: 'custom' }, buttonVp: { value: 'btn-vp' }, buttonHp: { value: 'btn-hp' }, hoverAnimation: { value: null }, entranceAnimation: { value: null }, animationScale: { value: 1 }, animationDuration: { value: 1 }, animationDelay: { value: 0 }, animationEasing: { value: 'linear' } },
        styles: { backgroundColor: { value: 'var(--cobalt)' }, color: { value: 'var(--white)' }, secondaryColor: { value: 'var(--white)' }, paddingTop: { unit: 'px', value: 16 }, paddingBottom: { unit: 'px', value: 16 }, paddingLeft: { unit: 'px', value: 32 }, paddingRight: { value: 32, unit: 'px' }, fontWeight: { value: '', desktop: '500' }, fontWeightSub: { desktop: '400', value: '' }, borderColor: { value: 'var(--white)' }, borderWidth: { value: '1px' }, borderStyle: { value: 'solid' }, borderRadius: { value: '5px' }, letterSpacing: { value: '0', unit: 'px' }, textTransform: { value: 'none' }, width: { value: 'auto', unit: '%' }, boxShadow: { value: 'none' }, textShadow: { value: 'none' }, iconColor: { value: 'var(--white)' } },
        wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 }, textAlign: { value: 'center' }, width: { value: 'auto', unit: '' }, height: { value: 'auto', unit: '' } },
        mobileWrapper: {}, customCss: [], id: '', mobileStyles: {}, type: 'element', child: [], meta: 'button', tagName: 'c-button', title: 'Button', tag: '',
      },
      make(el) {
        const n = clone(this.template); n.id = gid('button'); setPath(n, 'extra.nodeId', 'c' + n.id);
        setPath(n, this.fields.text, el.text || 'Click here');
        if (el.href) { setPath(n, this.fields.href, el.href); setPath(n, 'extra.action.value', 'website'); }
        Object.assign(n.styles, mapStyle(el.style)); return n;
      },
    },
    video: {
      confirmed: false, template: null, fields: { src: 'extra.video.value.url', styles: 'styles' },
      make(el) { const n = clone(this.template); n.id = gid('video'); setPath(n, 'extra.nodeId', 'c' + n.id); setPath(n, this.fields.src, el.src || ''); return n; },
    },
    form: {
      confirmed: false, template: null, fields: { styles: 'styles' },
      make(el) { const n = clone(this.template); n.id = gid('form'); setPath(n, 'extra.nodeId', 'c' + n.id); return n; },
    },
    divider: {
      confirmed: false, template: null, fields: { styles: 'styles' },
      make(el) { const n = clone(this.template); n.id = gid('divider'); setPath(n, 'extra.nodeId', 'c' + n.id); n.styles = Object.assign(n.styles || {}, mapStyle(el.style)); return n; },
    },
    spacer: {
      confirmed: false, template: null, fields: { height: 'extra.height.value' },
      make(el) { const n = clone(this.template); n.id = gid('spacer'); setPath(n, 'extra.nodeId', 'c' + n.id); const h = parseFloat(el.height); if (!Number.isNaN(h)) setPath(n, this.fields.height, h); return n; },
    },
  };

  // Registry: neutral element type → factory. `null` means "no native node — fall
  // back to custom-code". Native factories are gated on their captured schema.
  const LEAF_FACTORIES = {
    heading: (el) => headingNode(el.text, el.level, el.style),
    text: (el) => {
      const h = el.html || '';
      if (COMPLEX_HTML_RE.test(h)) return customCodeNode(renderElementHtml(el)); // exact markup
      if (BLOCK_HTML_RE.test(h)) return richTextNode(h, el.style);               // editable rich text
      return paragraphNode(h, el.style);                                          // simple paragraph
    },
    image: (el) => (NATIVE.image.confirmed ? NATIVE.image.make(el) : null),
    button: (el) => (NATIVE.button.confirmed ? NATIVE.button.make(el) : null),
    video: (el) => (NATIVE.video.confirmed ? NATIVE.video.make(el) : null),
    form: (el) => (NATIVE.form.confirmed ? NATIVE.form.make(el) : null),
    divider: (el) => (NATIVE.divider.confirmed ? NATIVE.divider.make(el) : null),
    spacer: (el) => (NATIVE.spacer.confirmed ? NATIVE.spacer.make(el) : null),
    html: () => null,
  };

  // Neutral element → GHL leaf node. Uses the native factory when its schema is
  // confirmed; otherwise emits a per-ELEMENT custom-code node that renders faithful
  // HTML. Crucially the fallback is per element (not per section) so one un-captured
  // image never forces its whole section into an opaque block.
  // opts.ghlSource=true prefers rich-text for plain text (preserves inline typography).
  function leafFromElement(el, opts) {
    if (!el) return null;
    if (el.type === 'text' && opts && opts.ghlSource && !COMPLEX_HTML_RE.test(el.html || '')) {
      return richTextNode(el.html || '', el.style);
    }
    const f = CONFIG.nativeElements && LEAF_FACTORIES[el.type];
    const node = f ? f(el) : null;
    return node || customCodeNode(renderElementHtml(el));
  }

  function sectionMeta(id, rowIds, style) {
    const child = Array.isArray(rowIds) ? rowIds : [rowIds];
    const n = { id, type: 'section', child, class: { width: { value: 'fullSection' } },
      styles: { boxShadow: { value: 'none' }, paddingLeft: { unit: 'px', value: 0 }, paddingRight: { value: 0, unit: 'px' }, paddingBottom: { unit: 'px', value: 20 }, paddingTop: { unit: 'px', value: 20 }, marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 }, backgroundColor: { value: 'var(--transparent)' }, background: { value: 'none' }, backdropFilter: { value: 'none' }, borderColor: { value: 'var(--black)' }, borderWidth: { value: '0px' }, borderStyle: { value: 'none' }, borderRadius: { value: '0px' } },
      extra: { sticky: { value: 'noneSticky' }, visibility: { value: { hideDesktop: false, hideMobile: false } }, bgImage: { value: { mediaType: 'image', url: '', opacity: '1', options: 'bgCover', svgCode: '', videoUrl: '', videoThumbnail: '', videoLoop: true } }, allowRowMaxWidth: { value: false }, customClass: { value: [] }, elementScreenshot: { value: [] } },
      wrapper: {}, meta: 'section', tagName: 'c-section', title: 'Section',
      // REQUIRED: GHL's builder reads section.mobileStyles.<field>.value when it renders
      // the responsive view — omitting these makes the editor throw and white-screen.
      mobileStyles: {}, mobileWrapper: {}, _id: id };
    Object.assign(n.styles, mapStyle(style));                 // section background / padding from source
    return n;
  }
  function rowNode(id, colIds, style) {
    const child = Array.isArray(colIds) ? colIds : [colIds];
    const n = { id, type: 'row', child, class: { alignRow: { value: 'row-align-center' } },
      styles: { boxShadow: { value: 'none' }, paddingLeft: { value: 5, unit: 'px' }, paddingRight: { value: 5, unit: 'px' }, paddingTop: { value: 10, unit: 'px' }, paddingBottom: { value: 10, unit: 'px' }, backgroundColor: { value: 'var(--transparent)' }, background: { value: 'none' }, backdropFilter: { value: 'none' }, borderColor: { value: 'var(--black)' }, borderWidth: { value: '0px' }, borderStyle: { value: 'none' }, borderRadius: { value: '0px' } },
      extra: { visibility: { value: { hideDesktop: false, hideMobile: false } }, bgImage: { value: { mediaType: 'image', url: '', opacity: '1', options: 'bgCover', svgCode: '', videoUrl: '', videoThumbnail: '', videoLoop: true } }, rowWidth: { value: 100, unit: '%' }, customClass: { value: [] } },
      wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: '', value: 'auto' }, marginRight: { unit: '', value: 'auto' } },
      tagName: 'c-row', meta: 'row', mobileStyles: {}, mobileWrapper: {}, title: `${child.length} Column Row` };
    Object.assign(n.styles, mapStyle(style));
    return n;
  }
  function colNode(id, childIds, widthPct, style) {
    const w = (typeof widthPct === 'number' && widthPct > 0) ? widthPct : 100;
    const n = { id, type: 'col', child: childIds, class: {},
      styles: { boxShadow: { value: 'none' }, paddingLeft: { value: 5, unit: 'px' }, paddingRight: { value: 5, unit: 'px' }, paddingTop: { value: 10, unit: 'px' }, paddingBottom: { value: 10, unit: 'px' }, backgroundColor: { value: 'var(--transparent)' }, background: { value: 'none' }, backdropFilter: { value: 'none' }, width: { value: w, unit: '%' }, borderColor: { value: 'var(--black)' }, borderWidth: { value: '0px' }, borderStyle: { value: 'none' }, borderRadius: { value: '0px' } },
      extra: { visibility: { value: { hideDesktop: false, hideMobile: false } }, bgImage: { value: { mediaType: 'image', url: '', opacity: '1', options: 'bgCover', svgCode: '', videoUrl: '', videoThumbnail: '', videoLoop: true } }, columnLayout: { value: 'column' }, justifyContentColumnLayout: { value: 'center' }, alignContentColumnLayout: { value: 'inherit' }, forceColumnLayoutForMobile: { value: true }, customClass: { value: [] }, elementVersion: { value: 2 } },
      wrapper: { marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 }, marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 } },
      tagName: 'c-column', meta: 'col', mobileStyles: {}, mobileWrapper: {}, title: '1st Column', noOfColumns: 1 };
    Object.assign(n.styles, mapStyle(style));
    return n;
  }
  function sectionGeneral() {
    return { colors: [{ label: 'Transparent', value: 'transparent' }, { label: 'Black', value: '#000000' }], fontsForPreview: ["'Inter'"], rootVars: { '--inter': "'Inter'", '--transparent': 'transparent', '--black': '#000000' }, sectionStyles: '', customFonts: [] };
  }

  // One neutral section → one GHL section object. Preserves the neutral row/column
  // structure: one c-row per neutral row, one c-column per neutral column (width from
  // its 1..12 span), each column holding its own leaves — so multi-column layouts stay
  // multi-column and every element is individually editable. GHL stores nodes FLAT in
  // `elements`, with nesting expressed by each node's `child:[ids]`.
  function buildGhlSection(neutralSec, sequence, ctx) {
    const rowIds = [];
    const rowNodes = [];
    const colNodes = [];
    const allLeaves = [];

    function addColumn(neutralCol) {
      const leafIds = [];
      for (const el of ((neutralCol && neutralCol.elements) || [])) {
        const leaf = leafFromElement(el, ctx);
        if (leaf) { allLeaves.push(leaf); leafIds.push(leaf.id); }
      }
      if (!leafIds.length) { const empty = customCodeNode(''); allLeaves.push(empty); leafIds.push(empty.id); }
      const span = Math.min(12, Math.max(1, (neutralCol && neutralCol.span) || 12));
      const widthPct = Math.round((span / 12) * 1000) / 10;
      const cId = gid('col');
      colNodes.push(colNode(cId, leafIds, widthPct, neutralCol && neutralCol.style));
      return cId;
    }
    function addRow(neutralRow) {
      const colIds = ((neutralRow && neutralRow.columns) || []).map(addColumn);
      if (!colIds.length) colIds.push(addColumn({ elements: [] }));
      const rId = gid('row');
      rowNodes.push(rowNode(rId, colIds, neutralRow && neutralRow.style));
      rowIds.push(rId);
    }

    if (neutralSec && Array.isArray(neutralSec.rows) && neutralSec.rows.length) {
      neutralSec.rows.forEach(addRow);
    } else if (neutralSec && (neutralSec.html != null || neutralSec.code != null)) {
      // Whole-section HTML (client-converter fallback, or the injected full-width CSS).
      addRow({ columns: [{ elements: [{ type: 'html', code: neutralSec.html != null ? neutralSec.html : neutralSec.code }] }] });
    }
    if (!rowIds.length) addRow({ columns: [{ elements: [] }] });

    const secId = gid('section');
    return {
      id: secId, metaData: sectionMeta(secId, rowIds, neutralSec && neutralSec.style),
      elements: [...rowNodes, ...colNodes, ...allLeaves],
      sequence,
      pageId: ctx.pageId, funnelId: ctx.funnelId, locationId: ctx.locationId,
      general: sectionGeneral(),
    };
  }

  function renderSectionHtml(sec) {
    if (sec && sec.html != null) return sec.html;
    const parts = [];
    for (const row of (sec.rows || [])) for (const col of (row.columns || [])) for (const el of (col.elements || [])) parts.push(renderElementHtml(el));
    return parts.join('\n');
  }

  /** Neutral page model → array of GHL section objects.
   *  forceHtml=true collapses each section to a single rich-text element (still NATIVE). */
  function buildGhlSections(pageJson, ctx, forceHtml) {
    const neutral = (pageJson && pageJson.sections) || [];
    // GHL-built SOURCE pages carry _source:'ghl' (from the backend ghlSourceMapper) —
    // prefer rich-text for their text so inline typography/classes survive.
    const ghlSource = !!(pageJson && pageJson._source === 'ghl');
    const fullCtx = Object.assign({ ghlSource }, ctx);
    const sections = neutral.map((sec, i) =>
      forceHtml
        ? buildGhlSection({ rows: [{ columns: [{ elements: [{ type: 'html', code: renderSectionHtml(sec) }] }] }] }, i, fullCtx)
        : buildGhlSection(sec, i, fullCtx));
    if (!sections.length) sections.push(buildGhlSection({ html: (pageJson && pageJson.fallbackHtml) || '' }, 0, fullCtx));

    // Full-width fix: GHL wraps every row/column in a centered max-width (~1140px)
    // container, which boxes a full-bleed cloned page with white gutters on both sides.
    // Force THIS page's exact section/row/column classes to full width — targeting ONLY
    // our generated ids (via !important, which beats GHL's specificity) so the cloned
    // content's own classes are never affected. Injected into the first custom-code
    // element so it adds no visual gap of its own.
    const ids = [];
    for (const s of sections) {
      if (s && s.id) ids.push(s.id);
      for (const el of (s.elements || [])) if (el && (el.meta === 'row' || el.meta === 'col')) ids.push(el.id);
    }
    if (ids.length) {
      const sel = ids.map((id) => '.' + id).join(',');
      const css = `<style id="c2ghl-fullwidth">${sel}{max-width:100%!important;width:100%!important;margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;}</style>`;
      let injected = false;
      for (const s of sections) {
        const leaf = (s.elements || []).find((el) => el && el.meta === 'custom-code' && el.extra && el.extra.customCode);
        if (leaf) { leaf.extra.customCode.value.rawCustomCode = css + (leaf.extra.customCode.value.rawCustomCode || ''); injected = true; break; }
      }
      if (!injected) sections.unshift(buildGhlSection({ html: css }, 0, fullCtx));
    }
    sections.forEach((s, i) => { s.sequence = i; });
    return sections;
  }

  // The `integrations` object the builder sends in its autosave body. Shape CONFIRMED
  // from a live capture: { videoBackground, blogMeta, customCode, popup }. customCode is
  // the count of custom-code elements on the page.
  function computeIntegrations(sections) {
    let customCode = 0;
    for (const sec of sections || []) for (const el of (sec.elements || [])) {
      if (el && el.meta === 'custom-code') customCode++;
    }
    return {
      videoBackground: false,
      blogMeta: { selectedBlogCategories: [], categoryNavigationList: [] },
      customCode,
      popup: false,
    };
  }

  // Save the cloned content into a GHL page. Strategy: GET the current page, swap in
  // our native sections (preserving the page's theme/settings/version), POST autosave.
  // Missing ids default from the sniffed page-data sample (the open builder page).
  // The builder iframe URL is …/location/{locationId}/page-builder/{pageId}.
  function parseBuilderUrl() {
    try {
      const m = g.location.pathname.match(/\/location\/([^/]+)\/page-builder\/([^/?#]+)/i);
      if (m) return { locationId: m[1], pageId: m[2] };
    } catch { /* ignore */ }
    return {};
  }

  // Resolve the live builder context. The page-builder URL carries locationId + the
  // OPEN pageId; the funnelId isn't in the URL, so we read it from the sniffed page
  // data (each section carries funnelId/pageId/locationId).
  function currentContext() {
    const fromUrl = parseBuilderUrl();
    const c = g.__C2GHL || {};
    const sample = c.sample || {};
    const env = (sample && (sample.pageData || sample)) || {};
    const sec = Array.isArray(env.sections) && env.sections.length ? env.sections[0] : null;
    let funnelId = (sec && sec.funnelId) || sample.funnelId || null;
    let pageId = fromUrl.pageId || sample.pageId || (sec && sec.pageId) || null;
    let locationId = fromUrl.locationId || sample.locationId || (sec && sec.locationId) || null;
    // The autosave body requires pageVersion (a number); read the most recent one the
    // builder sent so our save isn't rejected as stale.
    let pageVersion = (typeof sample.pageVersion === 'number') ? sample.pageVersion : null;
    // Fallback: the builder's own autosave/sync request bodies carry funnelId/locationId/
    // pageVersion even when the current page sample doesn't — scan the most recent ones.
    if ((!funnelId || !locationId || pageVersion == null) && Array.isArray(c.writes)) {
      for (let i = c.writes.length - 1; i >= 0; i--) {
        const b = c.writes[i] && c.writes[i].body;
        if (!b) continue;
        const bSec = b.pageData && Array.isArray(b.pageData.sections) && b.pageData.sections[0];
        funnelId = funnelId || b.funnelId || (bSec && bSec.funnelId) || null;
        locationId = locationId || b.locationId || (bSec && bSec.locationId) || null;
        if (pageVersion == null && typeof b.pageVersion === 'number') pageVersion = b.pageVersion;
        if (funnelId && locationId && pageVersion != null) break;
      }
    }
    return { funnelId, pageId, locationId, pageVersion };
  }

  // Known-good default page envelope (from a live captured builder page). Used when
  // we can't fetch the live page — GHL still renders our sections with a valid theme.
  function defaultPalette() {
    return [
      { label: 'Transparent', value: 'transparent' }, { label: 'Primary', value: '#37ca37' },
      { label: 'Secondary', value: '#188bf6' }, { label: 'White', value: '#ffffff' },
      { label: 'Gray', value: '#cbd5e0' }, { label: 'Black', value: '#000000' },
      { label: 'Red', value: '#e93d3d' }, { label: 'Orange', value: '#f6ad55' },
      { label: 'Yellow', value: '#faf089' }, { label: 'Green', value: '#9ae6b4' },
      { label: 'Teal', value: '#81e6d9' }, { label: 'Malibu', value: '#63b3ed' },
      { label: 'Indigo', value: '#757BBD' }, { label: 'Purple', value: '#d6bcfa' },
      { label: 'Pink', value: '#fbb6ce' }, { label: 'Cobalt', value: '#155eef' },
      { label: 'Smoke', value: '#f5f5f5' }, { label: 'Overlay', value: 'rgba(0, 0, 0, 0.5)' },
    ];
  }
  function defaultRootVars() {
    return ':root{--transparent:transparent;--primary:#37ca37;--secondary:#188bf6;--blue:#188bf6;'
      + '--white:#ffffff;--gray:#cbd5e0;--black:#000000;--red:#e93d3d;--orange:#f6ad55;--yellow:#faf089;'
      + '--green:#9ae6b4;--teal:#81e6d9;--malibu:#63b3ed;--indigo:#757BBD;--purple:#d6bcfa;--pink:#fbb6ce;'
      + '--cobalt:#155eef;--smoke:#f5f5f5;--overlay:rgba(0,0,0,0.5);--inter:"Inter";'
      + '--headlinefont:var(--inter);--contentfont:var(--inter);--text-color:var(--black);--link-color:var(--secondary)}';
  }
  // Matches GHL's REAL page envelope (from a live /funnels/builder/page/data capture).
  // The builder's page-level backgroundStyle reads settings.settings.background.bgImage.value —
  // omitting bgImage (the earlier bug) made it throw undefined.value and white-screen the editor.
  function defaultPageData() {
    return {
      sections: [],
      settings: { settings: {
        typography: {
          fonts: {
            headlineFont: { id: 'headlinefont', text: 'Headline Font', value: { text: 'Inter', value: 'var(--inter)' } },
            contentFont:  { id: 'contentfont', text: 'Content Font', value: { text: 'Inter', value: 'var(--inter)' } },
          },
          colors: {
            textColor: { value: { label: 'var(--black)', value: '#000000' } },
            linkColor: { value: { label: 'var(--blue)', value: '#188bf6' } },
          },
        },
        background: {
          bgImage: { value: { url: '', options: 'bgCover' } },   // REQUIRED — builder reads background.bgImage.value
          backgroundColor: { value: 'var(--transparent)' },
        },
        percentWidth: [
          { text: '0 Percent', value: 'progress0' }, { text: '10 Percent', value: 'progress10' }, { text: '20 Percent', value: 'progress20' },
          { text: '30 Percent', value: 'progress30' }, { text: '40 Percent', value: 'progress40' }, { text: '50 Percent', value: 'progress50' },
          { text: '60 Percent', value: 'progress60' }, { text: '70 Percent', value: 'progress70' }, { text: '80 Percent', value: 'progress80' },
          { text: '90 Percent', value: 'progress90' }, { text: '100 Percent', value: 'progress100' },
        ],
        offsetColor: [
          { text: 'White', value: 'progressbarOffsetWhite' }, { text: 'Transparent White', value: 'progressbarOffsetTransparentWhite' },
          { text: 'Black', value: 'progressbarOffsetBlack' }, { text: 'Transparent Black', value: 'progressbarOffsetTransparentBlack' },
        ],
        progressBarSize: [
          { text: 'Small', value: 'progressbarSmall' }, { text: 'Medium', value: 'progressbarMedium' }, { text: 'Large', value: 'progressbarLarge' },
        ],
      } },
      general: { general: { colors: defaultPalette(), fontsToLoad: ['Inter'], fontsToLoadForPreview: ['Inter'], pageStyles: '' } },
      pageStyles: defaultRootVars(),
      trackingCode: {},
      fontsForPreview: ["'Inter'"],
      popups: [],
      popupsList: [],
    };
  }

  // Only these keys belong in pageData; copy them from a live/base page if present.
  const ENVELOPE_KEYS = ['settings', 'general', 'pageStyles', 'trackingCode', 'fontsForPreview', 'popups', 'popupsList'];

  // Save cloned content into a GHL page by replicating the builder's OWN autosave
  // call: POST /funnels/builder/prebuilt-section/sync/changes with the full pageData
  // (our native sections) and write:false (draft). pageId/locationId come from args or
  // the builder URL. CONFIRMED shape from a live capture.
  async function saveContent({ funnelId, pageId, locationId, pageJson, html, forceHtml }) {
    const ctx = currentContext();
    funnelId = funnelId || ctx.funnelId;
    pageId = pageId || ctx.pageId;
    locationId = locationId || ctx.locationId;
    if (!pageId) throw new Error('No target pageId (open a page in the GHL builder first).');

    // Fetch the live page envelope FIRST — it's the most reliable source of funnelId
    // for a freshly-created page (the builder URL carries only pageId, and the sniffed
    // sample can be empty). We must resolve funnelId BEFORE building sections, because
    // each section embeds funnelId; a null there is what broke earlier saves.
    let base = null;
    try { base = await apiFetch(CONFIG.fallback.endpoints.getPageData, { pageId }); }
    catch { base = null; }
    // getPageData may return the envelope directly or wrapped ({ page: {...} } / { pageData: {...} }).
    const baseEnv = (base && (base.pageData || base.page || base)) || {};
    if (!funnelId) {
      funnelId = baseEnv.funnelId
        || (Array.isArray(baseEnv.sections) && baseEnv.sections[0] && baseEnv.sections[0].funnelId)
        || (base && base.funnelId) || null;
    }
    // The autosave endpoint REJECTS (422) without a string funnelId — fail clearly
    // instead of silently no-op'ing (the old sync/changes fallback only wrote a draft
    // preview that never persisted, which is why cloned content vanished).
    if (!funnelId) throw new Error('Could not determine the funnel for this page. Open the funnel’s page in the GHL builder, then paste.');

    const sections = buildGhlSections(pageJson || { sections: [], fallbackHtml: html }, { funnelId, pageId, locationId }, forceHtml);
    for (const s of sections) if (!s.funnelId) s.funnelId = funnelId; // backfill in case it resolved late

    const pageData = defaultPageData();
    for (const k of ENVELOPE_KEYS) if (baseEnv[k] !== undefined) pageData[k] = baseEnv[k];
    pageData.sections = sections;

    // CONFIRMED persist call — replicate the builder's OWN autosave body exactly:
    // { funnelId, pageData, pageVersion:<number>, pageType:'draft', manualSave:true, integrations }.
    // funnelId + pageVersion are REQUIRED (a 422 capture proved it); the earlier bug omitted
    // pageVersion and fell back to sync/changes (draft-only), so nothing actually saved.
    const baseVer = (typeof baseEnv.pageVersion === 'number') ? baseEnv.pageVersion
      : (typeof ctx.pageVersion === 'number') ? ctx.pageVersion : 1;
    const body = {
      funnelId,
      pageData,
      pageVersion: baseVer,
      pageType: 'draft',
      manualSave: true,
      integrations: computeIntegrations(sections),
    };
    const data = await apiFetch(CONFIG.fallback.endpoints.saveContent, { pageId, funnelId, locationId }, body);
    return { ok: true, raw: data, pageId };
  }

  // Read-back verification: fetch the page and report how many sections landed, so the
  // paste orchestrator can PROVE content saved. getPageData is marked unverified — a
  // failure here means "couldn't confirm", NOT "paste failed"; callers degrade gracefully.
  async function verifyPage(args) {
    const pageId = (args && args.pageId) || currentContext().pageId;
    if (!pageId) return { ok: false, error: 'no pageId to verify' };
    try {
      const d = await apiFetch(CONFIG.fallback.endpoints.getPageData, { pageId });
      const env = (d && (d.pageData || d.page || d)) || {};
      const sections = Array.isArray(env.sections) ? env.sections : [];
      return { ok: true, pageId, funnelId: env.funnelId || (sections[0] && sections[0].funnelId) || null, sectionCount: sections.length };
    } catch (e) {
      return { ok: false, pageId, error: String((e && e.message) || e) };
    }
  }

  // ── media upload (Tier-2, pending Phase-0 capture) ───────────────────────────
  // GHL rehosts images into its own media library via an internal endpoint. Until it's
  // captured, MEDIA.confirmed stays false and images keep their (already backend-
  // rehosted, stable) URLs. Fill endpoint+field from a live capture and flip
  // confirmed:true; the paste path can then rewrite image src → GHL media URL.
  // CONFIRMED media flow (live capture 2026-07-15). NOTE: different host than the builder
  // API (services.* not backend.*) — its auth header may differ from the sniffed token-id,
  // so uploadMedia stays gated (confirmed:false) until wired + tested on a live session.
  // Flow: 1) POST createFile → { url:<signed GCS PUT>, aknId:<fileId> }
  //       2) PUT the bytes to that signed url
  //       3) POST verify → { _id, url:'https://assets.cdn.filesafe.space/<loc>/media/<id>.<ext>' }
  //       4) (video only) POST encode { fileId, altId, altType }
  const MEDIA = {
    confirmed: false,
    host: 'https://services.leadconnectorhq.com',
    endpoints: {
      createFile: { method: 'POST', path: '/medias/files/' },      // {name,contentType,parentId:'',altType:'location',altId,size,mode:'public',category:'funnels',subCategory:'page_builder'}
      verify:     { method: 'POST', path: '/medias/files/verify' }, // {altId,altType:'location',id:<fileId>,mode:'public'}
      encode:     { method: 'POST', path: '/medias/encode' },       // {fileId,altId,altType}
    },
    cdnUrlPaths: ['url'],
  };
  async function uploadMedia() {
    if (!MEDIA.confirmed) throw new Error('GHL media upload not wired yet (flow captured; needs live auth test on services.leadconnectorhq.com)');
    throw new Error('uploadMedia: implementation pending live test');
  }
  function nativeCoverage() {
    const cov = {};
    for (const k of Object.keys(NATIVE)) cov[k] = !!NATIVE[k].confirmed;
    cov.media = !!MEDIA.confirmed;
    return cov;
  }

  // Auth headers (the real bearer/token-id) live in creds().headers and must NEVER
  // leave the browser. This returns only their NAMES + the host, so a capture can be
  // shared safely for wiring the endpoints.
  function credsShape() {
    const c = (g.__C2GHL && g.__C2GHL.creds) || null;
    if (!c) return null;
    const headerNames = Object.keys(c.headers || {}).sort();
    return {
      host: c.host || null,
      headerNames,
      hasAuthorization: headerNames.includes('authorization'),
      hasTokenId: headerNames.includes('token-id'),
    };
  }

  // ── One-shot capture for finishing the integration ────────────────────────────
  // Run in the GHL builder's TOP-frame console after creating a funnel + page and
  // saving content:  copy(JSON.stringify(window.C2GHLInternal.dump(), null, 2))
  // SAFE TO SHARE: writes() bodies + samples carry NO auth headers/tokens (those are
  // request headers, never recorded here); creds is reduced to header NAMES only.
  function dump() {
    let href = '';
    try { href = g.location.href; } catch { /* ignore */ }
    const cov = nativeCoverage();
    const missing = Object.keys(cov).filter((k) => !cov[k]);
    return {
      captureVersion: 2,
      build: BUILD,
      location: href,
      creds: credsShape(),                                   // host + header NAMES only (no tokens)
      coverage: cov,                                         // which native element schemas are confirmed
      stillNeeded: missing,                                  // element types whose native JSON we still need — capture these
      writes: (g.__C2GHL && g.__C2GHL.writes) || [],         // POST/PUT method+url+truncated body — the create/save calls
      sampleContent: (g.__C2GHL && g.__C2GHL.sample) || null,// most-recent page-content JSON (native element schema)
      samples: (g.__C2GHL && g.__C2GHL.samples) || [],
      endpointsKnown: CONFIG.fallback.endpoints,             // what we currently assume (for comparison)
      schema: CONFIG.schema,
    };
  }

  // Focused, SMALL, token-free capture for finishing Tier-2. Walks every page-content
  // sample/save the sniffer has seen and returns ONE example node per element type
  // (heading/image/button/video/form/divider/spacer/custom-code) + the container nodes.
  // Page content only — no auth. Run AFTER adding one of each element to a builder page:
  //   copy(JSON.stringify(window.C2GHLInternal.captureElements(), null, 2))
  function captureElements() {
    const c = g.__C2GHL || {};
    const envs = [];
    const addEnv = (o) => { if (o && typeof o === 'object') envs.push(o.pageData && o.pageData.sections ? o.pageData : o); };
    addEnv(c.sample);
    for (const s of (c.samples || [])) addEnv(s && s.json);
    for (const w of (c.writes || [])) if (w && w.body) addEnv(w.body);

    const nodes = {};
    const containers = {};
    for (const env of envs) {
      const sections = env && env.sections;
      if (!Array.isArray(sections)) continue;
      for (const sec of sections) {
        if (sec && sec.metaData && sec.metaData.tagName && !containers[sec.metaData.tagName]) containers[sec.metaData.tagName] = sec.metaData;
        for (const el of ((sec && sec.elements) || [])) {
          if (!el || !el.tagName) continue;
          if (el.meta === 'row' || el.meta === 'col') { if (!containers[el.tagName]) containers[el.tagName] = el; continue; }
          if (el.type === 'element') { const key = el.meta || el.tagName; if (!nodes[key]) nodes[key] = el; }
        }
      }
    }
    return {
      build: BUILD,
      note: 'Native element node schemas from the live builder page (page CONTENT only — no auth tokens). Fill these into NATIVE in ghlInternal.js.',
      found: Object.keys(nodes),
      missing: Object.keys(NATIVE).filter((k) => !nodes[k] && !nodes['c-' + k]),
      containers,
      nodes,
    };
  }

  // Capture the URLs the builder hit (one GET is how it LOADS a page = the correct
  // getPageData endpoint) + GHL's real page ENVELOPE (settings/general/pageStyles,
  // sections stripped). Used to replace our hand-built defaultPageData() with GHL's
  // real one so the builder edit-view stops white-screening.
  //   copy(JSON.stringify(window.C2GHLInternal.captureEnvelope(), null, 2))
  function captureEnvelope() {
    const c = g.__C2GHL || {};
    const samples = c.samples || [];
    const sampleUrls = samples.map((s) => s && s.url).filter(Boolean);
    const writeUrls = (c.writes || []).map((w) => w && w.url).filter(Boolean);
    const cands = [];
    if (c.sample) cands.push({ url: '(latest-sample)', env: (c.sample.pageData || c.sample) });
    for (const s of samples) { const e = s && s.json && (s.json.pageData || s.json); if (e) cands.push({ url: s.url, env: e }); }
    for (const w of (c.writes || [])) { const e = w && w.body && (w.body.pageData || w.body); if (e) cands.push({ url: w.url, env: e }); }
    let envelope = null, envelopeFromUrl = null, envelopeKeys = null;
    for (const cd of cands) {
      const e = cd.env;
      if (e && typeof e === 'object' && (e.settings || e.general || e.pageStyles)) {
        const copy = Object.assign({}, e); delete copy.sections;
        envelope = copy; envelopeFromUrl = cd.url; envelopeKeys = Object.keys(e); break;
      }
    }
    return {
      build: BUILD,
      note: 'sampleUrls = GET requests the builder made (one LOADS the page = getPageData). envelope = GHL real page settings/general/pageStyles (sections stripped, strings may be truncated).',
      sampleUrls, writeUrls, envelopeFromUrl, envelopeKeys, envelope,
    };
  }

  g.C2GHLInternal = {
    BUILD,   // bump on schema/endpoint changes; check to confirm the tab loaded fresh code
    CONFIG,
    NATIVE,          // native element schema table (fill from a Phase-0 capture)
    creds,
    currentContext,
    createFunnel,
    createStep,
    saveContent,
    verifyPage,
    uploadMedia,
    nativeCoverage,
    buildGhlSections, // exposed for testing + schema work
    computeIntegrations,
    renderElementHtml,
    schema: CONFIG.schema,
    // Inspectors for verifying GHL's REAL schema from a live builder session:
    //   window.C2GHLInternal.dump()    → SAFE one-shot capture bundle (share this)
    //   window.C2GHLInternal.sample()  → the page-content JSON GHL itself loaded
    //   window.C2GHLInternal.writes()  → recent builder save requests (url+method+body)
    dump,
    captureElements,
    captureEnvelope,
    credsShape,
    sample: () => (g.__C2GHL && g.__C2GHL.sample) || null,
    samples: () => (g.__C2GHL && g.__C2GHL.samples) || [],
    writes: () => (g.__C2GHL && g.__C2GHL.writes) || [],
  };

  if (typeof module !== 'undefined') module.exports = g.C2GHLInternal;
})();
