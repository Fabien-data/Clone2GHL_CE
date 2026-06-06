# GoHighLevel → Extension Activation (Finalized)

When a customer buys a Clone2GHL plan on the client's **GHL checkout** (e.g. the
"Starter Plan" One‑Time Product), the extension auto‑activates the right plan.

```
Buyer pays in GHL
   │
   ▼
GHL Workflow ──(1 Custom Webhook)──▶  POST /api/ghl/webhook   (our backend)
                                          │ provisions the account, sets the plan,
                                          │ and EMAILS the activation code (Resend)
                                          ▼
                              Buyer gets the code by email
                                          │
                                          ▼
   Extension → Settings → Cloud Backend → Activate Plan (email + code) → plan unlocked
```

The backend emails the code itself, so the **GHL workflow is a single webhook
step** — no response‑capture or AI‑Extract needed.

---

## 1. Backend config

Set on the deployed backend (see [backend/.env.example](../backend/.env.example)):

| Var | Value |
| --- | --- |
| `GHL_WEBHOOK_SECRET` | long random string (authenticates the webhook) |
| `GHL_PRODUCT_MAP` | product → plan **with billing type**. One‑time products use `:lifetime`. |
| `EMAIL_PROVIDER` / `EMAIL_API_KEY` / `EMAIL_FROM` | `resend` + your Resend key + a verified from‑address |
| `OPENAI_API_KEY`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `EXTENSION_IDS` | as per [DEPLOYMENT.md](../DEPLOYMENT.md) |

**Product map** — key is the GHL product **name or id** (case‑insensitive); append
`:lifetime` (never expires) or `:recurring` (default, 31‑day window re‑extended by
renewals):
```
GHL_PRODUCT_MAP=Starter Plan=starter:lifetime, Pro Plan=pro:lifetime, Agency Plan=agency:lifetime
```
> Your products are **One‑Time** → use `:lifetime` for each. A lifetime purchase
> sets `currentPeriodEnd = null`, so the plan never downgrades.

---

## 2. GHL Workflow (one per product)

> Need the full click‑by‑click GHL‑UI version? See [GHL_WORKFLOW_SETUP.md](GHL_WORKFLOW_SETUP.md).

GHL's **Payment Received** trigger doesn't expose the product name as a mappable
field, so create **one workflow per product** and hard‑code that product's name in
the webhook body (it must match a `GHL_PRODUCT_MAP` key).

**Automation → Workflows → Create:**

1. **Trigger:** `Payment Received`
   - Filter: **Product = Starter Plan** (the product this workflow handles).
   - (Optional) Filter Transaction type = *first / customer‑present* to skip odd events.
2. **Action — Custom Webhook:**
   - Method `POST`
   - URL: `https://<your-backend>/api/ghl/webhook?token=<GHL_WEBHOOK_SECRET>`
   - Body (JSON):
     ```json
     {
       "email": "{{contact.email}}",
       "name": "{{contact.first_name}} {{contact.last_name}}",
       "productName": "Starter Plan",
       "transactionId": "{{payment.transaction_id}}",
       "contactId": "{{contact.id}}"
     }
     ```
     `productName` is hard‑coded here and must equal the `GHL_PRODUCT_MAP` key.
3. **That's it** — the backend emails the activation code. Do **not** add a GHL
   email step (it would double‑send).

Duplicate Starter → Pro → Agency workflows, changing the product filter and the
`productName` value in each.

### Notes
- **100%‑off coupons / $0 orders:** `Payment Received` may not fire on a $0 order.
  If you sell free tiers via coupon, add a parallel workflow on **Coupon Code
  Applied** that hits the same webhook.
- **Renewals (recurring only):** later payments re‑extend access and return
  `activationCode: null` — no second email is sent. Lifetime products never renew.
- **Refunds/cancellations (optional):** point a cancel workflow at
  `POST /api/ghl/cancel?token=…` with `{ "email": "{{contact.email}}" }`.

---

## 3. Buyer activation (already shipped in v1.0.3)
Extension → **Settings → Cloud Backend → Activate Plan**: enter the purchase email
+ the emailed code (optionally set a password) → **Activate Plan**. The plan, feature
gates, and usage unlock instantly. (Confirm the build's `DEFAULT_BACKEND_API_BASE`
points to your live backend so buyers don't have to type the URL.)

---

## 4. End‑to‑end test
1. Set `GHL_PRODUCT_MAP=Starter Plan=starter:lifetime` and `EMAIL_PROVIDER=resend` (+ key) on the backend.
2. Build the Starter workflow above; run a **$1 test purchase** through the GHL checkout.
3. Confirm the buyer receives the **activation‑code email**.
4. In a clean browser profile, activate in the extension → plan shows **Starter**.
5. Admin tab → the user shows `plan: starter`, `productType: lifetime`,
   `currentPeriodEnd: null` (no expiry).
6. (Recurring products only) verify renewals re‑extend and expiry downgrades work.
