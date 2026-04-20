import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  const db = await readDb();
  const funnels = db.funnels.filter(f => f.userId === req.user.userId);
  return res.json({ funnels });
});

router.post('/', authRequired, async (req, res) => {
  const {
    name,
    sourceUrl,
    niche,
    status,
    html,
    optimizedHtml,
    analysis,
    aiReport,
    analysisTimestamp,
    videoUrl,
    meta,
  } = req.body || {};
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'html is required.' });
  }

  const funnel = {
    id: `f_${Date.now()}`,
    userId: req.user.userId,
    name: name || 'Untitled Funnel',
    sourceUrl: sourceUrl || '',
    niche: niche || 'general',
    status: status || 'draft',
    html,
    optimizedHtml: optimizedHtml || null,
    analysis: analysis || null,
    aiReport: aiReport || null,
    analysisTimestamp: analysisTimestamp || null,
    videoUrl: videoUrl || null,
    meta: meta || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeDb((draft) => {
    draft.funnels.unshift(funnel);
    draft.activity.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: req.user.userId,
      action: 'funnel.saved',
      resourceType: 'funnel',
      resourceId: funnel.id,
      status: 'ok',
      metadata: { niche: funnel.niche, hasAnalysis: Boolean(funnel.analysis) },
      createdAt: new Date().toISOString(),
    });
    draft.activity = draft.activity.slice(0, 5000);
    return draft;
  });

  return res.status(201).json({ funnel });
});

router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  await writeDb((draft) => {
    const exists = draft.funnels.some(f => f.id === id && f.userId === req.user.userId);
    draft.funnels = draft.funnels.filter(f => !(f.id === id && f.userId === req.user.userId));
    if (exists) {
      draft.activity.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: req.user.userId,
        action: 'funnel.deleted',
        resourceType: 'funnel',
        resourceId: id,
        status: 'ok',
        metadata: {},
        createdAt: new Date().toISOString(),
      });
      draft.activity = draft.activity.slice(0, 5000);
    }
    return draft;
  });
  return res.json({ deleted: true });
});

export default router;
