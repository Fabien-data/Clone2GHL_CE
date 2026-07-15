# Live GHL Capture — one-command guide (~15 min)

Goal: capture what GHL's own builder sends — **create funnel**, **create page**, **save content**,
**upload media** — PLUS the **native element JSON** for each element type (image, button, video,
form, divider, spacer). This is what unlocks fully-native, element-wise-**editable** pushes: once
these schemas are filled into `NATIVE` in `extension/ghlInternal.js`, images/buttons/forms/videos
become real, clickable GHL elements instead of custom-code blocks. (Heading, paragraph, rich-text,
section/row/column, and the save/create endpoints are already confirmed and native.)

The extension already sniffs these from your logged-in session. You just perform the actions,
then run **one console command** that copies a safe bundle (no auth tokens) for you to paste back.
The bundle's `stillNeeded` field lists exactly which element types are not yet captured.

> **Use a throwaway / test GHL sub-account.** These are GHL's internal endpoints; driving them
> is best proven on a test location first. The capture itself is read-only observation.

---

## 1. Load the capture build

1. Chrome → `chrome://extensions` → turn on **Developer mode** (top-right).
2. Click **Load unpacked** → select the folder:
   `extension/dist/chrome`
3. If it's already loaded, click the **↻ reload** icon on the Clone2GHL card so it picks up
   the new capture tools.

## 2. Do these 4 actions in GHL (stay logged in, don't reload mid-way)

Do them in order, fairly quickly, without extra page reloads:

| # | Action in GHL | Captures |
|---|---------------|----------|
| A | **Sites → Funnels → + New Funnel** (name it anything, create it) | create-funnel request |
| B | In the new funnel, **+ Add Step / Add Page** | create-page request |
| C | **Open that page in the builder** (click it → the drag-and-drop editor opens) | reads the page + learns your session |
| D | Drag in **one of EACH element**: Heading, Paragraph/Text, **Image (upload a file from your computer)**, Button, Video, Form, Divider, Spacer | native JSON for each element type **+ the media-upload request** |
| E | Click **Save** | the page-content persist payload |

> The more element types you add in step D, the more become fully native. Whatever you skip stays
> as a faithful custom-code block (still renders correctly) and shows up in `dump().stillNeeded`.

## 3. Run one command to copy the capture

1. With the builder still open, press **F12** → **Console** tab.
2. In the small **frame dropdown** at the top-left of the Console, make sure it says
   **`app.gohighlevel.com`** (the default top frame). If `window.C2GHLInternal` comes back
   `undefined`, switch that dropdown to `page-builder.leadconnectorhq.com` and retry.
3. Paste this and press Enter:

   ```js
   copy(JSON.stringify(window.C2GHLInternal.captureElements(), null, 2))
   ```

   It says `undefined` — that's normal; `copy()` puts the result on your clipboard.
4. **Paste the clipboard back to me in chat.** Check the `found` list at the top — it should list
   `image`, `button`, `video`, `form`, `divider`, `spacer`. Anything under `missing` wasn't on the
   page — add it and re-run.

`captureElements()` returns ONLY the element node schemas (page content) — small, carries **no
tokens**, and won't get truncated in chat.

If `copy(...)` doesn't work, run this instead and copy the printed text:

```js
JSON.stringify(window.C2GHLInternal.captureElements(), null, 2)
```

> `window.C2GHLInternal.dump()` still exists for endpoint/auth debugging, but it's large and
> records request bodies — prefer `captureElements()` for the element capture.

---

## What you're sending (and what you're NOT)

`dump()` includes:
- `writes` — the method + URL + body of GHL's recent create/save/**upload** requests (**no headers, no tokens**).
- `sampleContent` / `samples` — the page-content JSON (element schema — this is where the native
  image/button/video/form/divider/spacer node shapes live).
- `coverage` / `stillNeeded` — which native element schemas are already confirmed vs. still missing.
  Aim for `stillNeeded: []`; anything left there just stays as custom-code until a later capture.
- `creds` — **only the host + header *names*** (e.g. `authorization`, `token-id`), never their values.

Your GHL login token lives in request **headers**, which `dump()` deliberately does **not** include.
So the bundle is safe to share. (If you want to be doubly sure, skim it — you should see URLs and
JSON structure, no long `Bearer …` strings.)

---

## Troubleshooting

- **`window.C2GHLInternal` is `undefined`** → the frame is wrong (see step 3.2), or the extension
  didn't inject. Reload the GHL tab, redo actions C–D, try again.
- **`dump().writes` is empty or missing the create calls** → you may have navigated too much and
  they scrolled out of the 50-entry buffer, or the funnel/page was created before the tab loaded.
  Reload the GHL tab first, then do A→D in one go and dump immediately.
- **`dump().creds` is `null`** → open/refresh a page *inside the builder* (action C) so the session
  is observed, then dump again.
