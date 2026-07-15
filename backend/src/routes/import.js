/**
 * routes/import.js — the v2 import pipeline API.
 *
 *   POST   /api/import/jobs           ingest captured pages → enqueue → { jobId }
 *   GET    /api/import/jobs           job history (light summaries)
 *   GET    /api/import/jobs/:id       full job incl. normalized element models
 *   GET    /api/import/jobs/:id/stream  SSE progress (or poll :id)
 *   DELETE /api/import/jobs/:id       remove a job
 *
 * The extension still captures pages in the browser (the backend can't reach the
 * user's DOM) and gates usage via /api/usage/consume; this pipeline does the heavy
 * normalize/asset/link work and returns ready-to-apply GHL element JSON.
 */
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';
import { kickImportJob } from '../services/importWorker.js';
import { streamJob } from '../services/sse.js';

const router = express.Router();
const MAX_PAGES = 25;
const MAX_JOBS_STORED = 500;

function newJobId() { return `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function summary(j) {
  return {
    id: j.id, status: j.status, total: (j.input || []).length,
    ok: typeof j.ok === 'number' ? j.ok : (j.results ? j.results.filter((r) => !r.error).length : null),
    name: j.name || (j.input?.[0]?.meta?.title) || 'Import',
    createdAt: j.createdAt, finishedAt: j.finishedAt || null,
  };
}

router.post('/jobs', authRequired, async (req, res) => {
  const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
  if (!pages.length) return res.status(400).json({ error: 'Provide a non-empty `pages` array.' });
  if (pages.length > MAX_PAGES) return res.status(400).json({ error: `Too many pages (max ${MAX_PAGES}).` });

  const id = newJobId();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const job = {
    id,
    userId: req.user.userId,
    status: 'queued',
    name: req.body?.name || pages[0]?.meta?.title || 'Import',
    options: { businessName: req.body?.businessName || null, rehost: req.body?.rehost !== false },
    input: pages,
    results: null,
    createdAt: new Date().toISOString(),
  };

  await writeDb((d) => {
    d.importJobs.unshift(job);
    d.importJobs = d.importJobs.slice(0, MAX_JOBS_STORED);
    return d;
  });
  kickImportJob(id, baseUrl);

  return res.status(202).json({ jobId: id, status: 'queued', total: pages.length });
});

router.get('/jobs', authRequired, async (req, res) => {
  const db = await readDb();
  const jobs = db.importJobs.filter((j) => j.userId === req.user.userId).slice(0, 50).map(summary);
  return res.json({ jobs });
});

router.get('/jobs/:id', authRequired, async (req, res) => {
  const db = await readDb();
  const j = db.importJobs.find((x) => x.id === req.params.id && x.userId === req.user.userId);
  if (!j) return res.status(404).json({ error: 'Job not found.' });
  // Full detail: status + normalized results (element models), but never echo the
  // raw captured input back (large, already on the client).
  return res.json({
    job: { ...summary(j), status: j.status, options: j.options, results: j.results || null },
  });
});

router.get('/jobs/:id/stream', authRequired, async (req, res) => {
  const db = await readDb();
  const j = db.importJobs.find((x) => x.id === req.params.id && x.userId === req.user.userId);
  if (!j) return res.status(404).end();
  streamJob(req, res, j.id);
});

router.delete('/jobs/:id', authRequired, async (req, res) => {
  await writeDb((d) => {
    d.importJobs = d.importJobs.filter((j) => !(j.id === req.params.id && j.userId === req.user.userId));
    return d;
  });
  return res.json({ deleted: true });
});

export default router;
