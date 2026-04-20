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
      if (user) user.plan = nextPlan;
      return draft;
    });
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    await writeDb((draft) => {
      const user = draft.users.find(u => u.stripeCustomerId === customerId);
      if (user) user.plan = 'free';
      return draft;
    });
  }

  return res.json({ received: true });
});

export default router;
