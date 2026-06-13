import dotenv from 'dotenv';

dotenv.config();

// Parse "prod_abc=pro, Starter Plan=starter:lifetime" → { 'prod_abc': {plan:'pro', type:'recurring'},
//   'starter plan': {plan:'starter', type:'lifetime'} }. The optional ":type" suffix marks a product as
//   'lifetime' (one-time purchase, never expires) or 'recurring' (default — 31-day window, re-extended on renewal).
// Keys are lower-cased so we can match a GHL product by ID *or* by name, case-insensitively.
function parseProductMap(raw) {
  const map = {};
  String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(pair => {
      const idx = pair.lastIndexOf('='); // lastIndexOf: product names may contain '='
      if (idx < 0) return;
      const key = pair.slice(0, idx).trim().toLowerCase();
      const [planRaw, typeRaw] = pair.slice(idx + 1).trim().toLowerCase().split(':');
      const plan = (planRaw || '').trim();
      const type = (typeRaw || '').trim() === 'lifetime' ? 'lifetime' : 'recurring';
      if (key && plan) map[key] = { plan, type };
    });
  return map;
}

// Parse "starter=https://...,pro=https://..." → { starter: 'https://...', pro: 'https://...' }.
// Per-plan GHL checkout/upgrade URLs (optional). Used to deep-link the upgrade CTA.
function parseCheckoutMap(raw) {
  const map = {};
  String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(pair => {
      const idx = pair.indexOf('='); // URLs contain '=' in query strings → use the FIRST '='
      if (idx < 0) return;
      const key = pair.slice(0, idx).trim().toLowerCase();
      const url = pair.slice(idx + 1).trim();
      if (key && url) map[key] = url;
    });
  return map;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  clientUrl: process.env.CLIENT_URL || 'https://example.com',
  // Public base URL of the app/backend, used to build links in emails.
  appUrl: process.env.APP_URL || process.env.CLIENT_URL || '',

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Comma-separated exact origins allowed to call the API. The extension's own
  // origin (chrome-extension://<id>) is added from EXTENSION_IDS.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || '')
    .split(',').map(s => s.trim()).filter(s => s && s !== '*'),
  extensionIds: (process.env.EXTENSION_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean),

  // ── Transactional email ───────────────────────────────────────────────────
  emailProvider: process.env.EMAIL_PROVIDER || 'console', // 'resend' | 'console'
  emailApiKey:   process.env.EMAIL_API_KEY  || '',
  emailFrom:     process.env.EMAIL_FROM     || 'Clone2GHL <onboarding@resend.dev>',

  // ── Auth tokens ───────────────────────────────────────────────────────────
  accessTokenTtl:  process.env.ACCESS_TOKEN_TTL  || '30m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  passwordResetTtlMin: Number(process.env.PASSWORD_RESET_TTL_MIN || 30),

  // ── OpenAI ────────────────────────────────────────────────────────────────
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // AI feature models — best available as of 2025
  openaiCopyModel:     process.env.OPENAI_COPY_MODEL     || 'gpt-4.1',       // copy rewriting — best instruction-following
  openaiMiniModel:     process.env.OPENAI_MINI_MODEL     || 'gpt-4.1-mini',  // headlines & reports — fast + cheap
  openaiImageModel:    process.env.OPENAI_IMAGE_MODEL    || 'gpt-image-1',   // logo generation — latest image model

  // Video generation models
  openaiVideoScriptModel: process.env.OPENAI_VIDEO_SCRIPT_MODEL || 'gpt-4.1',
  openaiVideoModel:       process.env.OPENAI_VIDEO_MODEL        || 'sora-2-pro',
  openaiVideoSeconds:     Number(process.env.OPENAI_VIDEO_SECONDS || 16),
  openaiVideoSize:        process.env.OPENAI_VIDEO_SIZE         || '1920x1080',

  // ── HeyGen ───────────────────────────────────────────────────────────────
  heygenApiKey:          process.env.HEYGEN_API_KEY           || '',
  heygenBaseUrl:         process.env.HEYGEN_BASE_URL          || 'https://api.heygen.com',
  heygenWebhookSecret:   process.env.HEYGEN_WEBHOOK_SECRET    || '',

  // ── Admin / Stripe ────────────────────────────────────────────────────────
  adminSecret:           process.env.ADMIN_SECRET             || '',
  // Comma-separated list of emails granted owner / admin dashboard access.
  ownerEmails: (process.env.OWNER_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
  stripeSecretKey:       process.env.STRIPE_SECRET_KEY        || '',
  stripeWebhookSecret:   process.env.STRIPE_WEBHOOK_SECRET    || '',
  stripePriceIds: {
    starter: process.env.STRIPE_PRICE_STARTER || '',
    pro:     process.env.STRIPE_PRICE_PRO     || '',
    agency:  process.env.STRIPE_PRICE_AGENCY  || '',
  },
  // Selling is via GoHighLevel; Stripe is OFF by default so its routes are inert
  // and can never alter a GHL-provisioned account. Set BILLING_STRIPE_ENABLED=true
  // only if you intend to run Stripe as a live payment path.
  billingStripeEnabled: String(process.env.BILLING_STRIPE_ENABLED ?? 'false').toLowerCase() === 'true',

  // ── GoHighLevel (GHL) payment bridge ──────────────────────────────────────
  // Shared secret a GHL workflow must present (header X-GHL-Token or ?token=)
  // when calling our inbound /api/ghl/webhook.
  ghlWebhookSecret:      process.env.GHL_WEBHOOK_SECRET       || '',
  // Maps a purchased GHL product (ID or name) → our plan key.
  ghlProductMap:         parseProductMap(process.env.GHL_PRODUCT_MAP),
  // Days of access granted per successful payment (recurring renewals re-extend).
  ghlPeriodDays:         Number(process.env.GHL_PERIOD_DAYS || 31),
  // Optional HMAC secret — if set, the GHL webhook also accepts a signed request
  // (header X-GHL-Signature = hex HMAC-SHA256 of the raw body) as forge-resistance.
  ghlWebhookHmac:        process.env.GHL_WEBHOOK_HMAC        || '',

  // ── Upgrade / checkout deep-links ──────────────────────────────────────────
  // Where the extension sends a user who must upgrade. Selling is via GHL, so this
  // is normally the clone2ghl.com GHL checkout/order page. A captured ?ref= code
  // is appended to it so GHL's Affiliate Manager attributes the sale.
  ghlCheckoutUrl:        process.env.GHL_CHECKOUT_URL        || '',
  // Optional per-plan override map: "starter=https://...,pro=https://...".
  ghlCheckoutUrls:       parseCheckoutMap(process.env.GHL_CHECKOUT_URLS),
  // Chrome Web Store install link, included in the activation email so buyers can
  // get the extension. Override per environment without a code change.
  extensionInstallUrl:   process.env.EXTENSION_INSTALL_URL || 'https://chromewebstore.google.com/detail/mjphmimkcjjhaejnlpcpekeekjmjfajk',

  // ── Free trial ─────────────────────────────────────────────────────────────
  // Length of the one-time free trial window (non-repeating).
  trialDays:             Number(process.env.TRIAL_DAYS || 30),
  // When true, a brand-new account must prove a working GHL connection (validated
  // server-side) before the free trial is granted. Grandfathered free users keep
  // their lazily-started window regardless. Set TRIAL_REQUIRE_GHL=false to disable.
  trialRequireGhl:       String(process.env.TRIAL_REQUIRE_GHL ?? 'true').toLowerCase() !== 'false',
  // Base URL for server-side GHL location validation (LeadConnector REST).
  ghlApiBase:            process.env.GHL_API_BASE            || 'https://services.leadconnectorhq.com',
};

// Monthly list price per plan in whole dollars. Single source of truth for the
// admin revenue/MRR estimates AND the invoice amount recorded on each GHL payment
// (stored in cents = price * 100). Keep in sync with the in-app + website pricing.
export const planPrices = {
  free:    0,
  starter: 27,
  pro:     147,
  agency:  297,
  owner:   0,
};

// Monthly clone limits per plan (-1 = unlimited)
export const planLimits = {
  free:    6,
  starter: 24,
  pro:     300,
  agency:  -1,
  owner:   -1,   // client/owner account — never capped
};

// Monthly logo generation limits per plan (-1 = unlimited, 0 = not allowed)
export const logoLimits = {
  owner:   -1,   // client/owner account — unlimited
  free:    0,    // not included
  starter: 0,    // not included
  pro:     50,
  agency:  200,
};

// Monthly AI-call limits per plan (optimize / report / headlines). -1 = unlimited.
// These protect the client's shared OpenAI bill — a single user can't run it up.
// Env-overridable so the client can tune caps without a code change.
export const aiLimits = {
  free:    Number(process.env.AI_LIMIT_FREE    ?? 10),
  starter: Number(process.env.AI_LIMIT_STARTER ?? 100),
  pro:     Number(process.env.AI_LIMIT_PRO     ?? 1000),
  agency:  Number(process.env.AI_LIMIT_AGENCY  ?? -1),
  owner:   -1,
};

// The plan a user is *currently entitled to*, accounting for suspension and
// lapsed GHL subscriptions. Use this everywhere access is gated instead of the
// raw user.plan field, so a non-renewing/suspended user silently drops to free
// without needing a cron job to rewrite the stored plan.
export function effectivePlan(user) {
  if (!user) return 'free';
  if (user.status === 'suspended') return 'free';
  if (user.subscriptionSource === 'ghl' && user.currentPeriodEnd) {
    const end = Date.parse(user.currentPeriodEnd);
    if (Number.isFinite(end) && end < Date.now()) return 'free';
  }
  return user.plan || 'free';
}

// Per-plan feature flags. Drives UI gating and backend permission checks.
// Source of truth: PDF spec — Pro unlocks library+adIntel; Agency adds team+DFY.
export const featureFlags = {
  free:    { library: false, adIntel: false, fullAiOptimize: false, team: false, dfyDiscount: false, prioritySupport: false },
  starter: { library: false, adIntel: false, fullAiOptimize: false, team: false, dfyDiscount: false, prioritySupport: false },
  pro:     { library: true,  adIntel: true,  fullAiOptimize: true,  team: false, dfyDiscount: false, prioritySupport: false },
  agency:  { library: true,  adIntel: true,  fullAiOptimize: true,  team: true,  dfyDiscount: true,  prioritySupport: true  },
  owner:   { library: true,  adIntel: true,  fullAiOptimize: true,  team: true,  dfyDiscount: true,  prioritySupport: true  },
};

export function flagsForPlan(plan) {
  return featureFlags[plan] || featureFlags.free;
}
