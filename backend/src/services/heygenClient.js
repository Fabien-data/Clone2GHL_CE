import { config } from '../config.js';

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function heygenRequest(path, { method = 'GET', body } = {}) {
  if (!config.heygenApiKey) {
    throw new Error('HEYGEN_API_KEY is not configured.');
  }

  const resp = await fetch(`${config.heygenBaseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': config.heygenApiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  const data = parseJsonSafe(text) || {};

  if (!resp.ok) {
    throw new Error(data?.error?.message || data?.message || `HeyGen error: HTTP ${resp.status}`);
  }

  return data;
}

function parseCreateResponse(payload) {
  const providerJobId =
    payload?.data?.video_id ||
    payload?.data?.id ||
    payload?.video_id ||
    payload?.id ||
    '';

  if (!providerJobId) {
    throw new Error('HeyGen create response missing video ID.');
  }

  return { providerJobId };
}

function parseStatusResponse(payload) {
  return {
    rawStatus: payload?.data?.status || payload?.status || 'queued',
    progress: payload?.data?.progress ?? payload?.progress ?? null,
    videoUrl: payload?.data?.video_url || payload?.data?.url || payload?.video_url || '',
    error: payload?.data?.error?.message || payload?.error?.message || '',
  };
}

export function mapProviderStatus(rawStatus, progressValue) {
  const status = String(rawStatus || '').toLowerCase();

  if (['completed', 'success', 'succeeded', 'done'].includes(status)) {
    return { status: 'completed', progress: 100 };
  }

  if (['failed', 'error', 'rejected'].includes(status)) {
    return { status: 'failed', progress: 0 };
  }

  if (['cancelled', 'canceled', 'terminated'].includes(status)) {
    return { status: 'cancelled', progress: 0 };
  }

  if (['processing', 'rendering', 'running', 'in_progress'].includes(status)) {
    const progress = Number(progressValue);
    return {
      status: 'processing',
      progress: Number.isFinite(progress) ? Math.max(10, Math.min(99, progress)) : 50,
    };
  }

  return { status: 'queued', progress: 5 };
}

export async function createHeyGenJob({ script, avatar = 'default', voice = 'default' }) {
  const payload = {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: avatar,
        },
        voice: {
          type: 'text',
          voice_id: voice,
          input_text: script,
        },
      },
    ],
    dimension: {
      width: 1080,
      height: 1920,
    },
  };

  const result = await heygenRequest('/v2/video/generate', { method: 'POST', body: payload });
  return parseCreateResponse(result);
}

export async function getHeyGenJob(providerJobId) {
  const result = await heygenRequest(`/v1/video_status.get?video_id=${encodeURIComponent(providerJobId)}`);
  return parseStatusResponse(result);
}

export async function cancelHeyGenJob(providerJobId) {
  try {
    const result = await heygenRequest('/v1/video.cancel', {
      method: 'POST',
      body: { video_id: providerJobId },
    });
    return parseStatusResponse(result);
  } catch {
    return { rawStatus: 'cancelled', progress: 0, videoUrl: '', error: '' };
  }
}
