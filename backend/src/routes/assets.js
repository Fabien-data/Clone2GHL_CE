/**
 * backend/src/routes/assets.js
 *
 * Asset rehosting (Pro/Agency). Cloned pages often hot-link images to the source
 * domain, which can break if the source blocks hotlinking or goes down. This
 * fetches those images server-side and rehosts them under /assets, returning a
 * map of original → rehosted URL so the extension can rewrite the clone's <img>.
 */

import express from 'express';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { authRequired } from '../middleware/auth.js';
import { readDb } from '../store.js';
import { effectivePlan } from '../config.js';

const router = express.Router();

const ASSETS_DIR = path.resolve(process.cwd(), 'data', 'assets');
const MAX_URLS = 40;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB/image
const FETCH_TIMEOUT = 12_000;

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/x-icon': 'ico',
};

function isHttpImageUrl(u) {
  try { const url = new URL(u); return url.protocol === 'http:' || url.protocol === 'https:'; }
  catch { return false; }
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

router.post('/rehost', authRequired, async (req, res) => {
  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Pro/Agency/Owner only.
  const plan = effectivePlan(user);
  if (!['pro', 'agency', 'owner'].includes(plan)) {
    return res.status(403).json({ error: 'Asset rehosting is a Pro/Agency feature.', upgradeRequired: true });
  }

  const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter(isHttpImageUrl).slice(0, MAX_URLS) : [];
  if (!urls.length) return res.status(400).json({ error: 'Provide an array of image URLs.' });

  await mkdir(ASSETS_DIR, { recursive: true });
  const base = `${req.protocol}://${req.get('host')}`;
  const map = {};
  const failed = [];

  await Promise.all(urls.map(async (url) => {
    try {
      const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);

      // Reuse if already rehosted.
      for (const ext of new Set(Object.values(EXT_BY_TYPE))) {
        if (await fileExists(path.join(ASSETS_DIR, `${hash}.${ext}`))) {
          map[url] = `${base}/assets/${hash}.${ext}`;
          return;
        }
      }

      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
      const resp = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Clone2GHL-Rehost/1.0' } });
      clearTimeout(t);
      if (!resp.ok) { failed.push(url); return; }

      const type = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const ext = EXT_BY_TYPE[type];
      if (!ext) { failed.push(url); return; }

      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > MAX_BYTES) { failed.push(url); return; }

      await writeFile(path.join(ASSETS_DIR, `${hash}.${ext}`), buf);
      map[url] = `${base}/assets/${hash}.${ext}`;
    } catch {
      failed.push(url);
    }
  }));

  return res.json({ map, rehosted: Object.keys(map).length, failed });
});

export default router;
