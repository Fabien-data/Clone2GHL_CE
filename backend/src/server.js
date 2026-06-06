import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import funnelRoutes from './routes/funnels.js';
import usageRoutes from './routes/usage.js';
import billingRoutes from './routes/billing.js';
import preferencesRoutes from './routes/preferences.js';
import activityRoutes from './routes/activity.js';
import analyticsRoutes from './routes/analytics.js';
import videoRoutes from './routes/videos.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import sitesRoutes from './routes/sites.js';
import ghlRoutes from './routes/ghl.js';
import trialRoutes from './routes/trial.js';
import assetsRoutes from './routes/assets.js';
import { requestLogger } from './middleware/requestLogger.js';
import { aiLimiter, webhookLimiter } from './middleware/rateLimit.js';
import { readDb } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // behind a reverse proxy/load balancer in production

app.use(requestLogger);

// ── CORS ───────────────────────────────────────────────────────────────────
// Strict allowlist. Browser requests must come from a configured origin or a
// known extension id. Non-browser callers (curl, server-to-server, webhooks)
// send no Origin and are allowed through (they aren't subject to CORS anyway).
const allowedOrigins = new Set(config.allowedOrigins);
for (const id of config.extensionIds) {
  allowedOrigins.add(`chrome-extension://${id}`);
  allowedOrigins.add(`moz-extension://${id}`);
}
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    if (config.nodeEnv !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(null, false); // disallowed → no CORS headers; browser blocks the response
  },
  credentials: true,
}));

app.get('/health', async (_req, res) => {
  let dbOk = true;
  try { await readDb(); } catch { dbOk = false; }
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    service: 'clone2ghl-backend',
    db: dbOk ? 'ok' : 'error',
    openai: config.openaiApiKey ? 'configured' : 'missing',
    email: config.emailProvider,
    uptimeSec: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  });
});

// Stripe webhook must receive raw body before json parser.
app.use('/api/billing/webhook', webhookLimiter, billingRoutes);
app.use('/api/videos/webhook', express.text({ type: '*/*' }));

// Tiered body limits: clone/AI payloads can be large; everything else is capped
// tight to limit abuse. The large parser runs first on heavy paths and sets
// req._body, so the global small parser skips re-parsing them.
const bigJson = express.json({ limit: '12mb' });
app.use('/api/funnels', bigJson);
app.use('/api/ai', bigJson);
app.use('/api/sites', bigJson);
app.use('/api/videos', bigJson);

app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, '../../public')));
// Rehosted clone assets (images fetched from source pages).
app.use('/assets', express.static(path.resolve(process.cwd(), 'data', 'assets'), { maxAge: '7d' }));
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/funnels', funnelRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/ghl', ghlRoutes);
app.use('/api/trial', trialRoutes);
app.use('/api/assets', assetsRoutes);

app.use((err, req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  console.error(JSON.stringify({ level: 'error', id: req.id, msg: err.message, stack: err.stack?.split('\n').slice(0, 3) }));
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Clone2GHL backend running on http://localhost:${config.port}`);
});
