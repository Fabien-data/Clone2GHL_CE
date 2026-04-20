/**
 * owner-login.js — Clone2GHL Owner Access Page
 * Handles first-time password setup, login, unlock/lock via SHA-256 hashing.
 * All state is stored in chrome.storage.local under 'ownerAuth'.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sha256Hex(str) {
  const encoded = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-box ${type}`;
}

async function getOwnerAuth() {
  const data = await chrome.storage.local.get('ownerAuth');
  return data.ownerAuth || { passwordHash: null, unlocked: false };
}

async function saveOwnerAuth(patch) {
  const current = await getOwnerAuth();
  await chrome.storage.local.set({ ownerAuth: { ...current, ...patch } });
}

async function grantOwnerAccess() {
  await saveOwnerAuth({ unlocked: true });
  // Set owner plan in extension settings
  await chrome.runtime.sendMessage({
    action: 'OWNER_UNLOCK',
  }).catch(() => {});
}

async function revokeOwnerAccess() {
  await saveOwnerAuth({ unlocked: false });
  await chrome.runtime.sendMessage({
    action: 'OWNER_LOCK',
  }).catch(() => {});
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
}

// ─── View Switcher ────────────────────────────────────────────────────────────

function showView(name) {
  document.getElementById('setup-view').style.display = name === 'setup' ? 'block' : 'none';
  document.getElementById('login-view').style.display = name === 'login' ? 'block' : 'none';
  document.getElementById('unlocked-view').style.display = name === 'unlocked' ? 'block' : 'none';
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const auth = await getOwnerAuth();

  if (auth.unlocked) {
    showView('unlocked');
  } else if (auth.passwordHash) {
    showView('login');
  } else {
    showView('setup');
  }

  // ── Setup handlers ───────────────────────────────────────────────────────
  document.getElementById('toggle-setup-pw')?.addEventListener('click', () => {
    const inp = document.getElementById('setup-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-setup')?.addEventListener('click', async () => {
    const pw = document.getElementById('setup-password')?.value || '';
    const confirm = document.getElementById('setup-confirm')?.value || '';

    if (pw.length < 8) {
      showStatus('setup-status', 'Password must be at least 8 characters.', 'error');
      return;
    }
    if (pw !== confirm) {
      showStatus('setup-status', 'Passwords do not match.', 'error');
      return;
    }

    const hash = await sha256Hex(pw);
    await saveOwnerAuth({ passwordHash: hash });
    await grantOwnerAccess();

    showStatus('setup-status', 'Owner password set! Unlocking…', 'success');
    setTimeout(() => showView('unlocked'), 900);
  });

  // ── Login handlers ───────────────────────────────────────────────────────
  document.getElementById('toggle-login-pw')?.addEventListener('click', () => {
    const inp = document.getElementById('login-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-login')?.addEventListener('click', async () => {
    const pw = document.getElementById('login-password')?.value || '';
    if (!pw) {
      showStatus('login-status', 'Please enter your password.', 'error');
      return;
    }

    const auth = await getOwnerAuth();
    const hash = await sha256Hex(pw);

    if (hash !== auth.passwordHash) {
      showStatus('login-status', 'Incorrect password.', 'error');
      return;
    }

    await grantOwnerAccess();
    showStatus('login-status', 'Unlocked! Redirecting…', 'success');
    setTimeout(() => showView('unlocked'), 800);
  });

  // Allow Enter key on login password
  document.getElementById('login-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login')?.click();
  });

  document.getElementById('btn-reset-password')?.addEventListener('click', async () => {
    if (!confirm('This will clear your owner password and require you to set a new one. Continue?')) return;
    await saveOwnerAuth({ passwordHash: null, unlocked: false });
    await revokeOwnerAccess();
    document.getElementById('login-password').value = '';
    showView('setup');
  });

  // ── Unlocked handlers ────────────────────────────────────────────────────
  document.getElementById('btn-go-dashboard')?.addEventListener('click', openDashboard);

  document.getElementById('btn-lock')?.addEventListener('click', async () => {
    await revokeOwnerAccess();
    showStatus('unlocked-status', 'Owner access locked.', 'info');
    setTimeout(() => showView('login'), 900);
  });

  document.getElementById('btn-change-pw')?.addEventListener('click', async () => {
    if (!confirm('Change your owner password? You will need to set a new one.')) return;
    await saveOwnerAuth({ passwordHash: null, unlocked: false });
    await revokeOwnerAccess();
    showView('setup');
  });

  // ── Back link ────────────────────────────────────────────────────────────
  document.getElementById('back-to-dashboard')?.addEventListener('click', openDashboard);
}

document.addEventListener('DOMContentLoaded', init);
