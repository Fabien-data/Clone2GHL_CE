import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : '';

  const db = await readDb();
  let rows = db.activity.filter(a => a.userId === req.user.userId);
  if (actionFilter) rows = rows.filter(a => a.action === actionFilter);

  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = rows.length;
  const activity = rows.slice(offset, offset + limit);

  return res.json({ activity, total, limit, offset });
});

router.post('/log', authRequired, async (req, res) => {
  const {
    action,
    resourceType = 'unknown',
    resourceId = '',
    status = 'ok',
    metadata = {},
  } = req.body || {};

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action is required.' });
  }

  const safeMetadata = typeof metadata === 'object' && metadata !== null ? metadata : {};

  const event = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: req.user.userId,
    action: action.trim().slice(0, 80),
    resourceType: String(resourceType).slice(0, 50),
    resourceId: String(resourceId || '').slice(0, 120),
    status: String(status || 'ok').slice(0, 20),
    metadata: safeMetadata,
    createdAt: new Date().toISOString(),
  };

  await writeDb((draft) => {
    draft.activity.unshift(event);
    draft.activity = draft.activity.slice(0, 5000);
    return draft;
  });

  return res.status(201).json({ event });
});

export default router;