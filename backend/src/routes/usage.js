import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { planLimits } from '../config.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

router.get('/', authRequired, async (req, res) => {
  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const period = currentPeriod();
  const usage = db.usage.find(u => u.userId === user.id && u.period === period) || { clonesUsed: 0 };
  const limit = planLimits[user.plan] ?? 2;

  return res.json({
    plan: user.plan,
    clonesUsed: usage.clonesUsed,
    clonesLimit: limit,
    clonesRemaining: limit < 0 ? -1 : Math.max(0, limit - usage.clonesUsed),
  });
});

router.post('/consume', authRequired, async (req, res) => {
  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const period = currentPeriod();
  const limit = planLimits[user.plan] ?? 2;
  let usage = db.usage.find(u => u.userId === user.id && u.period === period);
  if (!usage) {
    usage = { userId: user.id, period, clonesUsed: 0, updatedAt: new Date().toISOString() };
  }

  if (limit >= 0 && usage.clonesUsed >= limit) {
    return res.status(402).json({ error: 'Plan limit reached.', plan: user.plan, clonesLimit: limit });
  }

  await writeDb((draft) => {
    let row = draft.usage.find(u => u.userId === user.id && u.period === period);
    if (!row) {
      row = { userId: user.id, period, clonesUsed: 0, updatedAt: new Date().toISOString() };
      draft.usage.push(row);
    }
    row.clonesUsed += 1;
    row.updatedAt = new Date().toISOString();

    draft.activity.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      action: 'usage.consumed',
      resourceType: 'usage',
      resourceId: period,
      status: 'ok',
      metadata: { clonesUsed: row.clonesUsed, plan: user.plan },
      createdAt: new Date().toISOString(),
    });
    draft.activity = draft.activity.slice(0, 5000);
    return draft;
  });

  const dbAfter = await readDb();
  const currentUsage = dbAfter.usage.find(u => u.userId === user.id && u.period === period) || { clonesUsed: 0 };
  return res.json({
    consumed: true,
    clonesUsed: currentUsage.clonesUsed,
    clonesRemaining: limit < 0 ? -1 : Math.max(0, limit - currentUsage.clonesUsed),
  });
});

export default router;
