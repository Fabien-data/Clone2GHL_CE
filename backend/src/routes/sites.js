import express from 'express';
import { randomUUID } from 'node:crypto';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

const MAX_SITES_PER_USER = 500;
const FIELD_LIMITS = { name: 120, url: 500, niche: 40, notes: 1000, tags: 200 };

function parseDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function sanitize(input) {
  const out = {};
  if (typeof input?.name === 'string') out.name = input.name.trim().slice(0, FIELD_LIMITS.name);
  if (typeof input?.url === 'string') out.url = input.url.trim().slice(0, FIELD_LIMITS.url);
  if (typeof input?.niche === 'string') out.niche = input.niche.trim().slice(0, FIELD_LIMITS.niche);
  if (typeof input?.notes === 'string') out.notes = input.notes.trim().slice(0, FIELD_LIMITS.notes);
  if (typeof input?.tags === 'string') out.tags = input.tags.trim().slice(0, FIELD_LIMITS.tags);
  return out;
}

router.get('/', authRequired, async (req, res) => {
  const db = await readDb();
  const sites = db.customSites
    .filter(s => s.userId === req.user.userId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return res.json({ sites });
});

router.post('/', authRequired, async (req, res) => {
  const data = sanitize(req.body || {});
  if (!data.url) return res.status(400).json({ error: 'url is required' });
  if (!/^https?:\/\//i.test(data.url)) data.url = `https://${data.url}`;
  const domain = parseDomain(data.url);
  if (!domain) return res.status(400).json({ error: 'Invalid URL' });

  let created;
  await writeDb((draft) => {
    const ownedCount = draft.customSites.filter(s => s.userId === req.user.userId).length;
    if (ownedCount >= MAX_SITES_PER_USER) {
      throw new Error(`Site limit reached (${MAX_SITES_PER_USER} per account)`);
    }
    created = {
      id: randomUUID(),
      userId: req.user.userId,
      name: data.name || domain,
      url: data.url,
      domain,
      niche: data.niche || 'general',
      notes: data.notes || '',
      tags: data.tags || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    draft.customSites.push(created);
    return draft;
  });
  return res.status(201).json({ site: created });
});

router.patch('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const patch = sanitize(req.body || {});
  let updated;
  await writeDb((draft) => {
    const site = draft.customSites.find(s => s.id === id && s.userId === req.user.userId);
    if (!site) return draft;
    Object.assign(site, patch);
    if (patch.url) {
      if (!/^https?:\/\//i.test(site.url)) site.url = `https://${site.url}`;
      site.domain = parseDomain(site.url) || site.domain;
    }
    site.updatedAt = new Date().toISOString();
    updated = site;
    return draft;
  });
  if (!updated) return res.status(404).json({ error: 'Site not found' });
  return res.json({ site: updated });
});

router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  let removed = false;
  await writeDb((draft) => {
    const before = draft.customSites.length;
    draft.customSites = draft.customSites.filter(s => !(s.id === id && s.userId === req.user.userId));
    removed = draft.customSites.length < before;
    return draft;
  });
  if (!removed) return res.status(404).json({ error: 'Site not found' });
  return res.json({ ok: true });
});

export default router;
