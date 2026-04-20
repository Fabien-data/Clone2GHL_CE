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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: config.clientUrl === '*' ? true : config.clientUrl }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'clone2ghl-backend', ts: new Date().toISOString() });
});

// Stripe webhook must receive raw body before json parser.
app.use('/api/billing/webhook', billingRoutes);
app.use('/api/videos/webhook', express.text({ type: '*/*' }));

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, '../../public')));
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/funnels', funnelRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/ai', aiRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Clone2GHL backend running on http://localhost:${config.port}`);
});
