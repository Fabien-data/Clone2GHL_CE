import express from 'express';
import { config, planLimits } from '../config.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

// ── Admin Auth Middleware ───────────────────────────────────────────────────────
function adminRequired(req, res, next) {
  if (!config.adminSecret) {
    return res.status(503).json({ error: 'Admin panel not enabled (ADMIN_SECRET not set in environment).' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token !== config.adminSecret) {
    return res.status(401).json({ error: 'Invalid admin secret.' });
  }
  return next();
}

// ── GET /api/admin/stats ───────────────────────────────────────────────────────
router.get('/stats', adminRequired, async (_req, res) => {
  try {
    const db = await readDb();
    const totalUsers = db.users.length;
    const activeSubscriptions = db.users.filter(u => u.plan && u.plan !== 'free').length;
    const totalFunnels = db.funnels.length;
    const totalClones = db.usage.reduce((sum, u) => sum + (u.clonesUsed || 0), 0);
    const totalVideos = db.videoJobs.filter(j => j.status === 'completed').length;
    const planPrices = { starter: 27, pro: 47, agency: 97 };
    const revenueEstimate = db.users.reduce((sum, u) => sum + (planPrices[u.plan] || 0), 0);

    return res.json({ totalUsers, activeSubscriptions, totalFunnels, totalClones, totalVideos, revenueEstimate });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/users ───────────────────────────────────────────────────────
router.get('/users', adminRequired, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const planFilter = String(req.query.plan || '');
    const search = String(req.query.search || '').toLowerCase();
    const period = new Date().toISOString().slice(0, 7);

    const db = await readDb();
    let users = db.users.slice();

    if (planFilter) users = users.filter(u => u.plan === planFilter);
    if (search) users = users.filter(u =>
      (u.email || '').toLowerCase().includes(search) ||
      (u.profile?.displayName || '').toLowerCase().includes(search)
    );

    const total = users.length;
    const page = users.slice(offset, offset + limit).map(u => {
      const usageRow = db.usage.find(us => us.userId === u.id && us.period === period);
      const funnelCount = db.funnels.filter(f => f.userId === u.id).length;
      const lastActivityRow = db.activity
        .filter(a => a.userId === u.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      return {
        id: u.id,
        email: u.email,
        plan: u.plan || 'free',
        displayName: u.profile?.displayName || '',
        clonesThisMonth: usageRow?.clonesUsed || 0,
        totalFunnels: funnelCount,
        lastActivity: lastActivityRow?.createdAt || u.createdAt || null,
        createdAt: u.createdAt || null,
      };
    });

    return res.json({ users: page, total, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/users/:id/plan ──────────────────────────────────────────
router.patch('/users/:id/plan', adminRequired, async (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(planLimits, plan)) {
      return res.status(400).json({ error: `Invalid plan. Must be one of: ${Object.keys(planLimits).join(', ')}` });
    }

    let updated = null;
    await writeDb((db) => {
      const user = db.users.find(u => u.id === req.params.id);
      if (!user) return db;
      user.plan = plan;
      updated = { id: user.id, email: user.email, plan: user.plan };
      return db;
    });

    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:id/reset-usage ────────────────────────────────────
router.post('/users/:id/reset-usage', adminRequired, async (req, res) => {
  try {
    const period = new Date().toISOString().slice(0, 7);
    let found = false;
    await writeDb((db) => {
      const row = db.usage.find(u => u.userId === req.params.id && u.period === period);
      if (row) {
        row.clonesUsed = 0;
        row.updatedAt = new Date().toISOString();
        found = true;
      }
      return db;
    });
    return res.json({ reset: true, found });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
router.delete('/users/:id', adminRequired, async (req, res) => {
  try {
    const id = req.params.id;
    let found = false;
    await writeDb((db) => {
      const idx = db.users.findIndex(u => u.id === id);
      if (idx < 0) return db;
      found = true;
      db.users.splice(idx, 1);
      db.funnels = db.funnels.filter(f => f.userId !== id);
      db.usage = db.usage.filter(u => u.userId !== id);
      db.preferences = db.preferences.filter(p => p.userId !== id);
      db.activity = db.activity.filter(a => a.userId !== id);
      db.videoJobs = db.videoJobs.filter(j => j.userId !== id);
      db.videoAssets = db.videoAssets.filter(v => v.userId !== id);
      return db;
    });
    if (!found) return res.status(404).json({ error: 'User not found.' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/analytics ──────────────────────────────────────────────────
router.get('/analytics', adminRequired, async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;

    const db = await readDb();

    // Build day-keyed buckets
    const clonesByDay = {};
    const videosByDay = {};
    const signupsByDay = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
      clonesByDay[d] = 0;
      videosByDay[d] = 0;
      signupsByDay[d] = 0;
    }

    db.activity.forEach(a => {
      const day = String(a.createdAt || '').slice(0, 10);
      if (!(day in clonesByDay)) return;
      if (a.action === 'usage.consumed' || a.action === 'clone.created') clonesByDay[day]++;
      if (a.action === 'video.generated') videosByDay[day]++;
    });

    db.users.forEach(u => {
      const day = String(u.createdAt || '').slice(0, 10);
      if (day in signupsByDay) signupsByDay[day]++;
    });

    const planPrices = { starter: 27, pro: 47, agency: 97 };
    const revenueProjection = db.users.reduce((sum, u) => sum + (planPrices[u.plan] || 0), 0);

    return res.json({
      days,
      clonesByDay,
      videosByDay,
      signupsByDay,
      revenueProjection,
      totalUsers: db.users.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
