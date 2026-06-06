# Clone2GHL — Go-Live QA Checklist

Run against the **live HTTPS backend** in a **clean browser profile** (Chrome + Edge,
and the Firefox build in Firefox). Automated logic tests: `cd backend && npm test`
and `cd extension && node test/logic.test.cjs`.

## Install & load
- [ ] `node extension/build.mjs` → load `dist/chrome` unpacked in Chrome and Edge; load `dist/firefox` in Firefox (`about:debugging`).
- [ ] No console errors in the service worker / background page on load (confirms `compat.js` + guarded `importScripts`).
- [ ] Popup opens; locale strings render (switch browser language to Spanish → popup shows ES strings).

## Onboarding / billing (M1)
- [ ] Sign up, sign in, **Forgot password** → reset email arrives (check Resend) → reset works.
- [ ] Let the access token expire (or revoke) → next action **silently refreshes**, no forced logout.
- [ ] Free user hits 0 credits → **paywall modal** appears in popup *and* dashboard.
- [ ] First-run **activation banner** shows; pasting a GHL activation code unlocks the plan.
- [ ] Plan/credits identical across popup, sidebar, My Account. Lapsed/suspended shows correct status.

## Core clone → preview → push (M2)
- [ ] Clone a media-heavy page → **fidelity badge** appears with grade + issues tooltip.
- [ ] Older funnel without a score → **📊 Analyze** computes and shows it.
- [ ] **👁 Preview** opens the sandboxed modal; source/converted toggle works; **no scripts run** in the frame.
- [ ] A page with a form → converted block **lists the original fields** (name/type/required).
- [ ] (Pro/Agency) **Rehost images** replaces hot-linked `<img>` and the preview still renders; (Free) rehost is blocked.
- [ ] Push to GHL succeeds (full/partial/html-only handled gracefully).

## Scale / sync (M4)
- [ ] **Search/filter** in My Funnels narrows results; niche/status filters work.
- [ ] **⚡ Batch clone** 3 URLs → 2 run in parallel, per-row ✅/❌, list refreshes.
- [ ] **🕘 History** lists versions after an edit syncs; **Restore** rolls back (and is itself reversible).
- [ ] Sign in on a second profile → funnels **pull**; edit on one → merges by `updatedAt`.
- [ ] **1-click library template** → ready-to-edit funnel.

## Admin console (M3) — as an OWNER_EMAILS account
- [ ] **Overview/Users/Business/Analytics/Invoices/Audit** tabs load.
- [ ] **Business**: MRR, expiring-soon, lapsed, and **top AI-cost consumers** populate.
- [ ] User row → **Detail drawer** (subscription, GHL id, usage incl. AI); **Suspend/Extend/Re-issue code/Reset AI** work.
- [ ] **Impersonate** swaps the session (banner shows); sign back in afterward.
- [ ] **Bulk select** → suspend/extend/change-plan; **Export CSV** downloads.
- [ ] Every admin mutation appears in the **Audit** tab.
- [ ] All modals/drawer: **Esc closes**, focus moves in, `Tab` stays reachable.

## Security / platform (M0)
- [ ] Hammer `/api/auth/login` past the limit → **429**.
- [ ] Webhook with wrong token → **401**; request over size cap → **413**.
- [ ] Disallowed `Origin` gets no `Access-Control-Allow-Origin`; the extension still works (host permission bypasses CORS).
- [ ] `GET /health` returns component status; logs show one JSON line per request with a request id.
- [ ] Render a funnel titled `<img src=x onerror=alert(1)>` → **no script executes**.

## GHL purchase path
- [ ] Run a GHL test/$1 purchase → webhook provisions the account, activation email sends, code activates the plan, admin shows `currentPeriodEnd`.
