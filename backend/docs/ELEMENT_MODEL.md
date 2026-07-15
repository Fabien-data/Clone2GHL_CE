# Neutral Element Model — the backend ⇄ extension contract

The backend **normalizer** (producer) and the extension's `ghlInternal.js` **executor** (consumer)
agree on this single JSON shape. The backend turns any captured page into this model; the extension
maps it to GHL's internal builder node shapes (filled from `extension/docs/GHL_INTERNAL_API.md`).

```
Page    = { name, pathSlug, seo:{title,description}, sections:[Section] }
Section = { type:'section', style?, rows:[Row] }
Row     = { type:'row', style?, columns:[Column] }
Column  = { type:'column', span?:1..12, style?, elements:[Element] }

Element (discriminated by `type`):
  { type:'heading', level:1..6, text, style? }
  { type:'text',    html, style? }                 // inline-formatted paragraph/rich text
  { type:'image',   src, alt?, href?, style? }
  { type:'button',  text, href?, style? }
  { type:'form',    fields:[{type,name,label,required}], action?, style? }
  { type:'video',   provider:'youtube'|'vimeo'|'file', src, style? }
  { type:'divider', style? }
  { type:'spacer',  height?, style? }
  { type:'html',    code }                          // custom_code fallback (always valid)
```

### `style` (optional, best-effort)
A flat map of CSS-ish hints the executor maps to GHL element settings where it can; unknown keys ignored:
`{ textAlign, color, background, fontSize, fontWeight, padding, margin, maxWidth, borderRadius, align }`.

### Rules / invariants
- **Always valid:** any block the normalizer can't classify becomes `{type:'html', code}` — never dropped,
  never throws. A whole section may collapse to one `html` element (still its own editable GHL section).
- **Backward compatible:** v1's `convertToPageJson` output `{ sections:[{html}] }` is the all-`html` subset.
  The executor treats a section whose only element is `html` exactly like a v1 custom_code section.
- **Tokens preserved:** phone/email/business-name are already replaced with `{{location.*}}` by the normalizer.
- **Assets:** `image.src` / `video.src` are absolute and (when rehosting ran) point at rehosted URLs.
- **Links:** internal `<a href>` that target other pages in the same import set are rewritten to `pathSlug`
  refs by the link resolver; external links are untouched.

### Producer
`backend/src/services/normalizer.js` (generic sites, cheerio) and
`backend/src/services/ghlSourceMapper.js` (GHL-built sources → higher fidelity).

### Consumer
`extension/ghlInternal.js`:
- `buildGhlSections(pageJson, ctx, forceHtml)` → `buildGhlSection(...)` maps each Section/Row/Column
  to native `c-section`/`c-row`/`c-column` nodes (column `span` 1..12 → width %), preserving layout.
- `leafFromElement(el, ctx)` maps each Element to a leaf via the `LEAF_FACTORIES` registry: `heading`
  and `text` are native today (`c-heading`/`c-paragraph`/`c-rich-text`); `image`/`button`/`video`/
  `form`/`divider`/`spacer` become native the moment their entry in the `NATIVE` schema table is
  `confirmed` (filled from a Phase-0 capture), else fall back to a **per-element** `c-custom-code`
  node (full fidelity — siblings stay native). `mapStyle(style)` translates the common CSS vocabulary
  onto native `styles`. Single edit point when GHL's schema shifts.
