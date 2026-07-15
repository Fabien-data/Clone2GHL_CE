/**
 * assetStore.js — rehost source images so cloned pages don't hot-link (and break).
 *
 * Object storage abstraction: uses an S3-compatible bucket when configured
 * (`config.s3.bucket`, lazy `@aws-sdk/client-s3` import), else falls back to the
 * existing local disk under `data/assets` (served by server.js at /assets).
 * Never throws — a failed image is simply left at its original URL.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const ASSETS_DIR = path.resolve(process.cwd(), 'data', 'assets');
const MAX_URLS = 60;
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT = 12_000;
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/x-icon': 'ico',
};

function isHttp(u) { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; } }
async function fileExists(p) { try { await access(p); return true; } catch { return false; } }

let s3 = null, s3Tried = false;
async function getS3() {
  if (!config.s3?.bucket) return null;
  if (s3 || s3Tried) return s3;
  s3Tried = true;
  try {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3 = new S3Client({
      region: config.s3.region,
      ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
      ...(config.s3.accessKeyId ? { credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey } } : {}),
    });
  } catch (e) {
    console.warn('[assetStore] S3 SDK unavailable — falling back to local disk:', e.message);
    s3 = null;
  }
  return s3;
}

async function fetchImage(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
  try {
    const resp = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Clone2GHL-Rehost/2.0' } });
    if (!resp.ok) return null;
    const type = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    return { buf, ext, type };
  } catch { return null; }
  finally { clearTimeout(t); }
}

/**
 * @param {string[]} urls
 * @param {Object} opts { baseUrl, enabled }
 * @returns {Promise<Object>} map of original → rehosted URL (only successful ones)
 */
export async function rehostAssets(urls, { baseUrl = '', enabled = true } = {}) {
  if (!enabled) return {};
  const list = [...new Set((urls || []).filter(isHttp))].slice(0, MAX_URLS);
  if (!list.length) return {};

  const client = await getS3();
  const map = {};

  await Promise.all(list.map(async (url) => {
    try {
      const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);

      if (client) {
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        const img = await fetchImage(url);
        if (!img) return;
        const key = `assets/${hash}.${img.ext}`;
        await client.send(new PutObjectCommand({
          Bucket: config.s3.bucket, Key: key, Body: img.buf, ContentType: img.type,
          CacheControl: 'public, max-age=604800',
        }));
        map[url] = config.s3.publicBaseUrl
          ? `${config.s3.publicBaseUrl.replace(/\/+$/, '')}/${key}`
          : `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;
        return;
      }

      // Local disk fallback.
      await mkdir(ASSETS_DIR, { recursive: true });
      for (const ext of new Set(Object.values(EXT_BY_TYPE))) {
        if (await fileExists(path.join(ASSETS_DIR, `${hash}.${ext}`))) {
          if (baseUrl) map[url] = `${baseUrl}/assets/${hash}.${ext}`;
          return;
        }
      }
      const img = await fetchImage(url);
      if (!img) return;
      await writeFile(path.join(ASSETS_DIR, `${hash}.${img.ext}`), img.buf);
      if (baseUrl) map[url] = `${baseUrl}/assets/${hash}.${img.ext}`;
    } catch { /* leave original URL */ }
  }));

  return map;
}
