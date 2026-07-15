/**
 * importWorker.js — processes an import job: for each captured page, rehost assets,
 * normalize to the neutral element model (GHL-aware), then resolve cross-page links.
 * Streams progress over SSE and persists results on the job record in the store.
 */
import { readDb, writeDb } from '../store.js';
import { normalizeBest, isGhlSource } from './ghlSourceMapper.js';
import { rehostAssets } from './assetStore.js';
import { resolveLinks } from './linkResolver.js';
import { publish } from './sse.js';
import { schedule } from './queue.js';

/** Public entry: queue a persisted job for processing (non-blocking). */
export function kickImportJob(jobId, baseUrl) {
  schedule(() => runImportJob(jobId, baseUrl));
}

async function patchJob(jobId, patch) {
  await writeDb((d) => {
    const j = d.importJobs.find((x) => x.id === jobId);
    if (j) Object.assign(j, patch, { updatedAt: new Date().toISOString() });
    return d;
  });
}

function collectImageUrls(captured) {
  const set = new Set();
  for (const u of captured.imageSrcs || []) if (typeof u === 'string') set.add(u);
  const html = captured.html || '';
  const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) set.add(m[1]);
  return [...set].filter((u) => /^https?:\/\//i.test(u));
}

export async function runImportJob(jobId, baseUrl) {
  const db = await readDb();
  const job = db.importJobs.find((j) => j.id === jobId);
  if (!job || job.status === 'ready') return;

  await patchJob(jobId, { status: 'processing', startedAt: new Date().toISOString() });
  const total = job.input.length;
  publish(jobId, { type: 'status', status: 'processing', total });

  const results = [];
  for (let i = 0; i < total; i++) {
    const captured = job.input[i];
    const title = captured.meta?.title || `Page ${i + 1}`;
    publish(jobId, { type: 'progress', step: i, total, message: `Normalizing “${title}” (${i + 1}/${total})` });
    try {
      let rehostMap = {};
      try {
        rehostMap = await rehostAssets(collectImageUrls(captured), { baseUrl, enabled: job.options?.rehost !== false });
      } catch { /* non-fatal */ }

      const model = normalizeBest(captured, { businessName: job.options?.businessName, rehostMap });
      results.push({
        name: model.name,
        pathSlug: model.pathSlug,
        sourceUrl: captured.meta?.url || '',
        source: model._source || (isGhlSource(captured).isGhl ? 'ghl' : 'generic'),
        rehosted: Object.keys(rehostMap).length,
        model,
      });
    } catch (e) {
      results.push({ name: title, sourceUrl: captured.meta?.url || '', error: String(e?.message || e) });
    }
    publish(jobId, { type: 'progress', step: i + 1, total });
  }

  try { resolveLinks(results); } catch { /* non-fatal */ }

  const ok = results.filter((r) => !r.error).length;
  await patchJob(jobId, { status: 'ready', results, finishedAt: new Date().toISOString(), ok });
  publish(jobId, { type: 'status', status: 'ready', count: ok, total });
  publish(jobId, { type: 'done' });
}

/** On boot, re-queue any job left mid-flight by a restart. */
export async function resumeStuckJobs(baseUrl) {
  try {
    const db = await readDb();
    for (const j of db.importJobs || []) {
      if (j.status === 'queued' || j.status === 'processing') kickImportJob(j.id, baseUrl);
    }
  } catch { /* ignore */ }
}
