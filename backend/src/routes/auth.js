import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { readDb, writeDb } from '../store.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and password (min 8 chars) are required.' });
  }

  const db = await readDb();
  if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: `u_${Date.now()}`,
    email,
    passwordHash,
    plan: 'free',
    profile: {
      displayName: '',
      company: '',
      timezone: 'UTC',
    },
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
  };

  await writeDb((draft) => {
    draft.users.push(user);
    draft.usage.push({
      userId: user.id,
      period: new Date().toISOString().slice(0, 7),
      clonesUsed: 0,
      updatedAt: new Date().toISOString(),
    });
    draft.preferences.push({
      userId: user.id,
      theme: 'dark',
      defaultNiche: 'general',
      notifications: true,
      updatedAt: new Date().toISOString(),
    });
    return draft;
  });

  const token = jwt.sign({ userId: user.id, email: user.email, plan: user.plan }, config.jwtSecret, { expiresIn: '7d' });
  return res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const db = await readDb();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

  const token = jwt.sign({ userId: user.id, email: user.email, plan: user.plan }, config.jwtSecret, { expiresIn: '7d' });
  return res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
});

router.get('/me', authRequired, async (req, res) => {
  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const preferences = db.preferences.find(p => p.userId === user.id) || {
    userId: user.id,
    theme: 'dark',
    defaultNiche: 'general',
    notifications: true,
    updatedAt: new Date().toISOString(),
  };

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      profile: user.profile || { displayName: '', company: '', timezone: 'UTC' },
    },
    preferences,
  });
});

router.patch('/profile', authRequired, async (req, res) => {
  const { displayName, company, timezone } = req.body || {};

  await writeDb((draft) => {
    const user = draft.users.find(u => u.id === req.user.userId);
    if (!user) return draft;

    user.profile = {
      displayName: typeof displayName === 'string' ? displayName.trim().slice(0, 80) : (user.profile?.displayName || ''),
      company: typeof company === 'string' ? company.trim().slice(0, 120) : (user.profile?.company || ''),
      timezone: typeof timezone === 'string' && timezone.trim() ? timezone.trim().slice(0, 80) : (user.profile?.timezone || 'UTC'),
    };
    return draft;
  });

  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ profile: user.profile });
});

router.post('/change-password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Current password and new password (min 8 chars) are required.' });
  }

  const db = await readDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await writeDb((draft) => {
    const target = draft.users.find(u => u.id === req.user.userId);
    if (target) target.passwordHash = passwordHash;
    return draft;
  });

  return res.json({ changed: true });
});

export default router;
