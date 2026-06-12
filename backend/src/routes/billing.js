import express from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveCheckoutReturnBase(req) {
  if (isHttpUrl(config.clientUrl)) return String(config.clientUrl).replace(/\/+$/, '');
  if (isHttpUrl(req.headers.origin)) return String(req.headers.origin).replace(/\/+$/, '');
  return 'https://example.com';
}

function planFromPriceId(priceId) {
  const pairs = Object.entries(config.stripePriceIds);
  const match = pairs.find(([, id]) => id && id === priceId);
  return match ? match[0] : 'free';
}

router.post('/checkout', authRequired, async (req, res) => {
  const { plan } = req.body || {};
  if (!stripe) return res.status(500).json({ error: 'Stripe is not configured.' });
  if (!config.stripePriceIds[plan]) return res.status(400).json({ error: 'Invalid plan.' });

  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const returnBaseUrl = resolveCheckoutReturnBase(req);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
    customerId = customer.id;
    await writeDb((draft) => {
      const target = draft.users.find(u => u.id === user.id);
      target.stripeCustomerId = customerId;
      return draft;
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: config.stripePriceIds[plan], quantity: 1 }],
    success_url: `${returnBaseUrl}/dashboard.html#settings?billing=success`,
    cancel_url: `${returnBaseUrl}/dashboard.html#settings?billing=cancelled`,
    metadata: { userId: user.id, plan },
  });

  return res.json({ url: session.url });
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !config.stripeWebhookSecret) {
    return res.status(500).send('Stripe webhook is not configured.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripeWebhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed' || event.type === 'customer.subscription.updated') {
    const object = event.data.object;
    const customerId = object.customer;
    const firstItem = object.items?.data?.[0] || object.display_items?.[0] || null;
    const priceId = firstItem?.price?.id || firstItem?.plan?.id || null;
    const nextPlan = planFromPriceId(priceId);

    await writeDb((draft) => {
      const user = draft.users.find(u => u.stripeCustomerId === customerId);
      // Never let a Stripe event override a GHL-provisioned account — GHL is the
      // source of truth for those users. (Also neutralizes the checkout.session
      // .completed → priceId null → 'free' downgrade bug if Stripe is re-enabled.)
      if (user && user.subscriptionSource !== 'ghl') user.plan = nextPlan;
      return draft;
    });
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    await writeDb((draft) => {
      const user = draft.users.find(u => u.stripeCustomerId === customerId);
      if (user && user.subscriptionSource !== 'ghl') user.plan = 'free';
      return draft;
    });
  }

  // ── Invoice lifecycle ────────────────────────────────────────────────────────
  // Persist every paid / failed invoice so we can show users their billing history
  // and let the owner see the global revenue trail from the Admin tab.
  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const customerId = invoice.customer;
    const priceId = invoice.lines?.data?.[0]?.price?.id || null;
    const plan = priceId ? planFromPriceId(priceId) : null;
    const status = event.type === 'invoice.payment_succeeded' ? 'paid' : 'failed';

    await writeDb((draft) => {
      const user = draft.users.find(u => u.stripeCustomerId === customerId);
      if (!user) return draft;

      // Upsert by stripe invoice ID
      const existing = draft.invoices.find(i => i.stripeInvoiceId === invoice.id);
      const record = {
        id: existing?.id || `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: user.id,
        userEmail: user.email,
        stripeInvoiceId: invoice.id,
        stripeCustomerId: customerId,
        plan,
        amount: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : (invoice.amount_due || 0),
        currency: invoice.currency || 'usd',
        status,
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
        hostedInvoiceUrl: invoice.hosted_invoice_url || null,
        invoicePdf: invoice.invoice_pdf || null,
        number: invoice.number || null,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, record);
      else draft.invoices.unshift(record);

      // Cap the audit list size
      if (draft.invoices.length > 10000) draft.invoices.length = 10000;
      return draft;
    });
  }

  return res.json({ received: true });
});

// ── GET /api/billing/invoices ── current user's invoice history ────────────────
router.get('/invoices', authRequired, async (req, res) => {
  const db = await readDb();
  const mine = db.invoices
    .filter(i => i.userId === req.user.userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return res.json({ invoices: mine });
});

export default router;
