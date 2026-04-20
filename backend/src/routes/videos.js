import express from 'express';
import crypto from 'crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';
import { config } from '../config.js';
import {
  cancelHeyGenJob,
  createHeyGenJob,
  getHeyGenJob,
  mapProviderStatus,
} from '../services/heygenClient.js';

const router = express.Router();

const DEFAULT_VIDEO_URL = 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4';
const OPENAI_VIDEOS_BASE = 'https://api.openai.com/v1/videos';
const VIDEO_CACHE_DIR = path.resolve(process.cwd(), 'data', 'video-cache');
const OPENAI_VIDEO_SIZES = new Set(['1280x720', '1920x1080', '1080x1920', '720x1280', '1024x1024']);

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function selectProvider(inputProvider) {
  const provider = String(inputProvider || '').toLowerCase();
  if (provider === 'mock' || !provider) return 'mock';
  if (provider === 'heygen') return 'heygen';
  if (provider === 'openai') return 'openai';
  return 'mock';
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function verifyWebhookSignature(rawBody, signature) {
  if (!config.heygenWebhookSecret) return true;
  if (!signature || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', config.heygenWebhookSecret)
    .update(rawBody)
    .digest('hex');

  return signature === expected;
}

async function appendActivity(userId, action, resourceId, metadata = {}, status = 'ok') {
  await writeDb((draft) => {
    draft.activity.unshift({
      id: makeId('act'),
      userId,
      action,
      resourceType: 'videoJob',
      resourceId,
      status,
      metadata,
      createdAt: nowIso(),
    });
    draft.activity = draft.activity.slice(0, 5000);
    return draft;
  });
}

async function ensureVideoCacheDir() {
  await mkdir(VIDEO_CACHE_DIR, { recursive: true });
}

function getOpenAIVideoPath(jobId) {
  return path.join(VIDEO_CACHE_DIR, `${jobId}.mp4`);
}

function normalizeOpenAIVideoSize(value) {
  const size = String(value || '').trim();
  return OPENAI_VIDEO_SIZES.has(size) ? size : config.openaiVideoSize;
}

function normalizeOpenAIVideoSeconds(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isNaN(parsed)) return config.openaiVideoSeconds;
  return Math.max(8, Math.min(20, parsed));
}

function buildVideoPreviewUrl(req, jobId) {
  const host = req.get('host');
  if (!host) return `/api/videos/preview/${jobId}`;
  return `${req.protocol}://${host}/api/videos/preview/${jobId}`;
}

function buildOpenAIVideoPrompt(prompt, { size, seconds } = {}) {
  const cleanPrompt = String(prompt || '').trim();
  const normalizedSize = normalizeOpenAIVideoSize(size);
  const normalizedSeconds = normalizeOpenAIVideoSeconds(seconds);

  return [
    'Create a polished, brand-safe marketing video for a website or funnel.',
    `Target output: ${normalizedSeconds}-second clip in ${normalizedSize}.`,
    'Use cinematic composition, clear motion, and visually strong scene structure.',
    'Optimize for landing-page and funnel use. Avoid copyrighted characters, logos, and real people unless explicitly requested and allowed.',
    'User brief:',
    cleanPrompt,
  ].filter(Boolean).join('\n');
}

async function openAIVideoRequest(pathname, { method = 'GET', body } = {}) {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const resp = await fetch(`${OPENAI_VIDEOS_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json().catch(() => ({})) : null;

  if (!resp.ok) {
    throw new Error(data?.error?.message || data?.message || `OpenAI video error: HTTP ${resp.status}`);
  }

  return data || resp;
}

async function createOpenAIVideoJob({ prompt, model, size, seconds }) {
  const response = await openAIVideoRequest('', {
    method: 'POST',
    body: {
      model,
      prompt,
      size: normalizeOpenAIVideoSize(size),
      seconds: String(normalizeOpenAIVideoSeconds(seconds)),
    },
  });

  const providerJobId = response?.id || response?.video_id || response?.data?.id;
  if (!providerJobId) {
    throw new Error('OpenAI video response missing job ID.');
  }

  return {
    providerJobId,
    status: response.status || 'queued',
    progress: Number(response.progress || 0),
  };
}

async function getOpenAIVideoJob(providerJobId) {
  const response = await openAIVideoRequest(`/${encodeURIComponent(providerJobId)}`);
  return {
    rawStatus: response.status || 'queued',
    progress: Number(response.progress || 0),
    videoUrl: response.video_url || response.url || '',
    error: response.error?.message || response.error || '',
  };
}

async function cacheOpenAIVideoContent(providerJobId, jobId) {
  await ensureVideoCacheDir();
  const assetPath = getOpenAIVideoPath(jobId);
  const resp = await fetch(`${OPENAI_VIDEOS_BASE}/${encodeURIComponent(providerJobId)}/content`, {
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`Unable to download OpenAI video content: HTTP ${resp.status}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  await writeFile(assetPath, Buffer.from(arrayBuffer));
  return assetPath;
}

async function ensureOpenAIVideoCached(job) {
  const assetPath = job?.assetPath || getOpenAIVideoPath(job.id);
  try {
    await readFile(assetPath);
    return assetPath;
  } catch {
    if (!job?.providerJobId) throw new Error('OpenAI video asset not available.');
    return cacheOpenAIVideoContent(job.providerJobId, job.id);
  }
}

function mapOpenAIVideoStatus(status, progress) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return { status: 'completed', progress: 100 };
  if (normalized === 'in_progress') return { status: 'processing', progress: Math.max(5, Number(progress || 0)) };
  if (normalized === 'queued') return { status: 'queued', progress: Math.max(0, Number(progress || 0)) };
  if (normalized === 'failed' || normalized === 'expired') return { status: 'failed', progress: 0 };
  return { status: 'queued', progress: Math.max(0, Number(progress || 0)) };
}

function buildJobPreviewUrl(req, job) {
  return buildVideoPreviewUrl(req, job.id);
}

async function saveVideoAssetForJob(job) {
  if (!job?.videoUrl) return;
  await writeDb((draft) => {
    const exists = draft.videoAssets.some((asset) => asset.jobId === job.id);
    if (exists) return draft;

    draft.videoAssets.unshift({
      id: makeId('va'),
      userId: job.userId,
      jobId: job.id,
      funnelId: job.funnelId || '',
      url: job.videoUrl,
      provider: job.provider,
      durationSec: 30,
      createdAt: nowIso(),
    });
    draft.videoAssets = draft.videoAssets.slice(0, 3000);
    return draft;
  });
}

async function syncProviderJob(job) {
  if (!job) return job;
  if (job.provider !== 'heygen') return job;
  if (!job.providerJobId) return job;
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;

  const provider = await getHeyGenJob(job.providerJobId);
  const mapped = mapProviderStatus(provider.rawStatus, provider.progress);

  const updates = {
    status: mapped.status,
    progress: mapped.progress,
    updatedAt: nowIso(),
  };

  if (mapped.status === 'completed' && provider.videoUrl) {
    updates.videoUrl = provider.videoUrl;
    updates.completedAt = nowIso();
  }
  if (mapped.status === 'failed') {
    updates.error = provider.error || 'Video generation failed.';
  }

  await writeDb((draft) => {
    const target = draft.videoJobs.find((j) => j.id === job.id);
    if (!target) return draft;
    Object.assign(target, updates);
    return draft;
  });

  const db = await readDb();
  const updated = db.videoJobs.find((j) => j.id === job.id);
  if (updated?.status === 'completed') {
    await saveVideoAssetForJob(updated);
  }
  return updated || job;
}

async function syncOpenAIVideoJob(job) {
  if (!job) return job;
  if (job.provider !== 'openai') return job;
  if (!job.providerJobId) return job;
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;

  const provider = await getOpenAIVideoJob(job.providerJobId);
  const mapped = mapOpenAIVideoStatus(provider.rawStatus, provider.progress);

  const updates = {
    status: mapped.status,
    progress: mapped.progress,
    updatedAt: nowIso(),
  };

  if (mapped.status === 'completed') {
    try {
      const assetPath = await ensureOpenAIVideoCached(job);
      updates.assetPath = assetPath;
      updates.videoUrl = `/api/videos/preview/${job.id}`;
      updates.completedAt = nowIso();
    } catch (err) {
      updates.status = 'failed';
      updates.error = err.message || 'Unable to download OpenAI video.';
    }
  }

  if (mapped.status === 'failed') {
    updates.error = provider.error || 'Video generation failed.';
  }

  await writeDb((draft) => {
    const target = draft.videoJobs.find((j) => j.id === job.id);
    if (!target) return draft;
    Object.assign(target, updates);
    return draft;
  });

  const db = await readDb();
  const updated = db.videoJobs.find((j) => j.id === job.id);
  if (updated?.status === 'completed') {
    await saveVideoAssetForJob(updated);
  }
  return updated || job;
}

async function openAIChat(model, body) {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, ...body }),
  });

  const text = await resp.text();
  const data = safeJson(text) || {};
  if (!resp.ok) {
    throw new Error(data?.error?.message || `OpenAI error: HTTP ${resp.status}`);
  }
  return data;
}

function queueLifecycle(jobId) {
  setTimeout(async () => {
    await writeDb((draft) => {
      const job = draft.videoJobs.find(j => j.id === jobId);
      if (!job || job.status === 'cancelled' || job.status === 'failed') return draft;
      job.status = 'processing';
      job.progress = 45;
      job.updatedAt = nowIso();
      return draft;
    });
  }, 800);

  setTimeout(async () => {
    await writeDb((draft) => {
      const job = draft.videoJobs.find(j => j.id === jobId);
      if (!job || job.status === 'cancelled' || job.status === 'failed') return draft;

      job.status = 'completed';
      job.progress = 100;
      job.videoUrl = DEFAULT_VIDEO_URL;
      job.completedAt = nowIso();
      job.updatedAt = nowIso();

      draft.videoAssets.unshift({
        id: `va_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: job.userId,
        jobId: job.id,
        funnelId: job.funnelId || '',
        url: job.videoUrl,
        provider: job.provider,
        durationSec: 30,
        createdAt: nowIso(),
      });
      draft.videoAssets = draft.videoAssets.slice(0, 3000);

      draft.activity.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: job.userId,
        action: 'video.generated',
        resourceType: 'videoJob',
        resourceId: job.id,
        status: 'ok',
        metadata: { provider: job.provider, funnelId: job.funnelId || '' },
        createdAt: nowIso(),
      });
      draft.activity = draft.activity.slice(0, 5000);

      return draft;
    });
  }, 2600);
}

router.get('/provider-status', authRequired, async (_req, res) => {
  const heygenConfigured = Boolean(config.heygenApiKey);
  const openaiConfigured = Boolean(config.openaiApiKey);

  return res.json({
    providers: {
      mock: { available: true },
      heygen: { available: heygenConfigured },
      openai: { available: openaiConfigured, model: config.openaiVideoModel },
    },
    scriptGeneration: {
      available: openaiConfigured,
      model: config.openaiVideoScriptModel,
    },
    videoGeneration: {
      available: openaiConfigured,
      model: config.openaiVideoModel,
      seconds: config.openaiVideoSeconds,
      size: config.openaiVideoSize,
    },
    suggestedProvider: openaiConfigured ? 'openai' : (heygenConfigured ? 'heygen' : 'mock'),
  });
});

router.post('/generate', authRequired, async (req, res) => {
  const {
    script,
    prompt,
    funnelId = '',
    avatar = 'default',
    voice = 'default',
    template = 'short_promo',
    provider = 'mock',
    seconds,
    size,
    model,
  } = req.body || {};

  const rawPrompt = String(prompt || script || '').trim();
  if (!rawPrompt) {
    return res.status(400).json({ error: 'prompt is required.' });
  }

  const selectedProvider = selectProvider(provider);
  const job = {
    id: makeId('vj'),
    userId: req.user.userId,
    funnelId: String(funnelId || ''),
    script: rawPrompt.slice(0, 5000),
    prompt: rawPrompt.slice(0, 5000),
    avatar: String(avatar || 'default').slice(0, 60),
    voice: String(voice || 'default').slice(0, 60),
    template: String(template || 'short_promo').slice(0, 60),
    provider: selectedProvider,
    providerJobId: '',
    status: 'queued',
    progress: 5,
    videoUrl: '',
    error: '',
    videoModel: selectedProvider === 'openai' ? String(model || config.openaiVideoModel) : '',
    videoSeconds: selectedProvider === 'openai' ? normalizeOpenAIVideoSeconds(seconds) : null,
    videoSize: selectedProvider === 'openai' ? normalizeOpenAIVideoSize(size) : '',
    assetPath: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
  };

  if (selectedProvider === 'openai') {
    if (!config.openaiApiKey) {
      return res.status(503).json({ error: 'OPENAI_API_KEY is not configured.' });
    }

    try {
      const providerResult = await createOpenAIVideoJob({
        prompt: buildOpenAIVideoPrompt(rawPrompt, { size: job.videoSize, seconds: job.videoSeconds }),
        model: job.videoModel || config.openaiVideoModel,
        size: job.videoSize,
        seconds: job.videoSeconds,
      });
      job.providerJobId = providerResult.providerJobId;
      job.status = providerResult.status || 'queued';
      job.progress = providerResult.progress ?? 0;
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Unable to create OpenAI video job.' });
    }
  } else if (selectedProvider === 'heygen') {
    if (!config.heygenApiKey) {
      return res.status(503).json({ error: 'HEYGEN_API_KEY is not configured.' });
    }

    try {
      const providerResult = await createHeyGenJob({
        script: job.script,
        avatar: job.avatar,
        voice: job.voice,
      });
      job.providerJobId = providerResult.providerJobId;
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Unable to create provider video job.' });
    }
  }

  await writeDb((draft) => {
    draft.videoJobs.unshift(job);
    draft.videoJobs = draft.videoJobs.slice(0, 5000);
    return draft;
  });

  await appendActivity(req.user.userId, 'video.queued', job.id, {
    funnelId: job.funnelId,
    provider: job.provider,
  });

  if (selectedProvider === 'mock') {
    queueLifecycle(job.id);
  }
  return res.status(202).json({ job });
});

router.get('/jobs', authRequired, async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
  const db = await readDb();
  const jobs = await Promise.all(db.videoJobs
    .filter(j => j.userId === req.user.userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .map(async (job) => {
      const synced = job.provider === 'openai'
        ? await syncOpenAIVideoJob(job).catch(() => job)
        : await syncProviderJob(job).catch(() => job);

      return {
        ...synced,
        previewUrl: buildJobPreviewUrl(req, synced),
      };
    }));
  return res.json({ jobs });
});

router.get('/jobs/:id', authRequired, async (req, res) => {
  const db = await readDb();
  const existing = db.videoJobs.find(j => j.id === req.params.id && j.userId === req.user.userId);
  const job = existing
    ? await (existing.provider === 'openai'
      ? syncOpenAIVideoJob(existing)
      : syncProviderJob(existing)).catch(() => existing)
    : null;
  if (!job) return res.status(404).json({ error: 'Video job not found.' });

  if (job.status === 'completed') {
    await saveVideoAssetForJob(job);
  }

  return res.json({ job: { ...job, previewUrl: buildJobPreviewUrl(req, job) } });
});

router.get('/preview/:id', async (req, res) => {
  const db = await readDb();
  const job = db.videoJobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Video preview not found.' });

  if (job.provider === 'openai') {
    try {
      const assetPath = await ensureOpenAIVideoCached(job);
      const file = await readFile(assetPath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(file);
    } catch (err) {
      return res.status(404).json({ error: err.message || 'Video preview unavailable.' });
    }
  }

  if (job.videoUrl) {
    return res.redirect(job.videoUrl);
  }

  return res.status(404).json({ error: 'Video preview unavailable.' });
});

router.post('/jobs/:id/cancel', authRequired, async (req, res) => {
  const db = await readDb();
  const current = db.videoJobs.find(j => j.id === req.params.id && j.userId === req.user.userId);
  if (!current) return res.status(404).json({ error: 'Video job not found.' });

  if (current.status === 'completed') {
    return res.json({ job: current });
  }

  if (current.provider === 'heygen' && current.providerJobId) {
    await cancelHeyGenJob(current.providerJobId).catch(() => null);
  }

  await writeDb((draft) => {
    const job = draft.videoJobs.find(j => j.id === req.params.id && j.userId === req.user.userId);
    if (!job) return draft;
    job.status = 'cancelled';
    job.progress = 0;
    job.updatedAt = nowIso();
    return draft;
  });

  await appendActivity(req.user.userId, 'video.cancelled', current.id, {
    provider: current.provider,
  });

  const refreshed = await readDb();
  const job = refreshed.videoJobs.find(j => j.id === req.params.id && j.userId === req.user.userId);
  return res.json({ job });
});

router.post('/script', authRequired, async (req, res) => {
  const {
    niche = 'general',
    offer = '',
    tone = 'professional',
    durationSec = 30,
    cta = 'Book now',
  } = req.body || {};

  const response = await openAIChat(config.openaiVideoScriptModel, {
    temperature: 0.7,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: 'You are an expert direct-response scriptwriter for short-form marketing videos. Return JSON only.',
      },
      {
        role: 'user',
        content: `Create a ${durationSec}-second script for a ${niche} business. Offer: ${offer || 'primary local service'}. Tone: ${tone}. CTA: ${cta}. Return strict JSON with keys: script, hook, ctaLine, sceneHints (array of 3 strings).`,
      },
    ],
    response_format: { type: 'json_object' },
  }).catch((err) => {
    res.status(502).json({ error: err.message || 'Unable to generate script.' });
    return null;
  });
  if (!response) return;

  const content = response?.choices?.[0]?.message?.content || '{}';
  const parsed = safeJson(content) || {};

  return res.json({
    script: parsed.script || '',
    hook: parsed.hook || '',
    ctaLine: parsed.ctaLine || '',
    sceneHints: Array.isArray(parsed.sceneHints) ? parsed.sceneHints.slice(0, 5) : [],
    model: config.openaiVideoScriptModel,
  });
});

router.post('/webhook', express.text({ type: '*/*' }), async (req, res) => {
  const signature = req.get('x-heygen-signature') || req.get('x-signature') || '';
  const rawBody = String(req.body || '');
  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  const payload = safeJson(rawBody) || {};
  const data = payload.data || {};
  const providerJobId = data.video_id || data.id || '';
  if (!providerJobId) return res.json({ ok: true });

  const mapped = mapProviderStatus(data.status, data.progress);
  await writeDb((draft) => {
    const job = draft.videoJobs.find((j) => j.providerJobId === providerJobId);
    if (!job) return draft;

    job.status = mapped.status;
    job.progress = mapped.progress;
    job.updatedAt = nowIso();

    if (mapped.status === 'completed' && (data.video_url || data.url)) {
      job.videoUrl = data.video_url || data.url;
      job.completedAt = nowIso();
    }

    if (mapped.status === 'failed') {
      job.error = data.error?.message || 'Provider marked job as failed.';
    }

    return draft;
  });

  const db = await readDb();
  const job = db.videoJobs.find((j) => j.providerJobId === providerJobId);
  if (job?.status === 'completed') {
    await saveVideoAssetForJob(job);
    await appendActivity(job.userId, 'video.generated', job.id, {
      provider: job.provider,
      funnelId: job.funnelId || '',
    });
  }

  if (job?.status === 'failed') {
    await appendActivity(job.userId, 'video.failed', job.id, {
      provider: job.provider,
      error: job.error || 'Provider failure',
    }, 'error');
  }

  return res.json({ ok: true });
});

export default router;