import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { readDb } from '../store.js';

const router = express.Router();

function parseDays(value, fallback = 30) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(365, Math.floor(n));
}

router.get('/summary', authRequired, async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = await readDb();
  const funnels = db.funnels.filter(f => f.userId === req.user.userId);
  const activity = db.activity
    .filter(a => a.userId === req.user.userId)
    .filter(a => new Date(a.createdAt) >= start);

  const totalFunnels = funnels.length;
  const clones = activity.filter(a => a.action === 'clone.created' || a.action === 'usage.consumed').length;
  const exports = activity.filter(a => a.action === 'ghl.export.success').length;
  const aiOptimizations = activity.filter(a => a.action === 'ai.optimized').length;

  const clonesByNiche = funnels.reduce((acc, f) => {
    const key = f.niche || 'general';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const timeline = {};
  for (const row of activity) {
    const key = String(row.createdAt || '').slice(0, 10);
    if (!key) continue;
    timeline[key] = (timeline[key] || 0) + 1;
  }

  const recentActivity = activity
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20);

  return res.json({
    windowDays: days,
    totals: {
      totalFunnels,
      clones,
      exports,
      aiOptimizations,
    },
    clonesByNiche,
    timeline,
    recentActivity,
  });
});

export default router;