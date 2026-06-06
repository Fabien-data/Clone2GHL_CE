# Build the GHL Workflow — Click‑by‑Click

Companion to [GHL_INTEGRATION.md](GHL_INTEGRATION.md). This is the exact GHL‑UI setup
for the workflow that activates the extension when a customer buys a product.

The backend (`POST /api/ghl/webhook`) provisions the buyer, sets the plan (one‑time
products = **lifetime**, never expire), and **emails the activation code itself**.
So the GHL workflow is a **single webhook step** — no email/AI‑Extract step.

## Webhook contract (from [../backend/src/routes/ghl.js](../backend/src/routes/ghl.js))
- **URL:** `https://<your-backend>/api/ghl/webhook`
- **Auth:** `?token=<GHL_WEBHOOK_SECRET>` in the URL, **or** header `X-GHL-Token: <GHL_WEBHOOK_SECRET>`.
- **Body fields:** `email` (required), `productName` **or** `productId` (must match a
  `GHL_PRODUCT_MAP` key, case‑insensitive), `transactionId` (dedupe), optional `name`, `contactId`.

## Prerequisites
1. Backend live on HTTPS with: `GHL_WEBHOOK_SECRET`, `GHL_PRODUCT_MAP=Starter Plan=starter:lifetime`
   (use your exact product name), `EMAIL_PROVIDER=resend` + `EMAIL_API_KEY` + verified `EMAIL_FROM`.
2. The exact product name as shown in GHL.

## Steps
1. **Automation → Workflows → + Create Workflow → Start from Scratch.** Name it `Clone2GHL — Starter activation`.
2. **+ Add New Trigger → "Payment Received".** Filter **Product → is → Starter Plan**. *(Fallback: "Order Submitted" if Payment Received doesn't fire for your store checkout.)*
3. **+ → "Custom Webhook":**
   - Method **POST**
   - URL `https://<your-backend>/api/ghl/webhook?token=<GHL_WEBHOOK_SECRET>` *(or drop `?token=` and add header `X-GHL-Token`)*
   - Body (Raw / JSON):
     ```json
     {
       "email": "{{contact.email}}",
       "name": "{{contact.first_name}} {{contact.last_name}}",
       "productName": "Starter Plan",
       "transactionId": "{{payment.transaction_id}}",
       "contactId": "{{contact.id}}"
     }
     ```
     Insert `{{...}}` via the merge‑field picker; **hard‑code `productName`** to match the `GHL_PRODUCT_MAP` key.
4. **No email action** — the backend emails the code.
5. **Publish + Save** (contact re‑entry off; backend dedupes by `transactionId`).
6. **Per tier:** duplicate, change the product filter + `productName`, add the product to `GHL_PRODUCT_MAP`.

## Test
1. $1 test purchase (or test mode) with an inbox you control.
2. Workflow **Execution Logs** → Webhook = **200**.
3. Buyer inbox → "Your Clone2GHL access code 🎟".
4. Extension → Settings → Cloud Backend → **Activate Plan** (email + code) → unlocked.
5. Admin → user: `plan: starter`, `productType: lifetime`, `currentPeriodEnd: null`.

## Troubleshooting
| Symptom | Cause / fix |
| --- | --- |
| `401` | Token mismatch (`?token=`/`X-GHL-Token` ≠ `GHL_WEBHOOK_SECRET`). |
| `{"matched": false, "reason": "product_not_mapped"}` | `productName` ≠ a `GHL_PRODUCT_MAP` key — copy it exactly. |
| No email | `EMAIL_PROVIDER`/`EMAIL_API_KEY` unset or from‑domain unverified. Code still in the webhook response; admin can re‑issue from the user drawer. |
| $0 / 100%‑off coupon orders don't fire | Add a parallel **"Coupon Code Applied"** workflow → same webhook. |
| Empty merge fields | `{{payment.*}}` exist only on payment triggers; pick from the trigger's available values. |
