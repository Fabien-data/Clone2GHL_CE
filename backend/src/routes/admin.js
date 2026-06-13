import express from 'express';
import jwt from 'jsonwebtoken';
import { config, planLimits, logoLimits, aiLimits, effectivePlan, planPrices as PLAN_PRICES } from '../config.js';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';
import { issueActivationCode } from '../lib/activation.js';
import { signAccessToken } from '../lib/authTokens.js';

// Rough per-AI-call cost estimates (USD) by action, used for the owner's spend
// dashboard. Approximate — counts × these constants; tune as real costs land.
const AI_CALL_COST = { 'ai.optimize': 0.04, 'ai.report': 0.01, 'ai.headlines': 0.005, 'ai.logo': 0.08 };

const router = express.Router();

// Pricing comes from config.planPrices (imported above as PLAN_PRICES) so the
// admin revenue/MRR estimates and the GHL invoice amounts never drift apart.

// Append an admin action to the activity audit trail (call inside a writeDb
// updater so it commits atomically with the change it records).
function logAdminAction(draft, req, action, targetId, meta = {}) {
  draft.activity.unshift({
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: targetId || null,
    actorEmail: req.user?.email || (req.isOwner ? 'admin-secret' : 'unknown'),
    action: `admin.${action}`,
    resourceType: 'user',
    resourceId: targetId || null,
    status: 'ok',
    metadata: meta,
    createdAt: new Date().toISOString(),
  });
  draft.activity = draft.activity.slice(0, 5000);
}

function isOwnerEmail(email) {
  if (!email) return false;
  return config.ownerEmails.includes(String(email).toLowerCase());
}

// ── Admin Auth ────────────────────────────────────────────────────────────────
// Accepts EITHER the legacy ADMIN_SECRET bearer token (for CLI/server-to-server)
// OR a valid user JWT whose email is in OWNER_EMAILS (extension UI).
function adminOrOwnerRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;

  // Path 1: shared admin secret
  if (config.adminSecret && token === config.adminSecret) {
    req.isOwner = true;
    return next();
  }

  // Path 2: JWT + owner email check
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      if (isOwnerEmail(payload.email)) {
        req.user = payload;
        req.isOwner = true;
        return next();
      }
    } catch { /* invalid JWT → fall through */ }
  }

  if (!config.adminSecret && config.ownerEmails.length === 0) {
    return res.status(503).json({ error: 'Admin panel not enabled. Set ADMIN_SECRET or OWNER_EMAILS in environment.' });
  }
  return res.status(401).json({ error: 'Forbidden. Owner access required.' });
}

// Lightweight check for the extension to decide whether to show the Admin tab.
// Uses ordinary authRequired so any signed-in user can call it.
router.get('/whoami', authRequired, async (req, res) => {
  return res.json({
    email: req.user?.email || null,
    isOwner: isOwnerEmail(req.user?.email),
    ownerConfigured: config.ownerEmails.length > 0 || Boolean(config.adminSecret),
  });
});

// ── GET /api/admin/stats ───────────────────────────────────────────────────────
router.get('/stats', adminOrOwnerRequired, async (_req, res) => {
  try {
    const db = await readDb();
    const totalUsers = db.users.length;
    const activeSubscriptions = db.users.filter(u => u.plan && u.plan !== 'free').length;
    const totalFunnels = db.funnels.length;
    const totalClones = db.usage.reduce((sum, u) => sum + (u.clonesUsed || 0), 0);
    const totalVideos = db.videoJobs.filter(j => j.status === 'completed').length;
    const revenueEstimate = db.users.reduce((sum, u) => sum + (PLAN_PRICES[u.plan] || 0), 0);
    const planBreakdown = { free: 0, starter: 0, pro: 0, agency: 0, owner: 0 };
    db.users.forEach(u => { const p = u.plan || 'free'; planBreakdown[p] = (planBreakdown[p] || 0) + 1; });

    return res.json({ totalUsers, activeSubscriptions, totalFunnels, totalClones, totalVideos, revenueEstimate, planBreakdown });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/users ───────────────────────────────────────────────────────
router.get('/users', adminOrOwnerRequired, async (req, res) => {
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
router.patch('/users/:id/plan', adminOrOwnerRequired, async (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(planLimits, plan)) {
      return res.status(400).json({ error: `Invalid plan. Must be one of: ${Object.keys(planLimits).join(', ')}` });
    }

    let updated = null;
    await writeDb((db) => {
      const user = db.users.find(u => u.id === req.params.id);
      if (!user) return db;
      const prev = user.plan;
      user.plan = plan;
      updated = { id: user.id, email: user.email, plan: user.plan };
      logAdminAction(db, req, 'plan.change', user.id, { from: prev, to: plan });
      return db;
    });

    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:id/reset-usage ────────────────────────────────────
router.post('/users/:id/reset-usage', adminOrOwnerRequired, async (req, res) => {
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
router.delete('/users/:id', adminOrOwnerRequired, async (req, res) => {
  try {
    const id = req.params.id;
    let found = false;
    await writeDb((db) => {
      const idx = db.users.findIndex(u => u.id === id);
      if (idx < 0) return db;
      found = true;
      const removed = db.users[idx];
      logAdminAction(db, req, 'user.delete', id, { email: removed?.email || null });
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

// ── GET /api/admin/users/:id ── full account detail ───────────────────────────
router.get('/users/:id', adminOrOwnerRequired, async (req, res) => {
  try {
    const period = new Date().toISOString().slice(0, 7);
    const db = await readDb();
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const usageRow = db.usage.find(us => us.userId === user.id && us.period === period) || {};
    const plan = effectivePlan(user);
    const invoices = db.invoices
      .filter(i => i.userId === user.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 50);
    const recentActivity = db.activity
      .filter(a => a.userId === user.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 25);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        plan: user.plan || 'free',
        effectivePlan: plan,
        status: user.status || 'active',
        subscriptionSource: user.subscriptionSource || null,
        subscriptionStatus: user.subscriptionStatus || null,
        currentPeriodEnd: user.currentPeriodEnd || null,
        ghlContactId: user.ghlContactId || null,
        ghlOrderId: user.ghlOrderId || null,
        activatedAt: user.activatedAt || null,
        hasPassword: Boolean(user.passwordHash),
        hasPendingActivation: Boolean(user.activationCodeHash),
        stripeCustomerId: user.stripeCustomerId || null,
        profile: user.profile || { displayName: '', company: '', timezone: 'UTC' },
        createdAt: user.createdAt || null,
      },
      usage: {
        period,
        clonesUsed: usageRow.clonesUsed || 0,
        clonesLimit: planLimits[plan] ?? 0,
        logosUsed: usageRow.logosUsed || 0,
        logosLimit: logoLimits[plan] ?? 0,
        aiUsed: usageRow.aiUsed || 0,
        aiLimit: aiLimits[plan] ?? 0,
      },
      funnelCount: db.funnels.filter(f => f.userId === user.id).length,
      invoices,
      recentActivity,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/users/:id/profile ── edit display name / company / email ──
router.patch('/users/:id/profile', adminOrOwnerRequired, async (req, res) => {
  try {
    const { displayName, company, timezone, email } = req.body || {};
    let updated = null;
    let conflict = false;

    await writeDb((db) => {
      const user = db.users.find(u => u.id === req.params.id);
      if (!user) return db;

      if (typeof email === 'string' && email.trim() && email.trim().toLowerCase() !== user.email.toLowerCase()) {
        const taken = db.users.some(u => u.id !== user.id && u.email.toLowerCase() === email.trim().toLowerCase());
        if (taken) { conflict = true; return db; }
        user.email = email.trim();
      }

      user.profile = {
        displayName: typeof displayName === 'string' ? displayName.trim().slice(0, 80) : (user.profile?.displayName || ''),
        company: typeof company === 'string' ? company.trim().slice(0, 120) : (user.profile?.company || ''),
        timezone: typeof timezone === 'string' && timezone.trim() ? timezone.trim().slice(0, 80) : (user.profile?.timezone || 'UTC'),
      };
      updated = { id: user.id, email: user.email, profile: user.profile };
      return db;
    });

    if (conflict) return res.status(409).json({ error: 'That email is already in use by another account.' });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:id/suspend & /unsuspend ────────────────────────────
router.post('/users/:id/suspend', adminOrOwnerRequired, async (req, res) => {
  try {
    let updated = null;
    await writeDb((db) => {
      const user = db.users.find(u => u.id === req.params.id);
      if (!user) return db;
      user.status = 'suspended';
      updated = { id: user.id, email: user.email, status: user.status };
      logAdminAction(db, req, 'user.suspend', user.id, {});
      return db;
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/unsuspend', adminOrOwnerRequired, async (req, res) => {
  try {
    let updated = null;
    await writeDb((db) => {
      const user = db.users.find(u => u.id === req.params.id);
      if (!user) return db;
      user.status = 'active';
      updated = { id: user.id, email: user.email, status: user.status };
      logAdminAction(db, req, 'user.unsuspend', user.id, {});
      return db;
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:id/extend ── set/extend subscription window ─────────
// Body: { days } (extend from the later of now / current end) OR { until } (ISO).
router.post('/users/:id/extend', adminOrOwnerRequired, async (req, res) => {
  try {
    const { days, until } = req.body || {};
    let updated = null;
    let invalid = false;

    await writeDb((db) => {
      const user = db.users.find(u => u.id === req.params.id);
      if (!user) return db;

      let endMs;
      if (until) {
        endMs = Date.parse(until);
        if (!Number.isFinite(endMs)) { invalid = true; return db; }
      } else {
        const n = Number(days);
        if (!Number.isFinite(n) || n === 0) { invalid = true; return db; }
        const base = Math.max(Date.now(), Date.parse(user.currentPeriodEnd || '') || Date.now());
        endMs = base + n * 86400000;
      }

      user.currentPeriodEnd = new Date(endMs).toISOString();
      if (!user.subscriptionSource) user.subscriptionSource = 'ghl';
      user.subscriptionStatus = 'active';
      updated = { id: user.id, email: user.email, currentPeriodEnd: user.currentPeriodEnd };
      logAdminAction(db, req, 'subscription.extend', user.id, { until: user.currentPeriodEnd, days, untilArg: until || null });
      return db;
    });

    if (invalid) return res.status(400).json({ error: 'Provide a non-zero `days` number or a valid `until` ISO date.' });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:id/activation-code ── (re)issue a code for support ──
router.post('/users/:id/activation-code', adminOrOwnerRequired, async (req, res) => {
  try {
    let code = null;
    let email = null;
    await writeDb(async (db) => {
      const user = db.users.find(u => u.id === req.params.id);
      if (!user) return db;
      code = await issueActivationCode(user);
      // Re-issuing lets the buyer (re)claim the account from the extension.
      user.activatedAt = null;
      email = user.email;
      logAdminAction(db, req, 'activation-code.reissue', user.id, {});
      return db;
    });
    if (!code) return res.status(404).json({ error: 'User not found.' });
    return res.json({ activationCode: code, email });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:id/reset-ai-usage ──────────────────────────────────
router.post('/users/:id/reset-ai-usage', adminOrOwnerRequired, async (req, res) => {
  try {
    const period = new Date().toISOString().slice(0, 7);
    let found = false;
    await writeDb((db) => {
      const row = db.usage.find(u => u.userId === req.params.id && u.period === period);
      if (row) {
        row.aiUsed = 0;
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

// ── POST /api/admin/users/:id/impersonate ── short-lived token for support ────
router.post('/users/:id/impersonate', adminOrOwnerRequired, async (req, res) => {
  try {
    const db = await readDb();
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // 15-minute access token scoped to the target user, flagged as impersonation.
    const token = jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan, impersonatedBy: req.user?.email || 'admin' },
      config.jwtSecret,
      { expiresIn: '15m' },
    );
    await writeDb((draft) => { logAdminAction(draft, req, 'user.impersonate', user.id, {}); return draft; });
    return res.json({ token, user: { id: user.id, email: user.email, plan: user.plan }, expiresInMin: 15 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/ai-costs ── estimated OpenAI spend per user / plan / month ──
router.get('/ai-costs', adminOrOwnerRequired, async (req, res) => {
  try {
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    const db = await readDb();
    const byUser = new Map();
    let total = 0;
    const byPlan = {};

    for (const a of db.activity) {
      if (!a.action || !AI_CALL_COST[a.action]) continue;
      if (String(a.createdAt || '').slice(0, 7) !== month) continue;
      const cost = AI_CALL_COST[a.action];
      total += cost;
      const row = byUser.get(a.userId) || { userId: a.userId, calls: 0, cost: 0 };
      row.calls += 1; row.cost += cost;
      byUser.set(a.userId, row);
    }

    // Attach email/plan and accumulate per-plan totals.
    const users = [...byUser.values()].map(r => {
      const u = db.users.find(x => x.id === r.userId);
      const plan = u?.plan || 'unknown';
      byPlan[plan] = (byPlan[plan] || 0) + r.cost;
      return { ...r, email: u?.email || null, plan, cost: Number(r.cost.toFixed(3)) };
    }).sort((a, b) => b.cost - a.cost);

    return res.json({
      month,
      totalCost: Number(total.toFixed(2)),
      byPlan: Object.fromEntries(Object.entries(byPlan).map(([k, v]) => [k, Number(v.toFixed(2))])),
      topUsers: users.slice(0, 50),
      note: 'Estimated from call counts × per-call cost constants.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/renewals ── churn / renewal radar ──────────────────────────
router.get('/renewals', adminOrOwnerRequired, async (req, res) => {
  try {
    const windowDays = Math.min(60, Math.max(1, Number(req.query.days || 7)));
    const now = Date.now();
    const db = await readDb();

    const expiringSoon = [], lapsed = [], active = [];
    let mrr = 0;

    for (const u of db.users) {
      if (!u.plan || u.plan === 'free' || u.plan === 'owner') continue;
      const price = PLAN_PRICES[u.plan] || 0;
      const end = u.currentPeriodEnd ? Date.parse(u.currentPeriodEnd) : null;
      const rec = { id: u.id, email: u.email, plan: u.plan, currentPeriodEnd: u.currentPeriodEnd, subscriptionStatus: u.subscriptionStatus || null };

      if (end != null && end < now) { lapsed.push(rec); }
      else {
        mrr += price; // count only currently-active subs toward MRR
        if (end != null && end - now <= windowDays * 86400000) expiringSoon.push(rec);
        else active.push(rec);
      }
    }

    return res.json({
      windowDays,
      mrr,
      counts: { active: active.length, expiringSoon: expiringSoon.length, lapsed: lapsed.length },
      expiringSoon: expiringSoon.sort((a, b) => String(a.currentPeriodEnd).localeCompare(String(b.currentPeriodEnd))),
      lapsed: lapsed.slice(0, 100),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/bulk ── bulk suspend / unsuspend / change-plan / extend ───
router.post('/bulk', adminOrOwnerRequired, async (req, res) => {
  try {
    const { action, ids, plan, days } = req.body || {};
    const idList = Array.isArray(ids) ? ids.filter(Boolean) : [];
    const validActions = ['suspend', 'unsuspend', 'plan', 'extend'];
    if (!validActions.includes(action)) return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
    if (!idList.length) return res.status(400).json({ error: 'ids must be a non-empty array.' });
    if (action === 'plan' && !Object.prototype.hasOwnProperty.call(planLimits, plan)) {
      return res.status(400).json({ error: 'Valid plan required for action=plan.' });
    }
    if (action === 'extend' && (!Number.isFinite(Number(days)) || Number(days) === 0)) {
      return res.status(400).json({ error: 'Non-zero days required for action=extend.' });
    }

    let affected = 0;
    await writeDb((db) => {
      for (const id of idList) {
        const user = db.users.find(u => u.id === id);
        if (!user) continue;
        if (action === 'suspend') user.status = 'suspended';
        else if (action === 'unsuspend') user.status = 'active';
        else if (action === 'plan') user.plan = plan;
        else if (action === 'extend') {
          const base = Math.max(Date.now(), Date.parse(user.currentPeriodEnd || '') || Date.now());
          user.currentPeriodEnd = new Date(base + Number(days) * 86400000).toISOString();
          if (!user.subscriptionSource) user.subscriptionSource = 'ghl';
          user.subscriptionStatus = 'active';
        }
        affected += 1;
      }
      logAdminAction(db, req, `bulk.${action}`, null, { count: affected, plan: plan || null, days: days || null });
      return db;
    });
    return res.json({ ok: true, action, affected });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/export/users.csv ── CSV export of all users ────────────────
router.get('/export/users.csv', adminOrOwnerRequired, async (_req, res) => {
  try {
    const period = new Date().toISOString().slice(0, 7);
    const db = await readDb();
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['id', 'email', 'plan', 'status', 'subscriptionStatus', 'currentPeriodEnd', 'clonesThisMonth', 'aiThisMonth', 'createdAt'];
    const rows = db.users.map(u => {
      const usage = db.usage.find(us => us.userId === u.id && us.period === period) || {};
      return [u.id, u.email, u.plan || 'free', u.status || 'active', u.subscriptionStatus || '', u.currentPeriodEnd || '', usage.clonesUsed || 0, usage.aiUsed || 0, u.createdAt || ''].map(esc).join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="clone2ghl-users.csv"');
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/audit ── admin action audit log ────────────────────────────
router.get('/audit', adminOrOwnerRequired, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const actionFilter = String(req.query.action || '');
    const userFilter = String(req.query.userId || '');

    const db = await readDb();
    let rows = db.activity.filter(a => String(a.action || '').startsWith('admin.'));
    if (actionFilter) rows = rows.filter(a => a.action === actionFilter);
    if (userFilter) rows = rows.filter(a => a.userId === userFilter);
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return res.json({ total: rows.length, limit, offset, entries: rows.slice(offset, offset + limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/analytics ──────────────────────────────────────────────────
router.get('/analytics', adminOrOwnerRequired, async (req, res) => {
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

    const revenueProjection = db.users.reduce((sum, u) => sum + (PLAN_PRICES[u.plan] || 0), 0);

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

// ── GET /api/admin/invoices ──────────────────────────────────────────────────
router.get('/invoices', adminOrOwnerRequired, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const statusFilter = String(req.query.status || '');
    const search = String(req.query.search || '').toLowerCase();

    const db = await readDb();
    let invoices = db.invoices.slice();
    if (statusFilter) invoices = invoices.filter(i => i.status === statusFilter);
    if (search) invoices = invoices.filter(i =>
      (i.userEmail || '').toLowerCase().includes(search) ||
      (i.number || '').toLowerCase().includes(search)
    );

    invoices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const total = invoices.length;
    const totalAmount = invoices
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + (i.amount || 0), 0);

    const page = invoices.slice(offset, offset + limit);
    return res.json({ invoices: page, total, totalAmount, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
