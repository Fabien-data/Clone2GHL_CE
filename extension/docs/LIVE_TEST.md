# Live test — native paste into GHL (~5 min)

Everything from the capture is wired. This verifies it end-to-end on your real GHL.

## 0. Reload the build
`chrome://extensions` → click **↻ reload** on the Clone2GHL card (picks up the new wiring).

---

## 1. 30-second smoke test (do this first)

This directly writes two native elements into the page you have open — the fastest way to
confirm the endpoint + auth + schema + save all work, before touching the full UI.

1. Open one of your GHL **funnel pages in the builder** (the drag-and-drop editor).
2. Press **F12 → Console** (frame dropdown = `app.aiwazaudit.com`, same as the capture).
3. Paste this and press Enter:

   ```js
   window.C2GHLInternal.saveContent({
     pageJson: { sections: [ { rows: [ { columns: [ { elements: [
       { type: 'heading', text: '✅ Clone2GHL native paste works', level: 1 },
       { type: 'text', html: '<p>If you can see this after reloading the builder, the auto-paste is wired correctly.</p>' }
     ] } ] } ] } ] }
   }).then(r => console.log('SAVE RESULT:', r)).catch(e => console.error('SAVE FAILED:', e));
   ```

4. **Reload the builder page.**

**Result:**
- ✅ You see the heading + paragraph → the core auto-paste works. Go to step 2.
- ❌ `SAVE FAILED` or nothing appears after reload → run the dump below and paste it to me:

   ```js
   copy(JSON.stringify(window.C2GHLInternal.dump(), null, 2))
   ```

   The dump now includes the **response** of each call, so I'll see the exact status/body
   (e.g. a 404 = wrong path, 401/403 = auth, or `write:false` didn't persist) and fix it fast.

> If the heading appears but only after also clicking GHL's own **Save**, tell me — that means
> we should send `write:true`. If it appears on reload without saving, `write:false` is correct.

---

## 2. Full "Paste N Pages" flow

1. Go to any website you want to clone. Open the Clone2GHL panel → **Scan** → tick a couple of
   pages → **Copy Selected**. (You'll see "N pages ready to paste.")
2. Open your **GHL funnel builder** with a page open (as in step 1).
3. Open the Clone2GHL **dashboard** → the **"N pages ready to paste"** banner → **→ Paste N Pages to GHL**.
4. Watch the progress, then **reload the GHL builder**.

**Expected:** page 1 lands in the page you had open; each extra page becomes a new step/page in
the same funnel. The dashboard reports `X/Y pasted`, and only clears the captured set if all Y landed.

## 3. If anything is off
Run the dump one-liner from step 1 and paste it to me. With responses included, I can pin the
exact fix (usually the create-step response's pageId path, or the save's write flag).
