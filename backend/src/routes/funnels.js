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

// ── PUT /api/funnels/:id ── upsert by client id (bidirectional sync) ──────────
// Creates the funnel if absent, otherwise merges by last-write-wins on updatedAt
// and snapshots the prior content into funnelVersions for rollback.
router.put('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  if (body.html != null && typeof body.html !== 'string') {
    return res.status(400).json({ error: 'html must be a string.' });
  }
  const incomingUpdated = body.updatedAt ? Date.parse(body.updatedAt) : Date.now();

  let result;
  let skipped = false;
  await writeDb((draft) => {
    const existing = draft.funnels.find(f => f.id === id && f.userId === req.user.userId);
    const nowIso = new Date().toISOString();

    if (existing) {
      // Last-write-wins: ignore a stale push (older than what we already have).
      const existingUpdated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
      if (Number.isFinite(incomingUpdated) && incomingUpdated < existingUpdated) {
        result = existing; skipped = true; return draft;
      }
      // Snapshot the previous content for rollback (cap 10 per funnel).
      draft.funnelVersions.unshift({
        id: `fv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        funnelId: id, userId: req.user.userId,
        name: existing.name, html: existing.html, optimizedHtml: existing.optimizedHtml || null,
        snapshotAt: nowIso,
      });
      const mine = draft.funnelVersions.filter(v => v.funnelId === id);
      if (mine.length > 10) {
        const drop = new Set(mine.slice(10).map(v => v.id));
        draft.funnelVersions = draft.funnelVersions.filter(v => !drop.has(v.id));
      }
      ['name', 'sourceUrl', 'niche', 'status', 'html', 'optimizedHtml', 'analysis', 'aiReport', 'analysisTimestamp', 'videoUrl', 'meta', 'tags']
        .forEach(k => { if (body[k] !== undefined) existing[k] = body[k]; });
      // Preserve the client's updatedAt so last-write-wins stays consistent
      // across devices (server clock isn't the source of truth for edits).
      existing.updatedAt = (body.updatedAt && Number.isFinite(Date.parse(body.updatedAt))) ? body.updatedAt : nowIso;
      result = existing;
    } else {
      result = {
        id, userId: req.user.userId,
        name: body.name || 'Untitled Funnel', sourceUrl: body.sourceUrl || '', niche: body.niche || 'general',
        status: body.status || 'draft', html: body.html || '', optimizedHtml: body.optimizedHtml || null,
        analysis: body.analysis || null, aiReport: body.aiReport || null, analysisTimestamp: body.analysisTimestamp || null,
        videoUrl: body.videoUrl || null, meta: body.meta || {}, tags: body.tags || [],
        createdAt: body.createdAt || nowIso,
        updatedAt: (body.updatedAt && Number.isFinite(Date.parse(body.updatedAt))) ? body.updatedAt : nowIso,
      };
      draft.funnels.unshift(result);
    }
    return draft;
  });

  return res.json({ funnel: result, skipped });
});

// ── GET /api/funnels/:id/versions ── rollback history ─────────────────────────
router.get('/:id/versions', authRequired, async (req, res) => {
  const db = await readDb();
  const owns = db.funnels.some(f => f.id === req.params.id && f.userId === req.user.userId);
  if (!owns) return res.status(404).json({ error: 'Funnel not found.' });
  const versions = db.funnelVersions
    .filter(v => v.funnelId === req.params.id && v.userId === req.user.userId)
    .sort((a, b) => String(b.snapshotAt).localeCompare(String(a.snapshotAt)))
    .map(v => ({ id: v.id, name: v.name, snapshotAt: v.snapshotAt, bytes: (v.optimizedHtml || v.html || '').length }));
  return res.json({ versions });
});

// ── POST /api/funnels/:id/restore ── roll a funnel back to a snapshot ─────────
router.post('/:id/restore', authRequired, async (req, res) => {
  const { versionId } = req.body || {};
  if (!versionId) return res.status(400).json({ error: 'versionId is required.' });
  let restored = null;
  await writeDb((draft) => {
    const funnel = draft.funnels.find(f => f.id === req.params.id && f.userId === req.user.userId);
    const version = draft.funnelVersions.find(v => v.id === versionId && v.funnelId === req.params.id && v.userId === req.user.userId);
    if (!funnel || !version) return draft;
    // Snapshot current before restoring, so a rollback is itself reversible.
    draft.funnelVersions.unshift({
      id: `fv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      funnelId: funnel.id, userId: req.user.userId,
      name: funnel.name, html: funnel.html, optimizedHtml: funnel.optimizedHtml || null,
      snapshotAt: new Date().toISOString(),
    });
    funnel.html = version.html;
    funnel.optimizedHtml = version.optimizedHtml;
    funnel.updatedAt = new Date().toISOString();
    restored = funnel;
    return draft;
  });
  if (!restored) return res.status(404).json({ error: 'Funnel or version not found.' });
  return res.json({ funnel: restored });
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
