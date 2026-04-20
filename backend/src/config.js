import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 8080),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  clientUrl: process.env.CLIENT_URL || 'https://example.com',

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
  stripeSecretKey:       process.env.STRIPE_SECRET_KEY        || '',
  stripeWebhookSecret:   process.env.STRIPE_WEBHOOK_SECRET    || '',
  stripePriceIds: {
    starter: process.env.STRIPE_PRICE_STARTER || '',
    pro:     process.env.STRIPE_PRICE_PRO     || '',
    agency:  process.env.STRIPE_PRICE_AGENCY  || '',
  },
};

// Monthly clone limits per plan (-1 = unlimited)
export const planLimits = {
  free:    6,
  starter: 24,
  pro:     300,
  agency:  -1,
};

// Monthly logo generation limits per plan (-1 = unlimited, 0 = not allowed)
export const logoLimits = {
  free:    0,    // not included
  starter: 0,    // not included
  pro:     50,
  agency:  200,
};
