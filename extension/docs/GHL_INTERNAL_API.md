# GHL Internal Builder API — Discovery Reference (Phase 0)

> **This file is the spec that [`ghlInternal.js`](../ghlInternal.js) and the Paste‑N‑Pages
> engine code against.** The exact endpoints, headers, and page‑content JSON schema are
> **undocumented** and can only be captured from a live, logged‑in GoHighLevel session.
> Fill in the `TODO:` blocks below from your own capture, then verify
> `ghlInternal.js` → `CONFIG` matches.

> ⚠️ **Honest caveats (already accepted by the project owner):**
> - These are GHL's **internal/undocumented** endpoints. They are **not** part of the
>   public API v2 (which is read‑only for funnel pages) and **may change without notice**.
> - Driving them is against GHL's ToS reverse‑engineering clause; there is an
>   **account‑flag risk**. The extension only ever acts inside the user's own logged‑in
>   session, and falls back to the manual copy/paste flow when a call fails.
> - The runtime **sniffer** ([`builderInjector.js`](../builderInjector.js)) learns the live
>   base URL + auth headers from the builder's *own* requests, so most of this is
>   self‑healing. The values below are the **fallback** used only if sniffing finds nothing.

---

## How to capture (≈10 minutes)

1. Log into a **throwaway** GHL sub‑account. Open **Sites → Funnels** (and **Websites**),
   then **edit a page in the builder**.
2. Open DevTools → **Network** tab → check **Preserve log** → filter **Fetch/XHR**.
3. Perform each action below and, for the matching request, record: **method**, **full URL**
   (host + path + query), **request headers**, and a copy of the **request body**.
   Right‑click → *Copy → Copy as HAR* and save the whole session to `ghl-builder.har`
   (do **not** commit the HAR — it contains your token).

| Action in the builder            | What to capture                                  |
|----------------------------------|--------------------------------------------------|
| Create a new funnel              | create‑funnel request (`A` below)                |
| Add a page / step to the funnel  | create‑page request (`B` below)                  |
| Edit something, then **Save**    | save‑page‑content request + **full body** (`C`)  |
| (note) any GET on page open      | read‑page request — confirms the schema shape    |

---

> **STATUS: CONFIRMED from a live capture (2026-07-04, app.aiwazaudit.com).** Values below
> are wired into `ghlInternal.js`. Auth is a **`token-id`** header (NOT `Authorization: Bearer`);
> the sniffer supplies it live. Host: `https://backend.leadconnectorhq.com`.

## A. Create funnel  ✅

```
POST  https://backend.leadconnectorhq.com/funnels/funnel/create
Headers: token-id, channel: APP, source: WEB_USER, version: 2021-07-28  (sniffed live)
Body (JSON):
  { "locationId": "<loc>", "name": "<name>", "type": "funnel" }
Response → funnelId at: (defensive) funnel._id | funnel.id | _id | id | funnelId
```

## B. Create page / step  ✅

```
POST  https://backend.leadconnectorhq.com/funnels/funnel/create-step
Body (JSON):
  { "step": { "id": "<client-uuid>", "name": "<name>", "url": "", "pages": [],
              "type": "optin_funnel_page", "split": false, "control_traffic": 100 },
    "funnelId": "<funnelId>" }
Response → pageId at: (defensive) step.pages[0].id | pages[0].id | step._id | _id | id
  NOTE: the client-generated step.id ≠ the builder pageId; GHL creates the page and
  returns it. Extract the real pageId from the response (still to be pinned on a live run).
```

## C. Save page content (the important one)  ✅

> **RESOLVED (2026-07):** the confirmed **persist** endpoint the code uses is the builder's
> debounced **autosave**, not `sync/changes`:
> ```
> POST https://backend.leadconnectorhq.com/funnels/builder/autosave/{pageId}
> Body: { funnelId, pageData:{sections,…}, pageVersion:<number>, pageType:'draft',
>         manualSave:true, integrations:{videoBackground,blogMeta,customCode,popup} }
> ```
> `funnelId` **and** `pageVersion` are REQUIRED (a 422 proved it). `sync/changes` (below) is kept
> only as a draft-preview fallback. See `CONFIG.fallback.endpoints` in `extension/ghlInternal.js`.

```
POST  https://backend.leadconnectorhq.com/funnels/builder/prebuilt-section/sync/changes   # fallback only
Body (JSON):
  { "pageData": { sections:[…native…], settings, general, pageStyles, trackingCode,
                  fontsForPreview, popups, popupsList },
    "locationId": "<loc>", "write": false, "isPublished": false, "pageId": "<pageId>" }
  # The builder's live autosave-on-edit call (write:false = draft). Kept as a fallback.
```

### Page‑content JSON schema (from body `C`)

Record the real shape. The tree is roughly `page → sections → rows → columns → elements`.
Capture the exact key names and a real example of each element type you see.

```jsonc
{
  // TODO: confirm top-level wrapper key(s): e.g. { "page": { "elements": [...] } }
  "elements": [
    {
      "id": "TODO",          // id format? (uuid / nanoid)
      "type": "section",     // TODO confirm type name
      "settings": { },       // TODO
      "elements": [
        {
          "type": "row",     // TODO
          "elements": [
            { "type": "column", "elements": [
              // leaf elements we care about:
              { "type": "TODO-headline", "..." : "..." },
              { "type": "TODO-image",    "src": "..." },
              { "type": "TODO-button",   "..." : "..." },
              { "type": "TODO-html",     "code": "<div>…</div>" }  // ← custom-code element
            ] }
          ]
        }
      ]
    }
  ]
}
```

**Most important field:** the **custom‑code / raw‑HTML element** `type` and the property that
holds the HTML string (`code`? `html`? `content`?). Tier‑1 of the converter emits one of these
per section, so this single fact makes the whole pipeline work even before native‑element
mapping (Tier‑2) is done.

> **RESOLVED (2026-07):** containers (`c-section`/`c-row`/`c-column`), text (`c-heading`/
> `c-paragraph`/`c-rich-text`), and the custom‑code leaf (`c-custom-code`, HTML at
> `extra.customCode.value.rawCustomCode`) are all **confirmed** and emitted natively by
> `buildGhlSection`. Layout is preserved (one row/column per neutral row/column, `span`→width).
>
> **Tier‑2 — what a fresh capture still needs:** the native node JSON for `image`, `button`,
> `video`, `form`, `divider`, `spacer` (and the media‑upload endpoint). These live in the
> **`NATIVE` table** in `extension/ghlInternal.js`. To finish one: from `dump().samples`, paste
> GHL's real node into `NATIVE.<type>.template`, set the 2–3 `fields` dot‑paths (where src/href/
> text/styles live), and flip `confirmed:true`. The registry auto‑switches that element from
> custom‑code to native — no other code change. `dump().stillNeeded` lists what's outstanding.

---

## D. Auth & identifiers

| Thing                | Where the builder gets it                  | Value (TODO) |
|----------------------|--------------------------------------------|--------------|
| Base API host        | request origin (e.g. `backend.leadconnectorhq.com`) | `TODO` |
| `Authorization`      | header on builder XHRs                      | `Bearer …`   |
| `token-id`           | header on builder XHRs                      | `TODO`       |
| `channel` / `source` | static headers                             | `TODO`       |
| `version`            | static header                              | `TODO`       |
| `locationId`         | URL path `…/location/<id>/…` or body field | `TODO`       |
| Token storage        | `localStorage` / IndexedDB key (fallback)  | `TODO`       |

> The sniffer captures the header **names + values** automatically by wrapping
> `fetch`/`XHR`. Fill the storage‑key fallback only if sniffing proves unreliable.

---

## E. Funnel vs Website builder differences

```
TODO: note any path/body differences between Funnels and Websites builders,
how step ordering / pathSlug collisions are handled, and the builder URL pattern
(e.g. https://app.gohighlevel.com/v2/location/<id>/funnels-websites/funnels/<funnelId>).
```

---

## F. After capture — wire it up

The paste now emits **native GHL elements by default** (not a custom-code block). The sniffer
auto-captures GHL's real schema so you barely have to transcribe anything:

1. Open a funnel page in the GHL builder, then in the browser console run:
   - `window.C2GHLInternal.sample()` → the **real page-content JSON** GHL itself loaded
     (section/row/column + element node shapes).
   - `window.C2GHLInternal.writes()` → the builder's recent **save requests** (method + URL + body)
     — this is your create/save endpoint + body schema, captured live.
2. From those, set in [`ghlInternal.js`](../ghlInternal.js) `CONFIG`:
   - `fallback.host` + `fallback.endpoints.*` (from `writes()` URLs/methods),
   - `schema.container` (`section`/`row`/`column` type names + the `childKey` that holds children),
   - `schema.el` (native element type names: heading→`headline`?, image→`image`?, …) + `schema.settingsKey`
     (the property a node carries its settings/content under, e.g. `meta`/`settings`/`component`).
3. Re-load the extension and paste. Each element should appear as a **native, editable GHL element**.
   If a native save is ever rejected, the extension automatically retries that page as custom-code so
   it still lands (set `CONFIG.nativeElements = false` to force custom-code globally).
