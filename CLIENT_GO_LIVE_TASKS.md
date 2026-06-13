# Clone2GHL — Final Go-Live Setup (Your Action Required)

The Clone2GHL system is **built, deployed, secured, and tested**. A complete purchase → plan
activation → refund cycle has been confirmed working on the live server (`https://api.clone2ghl.com`),
and the extension is submitted to the Chrome Web Store.

Two final steps must be done in **your** accounts, because they need your login access. Once both are
complete, customers can pay and have their plan activate automatically. Plan for about **30–40 minutes**
(plus a short wait for DNS to update).

> Your developer will fill in the **Webhook Token** referenced below and share it with you securely
> (it's a private key — please don't post it publicly).

---

## Task 1 — Verify your sending domain in Resend  *(~15 min + DNS wait)*

**Why:** After a customer pays, our system emails them a one-time activation code. Email providers only
deliver mail from a *verified* domain — until this is done, those activation emails will bounce or land
in spam.

**You need:** access to your **Resend** account and to your **clone2ghl.com DNS** (it's hosted at
**Namecheap**).

### Steps
1. In **Resend** → **Domains** → **Add Domain** → enter `clone2ghl.com` → choose a region (US is fine)
   → **Add**.
2. Resend will display **3–4 DNS records** to add (a DKIM key, a sending subdomain, and an SPF record).
   The exact values are unique to your account — copy them from the Resend screen. They look like:

   | Type | Host / Name | Value (example — copy yours from Resend) |
   |------|-------------|------------------------------------------|
   | TXT  | `resend._domainkey` | `p=MIGfMA0GCSq…` (a long key) |
   | MX   | `send` | `feedback-smtp.us-east-1.amazonses.com`  (priority 10) |
   | TXT  | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT  | `_dmarc` *(if shown)* | `v=DMARC1; p=none;` |

3. In **Namecheap** → **Domain List** → **Manage** (clone2ghl.com) → **Advanced DNS** →
   **Add New Record**, add each record above.
   - ⚠️ **Important:** In Namecheap's **Host** field, enter only the prefix shown — `resend._domainkey`,
     `send`, `_dmarc` — **not** the full `…clone2ghl.com`. Namecheap adds your domain automatically.
   - ⚠️ **Do not change your existing main email records** — these new records are on a `send`
     subdomain and won't affect your current email.
4. Wait **15–60 minutes**, then click **Verify** in Resend. When it shows **Verified**, you're done.

---

## Task 2 — Connect GoHighLevel to the activation system  *(~20 min)*

**Why:** This is what tells our backend that a customer paid, so it can unlock their plan and send their
activation code. A second workflow handles refunds (removing access).

**You need:** access to your **GoHighLevel** account.

### Workflow 1 — Purchase → activate the plan
1. **Automation → Workflows → Create Workflow** (start blank).
2. **Trigger:** the event that fires when a customer buys — typically **"Order Form Submission"** or
   **"Payment Received"** (use whichever your checkout funnel uses).
3. **Add Action → Webhook** and configure:
   - **Method:** `POST`
   - **URL:** `https://api.clone2ghl.com/api/ghl/webhook?token=YOUR_WEBHOOK_TOKEN`
     *(your developer will provide the token to paste in place of `YOUR_WEBHOOK_TOKEN`)*
   - **Header:** `Content-Type: application/json`
   - **Body** (use the field-picker for the values):
     ```json
     { "email": "{{contact.email}}", "productName": "{{order.product_name}}", "transactionId": "{{order.id}}" }
     ```
   - ⚠️ `productName` must match your plan product names **exactly**: `Starter Plan`, `Pro Plan`, or
     `Agency Plan` (or send the product ID).
4. **Map the response:** in the Webhook action, open **"Customize / Map Response"** and add a field for
   **`activationCode`** (and `plan`). This makes the code available to the next step.
5. **Add Action → Send Email:**
   - **To:** `{{contact.email}}`
   - **Subject:** `Your Clone2GHL access code`
   - **Body:**
     ```
     Thanks for your purchase! Activate your plan in 3 steps:
     1. Open the Clone2GHL extension → Settings → Cloud Backend.
     2. Under "Activate Plan", enter your email and this code:  {{webhook.activationCode}}
     3. Click "Activate Plan" — your plan unlocks instantly.
     ```
     *(`{{webhook.activationCode}}` is the value you mapped in step 4 — the picker shows the exact token.)*
6. **Save** and **Publish** (turn the workflow on).

> **Note:** Once Task 1 (Resend) is verified, our backend **also** emails the code automatically. So the
> "Send Email" step above is an optional backup. You can keep it for extra safety (the customer may get
> two copies) or leave it out and rely on the automatic email — your choice.

### Workflow 2 — Refund / cancellation → remove access
1. **Trigger:** your refund or cancellation event.
2. **Add Action → Webhook:**
   - **Method:** `POST`
   - **URL:** `https://api.clone2ghl.com/api/ghl/cancel?token=YOUR_WEBHOOK_TOKEN`
   - **Body** for a **refund** (removes access immediately):
     ```json
     { "email": "{{contact.email}}", "type": "refund" }
     ```
     For a normal end-of-period cancellation, leave out the `"type"` line (access runs until the paid
     period ends).
3. **Save** and **Publish**.

---

## Values you'll need

| Item | Value |
|------|-------|
| Purchase webhook URL | `https://api.clone2ghl.com/api/ghl/webhook?token=YOUR_WEBHOOK_TOKEN` |
| Refund webhook URL | `https://api.clone2ghl.com/api/ghl/cancel?token=YOUR_WEBHOOK_TOKEN` |
| Webhook Token | *provided separately by your developer (keep private)* |
| From email | `noreply@clone2ghl.com` |
| Plan product names | `Starter Plan`, `Pro Plan`, `Agency Plan` |

---

## When you're finished

Let your developer know. They'll run one final live test to confirm that a purchase activates a plan and
the activation email lands — then you're ready to go live and accept customers.

**Quick health check (anyone can open this in a browser):** `https://api.clone2ghl.com/health` — it
should show `"ok": true`.
