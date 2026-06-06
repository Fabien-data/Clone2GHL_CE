import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

function defaultPreferences(userId) {
  return {
    userId,
    theme: 'dark',
    defaultNiche: 'general',
    notifications: true,
    affiliateUrl: '', // the user's own GHL affiliate/referral link (shareable)
    updatedAt: new Date().toISOString(),
  };
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

router.get('/', authRequired, async (req, res) => {
  const db = await readDb();
  const prefs = db.preferences.find(p => p.userId === req.user.userId) || defaultPreferences(req.user.userId);
  return res.json({ preferences: prefs });
});

router.patch('/', authRequired, async (req, res) => {
  const { theme, defaultNiche, notifications, affiliateUrl } = req.body || {};

  if (affiliateUrl != null && affiliateUrl !== '' && !isHttpUrl(affiliateUrl)) {
    return res.status(400).json({ error: 'affiliateUrl must be a valid http(s) URL.' });
  }

  await writeDb((draft) => {
    let prefs = draft.preferences.find(p => p.userId === req.user.userId);
    if (!prefs) {
      prefs = defaultPreferences(req.user.userId);
      draft.preferences.push(prefs);
    }

    if (typeof theme === 'string' && theme.trim()) {
      prefs.theme = theme.trim().slice(0, 20);
    }
    if (typeof defaultNiche === 'string' && defaultNiche.trim()) {
      prefs.defaultNiche = defaultNiche.trim().slice(0, 40);
    }
    if (typeof notifications === 'boolean') {
      prefs.notifications = notifications;
    }
    if (typeof affiliateUrl === 'string') {
      prefs.affiliateUrl = affiliateUrl.trim().slice(0, 500);
    }

    prefs.updatedAt = new Date().toISOString();
    return draft;
  });

  const db = await readDb();
  const preferences = db.preferences.find(p => p.userId === req.user.userId) || defaultPreferences(req.user.userId);
  return res.json({ preferences });
});

export default router;