/**
 * dashboard.js — Clone2GHL Full Dashboard
 */

// ─── State ────────────────────────────────────────────────────────────────────
let funnelLibrary = [];
let nicheWebsites = [];
let myFunnels = [];
let settings = {};
let currentFunnelId = null;
let videoPollTimer = null;
let lastVideoScriptSuggestion = null;
let watchlist = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  setupNavigation();
  setupFunnelsTab();
  setupLibraryTab();
  setupAiToolsTab();
  setupVideoGenTab();
  setupAdIntelTab();
  setupLogoTab();
  setupAccountTab();
  setupSettingsTab();
  setupDiscoverTab();
  setupModal();
  setupDevModeToggle();
  setupOwnerButtons();
  setupVisualEditor();

  // Build the onboarding checklist + status card so they're ready if shown.
  renderGettingStarted();

  // Handle hash navigation (popup links to #library, #settings, #activate etc.)
  const hash = window.location.hash.replace('#', '');
  if (hash === 'activate') {
    // Deep-link from the popup / purchase email → open the Welcome modal on Activate.
    const q = new URLSearchParams(location.search);
    switchTab('getting-started');
    showWelcomeModal('activate', { email: (q.get('email') || '').trim(), code: (q.get('code') || '').trim() });
  } else if (hash) {
    switchTab(hash);
  } else if (!settings.backendToken && settings.plan !== 'owner' && !settings.devMode) {
    // First run / not signed in → guided onboarding with the Welcome modal front-and-center.
    switchTab('getting-started');
    showWelcomeModal('activate');
  } else if (!getSetupState().allDone) {
    switchTab('getting-started');
  }
});

async function loadAll() {
  // Load settings
  const sr = await sendMsg({ action: 'GET_SETTINGS' });
  settings = sr?.settings || {};

  // If a backend session exists, refresh usage early so plan/credits are accurate.
  if (settings.backendEnabled && settings.backendToken) {
    const usageResult = await sendMsg({ action: 'BACKEND_GET_USAGE' });
    if (usageResult?.success) {
      const refreshed = await sendMsg({ action: 'GET_SETTINGS' });
      settings = refreshed?.settings || settings;
    }
  }

  // Load my funnels
  const fr = await sendMsg({ action: 'GET_FUNNELS' });
  myFunnels = fr?.funnels || [];

  // Load funnel library (metadata only; HTML loads lazily per template)
  try {
    const resp = await fetch(chrome.runtime.getURL('data/funnelLibrary.json'));
    funnelLibrary = await resp.json();
  } catch { funnelLibrary = []; }

  // Load niche websites for discover tab
  try {
    const resp2 = await fetch(chrome.runtime.getURL('data/nicheWebsites.json'));
    nicheWebsites = await resp2.json();
  } catch { nicheWebsites = []; }

  // Load watchlist
  const wlResult = await sendMsg({ action: 'WATCHLIST_GET' });
  watchlist = wlResult?.watchlist || [];

  // Resolve owner status so the Admin nav shows for Sadiq + other OWNER_EMAILS.
  await refreshOwnerStatus();

  // Capture an inbound affiliate ref code (e.g. dashboard.html?ref=CODE) so it can
  // be attributed when this user later upgrades on the GHL checkout.
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && ref !== settings.capturedRef) {
      await sendMsg({ action: 'SAVE_SETTINGS', data: { capturedRef: ref.slice(0, 80) } });
      settings.capturedRef = ref.slice(0, 80);
    }
  } catch { /* no-op */ }

  updateSidebarPlanInfo();
  applyFeatureGating();
  showActivationBannerIfNeeded();
  showUpgradeBannerIfNeeded();
}

// Append the captured affiliate ref to the configured GHL checkout URL.
function ghlCheckoutUrl(extraRef) {
  return C2GUpgrade.appendRef(settings.upgradeUrl || '', extraRef || settings.capturedRef);
}

// Pre-fill the activation form from URL params (e.g. an email "Activate" link:
// dashboard.html#activate?email=...&code=...) so the user lands ready to submit.
function prefillActivationFromUrl() {
  try {
    const q = new URLSearchParams(location.search);
    const email = (q.get('email') || '').trim();
    const code = (q.get('code') || '').trim();
    const emailEl = document.getElementById('ghl-activate-email');
    const codeEl = document.getElementById('ghl-activate-code');
    if (email && emailEl) emailEl.value = email.slice(0, 160);
    if (code && codeEl) codeEl.value = code.slice(0, 80);
  } catch { /* no-op */ }
}

// Scroll to + focus the activation form (used by the #activate deep-link + banner).
function focusActivation() {
  const sec = document.getElementById('activate-section');
  if (sec) {
    sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sec.classList.add('gs-highlight');
    setTimeout(() => sec.classList.remove('gs-highlight'), 2100);
  }
  document.getElementById('ghl-activate-email')?.focus();
}

// ─── Onboarding / status (v1.0.5) ──────────────────────────────────────────────
// Derive setup state purely from already-synced `settings` — one source of truth
// shared by the Getting Started checklist and the "Your Status" card.
function getSetupState() {
  const s = settings || {};
  const ownerOrDev = s.plan === 'owner' || s.devMode;
  const accountDone = Boolean(s.backendToken);
  const ghlDone = Boolean(s.ghlValidated) || Boolean(s.ghlApiKey && s.ghlLocationId);
  const planDone = (s.plan && s.plan !== 'free') || s.isTrial === true
    || (s.plan === 'free' && !s.trialActivationRequired && typeof s.daysLeft === 'number');
  const allDone = ownerOrDev || (accountDone && ghlDone && planDone);
  const nextStep = !accountDone ? 1 : !ghlDone ? 2 : !planDone ? 3 : 0;
  return { ownerOrDev, accountDone, ghlDone, planDone, allDone, nextStep };
}

// Render the "Your Status" card into a container (used on Getting Started + Settings).
function renderStatusCard(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const s = settings || {};
  const st = getSetupState();
  const planName = (s.plan || 'free');
  const planLabel = planName.charAt(0).toUpperCase() + planName.slice(1);

  let usage;
  if (st.ownerOrDev) usage = 'Unlimited';
  else if (s.plan && s.plan !== 'free') usage = (s.plan === 'agency') ? 'Unlimited clones' : 'Active plan';
  else if (s.isTrial && typeof s.daysLeft === 'number') usage = `${s.credits ?? 0} clones · ${s.daysLeft} days left`;
  else usage = 'No active plan';

  const item = (label, valueHtml, cls, fixLabel, fixKey) => `
    <div class="gs-status-item">
      <div class="gs-status-label">${label}</div>
      <div class="gs-status-value ${cls || ''}">${valueHtml}</div>
      ${fixLabel ? `<button class="gs-status-fix" data-fix="${fixKey}">${fixLabel}</button>` : ''}
    </div>`;

  el.innerHTML = `
    <div class="settings-card">
      <div class="settings-card-header"><span class="settings-icon">📊</span>
        <div><div class="settings-card-title">Your Status</div>
        <div class="settings-card-sub">Account, plan, and connection at a glance</div></div>
      </div>
      <div class="gs-status-grid">
        ${item('Plan', escHtml(planLabel))}
        ${item('Usage', escHtml(usage))}
        ${item('Account', st.accountDone ? '✓ Signed in' : '✗ Not signed in', st.accountDone ? 'ok' : 'bad', st.accountDone ? '' : 'Sign in', 'account')}
        ${item('GoHighLevel', st.ghlDone ? '✓ Connected' : '✗ Not connected', st.ghlDone ? 'ok' : 'bad', st.ghlDone ? '' : 'Connect', 'ghl')}
      </div>
    </div>`;

  el.querySelectorAll('.gs-status-fix').forEach(b => {
    b.addEventListener('click', () => {
      switchTab('settings');
      if (b.dataset.fix === 'ghl') document.getElementById('ghl-api-key')?.focus();
      else document.getElementById('backend-auth-email')?.focus();
    });
  });
}

// Render the Getting Started status card + 3-step checklist with live ✓ ticks.
function renderGettingStarted() {
  renderStatusCard('gs-status-card');
  renderStatusCard('settings-status-card');
  const wrap = document.getElementById('gs-checklist');
  if (!wrap) return;
  const st = getSetupState();

  if (st.ownerOrDev) {
    wrap.innerHTML = `<div class="settings-card"><div class="settings-card-header"><span class="settings-icon">👑</span><div><div class="settings-card-title">You're all set</div><div class="settings-card-sub">Owner / dev account — everything is unlocked.</div></div></div></div>`;
    return;
  }

  const step = (n, done, isNext, title, desc, actionsHtml, helpHtml) => `
    <div class="gs-step ${done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}">
      <div class="gs-step-badge">${done ? '✓' : n}</div>
      <div class="gs-step-body">
        <div class="gs-step-title">${title}</div>
        <div class="gs-step-desc">${desc}</div>
        ${done ? '' : `<div class="gs-step-actions">${actionsHtml}</div>`}
        ${helpHtml || ''}
      </div>
    </div>`;

  const ghlHelp = `
    <details class="gs-help"><summary>Where do I find these?</summary>
      <ol>
        <li><strong>Private Integration Token</strong>: in GoHighLevel → Settings → Integrations → Private Integrations → create a token with the <strong>Funnels</strong> scope.</li>
        <li><strong>Location ID</strong>: in GoHighLevel → Settings → Business Profile → copy the Location ID.</li>
      </ol>
    </details>`;

  wrap.innerHTML = `
    ${step(1, st.accountDone, st.nextStep === 1,
      'Create your Clone2GHL account',
      'Sign in (or register) so your funnels sync and your plan is remembered.',
      `<button class="btn-primary" data-gs="account">Create account / Sign in</button>`)}
    ${step(2, st.ghlDone, st.nextStep === 2,
      'Connect GoHighLevel',
      'Paste your GHL Private Integration Token + Location ID. This unlocks your trial and lets you push funnels.',
      `<button class="btn-primary" data-gs="ghl">Connect GoHighLevel</button>`,
      ghlHelp)}
    ${step(3, st.planDone, st.nextStep === 3,
      'Start your free trial or activate a plan',
      'Connecting GoHighLevel starts your 30-day / 6-clone trial automatically. Bought a plan? Activate it with your code.',
      `<button class="btn-primary" data-gs="trial">Start free trial</button>
       <button class="btn-secondary" data-gs="activate">I bought a plan → Activate</button>`)}
    ${st.allDone ? `<div class="gs-step is-done"><div class="gs-step-badge">✓</div><div class="gs-step-body"><div class="gs-step-title">You're ready! 🎉</div><div class="gs-step-desc">Open any page and click <strong>Clone This Page</strong>, or head to <a href="#funnels" data-gs="funnels" style="color:var(--gold-light)">My Funnels</a>.</div></div></div>` : ''}`;

  wrap.querySelectorAll('[data-gs]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const a = b.dataset.gs;
      if (a === 'account') { showWelcomeModal('activate'); }
      else if (a === 'ghl' || a === 'trial') { switchTab('settings'); document.getElementById('ghl-api-key')?.focus(); }
      else if (a === 'activate') { showWelcomeModal('activate'); }
      else if (a === 'funnels') { switchTab('funnels'); }
    });
  });
}

// ─── Messaging ────────────────────────────────────────────────────────────────
function sendMsg(message) {
  return chrome.runtime.sendMessage(message).catch((err) => ({
    success: false,
    error: err?.message || 'Runtime connection error',
  }));
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ─── Per-Plan Feature Gating ──────────────────────────────────────────────────
// Local fallback when no backend / not signed in. Mirrors backend featureFlags.
const LOCAL_FEATURE_DEFAULTS = {
  free:    { library: false, adIntel: false, fullAiOptimize: false, team: false, dfyDiscount: false },
  starter: { library: false, adIntel: false, fullAiOptimize: false, team: false, dfyDiscount: false },
  pro:     { library: true,  adIntel: true,  fullAiOptimize: true,  team: false, dfyDiscount: false },
  agency:  { library: true,  adIntel: true,  fullAiOptimize: true,  team: true,  dfyDiscount: true  },
  owner:   { library: true,  adIntel: true,  fullAiOptimize: true,  team: true,  dfyDiscount: true  },
};

function hasFeature(name) {
  if (settings?.devMode) return true;
  if (settings?.plan === 'owner') return true;
  const flags = settings?.featureFlags || LOCAL_FEATURE_DEFAULTS[settings?.plan] || LOCAL_FEATURE_DEFAULTS.free;
  return Boolean(flags[name]);
}

// Map sidebar nav data-tab → required feature flag
const TAB_FEATURE_GATE = {
  library: 'library',
  'ad-intel': 'adIntel',
};

function applyFeatureGating() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    const required = TAB_FEATURE_GATE[btn.dataset.tab];
    const locked = required && !hasFeature(required);
    btn.classList.toggle('nav-locked', Boolean(locked));
    // Inject a 🔒 lock badge once
    let badge = btn.querySelector('.nav-lock-badge');
    if (locked && !badge) {
      badge = document.createElement('span');
      badge.className = 'nav-lock-badge';
      badge.textContent = '🔒';
      badge.title = 'Upgrade to unlock';
      btn.appendChild(badge);
    } else if (!locked && badge) {
      badge.remove();
    }
  });

  // Logo generator: gate the Generate button by quota
  const logoBtn = document.getElementById('btn-gen-logo');
  const logoNote = document.getElementById('logo-quota-note');
  if (logoBtn) {
    const limit = settings?.logosLimit ?? 0;
    const remaining = settings?.logosRemaining ?? 0;
    if (settings?.plan === 'owner' || settings?.devMode || limit < 0) {
      logoBtn.disabled = false;
      if (logoNote) logoNote.textContent = 'Unlimited logo generations';
    } else if (limit === 0) {
      logoBtn.disabled = true;
      if (logoNote) logoNote.innerHTML = `Logo generation requires <a href="#" id="logo-upgrade-link" style="color:var(--gold-light);">Pro or Agency</a>.`;
      document.getElementById('logo-upgrade-link')?.addEventListener('click', (e) => { e.preventDefault(); switchTab('pricing'); });
    } else if (remaining <= 0) {
      logoBtn.disabled = true;
      if (logoNote) logoNote.textContent = `Monthly quota reached (${limit}/${limit}). Resets next month.`;
    } else {
      logoBtn.disabled = false;
      if (logoNote) logoNote.textContent = `${remaining} of ${limit} logo generations left this month`;
    }
  }
}

function switchTab(tabName) {
  const tabMap = {
    funnels: 'funnels', library: 'library', discover: 'discover', 'ai-tools': 'ai-tools',
    watchlist: 'watchlist',
    'video-gen': 'video-gen', 'ad-intel': 'ad-intel', 'logo-gen': 'logo-gen',
    settings: 'settings', account: 'account',
    pricing: 'settings', activate: 'settings',
  };
  const tab = tabMap[tabName] || tabName;

  // Gate locked tabs — bounce to Settings pricing block
  const required = TAB_FEATURE_GATE[tab];
  if (required && !hasFeature(required)) {
    showSaveToast('That feature needs Pro or Agency — see plans below.');
    return switchTab('pricing');
  }

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${tab}`);
  });

  if (tab === 'settings' && tabName === 'pricing') {
    setTimeout(() => {
      document.getElementById('tab-pricing-card')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }

  if (tab === 'video-gen') {
    loadVideoJobs(false);
  }

  if (tab === 'account' && settings.backendToken) {
    loadBackendAccountData();
  }

  if (tab === 'admin') {
    setupAdminTab();
  }
}

// ═══════════ Admin Dashboard (Phase 4) ═══════════
let adminUsersState = { offset: 0, limit: 25, total: 0, plan: '', search: '', loading: false };
let adminCurrentEditingUser = null;
let adminChartInstance = null;
let adminInitialized = false;

async function refreshOwnerStatus() {
  if (!settings?.backendToken) {
    settings.isOwner = false;
    showHideAdminNav(false);
    return false;
  }
  try {
    const res = await sendMsg({ action: 'BACKEND_ADMIN_WHOAMI' });
    settings.isOwner = Boolean(res?.isOwner);
    settings.ownerEmail = res?.email || null;
    showHideAdminNav(settings.isOwner);
    return settings.isOwner;
  } catch {
    settings.isOwner = false;
    showHideAdminNav(false);
    return false;
  }
}

function showHideAdminNav(show) {
  const nav = document.getElementById('nav-admin');
  if (nav) nav.style.display = show ? 'flex' : 'none';
}

function setupAdminTab() {
  if (!settings?.isOwner) {
    // Defense in depth: even if user navigates here directly, redirect away
    alert('Admin dashboard requires owner access.');
    return switchTab('account');
  }
  if (adminInitialized) {
    // Re-render the currently active subtab
    const active = document.querySelector('.admin-subtab.active')?.dataset.admintab || 'overview';
    showAdminSubtab(active);
    return;
  }
  adminInitialized = true;
  document.getElementById('admin-owner-email').textContent = settings.ownerEmail || 'owner';
  document.getElementById('btn-admin-refresh')?.addEventListener('click', () => {
    const active = document.querySelector('.admin-subtab.active')?.dataset.admintab || 'overview';
    showAdminSubtab(active, true);
  });
  document.querySelectorAll('.admin-subtab').forEach(btn => {
    btn.addEventListener('click', () => showAdminSubtab(btn.dataset.admintab));
  });

  // Users panel filter inputs
  let adminSearchTimer = null;
  document.getElementById('admin-users-search')?.addEventListener('input', (e) => {
    clearTimeout(adminSearchTimer);
    adminSearchTimer = setTimeout(() => {
      adminUsersState.search = e.target.value.trim();
      adminUsersState.offset = 0;
      loadAdminUsers();
    }, 300);
  });
  document.getElementById('admin-users-plan-filter')?.addEventListener('change', (e) => {
    adminUsersState.plan = e.target.value;
    adminUsersState.offset = 0;
    loadAdminUsers();
  });

  // Analytics range
  document.getElementById('admin-analytics-range')?.addEventListener('change', () => loadAdminAnalytics());

  // Dev Mode toggle
  const devCheckbox = document.getElementById('admin-devmode-checkbox');
  if (devCheckbox) {
    devCheckbox.checked = Boolean(settings.devMode);
    devCheckbox.addEventListener('change', async () => {
      const result = await sendMsg({ action: 'SAVE_SETTINGS', data: { devMode: devCheckbox.checked } });
      settings = result?.settings || settings;
      updateSidebarPlanInfo();
      applyFeatureGating();
    });
  }
  const ownerStatus = document.getElementById('admin-owner-status');
  if (ownerStatus) ownerStatus.textContent = settings.isOwner ? `recognized (${settings.ownerEmail})` : 'NOT in OWNER_EMAILS';

  // Plan edit modal
  document.getElementById('admin-plan-modal-close')?.addEventListener('click', closeAdminPlanModal);
  document.getElementById('admin-plan-modal-cancel')?.addEventListener('click', closeAdminPlanModal);
  document.getElementById('admin-plan-modal-save')?.addEventListener('click', saveAdminPlanModal);
  document.getElementById('admin-plan-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'admin-plan-modal') closeAdminPlanModal();
  });

  // Bulk actions + CSV export + drawer
  document.getElementById('btn-admin-export-csv')?.addEventListener('click', exportAdminCsv);
  document.getElementById('btn-admin-bulk-apply')?.addEventListener('click', applyAdminBulk);
  document.getElementById('btn-admin-bulk-clear')?.addEventListener('click', () => { adminSelection.clear(); syncAdminSelectionUI(); });
  document.getElementById('admin-users-select-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.admin-user-cb').forEach(cb => { if (e.target.checked) adminSelection.add(cb.dataset.id); else adminSelection.delete(cb.dataset.id); });
    syncAdminSelectionUI();
  });
  document.getElementById('admin-drawer-close')?.addEventListener('click', closeUserDrawer);

  showAdminSubtab('overview', true);
}

// ── Admin: Business (renewals + AI spend) ────────────────────────────────────
async function loadAdminBusiness() {
  try {
    const [ren, ai] = await Promise.all([
      sendMsg({ action: 'BACKEND_ADMIN_RENEWALS', days: 7 }),
      sendMsg({ action: 'BACKEND_ADMIN_AI_COSTS' }),
    ]);
    if (ren?.success !== false) {
      document.getElementById('biz-mrr').textContent = `$${ren.mrr ?? 0}`;
      document.getElementById('biz-expiring').textContent = ren.counts?.expiringSoon ?? 0;
      document.getElementById('biz-lapsed').textContent = ren.counts?.lapsed ?? 0;
      const tb = document.getElementById('biz-expiring-tbody');
      const rows = ren.expiringSoon || [];
      tb.innerHTML = rows.length ? rows.map(r => `
        <tr><td>${escHtml(r.email)}</td><td><span class="admin-plan-chip ${escHtml(r.plan)}">${escHtml(r.plan)}</span></td>
        <td style="font-size:12px;color:var(--text3);">${r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toLocaleDateString() : '—'}</td>
        <td>${escHtml(r.subscriptionStatus || '—')}</td></tr>`).join('')
        : `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text3);">No renewals due in 7 days.</td></tr>`;
    }
    if (ai?.success !== false) {
      document.getElementById('biz-aicost').textContent = `$${ai.totalCost ?? 0}`;
      const tb = document.getElementById('biz-aicost-tbody');
      const rows = ai.topUsers || [];
      tb.innerHTML = rows.length ? rows.map(r => `
        <tr><td>${escHtml(r.email || r.userId || '—')}</td><td><span class="admin-plan-chip ${escHtml(r.plan)}">${escHtml(r.plan)}</span></td>
        <td>${r.calls}</td><td>$${r.cost}</td></tr>`).join('')
        : `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text3);">No AI usage this month.</td></tr>`;
    }
  } catch (err) {
    console.warn('loadAdminBusiness failed', err);
  }
}

// ── Admin: Audit log ─────────────────────────────────────────────────────────
async function loadAdminAudit() {
  const tbody = document.getElementById('admin-audit-tbody');
  const countEl = document.getElementById('admin-audit-count');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text3);">Loading…</td></tr>`;
  try {
    const res = await sendMsg({ action: 'BACKEND_ADMIN_AUDIT', limit: 200 });
    const rows = res.entries || [];
    if (countEl) countEl.textContent = `${res.total || 0} action${(res.total || 0) !== 1 ? 's' : ''}`;
    tbody.innerHTML = rows.length ? rows.map(a => `
      <tr>
        <td style="font-size:12px;color:var(--text3);">${a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}</td>
        <td>${escHtml(a.actorEmail || '—')}</td>
        <td><code>${escHtml(a.action || '')}</code></td>
        <td style="font-size:12px;">${escHtml(a.resourceId || '—')}</td>
        <td style="font-size:12px;color:var(--text3);">${escHtml(JSON.stringify(a.metadata || {}))}</td>
      </tr>`).join('')
      : `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3);">No admin actions recorded yet.</td></tr>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--red);">Load failed: ${escHtml(err.message || String(err))}</td></tr>`;
  }
}

// ── Admin: user detail drawer ────────────────────────────────────────────────
async function openUserDrawer(userId) {
  const drawer = document.getElementById('admin-user-drawer');
  const body = document.getElementById('admin-drawer-body');
  if (!drawer || !body) return;
  drawer.style.display = 'block';
  setTimeout(() => drawer.focus(), 0);
  drawer.onkeydown = (e) => { if (e.key === 'Escape') closeUserDrawer(); };
  body.innerHTML = '<p style="color:var(--text3);">Loading…</p>';
  try {
    const res = await sendMsg({ action: 'BACKEND_ADMIN_USER_DETAIL', userId });
    if (res?.success === false) throw new Error(res.error || 'Failed');
    const u = res.user || {};
    const usage = res.usage || {};
    const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border,#2a3350);"><span style="color:var(--text3);font-size:12px;">${escHtml(k)}</span><span style="font-size:12px;text-align:right;">${escHtml(String(v ?? '—'))}</span></div>`;
    body.innerHTML = `
      <div style="margin-bottom:14px;">
        <div style="font-weight:600;">${escHtml(u.email || '')}</div>
        <div style="color:var(--text3);font-size:12px;">${escHtml(u.profile?.displayName || '')}</div>
      </div>
      ${row('Plan (effective)', `${u.plan} → ${u.effectivePlan}`)}
      ${row('Status', u.status)}
      ${row('Subscription', `${u.subscriptionSource || '—'} / ${u.subscriptionStatus || '—'}`)}
      ${row('Renews', u.currentPeriodEnd ? new Date(u.currentPeriodEnd).toLocaleString() : '—')}
      ${row('GHL contact', u.ghlContactId)}
      ${row('Activated', u.activatedAt ? new Date(u.activatedAt).toLocaleDateString() : 'no')}
      ${row('Clones (mo)', `${usage.clonesUsed}/${usage.clonesLimit}`)}
      ${row('AI calls (mo)', `${usage.aiUsed}/${usage.aiLimit}`)}
      ${row('Funnels', res.funnelCount)}
      ${row('Joined', u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—')}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;">
        <button class="btn-secondary" data-drawer-act="${u.status === 'suspended' ? 'unsuspend' : 'suspend'}">${u.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</button>
        <button class="btn-secondary" data-drawer-act="extend">+31 days</button>
        <button class="btn-secondary" data-drawer-act="activation-code">Re-issue code</button>
        <button class="btn-secondary" data-drawer-act="reset-ai-usage">Reset AI</button>
        <button class="btn-primary" data-drawer-act="impersonate">Impersonate</button>
      </div>
      <div id="admin-drawer-msg" style="margin-top:10px;font-size:12px;color:var(--text3);"></div>`;

    body.querySelectorAll('button[data-drawer-act]').forEach(btn => {
      btn.addEventListener('click', () => handleDrawerAction(userId, btn.dataset.drawerAct, u));
    });
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red);">${escHtml(err.message || String(err))}</p>`;
  }
}

async function handleDrawerAction(userId, op, user) {
  const msg = document.getElementById('admin-drawer-msg');
  const setMsg = (t) => { if (msg) msg.textContent = t; };
  try {
    if (op === 'impersonate') { await impersonateUser({ id: userId, email: user.email }); return; }
    const body = op === 'extend' ? { days: 31 } : undefined;
    const res = await sendMsg({ action: 'BACKEND_ADMIN_USER_ACTION', userId, op, body });
    if (res?.success === false) throw new Error(res.error || 'Action failed');
    if (op === 'activation-code') setMsg(`New activation code: ${res.activationCode}`);
    else setMsg('✓ Done.');
    if (op !== 'activation-code') { openUserDrawer(userId); loadAdminUsers(); }
  } catch (err) { setMsg(`✗ ${err.message || err}`); }
}

function closeUserDrawer() {
  const drawer = document.getElementById('admin-user-drawer');
  if (drawer) drawer.style.display = 'none';
}

function showAdminSubtab(name, forceReload = false) {
  document.querySelectorAll('.admin-subtab').forEach(b => b.classList.toggle('active', b.dataset.admintab === name));
  ['overview', 'users', 'business', 'analytics', 'invoices', 'audit', 'devmode'].forEach(p => {
    const el = document.getElementById(`admin-panel-${p}`);
    if (el) el.style.display = p === name ? 'block' : 'none';
  });
  if (name === 'overview') loadAdminStats(forceReload);
  if (name === 'users') loadAdminUsers();
  if (name === 'business') loadAdminBusiness();
  if (name === 'analytics') loadAdminAnalytics();
  if (name === 'invoices') loadAdminInvoices();
  if (name === 'audit') loadAdminAudit();
}

// ── Admin Invoices ───────────────────────────────────────────────────────────
let adminInvoicesState = { offset: 0, limit: 50, total: 0, status: '', search: '' };

function formatMoney(amountInCents, currency = 'usd') {
  if (typeof amountInCents !== 'number') return '—';
  const dollars = amountInCents / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(dollars);
  } catch {
    return `$${dollars.toFixed(2)}`;
  }
}

function setupAdminInvoiceToolbar() {
  if (setupAdminInvoiceToolbar._wired) return;
  setupAdminInvoiceToolbar._wired = true;
  let timer = null;
  document.getElementById('admin-invoices-search')?.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      adminInvoicesState.search = e.target.value.trim();
      adminInvoicesState.offset = 0;
      loadAdminInvoices();
    }, 300);
  });
  document.getElementById('admin-invoices-status-filter')?.addEventListener('change', (e) => {
    adminInvoicesState.status = e.target.value;
    adminInvoicesState.offset = 0;
    loadAdminInvoices();
  });
}

async function loadAdminInvoices() {
  setupAdminInvoiceToolbar();
  const tbody = document.getElementById('admin-invoices-tbody');
  const countEl = document.getElementById('admin-invoices-count');
  const totalEl = document.getElementById('admin-invoices-total');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text3);">Loading…</td></tr>`;
  try {
    const res = await sendMsg({
      action: 'BACKEND_ADMIN_INVOICES',
      limit: adminInvoicesState.limit,
      offset: adminInvoicesState.offset,
      status: adminInvoicesState.status,
      search: adminInvoicesState.search,
    });
    adminInvoicesState.total = res.total || 0;
    const invoices = res.invoices || [];
    if (countEl) countEl.textContent = `${adminInvoicesState.total} invoice${adminInvoicesState.total !== 1 ? 's' : ''}`;
    if (totalEl) totalEl.textContent = `Paid total: ${formatMoney(res.totalAmount || 0)}`;

    if (!invoices.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text3);">No invoices match these filters.</td></tr>`;
      renderAdminInvoicesPager();
      return;
    }
    tbody.innerHTML = invoices.map(inv => {
      const receiptHtml = inv.hostedInvoiceUrl
        ? `<a href="${escHtml(inv.hostedInvoiceUrl)}" target="_blank" rel="noopener" class="invoice-link">View</a>`
        : '<span style="color:var(--text4);">—</span>';
      const statusChip = `<span class="invoice-status ${inv.status === 'paid' ? 'paid' : 'failed'}">${escHtml(inv.status || '')}</span>`;
      return `<tr>
        <td style="font-size:12px; color:var(--text3);">${inv.createdAt ? new Date(inv.createdAt).toLocaleString() : '—'}</td>
        <td>${escHtml(inv.userEmail || '—')}</td>
        <td style="font-family:monospace; font-size:12px;">${escHtml(inv.number || inv.stripeInvoiceId || '—')}</td>
        <td><span class="admin-plan-chip ${escHtml(inv.plan || 'free')}">${escHtml(inv.plan || '—')}</span></td>
        <td style="font-weight:700;">${formatMoney(inv.amount, inv.currency)}</td>
        <td>${statusChip}</td>
        <td>${receiptHtml}</td>
      </tr>`;
    }).join('');
    renderAdminInvoicesPager();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--red);">Load failed: ${escHtml(err.message || String(err))}</td></tr>`;
  }
}

function renderAdminInvoicesPager() {
  const pager = document.getElementById('admin-invoices-pager');
  if (!pager) return;
  const totalPages = Math.max(1, Math.ceil(adminInvoicesState.total / adminInvoicesState.limit));
  const currentPage = Math.floor(adminInvoicesState.offset / adminInvoicesState.limit) + 1;
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  pager.innerHTML = `
    <button class="discover-pager-btn" data-act="prev" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>
    <span class="discover-pager-info">Page ${currentPage} of ${totalPages}</span>
    <button class="discover-pager-btn" data-act="next" ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>
  `;
  pager.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const delta = b.dataset.act === 'next' ? adminInvoicesState.limit : -adminInvoicesState.limit;
      adminInvoicesState.offset = Math.max(0, adminInvoicesState.offset + delta);
      loadAdminInvoices();
    });
  });
}

// ── Customer Sparkline ──────────────────────────────────────────────────────
async function drawAccountSparkline() {
  const canvas = document.getElementById('acct-sparkline');
  if (!canvas) return;
  // Activity comes from BACKEND_GET_ACTIVITY — already in use by Analytics & Activity section.
  let activity = [];
  try {
    const res = await sendMsg({ action: 'BACKEND_GET_ACTIVITY', limit: 500 });
    activity = res?.activity || [];
  } catch { /* leave empty */ }

  // Bucket clone events by day (last 30)
  const today = new Date();
  const buckets = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    buckets[d] = 0;
  }
  activity.forEach(a => {
    const day = String(a.createdAt || '').slice(0, 10);
    if (day in buckets && (a.action === 'usage.consumed' || a.action === 'clone.created')) {
      buckets[day]++;
    }
  });
  const values = Object.values(buckets);
  const maxVal = Math.max(1, ...values);

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = 90;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padX = 4, padY = 6;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;

  // Filled area
  ctx.fillStyle = 'rgba(217, 166, 32, 0.18)';
  ctx.beginPath();
  ctx.moveTo(padX, padY + chartH);
  values.forEach((v, i) => {
    const x = padX + (i / Math.max(1, values.length - 1)) * chartW;
    const y = padY + (1 - v / maxVal) * chartH;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(padX + chartW, padY + chartH);
  ctx.closePath();
  ctx.fill();

  // Line
  ctx.strokeStyle = '#D9A620';
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = padX + (i / Math.max(1, values.length - 1)) * chartW;
    const y = padY + (1 - v / maxVal) * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Customer Billing & Invoices ─────────────────────────────────────────────
async function loadMyInvoices() {
  const tbody = document.getElementById('invoice-tbody');
  const badge = document.getElementById('invoices-status-badge');
  if (!tbody) return;
  if (!settings?.backendToken) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text3);">Sign in to your Clone2GHL account to see invoices.</td></tr>`;
    return;
  }
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text3);">Loading…</td></tr>`;
  try {
    const res = await sendMsg({ action: 'BACKEND_INVOICES_LIST' });
    const invoices = res?.invoices || [];
    if (badge) badge.innerHTML = '';
    if (!invoices.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text3);">No invoices yet. Subscribe to a paid plan to see your billing history here.</td></tr>`;
      return;
    }
    tbody.innerHTML = invoices.map(inv => {
      const pdfLink = inv.invoicePdf || inv.hostedInvoiceUrl;
      const downloadHtml = pdfLink
        ? `<a class="invoice-link" href="${escHtml(pdfLink)}" target="_blank" rel="noopener">⬇ PDF</a>`
        : '<span style="color:var(--text4);">—</span>';
      return `<tr>
        <td style="font-size:12px; color:var(--text3);">${inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—'}</td>
        <td style="font-family:monospace; font-size:12px;">${escHtml(inv.number || inv.stripeInvoiceId || '—')}</td>
        <td style="text-transform:capitalize;">${escHtml(inv.plan || '—')}</td>
        <td style="font-weight:700;">${formatMoney(inv.amount, inv.currency)}</td>
        <td><span class="invoice-status ${inv.status === 'paid' ? 'paid' : 'failed'}">${escHtml(inv.status || '')}</span></td>
        <td>${downloadHtml}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    if (badge) badge.innerHTML = `<div style="color:var(--red); font-size:12px;">Load failed: ${escHtml(err.message || String(err))}</div>`;
  }
}

async function loadAdminStats(force = false) {
  try {
    const stats = await sendMsg({ action: 'BACKEND_ADMIN_STATS' });
    document.getElementById('kpi-users').textContent = stats.totalUsers ?? 0;
    document.getElementById('kpi-subs').textContent = stats.activeSubscriptions ?? 0;
    document.getElementById('kpi-mrr').textContent = `$${(stats.revenueEstimate ?? 0).toLocaleString()}`;
    document.getElementById('kpi-clones').textContent = stats.totalClones ?? 0;
    document.getElementById('kpi-funnels').textContent = stats.totalFunnels ?? 0;
    document.getElementById('kpi-videos').textContent = stats.totalVideos ?? 0;

    const breakdown = stats.planBreakdown || {};
    const breakdownEl = document.getElementById('admin-plan-breakdown');
    if (breakdownEl) {
      breakdownEl.innerHTML = ['free', 'starter', 'pro', 'agency', 'owner']
        .map(p => `<div class="admin-plan-pill"><span class="admin-plan-pill-name">${p}</span><span class="admin-plan-pill-count">${breakdown[p] ?? 0}</span></div>`)
        .join('');
    }
  } catch (err) {
    document.getElementById('kpi-users').textContent = '!';
    console.error('admin stats', err);
  }
}

async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  const countEl = document.getElementById('admin-users-count');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text3);">Loading…</td></tr>`;
  try {
    const res = await sendMsg({
      action: 'BACKEND_ADMIN_USERS',
      limit: adminUsersState.limit,
      offset: adminUsersState.offset,
      plan: adminUsersState.plan,
      search: adminUsersState.search,
    });
    adminUsersState.total = res.total || 0;
    const users = res.users || [];
    if (countEl) countEl.textContent = `${adminUsersState.total} user${adminUsersState.total !== 1 ? 's' : ''}`;

    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text3);">No users match these filters.</td></tr>`;
      renderAdminUsersPager();
      return;
    }
    tbody.innerHTML = users.map(u => `
      <tr data-id="${escHtml(u.id)}">
        <td><input type="checkbox" class="admin-user-cb" data-id="${escHtml(u.id)}" aria-label="Select ${escHtml(u.email || '')}"></td>
        <td><button class="admin-user-link" data-act="detail" style="background:none;border:0;color:#6ea8ff;cursor:pointer;padding:0;">${escHtml(u.email || '')}</button></td>
        <td>${escHtml(u.displayName || '—')}</td>
        <td><span class="admin-plan-chip ${escHtml(u.plan)}">${escHtml(u.plan)}</span></td>
        <td>${u.clonesThisMonth || 0}</td>
        <td>${u.totalFunnels || 0}</td>
        <td style="color:var(--text3); font-size:12px;">${u.lastActivity ? new Date(u.lastActivity).toLocaleDateString() : '—'}</td>
        <td>
          <div class="admin-user-actions">
            <button data-act="detail">Detail</button>
            <button data-act="plan">Plan</button>
            <button data-act="impersonate">Impersonate</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      const user = users.find(x => x.id === id);
      const cb = tr.querySelector('.admin-user-cb');
      if (cb) cb.addEventListener('change', () => { toggleAdminSelection(id, cb.checked); });
      tr.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'detail') openUserDrawer(id);
        else if (act === 'plan') openAdminPlanModal(user);
        else if (act === 'impersonate') impersonateUser(user);
      });
    });
    // Reflect any already-selected ids after a reload.
    syncAdminSelectionUI();
    renderAdminUsersPager();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--red);">Load failed: ${escHtml(err.message || String(err))}</td></tr>`;
  }
}

// ── Admin: selection + bulk actions ──────────────────────────────────────────
const adminSelection = new Set();

function toggleAdminSelection(id, on) {
  if (on) adminSelection.add(id); else adminSelection.delete(id);
  syncAdminSelectionUI();
}

function syncAdminSelectionUI() {
  document.querySelectorAll('.admin-user-cb').forEach(cb => { cb.checked = adminSelection.has(cb.dataset.id); });
  const bar = document.getElementById('admin-bulk-bar');
  const count = document.getElementById('admin-bulk-count');
  if (bar) bar.style.display = adminSelection.size ? 'flex' : 'none';
  if (count) count.textContent = `${adminSelection.size} selected`;
}

async function applyAdminBulk() {
  if (!adminSelection.size) return;
  const raw = document.getElementById('admin-bulk-action').value;
  const ids = [...adminSelection];
  let payload;
  if (raw.startsWith('plan:')) payload = { bulkAction: 'plan', ids, plan: raw.split(':')[1] };
  else if (raw === 'extend') payload = { bulkAction: 'extend', ids, days: 31 };
  else payload = { bulkAction: raw, ids };
  if (!confirm(`Apply "${raw}" to ${ids.length} user(s)?`)) return;
  try {
    const res = await sendMsg({ action: 'BACKEND_ADMIN_BULK', ...payload });
    if (!res?.success) throw new Error(res?.error || 'Bulk action failed');
    adminSelection.clear();
    syncAdminSelectionUI();
    loadAdminUsers();
    showSaveToast(`Applied to ${res.affected} user(s).`);
  } catch (err) { alert(`Bulk action failed: ${err.message || err}`); }
}

async function impersonateUser(user) {
  if (!confirm(`Open a 15-minute support session as ${user.email}? Your owner session token will be replaced — sign back in afterward.`)) return;
  try {
    const res = await sendMsg({ action: 'BACKEND_ADMIN_IMPERSONATE', userId: user.id });
    if (!res?.success || !res.token) throw new Error(res?.error || 'Impersonation failed');
    await sendMsg({ action: 'SAVE_SETTINGS', data: { backendToken: res.token, impersonating: user.email } });
    showSaveToast(`Now impersonating ${user.email} (15 min). Reload account views to see their data.`);
  } catch (err) { alert(`Impersonation failed: ${err.message || err}`); }
}

async function exportAdminCsv() {
  try {
    const res = await sendMsg({ action: 'BACKEND_ADMIN_EXPORT_CSV' });
    if (!res?.success || res.csv == null) throw new Error(res?.error || 'Export failed');
    const blob = new Blob([res.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'clone2ghl-users.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) { alert(`Export failed: ${err.message || err}`); }
}

function renderAdminUsersPager() {
  const pager = document.getElementById('admin-users-pager');
  if (!pager) return;
  const totalPages = Math.max(1, Math.ceil(adminUsersState.total / adminUsersState.limit));
  const currentPage = Math.floor(adminUsersState.offset / adminUsersState.limit) + 1;
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  pager.innerHTML = `
    <button class="discover-pager-btn" data-act="prev" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>
    <span class="discover-pager-info">Page ${currentPage} of ${totalPages}</span>
    <button class="discover-pager-btn" data-act="next" ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>
  `;
  pager.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const delta = b.dataset.act === 'next' ? adminUsersState.limit : -adminUsersState.limit;
      adminUsersState.offset = Math.max(0, adminUsersState.offset + delta);
      loadAdminUsers();
    });
  });
}

function openAdminPlanModal(user) {
  adminCurrentEditingUser = user;
  document.getElementById('admin-plan-modal-user').textContent = `${user.email} — currently ${user.plan}`;
  document.getElementById('admin-plan-modal-select').value = user.plan || 'free';
  document.getElementById('admin-plan-modal').style.display = 'flex';
}

function closeAdminPlanModal() {
  document.getElementById('admin-plan-modal').style.display = 'none';
  adminCurrentEditingUser = null;
}

async function saveAdminPlanModal() {
  if (!adminCurrentEditingUser) return;
  const newPlan = document.getElementById('admin-plan-modal-select').value;
  const btn = document.getElementById('admin-plan-modal-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await sendMsg({
      action: 'BACKEND_ADMIN_USER_SET_PLAN',
      userId: adminCurrentEditingUser.id,
      plan: newPlan,
    });
    closeAdminPlanModal();
    loadAdminUsers();
  } catch (err) {
    alert(`Failed: ${err.message || err}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

async function loadAdminAnalytics() {
  const days = Number(document.getElementById('admin-analytics-range')?.value || 30);
  try {
    const data = await sendMsg({ action: 'BACKEND_ADMIN_ANALYTICS', days });
    drawAdminChart(data);
  } catch (err) {
    console.error('admin analytics', err);
  }
}

function drawAdminChart(data) {
  const canvas = document.getElementById('admin-chart-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 800;
  const h = 320;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const days = Object.keys(data.clonesByDay || {});
  if (!days.length) {
    ctx.fillStyle = '#B8B8B8';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No activity in this range yet.', w / 2, h / 2);
    return;
  }

  const series = [
    { name: 'Clones', values: days.map(d => data.clonesByDay[d] || 0), color: '#D9A620' },
    { name: 'Videos', values: days.map(d => data.videosByDay[d] || 0), color: '#1E4DFF' },
    { name: 'Signups', values: days.map(d => data.signupsByDay[d] || 0), color: '#10B981' },
  ];
  const maxVal = Math.max(1, ...series.flatMap(s => s.values));

  // Chart area
  const padLeft = 44, padBottom = 36, padTop = 28, padRight = 16;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padTop + chartH * (i / 4);
    ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + chartW, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, Arial';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(maxVal - (maxVal * i / 4))), padLeft - 6, y + 3);
  }

  // X-axis labels (first, middle, last)
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, Arial';
  ctx.textAlign = 'center';
  const formatLabel = d => d.slice(5);
  ctx.fillText(formatLabel(days[0]), padLeft, h - 16);
  ctx.fillText(formatLabel(days[Math.floor(days.length / 2)]), padLeft + chartW / 2, h - 16);
  ctx.fillText(formatLabel(days[days.length - 1]), padLeft + chartW, h - 16);

  // Lines + filled area
  series.forEach(s => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = padLeft + (i / Math.max(1, days.length - 1)) * chartW;
      const y = padTop + (1 - v / maxVal) * chartH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // Legend
  let legendX = padLeft;
  series.forEach(s => {
    ctx.fillStyle = s.color;
    ctx.fillRect(legendX, 8, 10, 10);
    ctx.fillStyle = '#F5F5F5';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, Arial';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, legendX + 14, 17);
    legendX += 80;
  });
}

// ─── Sidebar Plan Info ────────────────────────────────────────────────────────
function updateSidebarPlanInfo() {
  const nameEl = document.querySelector('.plan-name');
  const credEl = document.getElementById('sidebar-credits');
  if (!settings) return;

  if (nameEl) {
    const planLabel = settings.plan === 'owner' ? 'Owner' : (settings.plan?.charAt(0).toUpperCase() + settings.plan?.slice(1) || 'Free');
    nameEl.textContent = `${planLabel} Plan`;
  }
  if (credEl) {
    if (settings.plan === 'owner') {
      credEl.textContent = 'Unlimited — Owner';
    } else if (settings.devMode) {
      credEl.textContent = 'Dev Mode — Unlimited';
    } else if (settings.plan === 'free') {
      credEl.textContent = `${settings.credits ?? 6} clone${settings.credits !== 1 ? 's' : ''} remaining`;
    } else if (settings.plan === 'starter') {
      credEl.textContent = `${settings.credits ?? 24} clone${settings.credits !== 1 ? 's' : ''} remaining`;
    } else if (settings.plan === 'pro') {
      credEl.textContent = '300 clones/month';
    } else {
      credEl.textContent = 'Unlimited clones';
    }
  }

  // Subscription status line (lapsed/expiring/active) — surfaced so users aren't
  // silently downgraded without knowing why their tools changed.
  renderSubscriptionStatus();

  // Owner entry / badge visibility
  const ownerEntry = document.getElementById('owner-entry');
  const ownerBadge = document.getElementById('owner-badge');
  if (settings.plan === 'owner') {
    if (ownerEntry) ownerEntry.style.display = 'none';
    if (ownerBadge) ownerBadge.style.display = 'block';
  } else {
    if (ownerEntry) ownerEntry.style.display = 'block';
    if (ownerBadge) ownerBadge.style.display = 'none';
  }

  // Dev Mode badge + toggle sync
  const devBadge = document.getElementById('devmode-badge');
  const devToggle = document.getElementById('sidebar-devmode-toggle');
  if (devBadge) devBadge.style.display = settings.devMode ? 'block' : 'none';
  if (devToggle) devToggle.checked = Boolean(settings.devMode);

  document.getElementById('btn-upgrade-sidebar')?.addEventListener('click', () => switchTab('settings'));
}

function setupDevModeToggle() {
  const toggle = document.getElementById('sidebar-devmode-toggle');
  if (!toggle) return;
  toggle.addEventListener('change', async () => {
    const result = await sendMsg({ action: 'SAVE_SETTINGS', data: { devMode: toggle.checked } });
    settings = result?.settings || settings;
    settings.devMode = toggle.checked;
    updateSidebarPlanInfo();
    applyFeatureGating();
  });
}

function setupOwnerButtons() {
  document.getElementById('btn-owner-login')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('owner-login.html') });
  });

  document.getElementById('btn-owner-lock')?.addEventListener('click', async () => {
    await chrome.storage.local.set({ ownerAuth: { passwordHash: (await chrome.storage.local.get('ownerAuth'))?.ownerAuth?.passwordHash || null, unlocked: false } });
    const result = await sendMsg({ action: 'OWNER_LOCK' });
    settings = result?.settings || settings;
    updateSidebarPlanInfo();
    applyFeatureGating();
  });
}

// ─── My Funnels Tab ───────────────────────────────────────────────────────────
function setupFunnelsTab() {
  renderFunnels();

  document.getElementById('btn-clone-new')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.tabs.sendMessage(tab.id, { action: 'SHOW_CLONE_PANEL' }).catch(() => {});
    }
  });

  document.getElementById('btn-url-clone')?.addEventListener('click', cloneFromUrl);
  document.getElementById('url-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') cloneFromUrl();
  });
}

let funnelFilter = { q: '', niche: '', status: '' };

function applyFunnelFilter(list) {
  const q = funnelFilter.q.trim().toLowerCase();
  return list.filter(f =>
    (!q
      || (f.name || '').toLowerCase().includes(q)
      || (f.sourceUrl || '').toLowerCase().includes(q)
      || (f.niche || '').toLowerCase().includes(q)
      || (Array.isArray(f.tags) ? f.tags.join(' ') : '').toLowerCase().includes(q))
    && (!funnelFilter.niche || f.niche === funnelFilter.niche)
    && (!funnelFilter.status || (f.status || 'draft') === funnelFilter.status)
  );
}

// Builds (once) the search/filter toolbar above the funnel grid.
function ensureFunnelToolbar() {
  if (document.getElementById('funnels-toolbar')) return;
  const grid = document.getElementById('funnels-grid');
  if (!grid) return;
  const bar = document.createElement('div');
  bar.id = 'funnels-toolbar';
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;';
  bar.innerHTML = `
    <input type="search" id="funnels-search" class="field-input" placeholder="Search funnels, URLs, tags…" style="max-width:280px;" aria-label="Search funnels">
    <select id="funnels-niche" class="field-input" style="max-width:160px;" aria-label="Filter by niche"><option value="">All niches</option></select>
    <select id="funnels-status" class="field-input" style="max-width:160px;" aria-label="Filter by status">
      <option value="">All statuses</option>
      <option value="draft">Draft</option>
      <option value="optimized">AI Optimized</option>
      <option value="exported">Exported</option>
    </select>
    <span id="funnels-result-count" style="font-size:12px;color:var(--text3);"></span>
    <button id="btn-batch-clone" class="btn-primary" style="margin-left:auto;padding:7px 14px;">⚡ Batch clone</button>`;
  grid.parentNode.insertBefore(bar, grid);

  document.getElementById('funnels-search').addEventListener('input', (e) => { funnelFilter.q = e.target.value; renderFunnels(); });
  document.getElementById('funnels-niche').addEventListener('change', (e) => { funnelFilter.niche = e.target.value; renderFunnels(); });
  document.getElementById('funnels-status').addEventListener('change', (e) => { funnelFilter.status = e.target.value; renderFunnels(); });
  document.getElementById('btn-batch-clone').addEventListener('click', openBatchClone);
}

// ─── M4: Batch cloning (multi-URL, 2 parallel workers, live progress) ─────────
async function runBatchClone(urls, niche, optimize, onProgress) {
  const results = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      onProgress(i, 'cloning');
      try {
        const r = await sendMsg({ action: 'CLONE_FROM_URL_SILENT', url: urls[i], niche, optimize });
        if (r?.error || r?.success === false) throw new Error(r.error || 'Clone failed');
        results[i] = { url: urls[i], ok: true };
        onProgress(i, 'done');
      } catch (e) {
        results[i] = { url: urls[i], ok: false, error: e.message };
        onProgress(i, 'error', e.message);
      }
    }
  };
  await Promise.all([worker(), worker()]); // concurrency = 2
  return results;
}

function openBatchClone() {
  let modal = document.getElementById('batch-clone-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'batch-clone-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:#0f1426;border:1px solid #2a3350;border-radius:12px;width:min(620px,95vw);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #2a3350;">
        <strong style="flex:1;">⚡ Batch clone</strong>
        <button id="bc-close" class="btn-secondary" aria-label="Close" style="padding:5px 10px;">✕</button>
      </div>
      <div style="padding:14px 16px;overflow-y:auto;">
        <label class="field-label">URLs (one per line, max 20)</label>
        <textarea id="bc-urls" class="field-input" rows="6" placeholder="https://example.com/page-1&#10;https://example.com/page-2" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;">
          <input id="bc-niche" class="field-input" placeholder="Niche (e.g. plumber)" style="max-width:200px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="bc-optimize"> AI-optimize each</label>
          <button id="bc-start" class="btn-primary" style="margin-left:auto;">Start</button>
        </div>
        <div id="bc-progress" style="margin-top:14px;"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  a11yModal(modal, 'Batch clone');
  const close = () => modal.remove();
  document.getElementById('bc-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  document.getElementById('bc-start').addEventListener('click', async () => {
    const urls = document.getElementById('bc-urls').value.split('\n').map(s => s.trim())
      .filter(s => /^https?:\/\//i.test(s)).slice(0, 20);
    const niche = document.getElementById('bc-niche').value.trim() || 'general';
    const optimize = document.getElementById('bc-optimize').checked && Boolean(settings.backendToken);
    if (!urls.length) { alert('Enter at least one valid http(s) URL.'); return; }

    const startBtn = document.getElementById('bc-start');
    startBtn.disabled = true; startBtn.textContent = 'Cloning…';
    const prog = document.getElementById('bc-progress');
    prog.innerHTML = urls.map((u, i) => `<div id="bc-row-${i}" style="display:flex;gap:8px;padding:4px 0;font-size:12px;"><span style="width:18px;">⏳</span><span style="flex:1;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(u)}</span></div>`).join('');

    const setRow = (i, icon, color) => {
      const row = document.getElementById(`bc-row-${i}`);
      if (row) row.querySelector('span').textContent = icon;
      if (row && color) row.style.color = color;
    };
    const results = await runBatchClone(urls, niche, optimize, (i, state, err) => {
      if (state === 'cloning') setRow(i, '⏳');
      else if (state === 'done') setRow(i, '✅');
      else if (state === 'error') { setRow(i, '❌'); const r = document.getElementById(`bc-row-${i}`); if (r) r.title = err || 'failed'; }
    });

    const ok = results.filter(r => r?.ok).length;
    startBtn.disabled = false; startBtn.textContent = 'Start';
    showSaveToast(`Batch complete: ${ok}/${urls.length} cloned.`);
    const fr = await sendMsg({ action: 'GET_FUNNELS' });
    myFunnels = fr?.funnels || myFunnels;
    renderFunnels();
    updateFunnelSelects();
  });
}

function renderFunnels() {
  const grid = document.getElementById('funnels-grid');
  const empty = document.getElementById('funnels-empty');
  if (!grid || !empty) return;

  if (myFunnels.length === 0) {
    const bar = document.getElementById('funnels-toolbar');
    if (bar) bar.style.display = 'none';
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  ensureFunnelToolbar();
  const bar = document.getElementById('funnels-toolbar');
  if (bar) bar.style.display = 'flex';

  // Refresh niche options from the current set, preserving selection.
  const nicheSel = document.getElementById('funnels-niche');
  if (nicheSel) {
    const niches = [...new Set(myFunnels.map(f => f.niche).filter(Boolean))].sort();
    const cur = funnelFilter.niche;
    nicheSel.innerHTML = '<option value="">All niches</option>' + niches.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
    nicheSel.value = cur;
  }

  const filtered = applyFunnelFilter(myFunnels);
  const countEl = document.getElementById('funnels-result-count');
  if (countEl) countEl.textContent = `${filtered.length} of ${myFunnels.length}`;

  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  if (!filtered.length) {
    grid.style.display = 'block';
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);">No funnels match your search/filters.</div>`;
    return;
  }
  filtered.forEach(funnel => {
    grid.appendChild(buildFunnelCard(funnel));
  });
}

function buildFunnelCard(funnel) {
  const card = document.createElement('div');
  card.className = 'funnel-card';

  const score = funnel.analysis?.score || 0;
  const grade = funnel.analysis?.grade || '—';
  const statusLabel = { draft: 'Draft', optimized: 'AI Optimized', exported: 'Exported to GHL' }[funnel.status] || 'Draft';
  const nicheEmoji = nicheToEmoji(funnel.niche);
  const date = funnel.createdAt ? new Date(funnel.createdAt).toLocaleDateString() : '';

  // Clone fidelity badge — colour-coded so users see capture quality at a glance.
  const fid = funnel.fidelity;
  const fidColor = fid ? (fid.score >= 70 ? '#2ecc71' : fid.score >= 55 ? '#f1c40f' : '#ff6b6b') : '';
  const fidTitle = fid ? (fid.issues || []).map(i => i.text).join(' • ') || 'No fidelity issues detected' : '';
  const fidBadge = fid
    ? `<span class="fidelity-badge" title="${escHtml(fidTitle)}" style="position:absolute;top:8px;left:8px;background:${fidColor};color:#0d1020;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;">Fidelity ${escHtml(fid.grade)} · ${fid.score}</span>`
    : '';

  card.innerHTML = `
    <div class="funnel-card-preview" style="position:relative;">
      ${nicheEmoji}
      ${fidBadge}
      <span class="funnel-status-badge status-${funnel.status || 'draft'}">${statusLabel}</span>
    </div>
    <div class="funnel-card-body">
      <div class="funnel-card-title">${escHtml(funnel.name || 'Untitled Funnel')}</div>
      <div class="funnel-card-meta">
        <span class="funnel-tag">${funnel.niche || 'general'}</span>
        <span>${date}</span>
      </div>
      ${score > 0 ? `
      <div class="score-bar">
        <div class="score-bar-track"><div class="score-bar-fill" style="width:${score}%"></div></div>
        <span class="score-label">Score: ${score}/100 (${grade})</span>
      </div>` : ''}
      <div class="funnel-card-actions">
        <button class="btn-primary btn-view" data-id="${funnel.id}">View</button>
        <button class="btn-secondary btn-preview" data-id="${funnel.id}">👁 Preview</button>
        ${!fid ? `<button class="btn-secondary btn-analyze" data-id="${funnel.id}" title="Compute clone fidelity">📊 Analyze</button>` : ''}
        <button class="btn-secondary btn-customize" data-id="${funnel.id}">✏️ Edit</button>
        <button class="btn-secondary btn-history" data-id="${funnel.id}" title="Version history">🕘</button>
        <button class="btn-primary btn-push" data-id="${funnel.id}">→ GHL</button>
        <button class="btn-danger btn-delete" data-id="${funnel.id}">🗑</button>
      </div>
    </div>
  `;

  card.querySelector('.btn-preview').addEventListener('click', (e) => {
    e.stopPropagation();
    openClonePreview(funnel);
  });

  card.querySelector('.btn-history').addEventListener('click', (e) => {
    e.stopPropagation();
    openVersionHistory(funnel);
  });

  card.querySelector('.btn-analyze')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '…';
    try {
      const res = await sendMsg({ action: 'ANALYZE_FIDELITY', funnelId: funnel.id });
      if (!res?.success) throw new Error(res?.error || 'Analyze failed');
      const fr = await sendMsg({ action: 'GET_FUNNELS' });
      myFunnels = fr?.funnels || myFunnels;
      renderFunnels();
    } catch (err) { btn.disabled = false; btn.textContent = '📊 Analyze'; alert(`Analyze failed: ${err.message || err}`); }
  });

  card.querySelector('.btn-view').addEventListener('click', (e) => {
    e.stopPropagation();
    openFunnelModal(funnel);
  });

  card.querySelector('.btn-customize').addEventListener('click', (e) => {
    e.stopPropagation();
    openVisualEditor(funnel);
  });

  card.querySelector('.btn-push').addEventListener('click', (e) => {
    e.stopPropagation();
    pushFunnelToGHL(funnel.id, e.target);
  });

  card.querySelector('.btn-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${funnel.name}"?`)) {
      await sendMsg({ action: 'DELETE_FUNNEL', id: funnel.id });
      myFunnels = myFunnels.filter(f => f.id !== funnel.id);
      renderFunnels();
      updateFunnelSelects();
    }
  });

  card.addEventListener('click', () => openFunnelModal(funnel));

  return card;
}

async function cloneFromUrl() {
  const url = document.getElementById('url-input')?.value?.trim();
  if (!url) return;

  // Open URL in new tab and instruct user
  const tab = await chrome.tabs.create({ url, active: true });
  setTimeout(() => {
    chrome.tabs.sendMessage(tab.id, { action: 'SHOW_CLONE_PANEL' }).catch(() => {});
  }, 2000);
}

async function pushFunnelToGHL(funnelId, btnEl) {
  // Always refresh from storage
  const sr = await sendMsg({ action: 'GET_SETTINGS' });
  settings = sr?.settings || settings;

  if (!settings.ghlApiKey || !settings.ghlLocationId) {
    if (await uiConfirm('Connect GoHighLevel', "Your GoHighLevel API key or Location ID isn't set yet. Open Settings to connect your account?", { okText: 'Open Settings', cancelText: 'Not now' })) {
      switchTab('settings');
      document.getElementById('ghl-api-key')?.focus();
    }
    return;
  }

  const originalText = btnEl?.textContent || '→ GHL';
  if (btnEl) {
    btnEl.innerHTML = '<span class="spinner"></span> Pushing…';
    btnEl.disabled = true;
  }

  const result = await sendMsg({ action: 'PUSH_TO_GHL', data: { funnelId, useOptimized: true } });

  if (btnEl) btnEl.disabled = false;

  // ── Error ──────────────────────────────────────────────────────────────────
  if (result?.error || (!result?.success && !result?.funnelId)) {
    const errMsg = buildPushErrorMessage(result?.error || 'Unknown error occurred.');
    if (btnEl) btnEl.textContent = originalText;
    await uiAlert('Export failed', errMsg);

    // Offer download fallback
    const funnel = myFunnels.find(f => f.id === funnelId);
    if (funnel && await uiConfirm('Download HTML?', 'Want to download the HTML instead so you can paste it manually into GHL?', { okText: 'Download', cancelText: 'No thanks' })) {
      const html = funnel.optimizedHtml || funnel.html || '';
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(funnel.name || 'funnel').replace(/\s+/g, '-')}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return;
  }

  // ── Refresh funnel list ────────────────────────────────────────────────────
  const fr = await sendMsg({ action: 'GET_FUNNELS' });
  myFunnels = fr?.funnels || [];
  renderFunnels();

  // ── Partial success (page created, content upload failed) ─────────────────
  if (result.success === 'partial' || result.success === 'html_only') {
    if (btnEl) btnEl.textContent = '⚠ Partial';
    const details = result.warning || 'Page was created but content could not be uploaded automatically.';
    const action = await uiConfirm(
      'Partial export',
      `${details}\n\nFunnel: "${result.funnelName || 'Unknown'}"\n\nOpen GHL to paste the HTML manually, or download the HTML file instead.`,
      { okText: 'Open GHL', cancelText: 'Download HTML' }
    );
    if (action) {
      chrome.tabs.create({ url: result.ghlBuilderUrl });
    } else {
      const funnel = myFunnels.find(f => f.id === funnelId);
      if (funnel) {
        const html = funnel.optimizedHtml || funnel.html || '';
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(funnel.name || 'funnel').replace(/\s+/g, '-')}.html`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
    return;
  }

  // ── Full success ──────────────────────────────────────────────────────────
  if (btnEl) btnEl.textContent = '✓ Exported!';
  const funnelLabel = result.funnelName ? ` "${result.funnelName}"` : '';
  showSaveToast('Pushed to GoHighLevel ✓');
  if (await uiConfirm(
    'Pushed to GoHighLevel ✅',
    `Your page${funnelLabel} is now live in your GHL account and editable in the GHL Builder.\n\nOpen the GHL Builder now?`,
    { okText: 'Open GHL Builder', cancelText: 'Stay here' }
  )) {
    chrome.tabs.create({ url: result.ghlBuilderUrl });
  }
}

function buildPushErrorMessage(rawError) {
  const err = String(rawError || '').toLowerCase();
  let advice = 'Try again in a few seconds.';

  if (err.includes('location id') || err.includes('location not found') || err.includes('404')) {
    advice = 'Your Location ID is incorrect. Go to GHL → Settings → Business Profile → copy the Location ID and paste it in Clone2GHL Settings.';
  } else if (
    err.includes('invalid private integration') || err.includes('api key') ||
    err.includes('401') || err.includes('unauthorized') || err.includes('forbidden') || err.includes('403')
  ) {
    advice = 'Your GHL API key is invalid or missing permissions.\n\nFix: GHL → Settings → Integrations → Private Integrations → Create new key with Funnels + Websites scope → paste in Clone2GHL Settings → Test Connection.';
  } else if (err.includes('scope') || err.includes('permission')) {
    advice = 'Your API key is missing the Funnels scope. Edit your Private Integration in GHL and enable Funnels & Websites permissions.';
  } else if (err.includes('timed out') || err.includes('network') || err.includes('abort')) {
    advice = 'Connection timed out. Check your internet connection and retry. If GHL is slow, try again in 30 seconds.';
  } else if (err.includes('no funnels found') || err.includes('create at least one')) {
    advice = 'Go to GoHighLevel → Funnels & Websites → New Funnel → create any funnel → then retry the export here.';
  } else if (err.includes('quota') || err.includes('storage')) {
    advice = 'Delete older funnels in My Funnels to free storage, then retry.';
  } else if (err.includes('empty') || err.includes('invalid html')) {
    advice = 'The funnel HTML appears to be empty. Try re-cloning the site first.';
  }

  return `❌ Export Failed\n\n${rawError}\n\n💡 How to fix:\n${advice}`;
}


// ─── Funnel Modal ─────────────────────────────────────────────────────────────
function setupModal() {
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('funnel-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'funnel-modal') closeModal();
  });
}

function openFunnelModal(funnel) {
  currentFunnelId = funnel.id;
  const modal = document.getElementById('funnel-modal');
  const title = document.getElementById('modal-funnel-title');
  const body = document.getElementById('modal-body');

  title.textContent = funnel.name || 'Funnel Details';
  body.innerHTML = buildModalContent(funnel);

  modal.style.display = 'flex';

  // Wire up modal buttons
  body.querySelector('#modal-btn-push')?.addEventListener('click', async () => {
    await pushFunnelToGHL(funnel.id, body.querySelector('#modal-btn-push'));
  });

  body.querySelector('#modal-btn-optimize')?.addEventListener('click', async () => {
    const btn = body.querySelector('#modal-btn-optimize');
    btn.innerHTML = '<span class="spinner"></span> Optimizing…';
    btn.disabled = true;
    const niche = funnel.niche || 'general';
    const result = await sendMsg({ action: 'OPTIMIZE_FUNNEL', data: { funnelId: funnel.id, niche } });
    if (result?.success) {
      btn.textContent = '✓ Optimized!';
      const fr = await sendMsg({ action: 'GET_FUNNELS' });
      myFunnels = fr?.funnels || [];
    } else {
      alert(result?.error || 'Optimization failed');
      btn.textContent = '🤖 AI Optimize';
      btn.disabled = false;
    }
  });

  body.querySelector('#modal-btn-customize')?.addEventListener('click', () => {
    closeModal();
    openVisualEditor(funnel);
  });

  body.querySelector('#modal-btn-preview')?.addEventListener('click', () => {
    const html = funnel.optimizedHtml || funnel.html;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  });

  body.querySelector('#modal-btn-download')?.addEventListener('click', () => {
    const html = funnel.optimizedHtml || funnel.html;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(funnel.name || 'funnel').replace(/\s+/g, '-')}.html`;
    a.click();
  });
}

function buildModalContent(funnel) {
  const a = funnel.analysis;
  const score = a?.score || 0;
  const grade = a?.grade || '—';

  let analysisHtml = '';
  if (a) {
    const allInsights = [
      ...(a.ctaInsights || []),
      ...(a.formInsights || []),
      ...(a.trustScore?.insights || a.trustSignals?.map(t => ({ type: 'good', text: t.label })) || []),
    ].slice(0, 8);

    const insightItems = allInsights.map(i => `
      <div class="insight-item ${i.type || 'neutral'}">
        <span class="insight-dot">${i.type === 'good' ? '✓' : i.type === 'warning' ? '⚠' : i.type === 'tip' ? '💡' : '•'}</span>
        <span>${escHtml(i.text)}</span>
      </div>`).join('');

    const recItems = (a.recommendations || []).slice(0, 4).map(r => `
      <div class="rec-item">
        <span class="rec-priority ${r.priority}">${r.priority}</span>
        <span>${escHtml(r.action)}</span>
      </div>`).join('');

    const headlineTypes = (a.headlineTypes || []).map(h => `<span class="funnel-tag">${h.type}</span>`).join(' ');

    analysisHtml = `
      <div class="section-label">Funnel Intelligence</div>
      <div class="funnel-detail-grid">
        <div class="detail-stat">
          <div class="detail-stat-label">Conversion Score</div>
          <div class="detail-stat-value">${score}/100 <span style="font-size:16px">${grade}</span></div>
          <div class="detail-stat-sub">${a.summary || ''}</div>
        </div>
        <div class="detail-stat">
          <div class="detail-stat-label">Niche Detected</div>
          <div class="detail-stat-value">${a.detectedNiche || 'general'}</div>
          <div class="detail-stat-sub">${(a.testimonialCount || 0)} testimonials · ${(a.sectionCount || 0)} sections</div>
        </div>
      </div>
      ${headlineTypes ? `<div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;">${headlineTypes}</div>` : ''}
      ${insightItems ? `<div class="insight-list">${insightItems}</div>` : ''}
      ${recItems ? `<div class="section-label">Recommendations</div><div class="rec-list">${recItems}</div>` : ''}
      ${a.urgencyElements?.length ? `
        <div class="section-label">Urgency Elements</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${a.urgencyElements.map(u => `<span class="funnel-tag">${escHtml(u)}</span>`).join('')}</div>
      ` : ''}
    `;

    if (funnel.aiReport) {
      analysisHtml += `<div class="section-label">AI Analysis</div><div class="intel-report">${escHtml(funnel.aiReport)}</div>`;
    }
  }

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="font-size:2rem;">${nicheToEmoji(funnel.niche)}</div>
      <div>
        <div style="font-size:13px;color:var(--text4);">${funnel.sourceUrl || 'Library template'}</div>
        <div style="font-size:12px;color:var(--text4);margin-top:2px;">
          ${funnel.niche || 'general'} · ${funnel.status || 'draft'}
          ${funnel.exportedAt ? ` · Exported ${new Date(funnel.exportedAt).toLocaleDateString()}` : ''}
        </div>
      </div>
    </div>

    ${funnel.status === 'optimized' ? `<div class="tool-status success">✓ AI Optimized copy available — exporting will use the optimized version.</div>` : ''}
    ${funnel.ghlFunnelId ? `<div class="tool-status success">✓ Exported to GHL — Funnel ID: ${funnel.ghlFunnelId}</div>` : ''}

    ${analysisHtml}

    <div class="modal-actions">
      <button class="btn-primary" id="modal-btn-push">→ Push to GHL</button>
      <button class="btn-secondary" id="modal-btn-customize">✏️ Customize</button>
      <button class="btn-secondary" id="modal-btn-optimize">🤖 AI Optimize</button>
      <button class="btn-secondary" id="modal-btn-preview">👁 Preview HTML</button>
      <button class="btn-secondary" id="modal-btn-download">⬇ Download HTML</button>
    </div>
  `;
}

function closeModal() {
  document.getElementById('funnel-modal').style.display = 'none';
  currentFunnelId = null;
}

// ─── Library Tab ──────────────────────────────────────────────────────────────
function setupLibraryTab() {
  renderLibrary();
  document.getElementById('library-niche-filter')?.addEventListener('change', renderLibrary);
  document.getElementById('library-type-filter')?.addEventListener('change', renderLibrary);
  document.getElementById('library-perf-filter')?.addEventListener('change', renderLibrary);
}

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  if (!grid) return;

  const nicheFilter = document.getElementById('library-niche-filter')?.value || '';
  const typeFilter = document.getElementById('library-type-filter')?.value || '';
  const perfFilter = document.getElementById('library-perf-filter')?.value || '';

  let items = funnelLibrary;
  if (nicheFilter) items = items.filter(f => f.niche === nicheFilter);
  if (typeFilter) items = items.filter(f => f.type === typeFilter);
  if (perfFilter) items = items.filter(f => f.performance === perfFilter);

  grid.innerHTML = '';
  if (items.length === 0) {
    grid.innerHTML = '<p style="color:var(--text4);padding:20px;">No funnels match the selected filters.</p>';
    return;
  }

  items.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'library-card';

    const emoji = nicheToEmoji(tpl.niche);
    const perfClass = { high_converting: 'high', trending: 'trending' }[tpl.performance] || 'high';
    const perfLabel = { high_converting: '🔥 High Converting', trending: '📈 Trending' }[tpl.performance] || '';

    card.innerHTML = `
      <div class="library-card-preview">
        ${emoji}
        <span class="perf-badge perf-${perfClass}">${perfLabel}</span>
      </div>
      <div class="library-card-body">
        <div class="library-card-title">${escHtml(tpl.name)}</div>
        <div class="library-card-desc">${escHtml(tpl.description)}</div>
        <div class="library-card-stats">
          <span class="stat-pill green">✓ ${tpl.stats?.conversionRate || 'N/A'} CVR</span>
          <span class="stat-pill orange">⚡ ${tpl.stats?.avgLeads || 'N/A'}</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-primary" style="flex:1;justify-content:center;" data-id="${tpl.id}">Clone + Customize</button>
          <button class="btn-secondary btn-preview-tpl" data-id="${tpl.id}">👁</button>
        </div>
      </div>
    `;

    card.querySelector('.btn-primary').addEventListener('click', () => cloneFromLibrary(tpl));
    card.querySelector('.btn-preview-tpl').addEventListener('click', () => previewTemplate(tpl));

    grid.appendChild(card);
  });
}

// Lazy-loads a template's HTML from data/templates/{file}.html (or returns inline tpl.html for legacy entries).
async function loadTemplateHtml(tpl) {
  if (tpl?.html) return tpl.html;
  if (!tpl?.htmlFile) return '';
  loadTemplateHtml._cache = loadTemplateHtml._cache || {};
  if (loadTemplateHtml._cache[tpl.htmlFile]) return loadTemplateHtml._cache[tpl.htmlFile];
  try {
    const resp = await fetch(chrome.runtime.getURL(`data/${tpl.htmlFile}`));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    loadTemplateHtml._cache[tpl.htmlFile] = html;
    return html;
  } catch (e) {
    console.warn('[funnel-library] Failed to load template HTML', tpl.htmlFile, e);
    return '';
  }
}

async function cloneFromLibrary(tpl) {
  // Save the library template as a funnel in the user's "My Funnels"
  const html = await loadTemplateHtml(tpl);
  if (!html) {
    showSaveToast('Could not load template');
    return;
  }
  const funnel = {
    id: `lib_${tpl.id}_${Date.now()}`,
    name: tpl.name,
    sourceUrl: 'Library Template',
    niche: tpl.niche,
    status: 'draft',
    html,
    optimizedHtml: null,
    analysis: null,
    meta: { title: tpl.name, url: '', capturedAt: new Date().toISOString() },
  };

  await sendMsg({ action: 'SAVE_FUNNEL', data: funnel });
  const fr = await sendMsg({ action: 'GET_FUNNELS' });
  myFunnels = fr?.funnels || [];
  renderFunnels();
  updateFunnelSelects();
  switchTab('funnels');
}

async function previewTemplate(tpl) {
  const html = await loadTemplateHtml(tpl);
  if (!html) return;
  const blob = new Blob([html], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
}

// ─── Discover Sites Tab ───────────────────────────────────────────────────────

const DISCOVER_NICHES = [
  ['plumber',          '🔧', 'Plumber'],
  ['electrician',      '⚡', 'Electrician'],
  ['hvac',             '❄️', 'HVAC'],
  ['roofing',          '🏠', 'Roofing'],
  ['cleaning',         '🧹', 'Cleaning'],
  ['landscaping',      '🌿', 'Landscaping'],
  ['solar',            '☀️', 'Solar'],
  ['real_estate',      '🏢', 'Real Estate'],
  ['gym',              '💪', 'Gym / Fitness'],
  ['dental',           '🦷', 'Dental'],
  ['coaching',         '🎯', 'Coaching'],
  ['insurance',        '🛡️', 'Insurance'],
  ['legal',            '⚖️', 'Legal'],
  ['marketing_agency', '📈', 'Marketing Agency'],
  ['weight_loss',      '🏃', 'Weight Loss'],
];

// Map niche → icon for quick lookup
const NICHE_ICON_MAP = Object.fromEntries(DISCOVER_NICHES.map(([v, icon]) => [v, icon]));

let discoverActiveNiche = '';
let discoverLiveResults = [];
let discoverSearchTimer = null;
let discoverCloneTabId = null;     // track the silent background tab for cancel
let discoverCurrentCloneSite = null; // {url, niche, name}
let discoverCurrentPage = 1;
const DISCOVER_PAGE_SIZE = 24;
let discoverImgObserver = null;    // IntersectionObserver for lazy mshots
let discoverSuggestTimer = null;   // debounce for typeahead dropdown
let discoverSuggestCache = new Map(); // query → suggestion array (session cache)

// ── Build screenshot URL using WordPress mshots (free, no key needed) ─────────
function buildScreenshotUrl(url) {
  return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=400`;
}

// ── Conversion elements derived from tags/highlights ─────────────────────────
const CONVERSION_ELEMENT_MAP = {
  'lead gen':     'Lead Form',
  'form':         'Lead Form',
  'quiz':         'Quiz Funnel',
  'booking':      'Online Booking',
  'guarantee':    'Guarantee',
  'video':        'Video Hero',
  'calculator':   'Calculator',
  'comparison':   'Comparison Table',
  'testimonials': 'Testimonials',
  'reviews':      'Star Reviews',
  'financing':    'Financing',
  'free':         'Free Offer',
  'urgent':       'Urgency CTA',
  'countdown':    'Countdown Timer',
  'chat':         'Live Chat',
  'appointment':  'Appointment CTA',
};

function deriveConversionElements(site) {
  const tags = [...(site.tags || []), ...(site.highlights || [])].map(t => t.toLowerCase());
  const found = [];
  for (const [key, label] of Object.entries(CONVERSION_ELEMENT_MAP)) {
    if (tags.some(t => t.includes(key)) && !found.includes(label)) {
      found.push(label);
    }
  }
  return found.slice(0, 3);
}

function setupDiscoverTab() {
  const pillsContainer = document.getElementById('discover-niche-pills');
  if (!pillsContainer) return;

  // ── Build niche pills ─────────────────────────────────────────────────────
  const allPill = document.createElement('button');
  allPill.className = 'discover-niche-pill active';
  allPill.innerHTML = '<span class="discover-niche-pill-icon">🌐</span> All';
  allPill.dataset.niche = '';
  pillsContainer.appendChild(allPill);

  DISCOVER_NICHES.forEach(([value, icon, label]) => {
    const btn = document.createElement('button');
    btn.className = 'discover-niche-pill';
    btn.innerHTML = `<span class="discover-niche-pill-icon">${icon}</span> ${label}`;
    btn.dataset.niche = value;
    pillsContainer.appendChild(btn);
  });

  pillsContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.discover-niche-pill');
    if (!pill) return;
    pillsContainer.querySelectorAll('.discover-niche-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    discoverActiveNiche = pill.dataset.niche;
    discoverLiveResults = [];
    discoverCurrentPage = 1;
    renderDiscoverGrid();
  });

  // ── Search input with debounce + typeahead suggestions ──────────────────
  const searchInput = document.getElementById('discover-search-input');
  searchInput?.addEventListener('input', () => {
    clearTimeout(discoverSearchTimer);
    discoverSearchTimer = setTimeout(() => {
      discoverCurrentPage = 1;
      renderDiscoverGrid();
    }, 300);
    // Typeahead suggestions (Google CSE) — only if user has keys
    clearTimeout(discoverSuggestTimer);
    discoverSuggestTimer = setTimeout(() => updateDiscoverSuggestions(searchInput.value.trim()), 350);
  });
  searchInput?.addEventListener('focus', () => updateDiscoverSuggestions(searchInput.value.trim()));
  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.discover-search-row') && !e.target.closest('#discover-suggest-dropdown')) {
      hideDiscoverSuggestions();
    }
  });

  // ── Live search button ────────────────────────────────────────────────────
  document.getElementById('btn-discover-live-search')?.addEventListener('click', () => {
    if (!settings.discoverApiKey || !settings.discoverCx) {
      const status = document.getElementById('discover-live-status');
      status.style.display = 'block';
      status.innerHTML = '🔑 Add a Google Custom Search API Key + Search Engine ID in <button class="btn-secondary" id="discover-goto-settings" style="font-size:11px;padding:4px 10px;">Settings</button> to enable live search.';
      document.getElementById('discover-goto-settings')?.addEventListener('click', () => switchTab('settings'));
      return;
    }
    const query = document.getElementById('discover-search-input')?.value?.trim() || discoverActiveNiche;
    liveSearchDiscover(discoverActiveNiche, query);
  });

  // ── Subtab switching (Featured vs My Sites) ─────────────────────────────
  document.querySelectorAll('.discover-subtab').forEach(btn => {
    btn.addEventListener('click', () => switchDiscoverSubtab(btn.dataset.subtab));
  });

  // ── My Sites: add/edit modal ────────────────────────────────────────────
  setupMySitesModal();

  // ── Render all on first load ──────────────────────────────────────────────
  renderDiscoverGrid();
  setupDiscoverGridClickHandler();
  setupCloneProgressModal();
  setupSitePreviewModal();
  setupDiscoverBackgroundMessageListener();
}

// ── My Sites (custom user-saved sites with CRUD) ───────────────────────────
let mySites = [];
let mySiteEditingId = null;

function switchDiscoverSubtab(subtab) {
  document.querySelectorAll('.discover-subtab').forEach(b => {
    const active = b.dataset.subtab === subtab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const featured = document.getElementById('discover-featured-panel');
  const mine = document.getElementById('discover-mysites-panel');
  if (subtab === 'mine') {
    featured.style.display = 'none';
    mine.style.display = 'block';
    loadMySites();
  } else {
    mine.style.display = 'none';
    featured.style.display = 'block';
  }
}

async function loadMySites() {
  const list = document.getElementById('mysites-list');
  const empty = document.getElementById('mysites-empty');
  const count = document.getElementById('mysites-count');
  if (!list) return;

  if (!settings.backendToken) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('.mysites-empty-title').textContent = 'Sign in to use My Sites';
    empty.querySelector('.mysites-empty-sub').textContent = 'My Sites syncs your saved websites across devices. Sign in from the My Account tab to enable it.';
    count.textContent = '';
    return;
  }

  list.innerHTML = '<div class="mysites-empty"><span class="spinner"></span> Loading…</div>';
  try {
    const res = await sendMsg({ action: 'BACKEND_SITES_LIST' });
    mySites = res?.sites || [];
    renderMySites();
  } catch (err) {
    list.innerHTML = `<div class="mysite-modal-error" style="display:block;">Failed to load: ${escHtml(err.message || String(err))}</div>`;
  }
}

function renderMySites() {
  const list = document.getElementById('mysites-list');
  const empty = document.getElementById('mysites-empty');
  const count = document.getElementById('mysites-count');
  if (!list) return;

  count.textContent = `${mySites.length} site${mySites.length !== 1 ? 's' : ''}`;

  if (!mySites.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('.mysites-empty-title').textContent = 'No saved sites yet';
    empty.querySelector('.mysites-empty-sub').textContent = "Add any website you want to clone. Sites stay synced across your devices when you're signed in.";
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = mySites.map(s => `
    <div class="mysite-row" data-id="${escHtml(s.id)}">
      <img class="mysite-favicon" src="https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(s.domain || '')}" alt="" onerror="this.style.visibility='hidden'">
      <div class="mysite-info">
        <div class="mysite-name">${escHtml(s.name || s.domain)}</div>
        <div class="mysite-meta">
          <span>${escHtml(s.domain || '')}</span>
          <span class="pill">${escHtml((s.niche || 'general').replace(/_/g, ' '))}</span>
          ${s.tags ? `<span>${escHtml(s.tags)}</span>` : ''}
        </div>
      </div>
      <div class="mysite-actions">
        <button class="mysite-btn mysite-btn-clone" data-act="clone">⚡ Clone</button>
        <button class="mysite-btn" data-act="edit">Edit</button>
        <button class="mysite-btn mysite-btn-danger" data-act="delete">Delete</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.mysite-row').forEach(row => {
    const id = row.dataset.id;
    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const site = mySites.find(s => s.id === id);
      if (!site) return;
      const act = btn.dataset.act;
      if (act === 'clone') {
        startSilentClone({ url: site.url, name: site.name, niche: site.niche }, btn);
      } else if (act === 'edit') {
        openMySiteModal(site);
      } else if (act === 'delete') {
        if (!confirm(`Delete "${site.name || site.domain}"?`)) return;
        btn.disabled = true;
        try {
          await sendMsg({ action: 'BACKEND_SITES_DELETE', id });
          mySites = mySites.filter(s => s.id !== id);
          renderMySites();
        } catch (err) {
          alert(`Delete failed: ${err.message || err}`);
          btn.disabled = false;
        }
      }
    });
  });
}

function setupMySitesModal() {
  document.getElementById('btn-mysite-add')?.addEventListener('click', () => openMySiteModal(null));
  document.getElementById('mysite-modal-close')?.addEventListener('click', closeMySiteModal);
  document.getElementById('mysite-modal-cancel')?.addEventListener('click', closeMySiteModal);
  document.getElementById('mysite-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'mysite-modal') closeMySiteModal();
  });
  document.getElementById('mysite-modal-save')?.addEventListener('click', saveMySite);
}

function openMySiteModal(site) {
  mySiteEditingId = site?.id || null;
  document.getElementById('mysite-modal-title').textContent = site ? 'Edit Site' : 'Add Site';
  document.getElementById('mysite-input-url').value = site?.url || '';
  document.getElementById('mysite-input-name').value = site?.name || '';
  document.getElementById('mysite-input-niche').value = site?.niche || 'general';
  document.getElementById('mysite-input-tags').value = site?.tags || '';
  document.getElementById('mysite-input-notes').value = site?.notes || '';
  document.getElementById('mysite-modal-error').style.display = 'none';
  document.getElementById('mysite-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('mysite-input-url')?.focus(), 50);
}

function closeMySiteModal() {
  document.getElementById('mysite-modal').style.display = 'none';
  mySiteEditingId = null;
}

async function saveMySite() {
  const url = document.getElementById('mysite-input-url').value.trim();
  const name = document.getElementById('mysite-input-name').value.trim();
  const niche = document.getElementById('mysite-input-niche').value;
  const tags = document.getElementById('mysite-input-tags').value.trim();
  const notes = document.getElementById('mysite-input-notes').value.trim();
  const errEl = document.getElementById('mysite-modal-error');
  errEl.style.display = 'none';

  if (!url) {
    errEl.textContent = 'URL is required';
    errEl.style.display = 'block';
    return;
  }

  const saveBtn = document.getElementById('mysite-modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    if (mySiteEditingId) {
      const res = await sendMsg({
        action: 'BACKEND_SITES_UPDATE',
        id: mySiteEditingId,
        patch: { url, name, niche, tags, notes },
      });
      const idx = mySites.findIndex(s => s.id === mySiteEditingId);
      if (idx >= 0 && res?.site) mySites[idx] = res.site;
    } else {
      const res = await sendMsg({
        action: 'BACKEND_SITES_CREATE',
        site: { url, name, niche, tags, notes },
      });
      if (res?.site) mySites.unshift(res.site);
    }
    renderMySites();
    closeMySiteModal();
  } catch (err) {
    errEl.textContent = err.message || String(err);
    errEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

// ── Render the discover grid with new premium cards ────────────────────────────
function renderDiscoverGrid() {
  const grid = document.getElementById('discover-grid');
  if (!grid) return;

  const query = (document.getElementById('discover-search-input')?.value || '').toLowerCase().trim();
  const niche = discoverActiveNiche;

  let results = nicheWebsites.filter(site => {
    if (niche && site.niche !== niche) return false;
    if (query) {
      return site.name.toLowerCase().includes(query)
        || site.domain.toLowerCase().includes(query)
        || (site.description || '').toLowerCase().includes(query);
    }
    return true;
  });

  const merged = [...results, ...discoverLiveResults.filter(lr =>
    !results.some(r => r.domain === lr.domain)
  )];

  // Update site count pill
  const countEl = document.getElementById('discover-site-count');
  const statsEl = document.getElementById('discover-stats');
  if (countEl && merged.length > 0) {
    countEl.textContent = `${merged.length} site${merged.length !== 1 ? 's' : ''}`;
    if (statsEl) statsEl.style.display = 'flex';
  } else if (statsEl) {
    statsEl.style.display = 'none';
  }

  grid.innerHTML = '';

  if (!niche && !query && merged.length === 0) {
    grid.innerHTML = `
      <div class="discover-empty" id="discover-empty">
        <div class="discover-empty-icon">🌐</div>
        <div class="discover-empty-title">Select a niche to browse websites</div>
        <div class="discover-empty-sub">Pick a category above to see curated high-converting sites you can clone into GHL</div>
        <div class="discover-niche-hint">
          <span>🏠 Roofing</span><span>⚡ Electrician</span><span>🔧 Plumbing</span><span>🌿 Landscaping</span><span>🦷 Dental</span>
        </div>
      </div>`;
    return;
  }

  if (merged.length === 0) {
    grid.innerHTML = `<div class="discover-empty">
      <div class="discover-empty-icon">🔍</div>
      <div class="discover-empty-title">No sites found</div>
      <div class="discover-empty-sub">Try a different search or niche, or click "Search Online" to find more.</div>
    </div>`;
    return;
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(merged.length / DISCOVER_PAGE_SIZE));
  if (discoverCurrentPage > totalPages) discoverCurrentPage = totalPages;
  if (discoverCurrentPage < 1) discoverCurrentPage = 1;
  const startIdx = (discoverCurrentPage - 1) * DISCOVER_PAGE_SIZE;
  const pageSlice = merged.slice(startIdx, startIdx + DISCOVER_PAGE_SIZE);

  // Init / reset image observer for this render pass
  if (discoverImgObserver) discoverImgObserver.disconnect();
  discoverImgObserver = new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const img = entry.target;
        const src = img.getAttribute('data-src');
        if (src) { img.src = src; img.removeAttribute('data-src'); }
        obs.unobserve(img);
      }
    }
  }, { rootMargin: '200px' });

  pageSlice.forEach(site => {
    const card = buildDiscoverCard(site, niche);
    grid.appendChild(card);
    const img = card.querySelector('img.discover-card-thumb-img[data-src]');
    if (img) discoverImgObserver.observe(img);
  });

  // Render pagination controls
  if (totalPages > 1) {
    const pager = document.createElement('div');
    pager.className = 'discover-pager';
    pager.innerHTML = `
      <button class="discover-pager-btn" data-page="prev" ${discoverCurrentPage === 1 ? 'disabled' : ''}>← Prev</button>
      <span class="discover-pager-info">Page ${discoverCurrentPage} of ${totalPages} · ${merged.length} sites</span>
      <button class="discover-pager-btn" data-page="next" ${discoverCurrentPage === totalPages ? 'disabled' : ''}>Next →</button>
    `;
    grid.appendChild(pager);
    pager.addEventListener('click', (e) => {
      const btn = e.target.closest('.discover-pager-btn');
      if (!btn || btn.disabled) return;
      discoverCurrentPage += (btn.dataset.page === 'next' ? 1 : -1);
      renderDiscoverGrid();
      grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function buildDiscoverCard(site, activeNiche) {
  const card = document.createElement('div');
  card.className = 'discover-card';
  card.dataset.niche = site.niche || activeNiche || '';

  const conversionEls = deriveConversionElements(site);
  const screenshotUrl = buildScreenshotUrl(site.url);
  const niche = site.niche || activeNiche || 'general';
  const nicheIcon = NICHE_ICON_MAP[niche] || '🌐';
  const nicheLabel = (DISCOVER_NICHES.find(n => n[0] === niche)?.[2] || niche).replace(/_/g, ' ');

  const highlights = (site.highlights || [])
    .map(h => `<span class="discover-highlight-chip">${escHtml(h)}</span>`).join('');
  const convChips = conversionEls
    .map(el => `<span class="discover-conversion-chip">✓ ${escHtml(el)}</span>`).join('');

  card.innerHTML = `
    <div class="discover-card-thumb">
      <div class="discover-card-thumb-bg">
        <div class="discover-card-thumb-placeholder">
          <div class="discover-card-niche-icon">${nicheIcon}</div>
          <div class="discover-card-thumb-domain">${escHtml(site.domain)}</div>
        </div>
        <img class="discover-card-thumb-img" data-src="${screenshotUrl}"
             alt="${escHtml(site.name)} preview"
             loading="lazy"
             onerror="this.style.display='none'">
      </div>
      <div class="discover-card-badges">
        <span class="discover-niche-badge">${escHtml(nicheLabel)}</span>
        ${site.isLive ? '<span class="discover-live-badge">Live</span>' : ''}
      </div>
    </div>
    <div class="discover-card-body">
      <div class="discover-card-header-row">
        <span class="discover-card-domain">🌐 ${escHtml(site.domain)}</span>
      </div>
      <div class="discover-card-name">${escHtml(site.name)}</div>
      <div class="discover-card-desc">${escHtml(site.description)}</div>
      ${conversionEls.length ? `<div class="discover-conversion-chips">${convChips}</div>` : ''}
      ${highlights ? `<div class="discover-highlights">${highlights}</div>` : ''}
      <div class="discover-card-actions">
        <button class="btn-preview-site" data-preview-url="${escHtml(site.url)}" data-preview-name="${escHtml(site.name)}" title="Preview site">👁 Preview</button>
        <button class="btn-clone-site" data-clone-url="${escHtml(site.url)}" data-clone-niche="${escHtml(niche)}" data-clone-name="${escHtml(site.name)}">⚡ Clone to GHL</button>
      </div>
    </div>`;

  return card;
}

// ── Grid click delegation ──────────────────────────────────────────────────────
function setupDiscoverGridClickHandler() {
  const grid = document.getElementById('discover-grid');
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    // Preview button
    const previewBtn = e.target.closest('.btn-preview-site');
    if (previewBtn) {
      openSitePreviewModal({
        url: previewBtn.dataset.previewUrl,
        name: previewBtn.dataset.previewName,
      });
      return;
    }

    // Clone button
    const cloneBtn = e.target.closest('.btn-clone-site');
    if (cloneBtn) {
      const site = {
        url: cloneBtn.dataset.cloneUrl,
        niche: cloneBtn.dataset.cloneNiche,
        name: cloneBtn.dataset.cloneName,
      };
      startSilentClone(site, cloneBtn);
    }
  });
}

// ── Clone Progress Modal ──────────────────────────────────────────────────────
let cppCurrentFunnelId = null;

function setupCloneProgressModal() {
  document.getElementById('cpp-cancel')?.addEventListener('click', () => {
    closeCloneProgressModal();
  });

  document.getElementById('cpp-error-close')?.addEventListener('click', () => {
    closeCloneProgressModal();
  });

  document.getElementById('cpp-view-funnel')?.addEventListener('click', () => {
    closeCloneProgressModal();
    switchTab('funnels');
  });

  document.getElementById('cpp-push-ghl')?.addEventListener('click', async () => {
    closeCloneProgressModal();
    if (cppCurrentFunnelId) {
      const funnel = myFunnels.find(f => f.id === cppCurrentFunnelId);
      if (funnel) {
        switchTab('funnels');
        setTimeout(() => {
          const btn = document.querySelector(`[data-id="${cppCurrentFunnelId}"].btn-push`);
          if (btn) pushFunnelToGHL(cppCurrentFunnelId, btn);
        }, 300);
      }
    }
  });

  // Close on overlay click
  document.getElementById('clone-progress-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'clone-progress-modal') closeCloneProgressModal();
  });
}

function openCloneProgressModal(site) {
  const modal = document.getElementById('clone-progress-modal');
  if (!modal) return;

  // Reset state
  document.getElementById('cpp-url').textContent = site.url;
  document.getElementById('cpp-progress-fill').style.width = '0%';
  document.getElementById('cpp-progress-label').textContent = 'Starting…';
  document.getElementById('cpp-success').style.display = 'none';
  document.getElementById('cpp-error').style.display = 'none';
  document.getElementById('cpp-steps').style.display = 'flex';
  document.getElementById('cpp-progress-track').style.display = 'block';
  document.getElementById('cpp-cancel').style.display = 'flex';
  cppCurrentFunnelId = null;

  // Reset steps
  for (let i = 1; i <= 7; i++) {
    const step = document.getElementById(`cpp-step-${i}`);
    if (step) { step.classList.remove('active', 'done'); }
  }

  modal.style.display = 'flex';
  discoverCurrentCloneSite = site;
}

function closeCloneProgressModal() {
  const modal = document.getElementById('clone-progress-modal');
  if (modal) modal.style.display = 'none';
  discoverCurrentCloneSite = null;
}

function updateCloneProgress(step, total, msg) {
  const pct = Math.round((step / total) * 100);
  document.getElementById('cpp-progress-fill').style.width = `${pct}%`;
  document.getElementById('cpp-progress-label').textContent = msg;

  for (let i = 1; i <= total; i++) {
    const el = document.getElementById(`cpp-step-${i}`);
    if (!el) continue;
    el.classList.remove('active', 'done');
    if (i < step) el.classList.add('done');
    else if (i === step) el.classList.add('active');
  }
}

function showCloneSuccess(funnelId, siteName, opts = {}) {
  const { pushed = false, pushSkipped = false, pushError = null } = opts;
  cppCurrentFunnelId = funnelId;
  document.getElementById('cpp-steps').style.display = 'none';
  document.getElementById('cpp-progress-track').style.display = 'none';
  document.getElementById('cpp-progress-label').style.display = 'none';
  document.getElementById('cpp-cancel').style.display = 'none';

  let msg;
  if (pushed) {
    msg = `"${siteName}" cloned and pushed to your GHL account.`;
  } else if (pushSkipped) {
    msg = `"${siteName}" saved to My Funnels. Add your GHL API key + Location ID in Settings, then click "Push to GHL" from My Funnels.`;
  } else if (pushError) {
    msg = `"${siteName}" saved to My Funnels. GHL push failed: ${pushError}. You can retry from My Funnels.`;
  } else {
    msg = `"${siteName}" saved to My Funnels`;
  }
  document.getElementById('cpp-success-sub').textContent = msg;
  document.getElementById('cpp-success').style.display = 'block';
}

function showCloneError(errMsg) {
  document.getElementById('cpp-steps').style.display = 'none';
  document.getElementById('cpp-progress-track').style.display = 'none';
  document.getElementById('cpp-cancel').style.display = 'none';
  document.getElementById('cpp-error-msg').textContent = errMsg;
  document.getElementById('cpp-error').style.display = 'block';
}

// ── Site Preview Modal ────────────────────────────────────────────────────────
let previewCurrentSite = null;

function setupSitePreviewModal() {
  document.getElementById('spp-close')?.addEventListener('click', closeSitePreviewModal);
  document.getElementById('site-preview-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'site-preview-modal') closeSitePreviewModal();
  });

  document.getElementById('spp-open-btn')?.addEventListener('click', () => {
    if (previewCurrentSite?.url) chrome.tabs.create({ url: previewCurrentSite.url });
  });

  document.getElementById('spp-clone-btn')?.addEventListener('click', () => {
    if (previewCurrentSite) {
      closeSitePreviewModal();
      startSilentClone(previewCurrentSite, null);
    }
  });

  document.getElementById('spp-iframe')?.addEventListener('load', () => {
    document.getElementById('spp-loading').style.opacity = '0';
    setTimeout(() => {
      const loading = document.getElementById('spp-loading');
      if (loading) loading.style.display = 'none';
    }, 300);
  });
}

function openSitePreviewModal(site) {
  previewCurrentSite = site;
  const modal = document.getElementById('site-preview-modal');
  if (!modal) return;

  document.getElementById('spp-title').textContent = site.name || site.url;
  document.getElementById('spp-url').textContent = site.url;
  document.getElementById('spp-loading').style.display = 'flex';
  document.getElementById('spp-loading').style.opacity = '1';

  const iframe = document.getElementById('spp-iframe');
  iframe.src = site.url;

  modal.style.display = 'flex';
}

function closeSitePreviewModal() {
  document.getElementById('site-preview-modal').style.display = 'none';
  const iframe = document.getElementById('spp-iframe');
  if (iframe) iframe.src = '';
  previewCurrentSite = null;
}

// ── Silent One-Click Clone ────────────────────────────────────────────────────
async function startSilentClone(site, btnEl) {
  // Disable the card button during clone
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="spinner"></span>';
  }

  openCloneProgressModal(site);
  updateCloneProgress(1, 5, 'Opening website…');

  try {
    const result = await sendMsg({
      action: 'CLONE_FROM_URL_SILENT',
      url: site.url,
      niche: site.niche,
      optimize: Boolean(settings.backendToken),
    });

    if (result?.error) throw new Error(result.error);

    // Refresh funnels list
    const fr = await sendMsg({ action: 'GET_FUNNELS' });
    myFunnels = fr?.funnels || [];
    renderFunnels();
    updateFunnelSelects();

    showCloneSuccess(result?.funnel?.id, site.name || site.url, {
      pushed: Boolean(result?.ghlFunnelId),
      pushSkipped: Boolean(result?.pushSkipped),
      pushError: result?.pushError || null,
    });
  } catch (err) {
    showCloneError(err.message || 'Clone failed. Please try again.');
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = '⚡ Clone to GHL';
    }
  }
}

// ── Listen for progress broadcasts from background.js ────────────────────────
function setupDiscoverBackgroundMessageListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'DISCOVER_CLONE_PROGRESS') {
      updateCloneProgress(msg.step, msg.total, msg.message);
    }
    if (msg.action === 'DISCOVER_CLONE_COMPLETE') {
      // Handled by the sendMsg resolution above; this is a belt-and-suspenders fallback
    }
  });
}

// ── Typeahead dropdown for Discover search ────────────────────────────────
function classifyQuery(raw) {
  const q = (raw || '').trim();
  if (!q) return { type: 'empty', query: '', domain: '' };
  // Full URL
  try {
    const u = new URL(q.startsWith('http') ? q : `https://${q}`);
    if (u.hostname && u.hostname.includes('.')) {
      // If the user typed a full URL with path, search site-restricted
      if (u.pathname && u.pathname !== '/') return { type: 'url', query: q, domain: u.hostname };
      return { type: 'domain', query: q, domain: u.hostname };
    }
  } catch { /* not a URL */ }
  // Bare domain (foo.com / sub.foo.com)
  if (/^[\w-]+(\.[\w-]+)+$/.test(q)) return { type: 'domain', query: q, domain: q };
  return { type: 'keyword', query: q, domain: '' };
}

function buildCseQuery(classified, niche) {
  const { type, query, domain } = classified;
  if (type === 'url') return `site:${domain}`;
  if (type === 'domain') return `site:${domain}`;
  // keyword: bias by active niche when present
  return niche ? `${query} ${niche.replace(/_/g, ' ')} business website` : `${query} business website`;
}

function hideDiscoverSuggestions() {
  const dd = document.getElementById('discover-suggest-dropdown');
  if (dd) { dd.classList.remove('open'); dd.innerHTML = ''; }
}

function renderDiscoverSuggestions(items) {
  const dd = document.getElementById('discover-suggest-dropdown');
  if (!dd) return;
  if (!items || !items.length) {
    dd.innerHTML = `<div class="discover-suggest-empty">No matches. Try a different keyword.</div>`;
    dd.classList.add('open');
    return;
  }
  dd.innerHTML = items.map(it => `
    <div class="discover-suggest-item" data-url="${escHtml(it.url)}" data-name="${escHtml(it.title)}" data-niche="${escHtml(it.niche || discoverActiveNiche || 'general')}">
      <img class="discover-suggest-favicon" src="https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(it.domain)}" alt="" onerror="this.style.visibility='hidden'">
      <div class="discover-suggest-body">
        <div class="discover-suggest-title">${escHtml(it.title)}</div>
        <div class="discover-suggest-domain">${escHtml(it.domain)}</div>
      </div>
      <button class="discover-suggest-clone" data-action="clone">⚡ Clone</button>
    </div>
  `).join('');
  dd.classList.add('open');

  // Wire row clicks
  dd.querySelectorAll('.discover-suggest-item').forEach(row => {
    row.addEventListener('click', (e) => {
      const cloneBtn = e.target.closest('[data-action="clone"]');
      const site = { url: row.dataset.url, name: row.dataset.name, niche: row.dataset.niche };
      hideDiscoverSuggestions();
      if (cloneBtn) {
        startSilentClone(site, null);
      } else {
        // Open preview modal instead
        previewCurrentSite = site;
        const modal = document.getElementById('site-preview-modal');
        const iframe = document.getElementById('spp-iframe');
        const title = document.getElementById('spp-title');
        if (title) title.textContent = site.name;
        if (iframe) iframe.src = site.url;
        if (modal) modal.style.display = 'flex';
      }
    });
  });
}

async function updateDiscoverSuggestions(rawQuery) {
  const classified = classifyQuery(rawQuery);
  if (classified.type === 'empty') return hideDiscoverSuggestions();
  if (!settings.discoverApiKey || !settings.discoverCx) return hideDiscoverSuggestions();

  const cseQ = buildCseQuery(classified, discoverActiveNiche);
  const cacheKey = `${discoverActiveNiche}::${cseQ}`;
  if (discoverSuggestCache.has(cacheKey)) {
    renderDiscoverSuggestions(discoverSuggestCache.get(cacheKey));
    return;
  }
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${settings.discoverApiKey}&cx=${settings.discoverCx}&q=${encodeURIComponent(cseQ)}&num=6`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!resp.ok || data.error) {
      renderDiscoverSuggestions([]);
      return;
    }
    const items = (data.items || []).map(item => ({
      title: item.title || item.link,
      url: item.link,
      domain: (() => { try { return new URL(item.link).hostname.replace(/^www\./, ''); } catch { return item.link; } })(),
      niche: discoverActiveNiche || 'general',
    }));
    discoverSuggestCache.set(cacheKey, items);
    renderDiscoverSuggestions(items);
  } catch {
    hideDiscoverSuggestions();
  }
}

async function liveSearchDiscover(niche, query) {
  const status = document.getElementById('discover-live-status');
  status.style.display = 'block';
  status.textContent = 'Searching online…';

  const classified = classifyQuery(query || niche);
  const cseQ = buildCseQuery(classified, niche);
  const url = `https://www.googleapis.com/customsearch/v1?key=${settings.discoverApiKey}&cx=${settings.discoverCx}&q=${encodeURIComponent(cseQ)}&num=8`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error?.message || 'Search failed');

    discoverLiveResults = (data.items || []).map(item => ({
      id: `live-${item.link}`,
      niche: niche || 'general',
      name: item.title,
      url: item.link,
      domain: (() => { try { return new URL(item.link).hostname.replace('www.', ''); } catch { return item.link; } })(),
      description: item.snippet || '',
      highlights: [],
      tags: [],
      isLive: true,
    }));

    status.textContent = `Found ${discoverLiveResults.length} live results`;
    renderDiscoverGrid();
  } catch (err) {
    status.textContent = `Search error: ${err.message}`;
  }
}




// ─── AI Tools Tab ─────────────────────────────────────────────────────────────
function setupAiToolsTab() {
  updateFunnelSelects();

  // AI Optimize
  document.getElementById('btn-ai-optimize')?.addEventListener('click', async () => {
    const funnelId = document.getElementById('ai-opt-funnel-select').value;
    const niche = document.getElementById('ai-opt-niche').value;
    const businessName = document.getElementById('ai-opt-business').value.trim();
    const statusEl = document.getElementById('ai-opt-status');

    if (!funnelId) return setToolStatus(statusEl, 'Please select a funnel first.', 'error');
    if (!settings.backendToken) return setToolStatus(statusEl, 'Please sign in to your Clone2GHL account to use AI features.', 'error');

    setToolStatus(statusEl, '<span class="spinner"></span> Optimizing copy with GPT-4o…', 'loading');
    document.getElementById('btn-ai-optimize').disabled = true;

    const result = await sendMsg({
      action: 'OPTIMIZE_FUNNEL',
      data: { funnelId, niche: niche || undefined, businessName: businessName || undefined },
    });

    document.getElementById('btn-ai-optimize').disabled = false;

    if (result?.success) {
      setToolStatus(statusEl, '✓ Copy optimized! View in My Funnels.', 'success');
      const fr = await sendMsg({ action: 'GET_FUNNELS' });
      myFunnels = fr?.funnels || [];
      renderFunnels();
    } else {
      setToolStatus(statusEl, `Error: ${result?.error || 'Unknown error'}`, 'error');
    }
  });

  // Funnel Intelligence
  document.getElementById('btn-intel-analyze')?.addEventListener('click', async () => {
    const funnelId = document.getElementById('intel-funnel-select').value;
    const statusEl = document.getElementById('intel-status');
    const reportEl = document.getElementById('intel-report');

    if (!funnelId) return setToolStatus(statusEl, 'Please select a funnel.', 'error');

    const funnel = myFunnels.find(f => f.id === funnelId);
    if (!funnel) return setToolStatus(statusEl, 'Funnel not found.', 'error');

    if (funnel.analysis) {
      reportEl.textContent = buildTextReport(funnel.analysis);
      reportEl.style.display = 'block';
      setToolStatus(statusEl, `Score: ${funnel.analysis.score}/100 (${funnel.analysis.grade}) — ${funnel.analysis.detectedNiche}`, 'success');
      return;
    }

    setToolStatus(statusEl, '<span class="spinner"></span> Analyzing…', 'loading');
    document.getElementById('btn-intel-analyze').disabled = true;

    // Re-analyze from the funnel HTML structure (simplified, structure not stored separately)
    setToolStatus(statusEl, 'Analysis data not available for this funnel. Clone a fresh page for full intelligence.', 'info');
    document.getElementById('btn-intel-analyze').disabled = false;
  });

  // Headline Generator
  document.getElementById('btn-gen-headlines')?.addEventListener('click', async () => {
    const niche = document.getElementById('headline-niche').value;
    const offer = document.getElementById('headline-offer').value.trim();
    const listEl = document.getElementById('headlines-list');

    if (!settings.backendToken) {
      alert('Please sign in to your Clone2GHL account to use AI features.');
      return;
    }

    document.getElementById('btn-gen-headlines').innerHTML = '<span class="spinner"></span> Generating…';
    document.getElementById('btn-gen-headlines').disabled = true;

    const result = await sendMsg({ action: 'GENERATE_HEADLINES', niche, offer: offer || `${niche} service` });

    document.getElementById('btn-gen-headlines').textContent = '✨ Generate Headlines';
    document.getElementById('btn-gen-headlines').disabled = false;

    if (result?.success && result.headlines?.length) {
      listEl.style.display = 'flex';
      listEl.innerHTML = result.headlines.map(h => `
        <div class="headline-item">
          <span>${escHtml(h)}</span>
          <button class="btn-copy-headline" title="Copy" onclick="copyText(this, '${h.replace(/'/g, "\\'")}')">📋</button>
        </div>
      `).join('');
    } else {
      alert(result?.error || 'Failed to generate headlines');
    }
  });

  // AI Video Generator
  document.getElementById('btn-ai-video-generate')?.addEventListener('click', async () => {
    const prompt = document.getElementById('ai-video-prompt')?.value?.trim() || '';
    const durationSec = Number(document.getElementById('ai-video-duration')?.value || 16);
    const size = document.getElementById('ai-video-size')?.value || '1920x1080';
    const statusEl = document.getElementById('ai-video-status');
    const btn = document.getElementById('btn-ai-video-generate');

    if (!prompt) {
      setToolStatus(statusEl, 'Please enter a video prompt first.', 'error');
      return;
    }

    if (!requireBackendAuth(statusEl)) return;

    const providerStatus = await sendMsg({ action: 'BACKEND_VIDEO_PROVIDER_STATUS' });
    if (!providerStatus?.success || !providerStatus?.videoGeneration?.available) {
      setToolStatus(statusEl, 'OpenAI video generation is not configured on the backend. Add OPENAI_API_KEY first.', 'error');
      return;
    }

    const originalHtml = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating…';
    }

    setToolStatus(statusEl, `<span class="spinner"></span> Queuing Sora ${providerStatus.videoGeneration?.model || 'video'}…`, 'loading');

    const result = await sendMsg({
      action: 'BACKEND_VIDEO_GENERATE',
      prompt,
      script: prompt,
      provider: 'openai',
      template: 'openai_prompt',
      seconds: durationSec,
      size,
      model: providerStatus.videoGeneration?.model || 'sora-2-pro',
    });

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '🎬 Generate Video';
    }

    if (!result?.success || !result.job?.id) {
      setToolStatus(statusEl, `Error: ${result?.error || 'Unable to create video job'}`, 'error');
      return;
    }

    const model = result.job.videoModel || providerStatus.videoGeneration?.model || 'sora-2-pro';
    setToolStatus(statusEl, `✓ Job queued: ${result.job.id} using ${model}. Track it in Video Generation.`, 'success');
    await loadVideoJobs(false);
  });
}

function updateFunnelSelects() {
  const selects = ['ai-opt-funnel-select', 'intel-funnel-select'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Select a funnel…</option>' +
      myFunnels.map(f => `<option value="${f.id}">${escHtml(f.name || 'Untitled')}</option>`).join('');
  });

  updateVideoFunnelSelect();
}

function buildTextReport(a) {
  const lines = [
    `FUNNEL INTELLIGENCE REPORT`,
    `Score: ${a.score}/100 (${a.grade}) | Niche: ${a.detectedNiche}`,
    '',
    a.summary,
    '',
    'HEADLINE TYPES:',
    ...(a.headlineTypes || []).map(h => `  • ${h.type}: "${h.text}"`),
    '',
    'URGENCY ELEMENTS:',
    ...(a.urgencyElements?.length ? a.urgencyElements.map(u => `  • ${u}`) : ['  None detected']),
    '',
    'TRUST SIGNALS:',
    ...(a.trustSignals?.length ? a.trustSignals.map(t => `  ✓ ${t.label}`) : ['  None detected']),
    '',
    'RECOMMENDATIONS:',
    ...(a.recommendations || []).map(r => `  [${r.priority.toUpperCase()}] ${r.action}`),
  ];
  return lines.join('\n');
}

// ─── Video Generation Tab ────────────────────────────────────────────────────
function setupVideoGenTab() {
  updateVideoFunnelSelect();

  document.getElementById('video-provider')?.addEventListener('change', async () => {
    updateVideoDemoBanner();
    await refreshVideoProviderHints();
  });

  document.getElementById('btn-video-apply-script')?.addEventListener('click', () => {
    if (!lastVideoScriptSuggestion?.script) return;
    const scriptEl = document.getElementById('video-script');
    if (scriptEl) scriptEl.value = lastVideoScriptSuggestion.script;
    setToolStatus(document.getElementById('video-status'), '✓ Script inserted. You can now generate the video.', 'success');
  });

  document.getElementById('btn-video-script')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('video-status');
    if (!requireBackendAuth(statusEl)) return;

    const niche = document.getElementById('video-script-niche')?.value?.trim() || 'general';
    const offer = document.getElementById('video-script-offer')?.value?.trim() || '';
    const tone = document.getElementById('video-script-tone')?.value || 'professional';
    const durationSec = Number(document.getElementById('video-script-duration')?.value || 30);
    const cta = document.getElementById('video-script-cta')?.value?.trim() || 'Book now';
    const btn = document.getElementById('btn-video-script');

    const originalHtml = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating…';
    }

    setToolStatus(statusEl, '<span class="spinner"></span> Generating script…', 'loading');
    const result = await sendMsg({
      action: 'BACKEND_VIDEO_SCRIPT',
      niche,
      offer,
      tone,
      durationSec,
      cta,
    });

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '✨ Generate Script';
    }

    if (!result?.success || !result.script) {
      setToolStatus(statusEl, `Error: ${result?.error || 'Unable to generate script'}`, 'error');
      return;
    }

    lastVideoScriptSuggestion = {
      script: result.script,
      hook: result.hook || '',
      ctaLine: result.ctaLine || '',
      sceneHints: Array.isArray(result.sceneHints) ? result.sceneHints : [],
      model: result.model || 'model',
    };
    renderVideoScriptPreview(lastVideoScriptSuggestion);
    setToolStatus(statusEl, `✓ Script preview ready (${result.model || 'model'}). Click "Use This Script" to apply.`, 'success');
  });

  document.getElementById('btn-video-refresh')?.addEventListener('click', async () => {
    await loadVideoJobs(true);
  });

  document.getElementById('btn-video-generate')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('video-status');
    if (!requireBackendAuth(statusEl)) return;

    const script = document.getElementById('video-script')?.value?.trim() || '';
    const funnelId = document.getElementById('video-funnel-select')?.value || '';
    const avatar = document.getElementById('video-avatar')?.value || 'default';
    const voice = document.getElementById('video-voice')?.value || 'default';
    const template = document.getElementById('video-template')?.value || 'short_promo';
    const provider = document.getElementById('video-provider')?.value || 'mock';
    const seconds = Number(document.getElementById('video-script-duration')?.value || 30);
    const btn = document.getElementById('btn-video-generate');
    let providerStatus = null;

    if (provider === 'heygen') {
      providerStatus = await sendMsg({ action: 'BACKEND_VIDEO_PROVIDER_STATUS' });
      if (!providerStatus?.success || !providerStatus?.providers?.heygen?.available) {
        setToolStatus(statusEl, 'HeyGen provider is not configured on backend. Add HEYGEN_API_KEY or switch provider to Mock.', 'error');
        return;
      }
    } else if (provider === 'openai') {
      providerStatus = await sendMsg({ action: 'BACKEND_VIDEO_PROVIDER_STATUS' });
      if (!providerStatus?.success || !providerStatus?.videoGeneration?.available) {
        setToolStatus(statusEl, 'OpenAI video generation is not configured on backend. Add OPENAI_API_KEY or switch provider.', 'error');
        return;
      }
    }

    if (!script) {
      setToolStatus(statusEl, provider === 'openai' ? 'Please enter a video prompt first.' : 'Please enter a video script first.', 'error');
      return;
    }

    const originalHtml = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Queuing video…';
    }
    setToolStatus(statusEl, '<span class="spinner"></span> Submitting video job…', 'loading');

    const result = await sendMsg({
      action: 'BACKEND_VIDEO_GENERATE',
      script,
      prompt: script,
      funnelId,
      avatar,
      voice,
      template,
      provider,
      seconds,
      model: provider === 'openai' ? (providerStatus?.videoGeneration?.model || 'sora-2-pro') : undefined,
    });

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '🎬 Generate Video';
    }

    if (!result?.success || !result.job?.id) {
      setToolStatus(statusEl, `Error: ${result?.error || 'Unable to create video job'}`, 'error');
      return;
    }

    const model = result.job.videoModel || (provider === 'openai' ? 'sora-2-pro' : 'provider');
    setToolStatus(statusEl, `✓ Job queued: ${result.job.id}${provider === 'openai' ? ` using ${model}.` : '.'}`, 'success');
    await loadVideoJobs(false);
    startVideoPolling(result.job.id, result.job.provider);
  });

  document.getElementById('btn-video-attach-funnel')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('video-attach-status');
    const funnelId = document.getElementById('video-attach-funnel-select')?.value;
    const wrap = document.getElementById('video-preview-wrap');
    const jobId = wrap?.dataset.currentJobId || '';
    const videoUrl = document.getElementById('video-preview-player')?.src || '';

    if (!funnelId) {
      setToolStatus(statusEl, '⚠ Select a funnel to attach the video to.', 'error');
      return;
    }
    if (!videoUrl) {
      setToolStatus(statusEl, '⚠ No video loaded in player.', 'error');
      return;
    }

    const funnel = myFunnels.find(f => f.id === funnelId);
    if (!funnel) {
      setToolStatus(statusEl, '⚠ Funnel not found.', 'error');
      return;
    }

    setToolStatus(statusEl, '<span class="spinner"></span> Attaching…', 'loading');
    const result = await sendMsg({
      action: 'SAVE_FUNNEL',
      data: { ...funnel, videoUrl, videoJobId: jobId },
    });

    if (!result?.success) {
      setToolStatus(statusEl, `✗ ${result?.error || 'Unable to attach video'}`, 'error');
      return;
    }

    const idx = myFunnels.findIndex(f => f.id === funnelId);
    if (idx >= 0) myFunnels[idx] = { ...myFunnels[idx], videoUrl, videoJobId: jobId };

    setToolStatus(statusEl, `✓ Video attached to "${escHtml(funnel.name || 'funnel')}".`, 'success');
    showSaveToast('Video attached to funnel.');
  });

  updateVideoDemoBanner();
  refreshVideoProviderHints();
  loadVideoJobs(false);
}

function renderVideoScriptPreview(suggestion) {
  const wrap = document.getElementById('video-script-preview');
  const body = document.getElementById('video-script-preview-body');
  const meta = document.getElementById('video-script-preview-meta');
  if (!wrap || !body || !meta) return;

  wrap.style.display = 'block';
  body.textContent = suggestion.script || '';

  const hintLines = [];
  if (suggestion.hook) hintLines.push(`Hook: ${suggestion.hook}`);
  if (suggestion.ctaLine) hintLines.push(`CTA: ${suggestion.ctaLine}`);
  if (suggestion.sceneHints?.length) hintLines.push(`Scenes: ${suggestion.sceneHints.join(' | ')}`);
  hintLines.push(`Model: ${suggestion.model || 'n/a'}`);
  meta.textContent = hintLines.join(' · ');
}

function updateVideoDemoBanner() {
  const provider = document.getElementById('video-provider')?.value || 'mock';
  const banner = document.getElementById('video-demo-banner');
  if (banner) banner.style.display = provider === 'mock' ? 'block' : 'none';
}

async function refreshVideoProviderHints() {
  const provider = document.getElementById('video-provider')?.value || 'mock';
  const badge = document.getElementById('video-provider-status');

  updateVideoDemoBanner();

  if (provider === 'mock') {
    if (badge) {
      setToolStatus(badge, '✅ Mock / Demo Mode — no external API needed. Jobs complete in ~3s.', 'success');
      badge.style.display = 'block';
    }
    return;
  }

  if (!badge) return;
  if (!settings.backendToken) {
    badge.style.display = 'none';
    return;
  }

  const result = await sendMsg({ action: 'BACKEND_VIDEO_PROVIDER_STATUS' });
  if (!result?.success) {
    badge.style.display = 'none';
    return;
  }

  const heygenOk = Boolean(result.providers?.heygen?.available);
  const openaiOk = Boolean(result.videoGeneration?.available);
  const scriptOk = Boolean(result.scriptGeneration?.available);
  if (provider === 'heygen' && !heygenOk) {
    setToolStatus(badge, 'HeyGen is not configured on backend. Add HEYGEN_API_KEY or use Mock provider.', 'error');
    return;
  }

  if (provider === 'openai' && !openaiOk) {
    setToolStatus(badge, 'OpenAI video generation is not configured on backend. Add OPENAI_API_KEY or use Mock provider.', 'error');
    return;
  }

  if (!scriptOk) {
    setToolStatus(badge, 'Script generation is unavailable until OPENAI_API_KEY is configured on backend.', 'info');
    return;
  }

  if (provider === 'openai') {
    setToolStatus(badge, `Provider check OK. Video model: ${result.videoGeneration?.model || 'sora-2-pro'} (${result.videoGeneration?.size || '1920x1080'}, ${result.videoGeneration?.seconds || 16}s).`, 'success');
    return;
  }

  setToolStatus(badge, `Provider check OK. Script model: ${result.scriptGeneration?.model || 'n/a'}.`, 'success');
}

function updateVideoFunnelSelect() {
  const select = document.getElementById('video-funnel-select');
  if (!select) return;

  select.innerHTML = '<option value="">No linked funnel (optional)</option>' +
    myFunnels.map(f => `<option value="${f.id}">${escHtml(f.name || 'Untitled')}</option>`).join('');
}

function renderVideoJobs(jobs) {
  const body = document.getElementById('video-jobs-body');
  if (!body) return;

  if (!jobs.length) {
    body.innerHTML = '<tr><td colspan="5" class="activity-empty">No video jobs yet.</td></tr>';
    return;
  }

  body.innerHTML = jobs.map((job) => {
    const videoUrl = job.previewUrl || job.videoUrl || '';
    return `
    <tr>
      <td>${escHtml(formatActivityTime(job.createdAt))}</td>
      <td style="font-size:11px; word-break:break-all;">${escHtml(job.id)}</td>
      <td>${escHtml((job.status || '-').toUpperCase())} (${Number(job.progress || 0)}%)${job.videoModel ? `<br><span style="font-size:10px; opacity:.7;">${escHtml(job.videoModel)}</span>` : ''}</td>
      <td>${videoUrl
          ? `<button class="btn-secondary btn-video-play" data-url="${escHtml(videoUrl)}" data-job-id="${escHtml(job.id)}" style="font-size:11px; padding:4px 10px;">▶ Play</button>`
          : '-'}</td>
      <td>
        ${job.status === 'queued' || job.status === 'processing'
          ? `<button class="btn-danger btn-video-cancel" data-job-id="${escHtml(job.id)}">Cancel</button>`
          : '-'}
      </td>
    </tr>
  `}).join('');

  body.querySelectorAll('.btn-video-cancel').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const jobId = btn.dataset.jobId;
      const statusEl = document.getElementById('video-status');
      if (!jobId) return;

      btn.disabled = true;
      btn.textContent = 'Cancelling…';

      const result = await sendMsg({ action: 'BACKEND_VIDEO_CANCEL_JOB', jobId });
      if (!result?.success) {
        setToolStatus(statusEl, `Error: ${result?.error || 'Unable to cancel job'}`, 'error');
      } else {
        setToolStatus(statusEl, `✓ Job ${jobId} cancelled.`, 'success');
      }

      await loadVideoJobs(false);
    });
  });

  body.querySelectorAll('.btn-video-play').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      const jobId = btn.dataset.jobId;
      const player = document.getElementById('video-preview-player');
      const wrap = document.getElementById('video-preview-wrap');
      const attachSelect = document.getElementById('video-attach-funnel-select');

      if (!player || !wrap || !url) return;

      player.src = url;
      player.load();
      wrap.style.display = 'block';
      wrap.dataset.currentJobId = jobId || '';
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      if (attachSelect) {
        attachSelect.innerHTML = '<option value="">Attach to funnel…</option>' +
          myFunnels.map(f => `<option value="${f.id}">${escHtml(f.name || 'Untitled')}</option>`).join('');
      }
    });
  });
}

async function loadVideoJobs(showStatus = true) {
  const statusEl = document.getElementById('video-status');
  if (!statusEl) return;
  if (!requireBackendAuth(statusEl)) return;

  if (showStatus) setToolStatus(statusEl, '<span class="spinner"></span> Loading video jobs…', 'loading');
  const result = await sendMsg({ action: 'BACKEND_VIDEO_LIST_JOBS', limit: 20 });
  if (!result?.success) {
    setToolStatus(statusEl, `Error: ${result?.error || 'Unable to load video jobs'}`, 'error');
    return;
  }

  const jobs = result.jobs || [];
  renderVideoJobs(jobs);

  const active = jobs.find(job => job.status === 'queued' || job.status === 'processing');
  if (active) {
    startVideoPolling(active.id, active.provider);
  } else if (videoPollTimer) {
    clearInterval(videoPollTimer);
    videoPollTimer = null;
  }

  if (showStatus) setToolStatus(statusEl, `✓ Loaded ${jobs.length} video job(s).`, 'success');
}

function startVideoPolling(jobId, provider = '') {
  if (!jobId) return;

  if (videoPollTimer) clearInterval(videoPollTimer);
  const intervalMs = provider === 'openai' ? 10000 : 2000;
  videoPollTimer = setInterval(async () => {
    const result = await sendMsg({ action: 'BACKEND_VIDEO_GET_JOB', jobId });
    if (!result?.success || !result.job) return;

    const status = result.job.status;
    await loadVideoJobs(false);

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      clearInterval(videoPollTimer);
      videoPollTimer = null;
    }
  }, intervalMs);
}

// ─── Ad Intelligence Tab ──────────────────────────────────────────────────────
function setupAdIntelTab() {
  document.getElementById('btn-ad-search')?.addEventListener('click', () => {
    const query = document.getElementById('ad-search-query').value.trim();
    if (!query) return;
    window.open(`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(query)}&search_type=keyword_unordered`, '_blank');
  });

  document.getElementById('ad-search-query')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-ad-search').click();
  });

  document.getElementById('btn-fb-ads')?.addEventListener('click', () => {
    const q = document.getElementById('ad-search-query').value.trim() || '';
    window.open(`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US${q ? `&q=${encodeURIComponent(q)}` : ''}`, '_blank');
  });

  document.getElementById('btn-google-ads')?.addEventListener('click', () => {
    const q = document.getElementById('ad-search-query').value.trim() || '';
    window.open(`https://adstransparency.google.com/${q ? `?query=${encodeURIComponent(q)}` : ''}`, '_blank');
  });

  document.getElementById('btn-tiktok-ads')?.addEventListener('click', () => {
    window.open('https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en', '_blank');
  });
}

// ─── Logo Generator Tab ───────────────────────────────────────────────────────
function setupLogoTab() {
  document.getElementById('btn-gen-logo')?.addEventListener('click', async () => {
    const businessName = document.getElementById('logo-business-name').value.trim();
    const industry = document.getElementById('logo-industry').value.trim();
    const style = document.getElementById('logo-style').value;
    const colors = document.getElementById('logo-colors').value;
    const statusEl = document.getElementById('logo-status');
    const resultCard = document.getElementById('logo-result');

    if (!businessName || !industry) {
      setToolStatus(statusEl, 'Please enter a business name and industry.', 'error');
      return;
    }

    if (!settings.backendToken) {
      setToolStatus(statusEl, 'Please sign in to your Clone2GHL account to use AI features.', 'error');
      return;
    }

    document.getElementById('btn-gen-logo').innerHTML = '<span class="spinner"></span> Generating…';
    document.getElementById('btn-gen-logo').disabled = true;
    setToolStatus(statusEl, '<span class="spinner"></span> Generating logo with DALL-E 3…', 'loading');
    resultCard.style.display = 'none';

    const result = await sendMsg({
      action: 'GENERATE_LOGO',
      data: { businessName, industry, style, colors },
    });

    document.getElementById('btn-gen-logo').textContent = '🎨 Generate Logo';
    document.getElementById('btn-gen-logo').disabled = false;

    if (result?.success && result.url) {
      document.getElementById('logo-preview-img').src = result.url;
      document.getElementById('btn-download-logo').href = result.url;
      document.getElementById('logo-revised-prompt').textContent = result.revisedPrompt || '';
      resultCard.style.display = 'flex';
      setToolStatus(statusEl, '✓ Logo generated! Right-click → Save image, or use the Download button.', 'success');
    } else {
      setToolStatus(statusEl, `Error: ${result?.error || 'Logo generation failed'}`, 'error');
    }
  });
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function setupSettingsTab() {
  // Populate fields from saved settings
  loadSettingsFields();

  if (settings.backendToken) {
    loadBackendAccountData();
  }

  // Toggle visibility of API key inputs
  document.getElementById('toggle-ghl-key')?.addEventListener('click', () => togglePasswordField('ghl-api-key'));

  // GHL validate
  document.getElementById('btn-validate-ghl')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('ghl-api-key').value.trim();
    const locationId = document.getElementById('ghl-location-id').value.trim();
    const badge = document.getElementById('ghl-status-badge');

    if (!apiKey || !locationId) {
      setStatus(badge, '⚠ Enter both API key and Location ID first.', 'error');
      return;
    }

    setStatus(badge, '<span class="spinner"></span> Testing connection…', 'connected');
    const result = await sendMsg({ action: 'VALIDATE_GHL', apiKey, locationId });

    if (result?.valid) {
      // Auto-save validated credentials so export works immediately without a separate Save click.
      await sendMsg({ action: 'SAVE_SETTINGS', data: { ghlApiKey: apiKey, ghlLocationId: locationId } });
      settings.ghlApiKey = apiKey;
      settings.ghlLocationId = locationId;
      setStatus(badge, `✓ Connected to: ${result.locationName} — Settings saved!`, 'connected');

      // If signed in and still on the free tier, this validated connection starts
      // the one-time free trial (the backend re-validates and binds the location).
      if (settings.backendToken && settings.plan === 'free' && !settings.ghlValidated) {
        const trialResp = await sendMsg({ action: 'GHL_START_TRIAL', apiKey, locationId });
        if (trialResp?.success) {
          if (trialResp.settings) settings = { ...settings, ...trialResp.settings };
          const t = trialResp.trial || {};
          setStatus(badge, t.alreadyStarted
            ? `✓ Connected to: ${result.locationName} — trial active (${t.clonesRemaining ?? ''} clones left)`
            : `✓ Connected to: ${result.locationName} — free trial started! ${t.clonesRemaining ?? 6} clones · ${t.daysLeft ?? 30} days`, 'connected');
          updateSidebarPlanInfo();
          showUpgradeBannerIfNeeded();
        } else if (trialResp?.data?.code === 'location_already_trialed') {
          setStatus(badge, '✗ This GoHighLevel location has already used a free trial. Upgrade to continue.', 'error');
        }
        // Any other trial error: keep the "connected" status — they can still upgrade.
      }
      renderGettingStarted();
    } else {
      setStatus(badge, `✗ ${result?.error || 'Connection failed'}`, 'error');
    }
  });

  // GHL save
  document.getElementById('btn-save-ghl')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('ghl-api-key').value.trim();
    const locationId = document.getElementById('ghl-location-id').value.trim();
    await sendMsg({ action: 'SAVE_SETTINGS', data: { ghlApiKey: apiKey, ghlLocationId: locationId } });
    // Keep in-memory settings in sync with what was just persisted.
    settings.ghlApiKey = apiKey;
    settings.ghlLocationId = locationId;
    showSaveToast('GHL settings saved!');
    renderGettingStarted();
  });

  // ── Affiliate / referral link ─────────────────────────────────────────────
  // Prefill from saved preferences when signed in.
  (async () => {
    const input = document.getElementById('affiliate-url');
    if (!input || !settings.backendToken) return;
    const r = await sendMsg({ action: 'BACKEND_GET_PREFERENCES' });
    if (r?.success && r.preferences?.affiliateUrl) input.value = r.preferences.affiliateUrl;
  })();

  document.getElementById('btn-save-affiliate')?.addEventListener('click', async () => {
    const badge = document.getElementById('affiliate-status-badge');
    const affiliateUrl = document.getElementById('affiliate-url').value.trim();
    if (affiliateUrl && !/^https?:\/\//i.test(affiliateUrl)) {
      setStatus(badge, '⚠ Enter a valid http(s) URL.', 'error');
      return;
    }
    if (!settings.backendToken) {
      setStatus(badge, '⚠ Sign in under Cloud Backend to save your referral link.', 'error');
      return;
    }
    const r = await sendMsg({ action: 'BACKEND_SAVE_PREFERENCES', preferences: { affiliateUrl } });
    if (r?.success) setStatus(badge, '✓ Referral link saved.', 'connected');
    else setStatus(badge, `✗ ${r?.error || 'Could not save.'}`, 'error');
  });

  document.getElementById('btn-copy-affiliate')?.addEventListener('click', async () => {
    const badge = document.getElementById('affiliate-status-badge');
    const url = document.getElementById('affiliate-url').value.trim();
    if (!url) { setStatus(badge, '⚠ Add your referral link first.', 'error'); return; }
    try { await navigator.clipboard.writeText(url); setStatus(badge, '✓ Referral link copied!', 'connected'); }
    catch { setStatus(badge, '⚠ Copy failed — select and copy manually.', 'error'); }
  });

  // Backend save base URL on blur
  document.getElementById('backend-api-base')?.addEventListener('blur', async (e) => {
    const backendApiBase = e.target.value.trim();
    if (!backendApiBase) return;
    await sendMsg({ action: 'SAVE_SETTINGS', data: { backendApiBase, backendEnabled: true } });
    settings.backendApiBase = backendApiBase;
  });

  // Backend register
  document.getElementById('btn-backend-register')?.addEventListener('click', async () => {
    const email = document.getElementById('backend-auth-email').value.trim();
    const password = document.getElementById('backend-auth-password').value;
    const backendApiBase = document.getElementById('backend-api-base').value.trim();
    const badge = document.getElementById('backend-status-badge');

    if (!email || !password || !backendApiBase) {
      setStatus(badge, '⚠ Enter backend URL, email, and password first.', 'error');
      return;
    }

    await sendMsg({ action: 'SAVE_SETTINGS', data: { backendApiBase, backendEnabled: true } });
    settings.backendApiBase = backendApiBase;
    settings.backendEnabled = true;

    setStatus(badge, '<span class="spinner"></span> Registering…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_REGISTER', email, password });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Registration failed'}`, 'error');
      return;
    }

    settings = result.settings || settings;
    await refreshOwnerStatus();
    updateSidebarPlanInfo();
    applyFeatureGating();
    refreshPlanLabel();
    await loadBackendAccountData();
    setStatus(badge, `✓ Signed in as ${result.user?.email || email}`, 'connected');
    showSaveToast('Backend account created and connected.');
    renderGettingStarted();
  });

  // Backend login
  document.getElementById('btn-backend-login')?.addEventListener('click', async () => {
    const email = document.getElementById('backend-auth-email').value.trim();
    const password = document.getElementById('backend-auth-password').value;
    const backendApiBase = document.getElementById('backend-api-base').value.trim();
    const badge = document.getElementById('backend-status-badge');

    if (!email || !password || !backendApiBase) {
      setStatus(badge, '⚠ Enter backend URL, email, and password first.', 'error');
      return;
    }

    await sendMsg({ action: 'SAVE_SETTINGS', data: { backendApiBase, backendEnabled: true } });
    settings.backendApiBase = backendApiBase;
    settings.backendEnabled = true;

    setStatus(badge, '<span class="spinner"></span> Signing in…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_LOGIN', email, password });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Sign in failed'}`, 'error');
      return;
    }

    settings = result.settings || settings;
    await refreshOwnerStatus();
    updateSidebarPlanInfo();
    applyFeatureGating();
    refreshPlanLabel();
    await loadBackendAccountData();
    setStatus(badge, `✓ Signed in as ${result.user?.email || email}`, 'connected');
    showSaveToast('Backend sign-in successful.');
    renderGettingStarted();
  });

  // Forgot password — reveal the reset panel
  document.getElementById('btn-forgot-password')?.addEventListener('click', () => {
    const panel = document.getElementById('forgot-password-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // Send a reset code to the entered email
  document.getElementById('btn-send-reset-code')?.addEventListener('click', async () => {
    const email = document.getElementById('backend-auth-email').value.trim();
    const backendApiBase = document.getElementById('backend-api-base').value.trim();
    const badge = document.getElementById('backend-status-badge');
    if (!email || !backendApiBase) {
      setStatus(badge, '⚠ Enter the backend URL and your email first.', 'error');
      return;
    }
    await sendMsg({ action: 'SAVE_SETTINGS', data: { backendApiBase, backendEnabled: true } });
    settings.backendApiBase = backendApiBase;
    setStatus(badge, '<span class="spinner"></span> Sending reset code…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_FORGOT_PASSWORD', email });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Could not send reset code'}`, 'error');
      return;
    }
    setStatus(badge, '✓ If that email is registered, a reset code was sent. Check your inbox.', 'connected');
  });

  // Complete the reset with the emailed code + new password
  document.getElementById('btn-reset-password')?.addEventListener('click', async () => {
    const email = document.getElementById('backend-auth-email').value.trim();
    const code = document.getElementById('reset-code').value.trim();
    const newPassword = document.getElementById('reset-new-password').value;
    const badge = document.getElementById('backend-status-badge');
    if (!email || !code || !newPassword) {
      setStatus(badge, '⚠ Enter your email, the reset code, and a new password.', 'error');
      return;
    }
    if (newPassword.length < 8) {
      setStatus(badge, '⚠ New password must be at least 8 characters.', 'error');
      return;
    }
    setStatus(badge, '<span class="spinner"></span> Resetting password…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_RESET_PASSWORD', email, code, newPassword });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Reset failed'}`, 'error');
      return;
    }
    setStatus(badge, '✓ Password reset. You can now sign in with your new password.', 'connected');
    document.getElementById('forgot-password-panel').style.display = 'none';
    document.getElementById('backend-auth-password').value = newPassword;
  });

  // Activate a GHL-purchased plan with the emailed code
  document.getElementById('btn-ghl-activate')?.addEventListener('click', async () => {
    const email = document.getElementById('ghl-activate-email').value.trim();
    const code = document.getElementById('ghl-activate-code').value.trim();
    const password = document.getElementById('ghl-activate-password').value;
    const backendApiBase = document.getElementById('backend-api-base').value.trim();
    const badge = document.getElementById('backend-status-badge');

    if (!email || !code) {
      setStatus(badge, '⚠ Enter your purchase email and activation code.', 'error');
      return;
    }
    if (!backendApiBase) {
      setStatus(badge, '⚠ Enter the backend URL first.', 'error');
      return;
    }
    if (password && password.length < 8) {
      setStatus(badge, '⚠ Password must be at least 8 characters (or leave it blank).', 'error');
      return;
    }

    await sendMsg({ action: 'SAVE_SETTINGS', data: { backendApiBase, backendEnabled: true } });
    settings.backendApiBase = backendApiBase;
    settings.backendEnabled = true;

    setStatus(badge, '<span class="spinner"></span> Activating…', 'connected');
    const result = await sendMsg({ action: 'GHL_ACTIVATE', email, code, password });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Activation failed'}`, 'error');
      return;
    }

    settings = result.settings || settings;
    await refreshOwnerStatus();
    updateSidebarPlanInfo();
    applyFeatureGating();
    refreshPlanLabel();
    await loadBackendAccountData();
    setStatus(badge, `✓ Activated — plan: ${result.user?.plan || 'updated'}`, 'connected');
    showSaveToast('Plan activated! Welcome aboard.');
    renderGettingStarted();
  });

  // Backend logout
  document.getElementById('btn-backend-logout')?.addEventListener('click', async () => {
    const badge = document.getElementById('backend-status-badge');
    const result = await sendMsg({ action: 'BACKEND_LOGOUT' });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Sign out failed'}`, 'error');
      return;
    }
    settings = result.settings || settings;
    settings.isOwner = false;
    showHideAdminNav(false);
    refreshPlanLabel();
    clearDashboardAccountPanels();
    setStatus(badge, '● Signed out from backend.', 'connected');
    showSaveToast('Signed out.');
  });

  // Backend usage refresh
  document.getElementById('btn-backend-usage')?.addEventListener('click', async () => {
    const badge = document.getElementById('backend-status-badge');
    setStatus(badge, '<span class="spinner"></span> Fetching usage…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_GET_USAGE' });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Unable to fetch usage'}`, 'error');
      return;
    }

    const sr = await sendMsg({ action: 'GET_SETTINGS' });
    settings = sr?.settings || settings;
    updateSidebarPlanInfo();
    applyFeatureGating();
    refreshPlanLabel();
    const remaining = result.usage?.clonesRemaining;
    setStatus(badge, `✓ Usage synced${remaining >= 0 ? ` · ${remaining} clones remaining` : ' · unlimited'}`, 'connected');
  });

  // Backend funnel sync
  document.getElementById('btn-backend-sync')?.addEventListener('click', async () => {
    const badge = document.getElementById('backend-status-badge');
    setStatus(badge, '<span class="spinner"></span> Syncing funnels…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_SYNC_FUNNELS' });
    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Funnel sync failed'}`, 'error');
      return;
    }
    setStatus(badge, `✓ Synced ${result.synced || 0} funnel(s)`, 'connected');
  });

  // Stripe checkout buttons
  document.getElementById('btn-upgrade-starter')?.addEventListener('click', async () => {
    await startCheckout('starter');
  });
  document.getElementById('btn-upgrade-pro')?.addEventListener('click', async () => {
    await startCheckout('pro');
  });
  document.getElementById('btn-upgrade-agency')?.addEventListener('click', async () => {
    await startCheckout('agency');
  });

  // Current plan display
  refreshPlanLabel();

  // Reset credits button
  document.getElementById('btn-reset-credits')?.addEventListener('click', async () => {
    await sendMsg({ action: 'SAVE_SETTINGS', data: { credits: 999 } });
    settings.credits = 999;
    refreshPlanLabel();
    updateSidebarPlanInfo();
    applyFeatureGating();
    showSaveToast('Credits reset to 999!');
  });

}

// ─── My Account Tab ───────────────────────────────────────────────────────────
function setupAccountTab() {
  document.getElementById('btn-load-invoices')?.addEventListener('click', () => loadMyInvoices());
  document.getElementById('btn-refresh-profile')?.addEventListener('click', async () => {
    await loadBackendAccountData(true);
  });

  document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    const badge = document.getElementById('profile-status-badge');
    if (!requireBackendAuth(badge)) return;

    setStatus(badge, '<span class="spinner"></span> Saving profile…', 'connected');
    const result = await sendMsg({
      action: 'BACKEND_UPDATE_PROFILE',
      displayName: document.getElementById('profile-display-name')?.value?.trim() || '',
      company: document.getElementById('profile-company')?.value?.trim() || '',
      timezone: document.getElementById('profile-timezone')?.value?.trim() || 'UTC',
    });

    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Unable to save profile'}`, 'error');
      return;
    }

    settings = result.settings || settings;
    populateProfileForm(result.user?.profile || result.profile || null);
    setStatus(badge, '✓ Profile updated.', 'connected');
  });

  document.getElementById('btn-change-password')?.addEventListener('click', async () => {
    const badge = document.getElementById('profile-status-badge');
    if (!requireBackendAuth(badge)) return;

    const currentPassword = document.getElementById('profile-current-password')?.value || '';
    const newPassword = document.getElementById('profile-new-password')?.value || '';
    if (!currentPassword || !newPassword) {
      setStatus(badge, '⚠ Enter current and new password.', 'error');
      return;
    }

    setStatus(badge, '<span class="spinner"></span> Changing password…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_CHANGE_PASSWORD', currentPassword, newPassword });

    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Unable to change password'}`, 'error');
      return;
    }

    document.getElementById('profile-current-password').value = '';
    document.getElementById('profile-new-password').value = '';
    setStatus(badge, '✓ Password updated.', 'connected');
  });

  document.getElementById('btn-delete-account')?.addEventListener('click', async () => {
    const badge = document.getElementById('profile-status-badge');
    if (!requireBackendAuth(badge)) return;

    const password = document.getElementById('profile-delete-password')?.value || '';
    if (!password) {
      setStatus(badge, '⚠ Enter your password to confirm deletion.', 'error');
      return;
    }
    if (!confirm('Permanently delete your Clone2GHL account and all associated server-side data? This cannot be undone.')) return;

    setStatus(badge, '<span class="spinner"></span> Deleting account…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_DELETE_ACCOUNT', password });

    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Unable to delete account'}`, 'error');
      return;
    }

    const pwField = document.getElementById('profile-delete-password');
    if (pwField) pwField.value = '';
    setStatus(badge, '✓ Account deleted. You have been signed out.', 'connected');
    setTimeout(() => location.reload(), 1500);
  });

  document.getElementById('btn-save-preferences')?.addEventListener('click', async () => {
    const badge = document.getElementById('profile-status-badge');
    if (!requireBackendAuth(badge)) return;

    const preferences = {
      theme: document.getElementById('pref-theme')?.value || 'dark',
      defaultNiche: document.getElementById('pref-default-niche')?.value || 'general',
      notifications: Boolean(document.getElementById('pref-notifications')?.checked),
    };

    setStatus(badge, '<span class="spinner"></span> Saving preferences…', 'connected');
    const result = await sendMsg({ action: 'BACKEND_SAVE_PREFERENCES', preferences });

    if (!result?.success) {
      setStatus(badge, `✗ ${result?.error || 'Unable to save preferences'}`, 'error');
      return;
    }

    populatePreferencesForm(result.preferences || preferences);
    setStatus(badge, '✓ Preferences saved.', 'connected');
  });

  document.getElementById('toggle-discover-key')?.addEventListener('click', () => togglePasswordField('discover-api-key'));

  document.getElementById('btn-save-discover')?.addEventListener('click', async () => {
    const discoverApiKey = document.getElementById('discover-api-key')?.value.trim();
    const discoverCx = document.getElementById('discover-cx')?.value.trim();
    await sendMsg({ action: 'SAVE_SETTINGS', data: { discoverApiKey, discoverCx } });
    settings.discoverApiKey = discoverApiKey;
    settings.discoverCx = discoverCx;
    const btn = document.getElementById('btn-save-discover');
    btn.textContent = '✓ Saved';
    setTimeout(() => { btn.textContent = 'Save'; }, 2000);
  });

  document.getElementById('btn-load-analytics')?.addEventListener('click', async () => {
    await loadAnalytics();
  });

  document.getElementById('btn-load-activity')?.addEventListener('click', async () => {
    await loadActivity();
  });
}

function loadSettingsFields() {
  if (settings.ghlApiKey) document.getElementById('ghl-api-key').value = settings.ghlApiKey;
  if (settings.ghlLocationId) document.getElementById('ghl-location-id').value = settings.ghlLocationId;
  // Always populate the (now hidden/Advanced) backend URL so handlers never see it
  // empty; fall back to the production default if settings somehow lacks it.
  const baseEl = document.getElementById('backend-api-base');
  if (baseEl) baseEl.value = settings.backendApiBase || 'https://api.clone2ghl.com';
  if (settings.discoverApiKey) document.getElementById('discover-api-key').value = settings.discoverApiKey;
  if (settings.discoverCx) document.getElementById('discover-cx').value = settings.discoverCx;

  if (settings.ghlApiKey && settings.ghlLocationId) {
    setStatus(document.getElementById('ghl-status-badge'), '● GHL credentials saved. Click "Test Connection" to verify.', 'connected');
  }
  if (settings.backendToken && settings.backendUser?.email) {
    setStatus(document.getElementById('backend-status-badge'), `● Signed in as ${settings.backendUser.email}`, 'connected');
  }
}

function requireBackendAuth(statusEl) {
  if (settings.backendToken) return true;
  if (statusEl) setStatus(statusEl, '⚠ Sign in to cloud backend first.', 'error');
  return false;
}

function populateProfileForm(profile) {
  if (!profile) return;
  document.getElementById('profile-display-name').value = profile.displayName || '';
  document.getElementById('profile-company').value = profile.company || '';
  document.getElementById('profile-timezone').value = profile.timezone || 'UTC';
}

function populatePreferencesForm(preferences) {
  if (!preferences) return;
  document.getElementById('pref-theme').value = preferences.theme || 'dark';
  document.getElementById('pref-default-niche').value = preferences.defaultNiche || 'general';
  document.getElementById('pref-notifications').checked = Boolean(preferences.notifications);
}

async function loadBackendAccountData(showToast = false) {
  const profileBadge = document.getElementById('profile-status-badge');
  const analyticsBadge = document.getElementById('analytics-status-badge');
  if (!requireBackendAuth(profileBadge)) return;

  const me = await sendMsg({ action: 'BACKEND_ME' });
  if (!me?.success) {
    setStatus(profileBadge, `✗ ${me?.error || 'Unable to load account'}`, 'error');
    return;
  }

  settings = me.settings || settings;
  updateSidebarPlanInfo();
  refreshPlanLabel();
  populateProfileForm(me.user?.profile || null);
  populatePreferencesForm(me.preferences || null);
  setStatus(profileBadge, `✓ Profile loaded for ${me.user?.email || 'user'}.`, 'connected');

  // Populate My Account usage overview
  const planEl = document.getElementById('acct-plan-name');
  if (planEl) planEl.textContent = (settings.plan || 'free').charAt(0).toUpperCase() + (settings.plan || 'free').slice(1);
  const usageResult = await sendMsg({ action: 'BACKEND_GET_USAGE' });
  const clEl = document.getElementById('acct-clones-used');
  if (clEl && usageResult?.usage) clEl.textContent = String(usageResult.usage.clonesUsed ?? 0);
  const vidEl = document.getElementById('acct-videos');
  if (vidEl) {
    const jobsResult = await sendMsg({ action: 'BACKEND_VIDEO_LIST_JOBS', limit: 100 });
    const completedCount = (jobsResult?.jobs || []).filter(j => j.status === 'completed').length;
    vidEl.textContent = String(completedCount);
  }

  // Invoice history + sparkline polish
  loadMyInvoices();
  drawAccountSparkline();

  await loadAnalytics(false);
  await loadActivity(false);

  if (showToast) showSaveToast('Profile refreshed.');
  if (analyticsBadge && analyticsBadge.classList.contains('error')) {
    setStatus(analyticsBadge, '✓ Analytics panel ready.', 'connected');
  }
}

function clearDashboardAccountPanels() {
  document.getElementById('profile-display-name').value = '';
  document.getElementById('profile-company').value = '';
  document.getElementById('profile-timezone').value = 'UTC';
  document.getElementById('profile-current-password').value = '';
  document.getElementById('profile-new-password').value = '';

  document.getElementById('pref-theme').value = 'dark';
  document.getElementById('pref-default-niche').value = 'general';
  document.getElementById('pref-notifications').checked = true;

  ['analytics-total-funnels', 'analytics-clones', 'analytics-optimizations', 'analytics-exports']
    .forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = '-'; });

  const body = document.getElementById('activity-table-body');
  if (body) {
    body.innerHTML = '<tr><td colspan="4" class="activity-empty">Sign in to load activity.</td></tr>';
  }
}

async function loadAnalytics(showStatus = true) {
  const badge = document.getElementById('analytics-status-badge');
  if (!requireBackendAuth(badge)) return;

  if (showStatus) setStatus(badge, '<span class="spinner"></span> Loading analytics…', 'connected');
  const result = await sendMsg({ action: 'BACKEND_GET_ANALYTICS', days: 30 });
  if (!result?.success) {
    setStatus(badge, `✗ ${result?.error || 'Unable to load analytics'}`, 'error');
    return;
  }

  const totals = result.analytics?.totals || {};
  document.getElementById('analytics-total-funnels').textContent = String(totals.totalFunnels ?? 0);
  document.getElementById('analytics-clones').textContent = String(totals.clones ?? 0);
  document.getElementById('analytics-optimizations').textContent = String(totals.aiOptimizations ?? 0);
  document.getElementById('analytics-exports').textContent = String(totals.exports ?? 0);

  if (showStatus) setStatus(badge, '✓ Analytics updated.', 'connected');
}

function formatActivityTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

async function loadActivity(showStatus = true) {
  const badge = document.getElementById('analytics-status-badge');
  const body = document.getElementById('activity-table-body');
  if (!requireBackendAuth(badge)) return;

  if (showStatus) setStatus(badge, '<span class="spinner"></span> Loading activity…', 'connected');
  const result = await sendMsg({ action: 'BACKEND_GET_ACTIVITY', limit: 25, offset: 0 });
  if (!result?.success) {
    setStatus(badge, `✗ ${result?.error || 'Unable to load activity'}`, 'error');
    return;
  }

  const rows = result.activity || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="activity-empty">No recent activity found.</td></tr>';
  } else {
    body.innerHTML = rows.map((row) => {
      const resource = row.resourceType === 'funnel'
        ? `${row.resourceType}:${row.resourceId || '-'}`
        : (row.resourceType || '-');
      return `
        <tr>
          <td>${escHtml(formatActivityTime(row.createdAt))}</td>
          <td>${escHtml(row.action || '-')}</td>
          <td>${escHtml(resource)}</td>
          <td>${escHtml(row.status || '-')}</td>
        </tr>
      `;
    }).join('');
  }

  if (showStatus) setStatus(badge, `✓ Loaded ${rows.length} activity row(s).`, 'connected');
}

function refreshPlanLabel() {
  const planLabel = document.getElementById('current-plan-label');
  if (!planLabel) return;
  const plan = settings.plan || 'free';
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);

  if (plan === 'free') {
    const credits = settings.credits ?? 6;
    planLabel.textContent = `Current: ${planName} Plan · ${credits} clone${credits !== 1 ? 's' : ''} remaining`;
  } else if (plan === 'starter') {
    const credits = settings.credits ?? 24;
    planLabel.textContent = `Current: ${planName} Plan · ${credits} clone${credits !== 1 ? 's' : ''} remaining`;
  } else if (plan === 'pro') {
    planLabel.textContent = `Current: ${planName} Plan · 300 clones/month`;
  } else {
    planLabel.textContent = `Current: ${planName} Plan · Unlimited clones`;
  }
}

async function startCheckout(plan) {
  // Plans are sold via GoHighLevel. Deep-link to the per-plan GHL checkout (falling
  // back to the single configured URL), carrying the captured affiliate ref. Stripe
  // is only a fallback when no GHL URL is configured at all.
  const base = C2GUpgrade.planCheckoutUrl(settings.checkoutUrls, plan, settings.upgradeUrl);
  const ghlUrl = C2GUpgrade.appendRef(base, settings.capturedRef);
  if (ghlUrl) {
    chrome.tabs.create({ url: ghlUrl });
    return;
  }

  if (!settings.backendApiBase) {
    alert('Checkout is unavailable: set Backend API URL in Settings first.');
    switchTab('settings');
    return;
  }

  if (!settings.backendToken) {
    alert('Checkout requires sign-in. Please sign in under Backend Account in Settings.');
    switchTab('settings');
    return;
  }

  const buttonId = plan === 'agency' ? 'btn-upgrade-agency' : plan === 'starter' ? 'btn-upgrade-starter' : 'btn-upgrade-pro';
  const button = document.getElementById(buttonId);
  const originalHtml = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Redirecting…';
  }

  const result = await sendMsg({ action: 'BACKEND_CHECKOUT', plan });
  if (button) {
    button.disabled = false;
    button.innerHTML = originalHtml || button.textContent;
  }

  if (!result?.success) {
    alert(`Checkout failed: ${result?.error || 'Unknown error'}`);
    return;
  }
  if (result.url) {
    chrome.tabs.create({ url: result.url });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setToolStatus(el, html, type) {
  if (!el) return;
  el.innerHTML = html;
  el.className = `tool-status ${type}`;
}

function setStatus(el, html, type) {
  if (!el) return;
  el.innerHTML = html;
  el.className = `settings-status ${type}`;
  el.style.display = 'block';
}

function togglePasswordField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Apply standard dialog a11y to a modal overlay: role, aria-modal, label, and
// move focus into it so keyboard/screen-reader users land on the dialog.
function a11yModal(modal, label) {
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  if (label) modal.setAttribute('aria-label', label);
  modal.tabIndex = -1;
  // Focus the first interactive control, falling back to the dialog itself.
  const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  setTimeout(() => (focusable || modal).focus(), 0);
}

// ─── In-app dialogs (replace jarring native alert/confirm) ─────────────────────
// Promise-based; OK resolves true, Cancel/✕/backdrop/Esc resolve false.
function uiDialog(title, message, { okText = 'OK', cancelText = null } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    const safeMsg = escHtml(message).replace(/\n/g, '<br>');
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <div class="modal-header">
          <div class="modal-title">${escHtml(title)}</div>
          <button class="modal-close" data-act="cancel" aria-label="Close">✕</button>
        </div>
        <div class="modal-body" style="font-size:13.5px;color:var(--text3);line-height:1.6;">${safeMsg}</div>
        <div class="modal-footer">
          ${cancelText ? `<button class="btn-secondary" data-act="cancel">${escHtml(cancelText)}</button>` : ''}
          <button class="btn-primary" data-act="ok">${escHtml(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    a11yModal(overlay.querySelector('.modal'), title);
    const done = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return done(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') done(true);
      else if (act === 'cancel') done(false);
    });
    document.addEventListener('keydown', onKey);
  });
}
function uiAlert(title, message, opts = {}) { return uiDialog(title, message, { okText: opts.okText || 'OK' }); }
function uiConfirm(title, message, opts = {}) { return uiDialog(title, message, { okText: opts.okText || 'OK', cancelText: opts.cancelText || 'Cancel' }); }

// ─── First-run Welcome / Activate modal (v1.0.5) ───────────────────────────────
// One dead-simple entry: Activate (email + code + create password) OR Sign in
// (email + password). Reuses the existing GHL_ACTIVATE / BACKEND_LOGIN handlers;
// setting a password during activation means future logins are just email + pw.
function showWelcomeModal(tab = 'activate', prefill = {}) {
  if (document.getElementById('c2g-welcome-overlay')) return; // already open
  const base = settings.backendApiBase || 'https://api.clone2ghl.com';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'c2g-welcome-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal c2gw-modal" style="max-width:440px;">
      <div class="modal-header">
        <div class="modal-title">Welcome to Clone2GHL 👋</div>
        <button class="modal-close" data-w="close" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="c2gw-tabs">
          <button class="c2gw-tab" data-tab="activate">Activate a plan</button>
          <button class="c2gw-tab" data-tab="signin">Sign in</button>
        </div>

        <div class="c2gw-pane" data-pane="activate">
          <p class="c2gw-hint">Just bought a plan? Enter your email and the activation code from your purchase email.</p>
          <label class="field-label">Email</label>
          <input type="email" class="field-input" id="cw-act-email" placeholder="you@example.com" autocomplete="email">
          <label class="field-label" style="margin-top:10px;">Activation code</label>
          <input type="text" class="field-input" id="cw-act-code" placeholder="XXXX-XXXX">
          <label class="field-label" style="margin-top:10px;">Create a password <span style="opacity:.6;">(so you can sign in anytime)</span></label>
          <input type="password" class="field-input" id="cw-act-pass" placeholder="Min 8 characters" autocomplete="new-password">
          <div class="c2gw-err" id="cw-act-err"></div>
          <button class="btn-primary btn-full" id="cw-act-btn" style="margin-top:12px;">Activate &amp; Start →</button>
          <p class="c2gw-foot">Don't have a plan yet? <a data-w="pricing">View pricing →</a></p>
        </div>

        <div class="c2gw-pane" data-pane="signin" style="display:none;">
          <p class="c2gw-hint">Welcome back — sign in with your email and password.</p>
          <label class="field-label">Email</label>
          <input type="email" class="field-input" id="cw-si-email" placeholder="you@example.com" autocomplete="email">
          <label class="field-label" style="margin-top:10px;">Password</label>
          <input type="password" class="field-input" id="cw-si-pass" placeholder="Your password" autocomplete="current-password">
          <div class="c2gw-err" id="cw-si-err"></div>
          <button class="btn-primary btn-full" id="cw-si-btn" style="margin-top:12px;">Sign In →</button>
          <p class="c2gw-foot">Have a code instead? <a data-w="to-activate">Activate a plan →</a></p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  a11yModal(overlay.querySelector('.modal'), 'Welcome to Clone2GHL');

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const selectTab = (name) => {
    overlay.querySelectorAll('.c2gw-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    overlay.querySelectorAll('.c2gw-pane').forEach(p => { p.style.display = (p.dataset.pane === name ? 'block' : 'none'); });
    setTimeout(() => overlay.querySelector(name === 'signin' ? '#cw-si-email' : '#cw-act-email')?.focus(), 0);
  };

  if (prefill.email) overlay.querySelector('#cw-act-email').value = String(prefill.email).slice(0, 160);
  if (prefill.code) overlay.querySelector('#cw-act-code').value = String(prefill.code).slice(0, 80);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close();
    const t = e.target.closest('.c2gw-tab')?.dataset.tab;
    if (t) return selectTab(t);
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (w === 'close') return close();
    if (w === 'pricing') { close(); switchTab('settings'); return; }
    if (w === 'to-activate') return selectTab('activate');
  });

  const onAuthSuccess = async (result) => {
    settings = result.settings || settings;
    await refreshOwnerStatus();
    updateSidebarPlanInfo();
    applyFeatureGating();
    refreshPlanLabel();
    await loadBackendAccountData();
    renderGettingStarted();
    close();
    showSaveToast('Welcome! 🎉 You\'re all set.');
    switchTab('getting-started');
  };

  const run = async (btn, errEl, action, payload, validate) => {
    errEl.textContent = '';
    const v = validate();
    if (v) { errEl.textContent = v; return; }
    btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> Working…';
    await sendMsg({ action: 'SAVE_SETTINGS', data: { backendApiBase: base, backendEnabled: true } });
    settings.backendApiBase = base; settings.backendEnabled = true;
    const result = await sendMsg({ action, ...payload });
    if (!result?.success) { btn.disabled = false; btn.innerHTML = orig; errEl.textContent = result?.error || 'Something went wrong. Please try again.'; return; }
    await onAuthSuccess(result);
  };

  overlay.querySelector('#cw-act-btn').addEventListener('click', () => {
    const email = overlay.querySelector('#cw-act-email').value.trim();
    const code = overlay.querySelector('#cw-act-code').value.trim();
    const password = overlay.querySelector('#cw-act-pass').value;
    run(overlay.querySelector('#cw-act-btn'), overlay.querySelector('#cw-act-err'), 'GHL_ACTIVATE', { email, code, password }, () => {
      if (!email || !code) return 'Enter your email and activation code.';
      if (password && password.length < 8) return 'Password must be at least 8 characters (or leave it blank).';
      return null;
    });
  });
  overlay.querySelector('#cw-si-btn').addEventListener('click', () => {
    const email = overlay.querySelector('#cw-si-email').value.trim();
    const password = overlay.querySelector('#cw-si-pass').value;
    run(overlay.querySelector('#cw-si-btn'), overlay.querySelector('#cw-si-err'), 'BACKEND_LOGIN', { email, password }, () => {
      if (!email || !password) return 'Enter your email and password.';
      return null;
    });
  });

  selectTab(tab === 'signin' ? 'signin' : 'activate');
}

// Render untrusted/cloned HTML in an isolated, script-disabled sandbox iframe —
// NEVER inject cloned page markup into the dashboard DOM via innerHTML. The
// extension page CSP already blocks inline scripts; the sandbox (no allow-scripts)
// is defense-in-depth and also prevents the cloned page from touching our DOM.
function mountIsolatedHtml(container, html) {
  if (!container) return null;
  container.textContent = '';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', ''); // no allow-scripts → scripts/handlers inert
  frame.style.cssText = 'width:100%;height:100%;border:0;background:#fff;';
  frame.srcdoc = String(html || '');
  container.appendChild(frame);
  return frame;
}

// ─── M2: Clone preview modal (sandboxed) ──────────────────────────────────────
// Renders the GHL-converted HTML in an isolated iframe so users can review the
// clone (forms→placeholders, token swaps) BEFORE pushing to GHL.
function openClonePreview(funnel) {
  let modal = document.getElementById('clone-preview-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'clone-preview-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;';

  const fid = funnel.fidelity;
  const issuesHtml = fid && fid.issues?.length
    ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:#cdd6f4;">${fid.issues.map(i => `<li style="color:${i.level === 'warn' ? '#ffb020' : '#9aa'}">${escHtml(i.text)}</li>`).join('')}</ul>`
    : '<div style="font-size:12px;color:#9aa;">No fidelity issues detected.</div>';

  modal.innerHTML = `
    <div style="background:#0f1426;border:1px solid #2a3350;border-radius:12px;width:min(1000px,95vw);height:88vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #2a3350;">
        <strong style="flex:1;">${escHtml(funnel.name || 'Clone preview')}</strong>
        ${fid ? `<span style="font-size:12px;color:#9aa;">Fidelity ${escHtml(fid.grade)} · ${fid.score}/100</span>` : ''}
        <button id="clone-preview-source" class="btn-secondary" style="padding:5px 10px;font-size:12px;">Toggle source/converted</button>
        ${(fid && fid.stats?.hotlinkedImages > 0) ? `<button id="clone-preview-rehost" class="btn-secondary" style="padding:5px 10px;font-size:12px;" title="Pro/Agency">⬇ Rehost ${fid.stats.hotlinkedImages} image(s)</button>` : ''}
        <button id="clone-preview-close" class="btn-secondary" aria-label="Close" style="padding:5px 10px;">✕</button>
      </div>
      <div style="padding:8px 16px;border-bottom:1px solid #2a3350;background:#11172b;">${issuesHtml}</div>
      <div id="clone-preview-frame" style="flex:1;background:#fff;"></div>
    </div>`;
  document.body.appendChild(modal);

  a11yModal(modal, 'Clone preview');
  const converted = funnel.optimizedHtml || funnel.html || '';
  let showingConverted = true;
  mountIsolatedHtml(document.getElementById('clone-preview-frame'), converted);

  const close = () => modal.remove();
  document.getElementById('clone-preview-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.getElementById('clone-preview-source').addEventListener('click', () => {
    showingConverted = !showingConverted;
    mountIsolatedHtml(document.getElementById('clone-preview-frame'), showingConverted ? converted : (funnel.html || converted));
  });

  document.getElementById('clone-preview-rehost')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Rehosting…';
    try {
      const res = await sendMsg({ action: 'REHOST_FUNNEL_ASSETS', funnelId: funnel.id });
      if (!res?.success) throw new Error(res?.error || 'Rehost failed');
      showSaveToast(`Rehosted ${res.rehosted}/${res.total} image(s).`);
      // Refresh local funnels + preview with the rewritten HTML.
      const fr = await sendMsg({ action: 'GET_FUNNELS' });
      myFunnels = fr?.funnels || myFunnels;
      const updated = myFunnels.find(f => f.id === funnel.id) || funnel;
      mountIsolatedHtml(document.getElementById('clone-preview-frame'), updated.optimizedHtml || updated.html || '');
      btn.textContent = `✓ Rehosted ${res.rehosted}`;
    } catch (err) {
      btn.disabled = false; btn.textContent = '⬇ Rehost images';
      alert(`Rehost failed: ${err.message || err}`);
    }
  });
}

// ─── M4: Version history + restore ────────────────────────────────────────────
async function openVersionHistory(funnel) {
  let modal = document.getElementById('version-history-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'version-history-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:#0f1426;border:1px solid #2a3350;border-radius:12px;width:min(560px,95vw);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #2a3350;">
        <strong style="flex:1;">🕘 Version history — ${escHtml(funnel.name || 'funnel')}</strong>
        <button id="vh-close" class="btn-secondary" aria-label="Close" style="padding:5px 10px;">✕</button>
      </div>
      <div id="vh-body" style="padding:14px 16px;overflow-y:auto;">Loading…</div>
    </div>`;
  document.body.appendChild(modal);
  a11yModal(modal, 'Version history');
  const close = () => modal.remove();
  document.getElementById('vh-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  const body = document.getElementById('vh-body');
  try {
    const res = await sendMsg({ action: 'BACKEND_FUNNEL_VERSIONS', funnelId: funnel.id });
    if (res?.success === false) throw new Error(res.error || 'Failed');
    const versions = res.versions || [];
    if (!versions.length) {
      body.innerHTML = `<p style="color:var(--text3);">No saved versions yet. Versions are captured automatically each time an edited funnel syncs to the cloud. Enable cloud sync in Settings to keep history.</p>`;
      return;
    }
    body.innerHTML = versions.map(v => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#2a3350);">
        <div style="flex:1;">
          <div style="font-size:13px;">${escHtml(v.name || 'Snapshot')}</div>
          <div style="font-size:11px;color:var(--text3);">${v.snapshotAt ? new Date(v.snapshotAt).toLocaleString() : ''} · ${(v.bytes || 0).toLocaleString()} bytes</div>
        </div>
        <button class="btn-secondary vh-restore" data-vid="${escHtml(v.id)}" style="padding:5px 12px;font-size:12px;">Restore</button>
      </div>`).join('');

    body.querySelectorAll('.vh-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Restore this version? The current content is snapshotted first, so this is reversible.')) return;
        btn.disabled = true; btn.textContent = '…';
        try {
          const r = await sendMsg({ action: 'BACKEND_FUNNEL_RESTORE', funnelId: funnel.id, versionId: btn.dataset.vid });
          if (!r?.success) throw new Error(r?.error || 'Restore failed');
          const fr = await sendMsg({ action: 'GET_FUNNELS' });
          myFunnels = fr?.funnels || myFunnels;
          renderFunnels();
          showSaveToast('Version restored.');
          close();
        } catch (err) { btn.disabled = false; btn.textContent = 'Restore'; alert(`Restore failed: ${err.message || err}`); }
      });
    });
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red);">${escHtml(err.message || String(err))}</p><p style="color:var(--text3);font-size:12px;">Version history requires cloud sign-in.</p>`;
  }
}

// ─── M1: Subscription status + activation banner ──────────────────────────────

function daysUntil(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86400000);
}

// Shows an at-a-glance subscription state under the sidebar credits so a lapsed
// or soon-to-expire plan never surprises the user.
function renderSubscriptionStatus() {
  const credEl = document.getElementById('sidebar-credits');
  if (!credEl || !settings) return;
  let el = document.getElementById('sidebar-sub-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sidebar-sub-status';
    el.style.cssText = 'font-size:11px;margin-top:4px;line-height:1.4;';
    credEl.insertAdjacentElement('afterend', el);
  }

  const signedIn = Boolean(settings.backendToken);
  if (!signedIn || settings.plan === 'owner' || settings.devMode) { el.style.display = 'none'; return; }

  if (settings.suspended) {
    el.style.display = 'block';
    el.style.color = '#ff6b6b';
    el.textContent = '⚠ Account suspended — contact support';
    return;
  }

  // Free / trial tier: surface the trial countdown, connect-GHL prompt, or the
  // "trial ended → upgrade" state so users are never silently blocked.
  if (settings.plan === 'free') {
    el.style.display = 'block';
    if (settings.trialActivationRequired) {
      el.style.color = '#ffb020';
      el.textContent = '🔗 Connect GoHighLevel to start your free trial';
    } else if (settings.state === 'trial_expired') {
      el.style.color = '#ff6b6b';
      el.textContent = '⚠ Free trial ended — upgrade to keep cloning';
    } else if (settings.state === 'plan_expired') {
      el.style.color = '#ff6b6b';
      el.textContent = '⚠ Plan expired — upgrade to keep cloning';
    } else if (settings.upgradeRequired) {
      el.style.color = '#ffb020';
      el.textContent = "⚠ You're out of free clones — upgrade to keep cloning";
    } else if (typeof settings.daysLeft === 'number') {
      const d = settings.daysLeft;
      el.style.color = d <= 3 ? '#ffb020' : '#9aa';
      el.textContent = `⏳ Trial: ${settings.credits ?? 0} clone${settings.credits !== 1 ? 's' : ''} · ${d} day${d !== 1 ? 's' : ''} left`;
    } else {
      el.style.display = 'none';
    }
    return;
  }

  const left = daysUntil(settings.currentPeriodEnd);
  if (settings.plan !== 'free' && left != null) {
    el.style.display = 'block';
    if (left < 0) { el.style.color = '#ff6b6b'; el.textContent = '⚠ Plan expired — renew to reactivate'; }
    else if (left <= 5) { el.style.color = '#ffb020'; el.textContent = `⏳ Renews in ${left} day${left !== 1 ? 's' : ''}`; }
    else { el.style.color = '#9aa'; el.textContent = `✓ Active · renews ${new Date(settings.currentPeriodEnd).toLocaleDateString()}`; }
  } else {
    el.style.display = 'none';
  }
}

// Top-of-page banner when the user must upgrade (trial clones used, trial expired,
// or plan lapsed) or must connect GHL to start the trial. Mirrors the activation
// banner pattern. CTA opens the GHL checkout (with ref) or the connect-GHL flow.
function showUpgradeBannerIfNeeded() {
  if (!settings || settings.plan === 'owner' || settings.devMode) return;
  const existing = document.getElementById('upgrade-banner');

  const needsGhl = settings.trialActivationRequired;
  if (!C2GUpgrade.shouldShowUpgradeBanner(settings)) { existing?.remove(); return; }
  if (existing) return;

  const main = document.querySelector('.dashboard-main') || document.querySelector('main') || document.body;
  const banner = document.createElement('div');
  banner.id = 'upgrade-banner';
  banner.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;margin:0 0 16px;border-radius:10px;background:linear-gradient(90deg,#3a2a12,#4a3416);color:#ffe9c7;font-size:13px;';

  const text = document.createElement('div');
  text.style.flex = '1';
  const goBtn = document.createElement('button');
  goBtn.className = 'btn-primary';
  goBtn.style.cssText = 'padding:7px 14px;font-size:12px;';

  if (needsGhl) {
    text.textContent = 'Connect your GoHighLevel account to start your free 30-day trial (6 clones).';
    goBtn.textContent = 'Connect GoHighLevel';
    goBtn.addEventListener('click', () => { switchTab('settings'); document.getElementById('ghl-api-key')?.focus(); });
  } else {
    text.textContent = settings.state === 'trial_expired'
      ? 'Your 30-day free trial has ended. Upgrade to keep cloning funnels into GoHighLevel.'
      : settings.state === 'plan_expired'
        ? 'Your plan has expired. Upgrade to keep cloning funnels into GoHighLevel.'
        : "You've used all your free trial clones. Upgrade to keep cloning.";
    goBtn.textContent = 'Upgrade now';
    goBtn.addEventListener('click', () => {
      const url = ghlCheckoutUrl();
      if (url) chrome.tabs.create({ url });
      else switchTab('pricing');
    });
  }

  banner.appendChild(text);
  banner.appendChild(goBtn);
  main.insertBefore(banner, main.firstChild);
}

// First-run nudge: if the user hasn't connected a backend account, show a
// dismissible banner pointing them to sign in or activate a purchased code.
function showActivationBannerIfNeeded() {
  if (!settings || settings.backendToken || settings.plan === 'owner') return;
  if (settings.activationBannerDismissed) return;
  if (document.getElementById('activation-banner')) return;

  const main = document.querySelector('.dashboard-main') || document.querySelector('main') || document.body;
  const banner = document.createElement('div');
  banner.id = 'activation-banner';
  banner.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;margin:0 0 16px;border-radius:10px;background:linear-gradient(90deg,#1f2a44,#27314f);color:#e6ecff;font-size:13px;';

  const text = document.createElement('div');
  text.style.flex = '1';
  text.textContent = 'Activate your plan to unlock cloud sync, higher limits, and AI tools — sign in or paste your purchase code.';

  const goBtn = document.createElement('button');
  goBtn.className = 'btn-primary';
  goBtn.style.cssText = 'padding:7px 14px;font-size:12px;';
  goBtn.textContent = 'Activate / Sign in';
  goBtn.addEventListener('click', () => { showWelcomeModal('activate'); });

  const dismiss = document.createElement('button');
  dismiss.className = 'btn-secondary';
  dismiss.style.cssText = 'padding:7px 10px;font-size:12px;';
  dismiss.textContent = '✕';
  dismiss.title = 'Dismiss';
  dismiss.addEventListener('click', async () => {
    banner.remove();
    await sendMsg({ action: 'SAVE_SETTINGS', data: { activationBannerDismissed: true } });
    if (settings) settings.activationBannerDismissed = true;
  });

  banner.appendChild(text);
  banner.appendChild(goBtn);
  banner.appendChild(dismiss);
  main.insertBefore(banner, main.firstChild);
}

function nicheToEmoji(niche) {
  const map = {
    // Legacy niches (kept for backward compatibility with existing user funnels)
    plumber: '🔧', electrician: '⚡', hvac: '❄️', roofing: '🏠', cleaning: '🧹',
    landscaping: '🌱', solar: '☀️', real_estate: '🏡', gym: '💪', dental: '🦷',
    coaching: '🚀', insurance: '🛡️', legal: '⚖️', marketing_agency: '📈',
    weight_loss: '🥗',
    // Funnel Library v2 niches
    chiropractor: '🦴', medspa: '💆', salon: '💇', restaurant: '🍽️',
    auto_detailing: '🚗', pest_control: '🐛', mortgage_broker: '🏦',
    financial_advisor: '📊', plastic_surgery: '✨', photography: '📸',
    wedding_planner: '💍', pool_service: '🏊', moving_company: '📦',
    tutoring: '📚', veterinary: '🐾', accounting: '🧾', ecommerce: '🛒',
    saas: '💻', interior_design: '🛋️', painter: '🎨',
    general: '📄',
  };
  return map[niche] || '📄';
}

function showSaveToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:#10B981;color:white;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;animation:fadeIn .2s;`;
  t.textContent = `✓ ${msg}`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// Global helper for headline copy buttons
window.copyText = function(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = '📋', 1200);
  });
};

// Listen for progress messages from background during GHL push
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'GHL_PUSH_PROGRESS') {
    console.log(`GHL Push: ${message.step}/${message.total} — ${message.message}`);
  }
  if (message.action === 'CLONE_COMPLETE' && message.funnelId) {
    const fr2 = sendMsg({ action: 'GET_FUNNELS' });
    fr2.then(r => {
      myFunnels = r?.funnels || myFunnels;
      const f = myFunnels.find(x => x.id === message.funnelId);
      if (f) { renderFunnels(); openVisualEditor(f); }
      renderGettingStarted();
    });
  }
});

// ─── Visual Editor ────────────────────────────────────────────────────────────

const editorState = {
  funnelId: null,
  originalHtml: '',
  workingHtml: '',
  patches: [],
  activePanelId: 'brand',
  isOpen: false,
  copyrightRisks: [],
  allImages: [],
  allColors: [],
  headlines: [],
  ctaBlocks: [],
  bodyBlocks: [],
  funnelSourceDomain: '',
  selectedColorHex: null,
  generatedLogoUrl: null,
};

function setupVisualEditor() {
  document.getElementById('editor-btn-close')?.addEventListener('click', () => {
    if (editorState.patches.length > 0) {
      if (!confirm('You have unsaved changes. Close without saving?')) return;
    }
    closeVisualEditor();
  });

  document.getElementById('editor-btn-save')?.addEventListener('click', saveEditorChanges);

  document.getElementById('editor-btn-push')?.addEventListener('click', async () => {
    await saveEditorChanges();
    if (editorState.funnelId) {
      closeVisualEditor();
      pushFunnelToGHL(editorState.funnelId, document.getElementById('editor-btn-push'));
    }
  });

  document.getElementById('editor-btn-reset')?.addEventListener('click', () => {
    if (!confirm('Reset all changes and restore original cloned HTML?')) return;
    editorState.patches = [];
    editorState.workingHtml = editorState.originalHtml;
    renderEditorPreview();
    updateEditorUnsavedIndicator();
  });

  document.getElementById('editor-btn-undo')?.addEventListener('click', () => {
    if (editorState.patches.length === 0) return;
    editorState.patches.pop();
    // Re-apply remaining patches from original
    editorState.workingHtml = editorState.originalHtml;
    renderEditorPreview();
    updateEditorUnsavedIndicator();
  });

  document.querySelectorAll('.editor-tab').forEach(btn => {
    btn.addEventListener('click', () => switchEditorPanel(btn.dataset.panel));
  });

  document.querySelectorAll('.editor-device-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.editor-device-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const iframe = document.getElementById('editor-iframe');
      iframe.className = `editor-iframe device-${btn.dataset.device}`;
    });
  });

  window.addEventListener('message', handleEditorMessage);
}

function openVisualEditor(funnel) {
  editorState.funnelId = funnel.id;
  editorState.originalHtml = funnel.optimizedHtml || funnel.html || '';
  editorState.workingHtml = editorState.originalHtml;
  editorState.patches = Array.isArray(funnel.editorPatches) ? [...funnel.editorPatches] : [];
  editorState.funnelSourceDomain = extractDomain(funnel.sourceUrl || '');
  editorState.isOpen = true;
  editorState.generatedLogoUrl = null;
  editorState.selectedColorHex = null;

  document.getElementById('editor-funnel-name').textContent = `Customizing: ${funnel.name || 'Funnel'}`;
  document.getElementById('visual-editor').style.display = 'flex';
  updateEditorUnsavedIndicator();
  renderEditorPreview();
}

function closeVisualEditor() {
  document.getElementById('visual-editor').style.display = 'none';
  editorState.isOpen = false;
  editorState.funnelId = null;
  editorState.patches = [];
  document.getElementById('editor-iframe').srcdoc = '';
}

function renderEditorPreview() {
  const iframe = document.getElementById('editor-iframe');
  iframe.onload = onEditorIframeLoad;
  // Strip CSP meta tags that would block injected scripts/fonts
  const safeHtml = editorState.workingHtml.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  iframe.srcdoc = safeHtml;
}

function onEditorIframeLoad() {
  const iframe = document.getElementById('editor-iframe');
  const doc = iframe.contentDocument;
  if (!doc || !doc.body) return;

  // Tag all editable elements with stable IDs
  let counter = 0;
  doc.querySelectorAll('h1,h2,h3,p,li,button,a,img,svg').forEach(el => {
    el.setAttribute('data-c2ghl-id', `c2g${counter++}`);
  });

  injectEditorBridge(doc);
  switchEditorPanel(editorState.activePanelId);
}

function injectEditorBridge(iframeDoc) {
  iframeDoc.getElementById('c2ghl-bridge')?.remove();
  iframeDoc.getElementById('c2ghl-editor-styles')?.remove();

  const style = iframeDoc.createElement('style');
  style.id = 'c2ghl-editor-styles';
  style.textContent = `
    [data-c2ghl-id] { cursor:pointer !important; }
    .c2ghl-hover { outline:2px solid #D9A620 !important; outline-offset:2px !important; }
    .c2ghl-selected { outline:2px solid #F0BB2D !important; }
    .c2ghl-risk { outline:2px solid #EF4444 !important; background:rgba(239,68,68,0.12) !important; }
  `;
  iframeDoc.head.appendChild(style);

  const script = iframeDoc.createElement('script');
  script.id = 'c2ghl-bridge';
  script.textContent = `
    document.addEventListener('click', function(e) {
      var el = e.target.closest('[data-c2ghl-id]');
      if (!el) return;
      e.preventDefault();
      document.querySelectorAll('.c2ghl-selected').forEach(function(x){ x.classList.remove('c2ghl-selected'); });
      el.classList.add('c2ghl-selected');
      window.parent.postMessage({ type:'C2GHL_CLICK', id:el.getAttribute('data-c2ghl-id'), tag:el.tagName, text:el.innerText ? el.innerText.slice(0,200) : '' }, '*');
    });
    document.addEventListener('mouseover', function(e) {
      var el = e.target.closest('[data-c2ghl-id]');
      document.querySelectorAll('.c2ghl-hover').forEach(function(x){ x.classList.remove('c2ghl-hover'); });
      if (el) el.classList.add('c2ghl-hover');
    });
  `;
  iframeDoc.head.appendChild(script);
}

function handleEditorMessage(event) {
  if (!event.data || event.data.type !== 'C2GHL_CLICK') return;
  // Future: wire click to select the matching text item in the Text panel
}

function switchEditorPanel(panelId) {
  editorState.activePanelId = panelId;
  document.querySelectorAll('.editor-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.panel === panelId);
  });
  const content = document.getElementById('editor-panel-content');
  if (!content) return;

  switch (panelId) {
    case 'brand':     renderBrandPanel(content); break;
    case 'copyright': renderCopyrightPanel(content); break;
    case 'text':      renderTextPanel(content); break;
    case 'images':    renderImagesPanel(content); break;
    case 'colors':    renderColorsPanel(content); break;
    case 'fonts':     renderFontsPanel(content); break;
  }
}

function updateEditorUnsavedIndicator() {
  const el = document.getElementById('editor-unsaved');
  if (el) el.style.display = editorState.patches.length > 0 ? 'block' : 'none';
}

function addPatch(patch) {
  editorState.patches.push({
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    ...patch,
  });
  updateEditorUnsavedIndicator();
}

function serializeIframeToHtml() {
  const iframe = document.getElementById('editor-iframe');
  const doc = iframe.contentDocument;
  if (!doc) return editorState.workingHtml;

  // Remove editor artifacts
  doc.getElementById('c2ghl-bridge')?.remove();
  doc.getElementById('c2ghl-editor-styles')?.remove();
  doc.querySelectorAll('[data-c2ghl-id]').forEach(el => el.removeAttribute('data-c2ghl-id'));
  doc.querySelectorAll('.c2ghl-hover,.c2ghl-selected,.c2ghl-risk').forEach(el => {
    el.classList.remove('c2ghl-hover', 'c2ghl-selected', 'c2ghl-risk');
  });

  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}

async function saveEditorChanges() {
  const funnel = myFunnels.find(f => f.id === editorState.funnelId);
  if (!funnel) return;

  const finalHtml = serializeIframeToHtml();
  const updated = {
    ...funnel,
    html: finalHtml,
    optimizedHtml: finalHtml,
    editorPatches: editorState.patches,
    status: funnel.status === 'exported' ? 'optimized' : (funnel.status || 'draft'),
    updatedAt: new Date().toISOString(),
  };

  const result = await sendMsg({ action: 'SAVE_FUNNEL', data: updated });
  if (result?.funnel || result?.success) {
    const idx = myFunnels.findIndex(f => f.id === editorState.funnelId);
    if (idx >= 0) myFunnels[idx] = updated;
    renderFunnels();
    showSaveToast('Changes saved!');
    editorState.patches = [];
    updateEditorUnsavedIndicator();
    // Re-open with saved HTML as new baseline
    editorState.originalHtml = finalHtml;
    editorState.workingHtml = finalHtml;
  } else {
    showSaveToast('Save failed — check storage');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch { return ''; }
}

function buildUniqueSelector(el) {
  const id = el.getAttribute('data-c2ghl-id');
  if (id) return `[data-c2ghl-id="${id}"]`;
  if (el.id && /^[a-zA-Z]/.test(el.id)) return `#${el.id}`;
  const parts = [];
  let cur = el;
  for (let d = 0; d < 4 && cur && cur.tagName; d++) {
    if (cur.id && /^[a-zA-Z]/.test(cur.id)) { parts.unshift(`#${cur.id}`); break; }
    let part = cur.tagName.toLowerCase();
    const sibs = cur.parentElement ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName) : [];
    if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function normalizeToHex(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (short) return '#' + short[1].split('').map(c => c + c).join('');
  const full = /^#([0-9a-fA-F]{6})/.exec(s);
  if (full) return s.toLowerCase().slice(0, 7);
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  return null;
}

function isNeutralColor(hex) {
  if (!hex) return true;
  return /^#(0{6}|f{6}|fff|000|1[0-9a-f]{5}|f[89a-f][89a-f][89a-f]{3})/i.test(hex);
}

function replaceTextGlobal(doc, pattern, replacement) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement && ['SCRIPT','STYLE','NOSCRIPT'].includes(node.parentElement.tagName)) continue;
    if (pattern.test(node.textContent)) {
      node.textContent = node.textContent.replace(pattern, replacement);
    }
  }
}

/**
 * Heuristically finds the best tagline/subtitle element in the page.
 * Priority:
 * 1. Element with class/id containing tagline, subtitle, slogan, subhead, description in hero/header
 * 2. First <p> immediately after a <h1> with 30–250 chars
 * 3. First <p> inside the hero/banner section with 30–250 chars
 */
function findTaglineElement(doc) {
  // Priority 1: semantic class/id hints
  const semanticRx = /tagline|subtitle|slogan|subhead|sub-head|descriptor/i;
  const candidates = doc.querySelectorAll('p, h2, h3, [class*="tagline"], [class*="subtitle"], [class*="slogan"], [id*="tagline"], [id*="subtitle"]');
  for (const el of candidates) {
    const cls = (el.className || '') + ' ' + (el.id || '');
    if (semanticRx.test(cls)) {
      const txt = el.textContent.trim();
      if (txt.length >= 5 && txt.length <= 300) return el;
    }
  }

  // Priority 2: first <p> sibling right after an h1
  const h1 = doc.querySelector('h1');
  if (h1) {
    let sib = h1.nextElementSibling;
    while (sib) {
      if (sib.tagName === 'P') {
        const txt = sib.textContent.trim();
        if (txt.length >= 30 && txt.length <= 300) return sib;
      }
      // Only look at first couple siblings
      if (['H1','H2','H3','SECTION','FOOTER'].includes(sib.tagName)) break;
      sib = sib.nextElementSibling;
    }
  }

  // Priority 3: first <p> inside hero/banner
  const heroSel = '.hero, .hero-section, .banner, [class*="hero"], [class*="banner"], [class*="jumbotron"], header, main > section:first-child';
  const heroArea = doc.querySelector(heroSel);
  if (heroArea) {
    for (const p of heroArea.querySelectorAll('p')) {
      const txt = p.textContent.trim();
      if (txt.length >= 30 && txt.length <= 300) return p;
    }
  }

  // Fallback: first descriptive <p> anywhere
  for (const p of doc.querySelectorAll('p')) {
    const txt = p.textContent.trim();
    if (txt.length >= 30 && txt.length <= 300) return p;
  }

  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getEditorDoc() {
  return document.getElementById('editor-iframe')?.contentDocument || null;
}

// ─── Logo Detection & Replacement ─────────────────────────────────────────────

function findLogoElements(doc) {
  const logoRx = /logo|brand|mark|icon/i;
  const seen = new Set();
  const results = [];

  const push = (el) => {
    const sel = buildUniqueSelector(el);
    if (seen.has(sel)) return;
    seen.add(sel);
    results.push({ type: el.tagName === 'IMG' ? 'img' : 'svg', element: el, selector: sel, src: el.src || null, alt: el.alt || el.getAttribute('aria-label') || '' });
  };

  doc.querySelectorAll('header img, nav img, [class*="logo"] img, [id*="logo"] img').forEach(push);
  doc.querySelectorAll('img').forEach(img => {
    if (logoRx.test(img.alt || '') || logoRx.test(img.className || '') || logoRx.test(img.id || '')) push(img);
  });
  doc.querySelectorAll('header svg, nav svg, [class*="logo"] svg').forEach(push);
  return results;
}

function replaceLogoInPage(logoEntry, newSrc) {
  const doc = getEditorDoc();
  if (!doc) return;
  const el = doc.querySelector(logoEntry.selector);
  if (!el) return;

  if (el.tagName === 'IMG') {
    const oldSrc = el.src;
    el.src = newSrc;
    addPatch({ type: 'img-replace', selector: logoEntry.selector, attribute: 'src', oldValue: oldSrc, newValue: newSrc });
  } else {
    const img = doc.createElement('img');
    img.src = newSrc;
    img.alt = 'Logo';
    img.style.cssText = (el.getAttribute('style') || '');
    img.style.maxHeight = img.style.maxHeight || '60px';
    img.setAttribute('data-c2ghl-id', el.getAttribute('data-c2ghl-id') || '');
    el.replaceWith(img);
    addPatch({ type: 'img-replace', selector: logoEntry.selector, attribute: 'src', oldValue: 'svg', newValue: newSrc });
  }
}

// ─── Color Extraction & Replacement ───────────────────────────────────────────

function extractPageColors(doc) {
  const colorMap = new Map();

  const addColor = (hex, varName, ctx) => {
    if (!hex || isNeutralColor(hex)) return;
    if (!colorMap.has(hex)) colorMap.set(hex, { count: 0, cssVarName: null, contexts: [] });
    const entry = colorMap.get(hex);
    entry.count++;
    if (varName && !entry.cssVarName) entry.cssVarName = varName;
    if (ctx) entry.contexts.push(ctx);
  };

  const cssVarRx = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g;
  const hexRx = /#([0-9a-fA-F]{6})\b/g;

  doc.querySelectorAll('style').forEach(s => {
    let m;
    while ((m = cssVarRx.exec(s.textContent)) !== null) addColor(normalizeToHex(m[2]), m[1], null);
    while ((m = hexRx.exec(s.textContent)) !== null) addColor(normalizeToHex('#' + m[1]), null, 'css');
  });

  ['body', 'header', 'nav', 'section', 'footer', '.hero', '.cta', 'main'].forEach(sel => {
    const el = doc.querySelector(sel);
    if (!el) return;
    try {
      const cs = doc.defaultView.getComputedStyle(el);
      addColor(normalizeToHex(cs.backgroundColor), null, sel);
      addColor(normalizeToHex(cs.color), null, sel);
    } catch {}
  });

  return Array.from(colorMap.entries())
    .map(([hex, meta]) => ({ hex, ...meta }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function replaceColorInPage(oldHex, newHex) {
  const doc = getEditorDoc();
  if (!doc) return;
  const entry = editorState.allColors.find(c => c.hex === oldHex);

  if (entry?.cssVarName) {
    let ov = doc.getElementById('c2ghl-color-overrides');
    if (!ov) { ov = doc.createElement('style'); ov.id = 'c2ghl-color-overrides'; doc.head.appendChild(ov); }
    const varRx = new RegExp(`${escapeRegex(entry.cssVarName)}\\s*:[^;]+;`);
    if (varRx.test(ov.textContent)) {
      ov.textContent = ov.textContent.replace(varRx, `${entry.cssVarName}: ${newHex};`);
    } else {
      ov.textContent += `\n:root { ${entry.cssVarName}: ${newHex}; }`;
    }
  } else {
    doc.querySelectorAll('style').forEach(s => {
      if (s.id && s.id.startsWith('c2ghl-')) return;
      s.textContent = s.textContent.replace(new RegExp(escapeRegex(oldHex), 'gi'), newHex);
    });
  }

  addPatch({ type: 'color-replace', selector: '_style', attribute: entry?.cssVarName || null, oldValue: oldHex, newValue: newHex });
  if (entry) entry.hex = newHex;
  editorState.selectedColorHex = newHex;
}

// ─── Font Detection & Replacement ─────────────────────────────────────────────

function extractFonts(doc) {
  const googleFonts = [];
  const gfRx = /fonts\.googleapis\.com\/css[^'"]*family=([^&'"]+)/g;
  doc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => {
    const src = el.textContent || el.href || '';
    let m;
    while ((m = gfRx.exec(src)) !== null) googleFonts.push(decodeURIComponent(m[1].replace(/\+/g, ' ')));
  });
  let bodyFont = '', headingFont = '';
  try {
    bodyFont = doc.defaultView.getComputedStyle(doc.body).fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    const h1 = doc.querySelector('h1');
    headingFont = h1 ? doc.defaultView.getComputedStyle(h1).fontFamily.split(',')[0].replace(/['"]/g, '').trim() : bodyFont;
  } catch {}
  return { googleFonts: [...new Set(googleFonts)], bodyFont, headingFont };
}

function applyFontChange(target, fontFamily, smartSizes) {
  const doc = getEditorDoc();
  if (!doc) return;
  const slug = fontFamily.replace(/\s+/g, '+');
  const linkId = `c2ghl-gfont-${slug}`;
  if (!doc.getElementById(linkId)) {
    const link = doc.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${slug}:wght@400;600;700&display=swap`;
    doc.head.appendChild(link);
  }
  let ov = doc.getElementById('c2ghl-font-overrides');
  if (!ov) { ov = doc.createElement('style'); ov.id = 'c2ghl-font-overrides'; doc.head.appendChild(ov); }

  if (target === 'heading') {
    // Remove old heading rule
    ov.textContent = ov.textContent.replace(/\/\* headings-start \*\/[\s\S]*?\/\* headings-end \*\//g, '');
    if (smartSizes && smartSizes.length) {
      // Per-element-with-exact-size overrides
      const rules = smartSizes.map(({ selector, size }) =>
        `${selector} { font-family: '${fontFamily}', sans-serif !important; font-size: ${size} !important; }`
      ).join('\n');
      ov.textContent += `\n/* headings-start */\n${rules}\n/* headings-end */`;
    } else {
      ov.textContent += `\n/* headings-start */\nh1, h2, h3 { font-family: '${fontFamily}', sans-serif !important; }\n/* headings-end */`;
    }
  } else {
    ov.textContent = ov.textContent.replace(/\/\* body-start \*\/[\s\S]*?\/\* body-end \*\//g, '');
    if (smartSizes && smartSizes.length) {
      const rules = smartSizes.map(({ selector, size }) =>
        `${selector} { font-family: '${fontFamily}', sans-serif !important; font-size: ${size} !important; }`
      ).join('\n');
      ov.textContent += `\n/* body-start */\n${rules}\n/* body-end */`;
    } else {
      ov.textContent += `\n/* body-start */\nbody, p, li, span, a, button { font-family: '${fontFamily}', sans-serif !important; }\n/* body-end */`;
    }
  }
  addPatch({ type: 'font-replace', selector: target, attribute: 'fontFamily', oldValue: '', newValue: fontFamily });
}

// ─── Copyright Auditor ────────────────────────────────────────────────────────

function runCopyrightAudit() {
  const doc = getEditorDoc();
  if (!doc || !doc.body) return [];
  const risks = [];

  // Helper: check if element already captured
  const sels = new Set();
  const addRisk = (el, type, label, severity, description) => {
    const sel = buildUniqueSelector(el);
    if (sels.has(sel + type)) return;
    sels.add(sel + type);
    risks.push({ el, selector: sel, type, label, severity, description });
  };

  // HIGH: logo images in nav/header with external src
  doc.querySelectorAll('header img, nav img, [class*="logo"] img, [id*="logo"] img').forEach(img => {
    if (img.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:')) {
      addRisk(img, 'brand-logo-img', 'Brand logo image', 'high', `alt="${img.alt || ''}" — ${img.src.slice(0, 60)}`);
    }
  });

  // HIGH: SVG in nav/header
  doc.querySelectorAll('header svg, nav svg, [class*="logo"] svg').forEach(svg => {
    addRisk(svg, 'brand-logo-svg', 'SVG logo mark', 'high', `SVG in ${svg.closest('header') ? 'header' : 'nav/logo area'}`);
  });

  // HIGH: copyright notices
  const cpRx = /©\s*\d{4}|copyright\s*©?\s*\d{4}|all\s+rights?\s+reserved/i;
  const walker1 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker1.nextNode())) {
    if (cpRx.test(node.textContent) && node.parentElement && !['SCRIPT','STYLE'].includes(node.parentElement.tagName)) {
      addRisk(node.parentElement, 'copyright-notice', 'Copyright notice', 'high', `"${node.textContent.trim().slice(0, 80)}"`);
    }
  }

  // MEDIUM: trademark symbols
  const tmRx = /[™®℠]/;
  const walker2 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while ((node = walker2.nextNode())) {
    if (tmRx.test(node.textContent) && node.parentElement && !['SCRIPT','STYLE'].includes(node.parentElement.tagName)) {
      addRisk(node.parentElement, 'trademark-symbol', 'Trademark symbol', 'medium', `"${node.textContent.trim().slice(0, 80)}"`);
    }
  }

  // MEDIUM: original brand name in text
  if (editorState.funnelSourceDomain) {
    const rawBrand = editorState.funnelSourceDomain.replace(/\.[a-z]{2,}(\.[a-z]{2})?$/, '').replace(/-/g, ' ');
    if (rawBrand.length >= 3) {
      const brandRx = new RegExp(`\\b${escapeRegex(rawBrand)}\\b`, 'i');
      const walker3 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let count = 0;
      while ((node = walker3.nextNode()) && count < 20) {
        if (brandRx.test(node.textContent) && node.parentElement && !['SCRIPT','STYLE'].includes(node.parentElement.tagName)) {
          addRisk(node.parentElement, 'brand-name-text', 'Original brand name', 'medium', `"${node.textContent.trim().slice(0, 80)}"`);
          count++;
        }
      }
    }
  }

  // LOW: external links
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') || href.startsWith('javascript') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const url = new URL(href, 'https://x.com');
      if (url.hostname && url.hostname !== editorState.funnelSourceDomain) {
        addRisk(a, 'external-link', 'External brand link', 'low', href.slice(0, 60));
      }
    } catch {}
  });

  editorState.copyrightRisks = risks;
  return risks;
}

function highlightRiskElements() {
  const doc = getEditorDoc();
  if (!doc) return;
  doc.querySelectorAll('.c2ghl-risk').forEach(el => el.classList.remove('c2ghl-risk'));
  editorState.copyrightRisks.forEach(risk => {
    const el = doc.querySelector(risk.selector);
    if (el) el.classList.add('c2ghl-risk');
  });
}

// ─── Text Extraction ──────────────────────────────────────────────────────────

function extractEditableText(doc) {
  editorState.headlines = Array.from(doc.querySelectorAll('h1,h2,h3')).map((el, i) => ({
    id: `h_${i}`, tag: el.tagName, text: el.textContent.trim(), selector: buildUniqueSelector(el),
  })).filter(x => x.text).slice(0, 25);

  editorState.ctaBlocks = Array.from(doc.querySelectorAll('button,a[class*="btn"],a[class*="cta"],[class*="btn"],[class*="cta"]')).map((el, i) => ({
    id: `cta_${i}`, tag: el.tagName, text: el.textContent.trim(), selector: buildUniqueSelector(el),
  })).filter(x => x.text && x.text.length < 80).slice(0, 15);

  editorState.bodyBlocks = Array.from(doc.querySelectorAll('p,li')).map((el, i) => ({
    id: `b_${i}`, tag: el.tagName, text: el.textContent.trim(), selector: buildUniqueSelector(el),
  })).filter(x => x.text.length > 15 && x.text.length < 600).slice(0, 20);
}

// ─── Panel Renderers ──────────────────────────────────────────────────────────

function renderBrandPanel(content) {
  content.innerHTML = `
    <div class="editor-section-title">Business Identity</div>

    <div class="editor-field">
      <label>Business Name</label>
      <input type="text" id="ep-biz-name" placeholder="Your Business Name" />
    </div>
    <div class="editor-field">
      <label>Tagline</label>
      <input type="text" id="ep-tagline" placeholder="Your tagline or slogan" />
    </div>
    <div class="editor-field">
      <label>Phone Number</label>
      <input type="tel" id="ep-phone" placeholder="(555) 123-4567" />
    </div>

    <button class="editor-btn-apply" id="ep-apply-text">Apply Text Replacements</button>

    <div class="editor-section-title" style="margin-top:18px;">Logo</div>
    <div class="editor-logo-preview" id="ep-logo-preview">
      <span class="placeholder">No logo set</span>
    </div>
    <div class="editor-logo-actions">
      <label class="btn-editor-xs neutral" style="cursor:pointer;">
        📁 Upload <input type="file" id="ep-logo-upload" accept="image/*" style="display:none;">
      </label>
      <button class="btn-editor-xs neutral" id="ep-logo-url-btn">🔗 URL</button>
      <button class="btn-editor-xs primary" id="ep-logo-ai-btn">✨ AI Generate</button>
      <button class="btn-editor-xs primary" id="ep-logo-apply-btn" style="display:none;">Apply to Page</button>
    </div>
    <div class="editor-img-url-row" id="ep-logo-url-row">
      <input type="url" id="ep-logo-url-input" placeholder="https://...logo.png" />
      <button class="btn-editor-xs primary" id="ep-logo-url-apply">OK</button>
    </div>

    <div class="editor-ai-logo-form" id="ep-ai-logo-form">
      <div class="editor-section-title">AI Logo Generator</div>
      <div class="editor-field">
        <label>Industry</label>
        <input type="text" id="ep-ai-industry" placeholder="e.g. plumbing, dental, gym" />
      </div>
      <div class="editor-field">
        <label>Style</label>
        <select class="editor-font-select" id="ep-ai-style">
          <option value="modern">Modern & Minimal</option>
          <option value="professional">Professional</option>
          <option value="bold">Bold & Energetic</option>
          <option value="friendly">Friendly & Approachable</option>
          <option value="luxury">Luxury & Premium</option>
        </select>
      </div>
      <button class="editor-btn-apply" id="ep-ai-logo-generate">✨ Generate Logo</button>
      <div class="editor-ai-logo-result" id="ep-ai-logo-result"></div>
    </div>
  `;

  // Apply text replacements
  content.querySelector('#ep-apply-text').addEventListener('click', () => {
    const doc = getEditorDoc();
    if (!doc) return;
    const bizName = content.querySelector('#ep-biz-name').value.trim();
    const tagline = content.querySelector('#ep-tagline').value.trim();
    const phone = content.querySelector('#ep-phone').value.trim();

    if (bizName && editorState.funnelSourceDomain) {
      const rawBrand = editorState.funnelSourceDomain.replace(/\.[a-z]{2,}(\.[a-z]{2})?$/, '').replace(/-/g, ' ');
      if (rawBrand.length >= 3) {
        replaceTextGlobal(doc, new RegExp(`\\b${escapeRegex(rawBrand)}\\b`, 'gi'), bizName);
        addPatch({ type: 'brand-name', selector: 'body', attribute: null, oldValue: rawBrand, newValue: bizName });
      }
    }
    if (phone) {
      replaceTextGlobal(doc, /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, phone);
      addPatch({ type: 'text', selector: 'body', attribute: null, oldValue: 'phone', newValue: phone });
    }
    if (tagline) {
      // Find the best tagline element using heuristics
      const taglineEl = findTaglineElement(doc);
      if (taglineEl) {
        const oldText = taglineEl.textContent;
        taglineEl.textContent = tagline;
        addPatch({ type: 'text', selector: buildUniqueSelector(taglineEl), attribute: null, oldValue: oldText, newValue: tagline });
      } else {
        addPatch({ type: 'text', selector: 'body', attribute: null, oldValue: 'tagline', newValue: tagline });
      }
    }
    showSaveToast('Text replacements applied!');
  });

  // Logo upload
  content.querySelector('#ep-logo-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      editorState.generatedLogoUrl = ev.target.result;
      updateLogoPreview(content, ev.target.result);
    };
    reader.readAsDataURL(file);
  });

  // Logo URL toggle
  content.querySelector('#ep-logo-url-btn').addEventListener('click', () => {
    content.querySelector('#ep-logo-url-row').classList.toggle('visible');
  });
  content.querySelector('#ep-logo-url-apply').addEventListener('click', () => {
    const url = content.querySelector('#ep-logo-url-input').value.trim();
    if (url) { editorState.generatedLogoUrl = url; updateLogoPreview(content, url); }
    content.querySelector('#ep-logo-url-row').classList.remove('visible');
  });

  // Logo apply to page
  content.querySelector('#ep-logo-apply-btn').addEventListener('click', () => {
    if (!editorState.generatedLogoUrl) return;
    const doc = getEditorDoc();
    if (!doc) return;
    const logos = findLogoElements(doc);
    if (logos.length === 0) {
      showSaveToast('No logo elements found on page');
      return;
    }
    logos.forEach(logo => replaceLogoInPage(logo, editorState.generatedLogoUrl));
    showSaveToast(`Logo applied to ${logos.length} element${logos.length !== 1 ? 's' : ''}!`);
  });

  // AI Logo Form toggle
  content.querySelector('#ep-logo-ai-btn').addEventListener('click', () => {
    content.querySelector('#ep-ai-logo-form').classList.toggle('visible');
  });

  // AI Logo Generate
  content.querySelector('#ep-ai-logo-generate').addEventListener('click', async () => {
    const btn = content.querySelector('#ep-ai-logo-generate');
    const bizName = content.querySelector('#ep-biz-name').value.trim() || 'Business';
    const industry = content.querySelector('#ep-ai-industry').value.trim() || 'general';
    const style = content.querySelector('#ep-ai-style').value;
    btn.textContent = '⏳ Generating…';
    btn.disabled = true;
    const result = await sendMsg({ action: 'GENERATE_LOGO', data: { businessName: bizName, industry, style, colors: [] } });
    btn.textContent = '✨ Generate Logo';
    btn.disabled = false;
    if (result?.logoUrl || result?.url) {
      const url = result.logoUrl || result.url;
      editorState.generatedLogoUrl = url;
      updateLogoPreview(content, url);
      content.querySelector('#ep-ai-logo-result').innerHTML = `<img src="${url}" style="max-width:100%;border-radius:6px;margin-top:8px;">`;
      content.querySelector('#ep-ai-logo-result').classList.add('visible');
    } else {
      showSaveToast(result?.error || 'Logo generation failed — check API key in Settings');
    }
  });
}

function updateLogoPreview(content, src) {
  const preview = content.querySelector('#ep-logo-preview');
  preview.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;">`;
  content.querySelector('#ep-logo-apply-btn').style.display = 'inline-block';
}

function renderCopyrightPanel(content, forceReaudit = true) {
  if (forceReaudit) {
    runCopyrightAudit();
    highlightRiskElements();
  }

  const risks = editorState.copyrightRisks;

  if (risks.length === 0) {
    content.innerHTML = `
      <div style="text-align:center;padding:24px 0;color:var(--green);">
        <div style="font-size:32px;margin-bottom:8px;">✓</div>
        <div style="font-size:13px;font-weight:700;">No copyright risks detected</div>
        <div style="font-size:12px;color:var(--text4);margin-top:4px;">You're good to go!</div>
      </div>`;
    return;
  }

  const highCount = risks.filter(r => r.severity === 'high').length;
  const medCount = risks.filter(r => r.severity === 'medium').length;

  content.innerHTML = `
    <div class="editor-audit-summary">
      <span>Found <span class="audit-count-high">${highCount} high</span> · <span class="audit-count-med">${medCount} medium</span> · ${risks.filter(r => r.severity === 'low').length} low risk items</span>
      <button class="audit-btn-fix-all" id="ep-fix-all">Fix All</button>
    </div>
    <div id="ep-risk-list">
      ${risks.map((r, i) => `
        <div class="editor-risk-item" data-risk-idx="${i}">
          <div class="editor-risk-header">
            <span class="editor-risk-badge risk-${r.severity}">${r.severity}</span>
            <span class="editor-risk-label">${r.label}</span>
          </div>
          <div class="editor-risk-desc">${escHtml(r.description)}</div>
          <div class="editor-risk-actions">
            <button class="btn-editor-xs danger ep-risk-remove" data-idx="${i}">Remove</button>
            <button class="btn-editor-xs neutral ep-risk-scroll" data-idx="${i}">View in Page</button>
          </div>
        </div>`).join('')}
    </div>`;

  content.querySelectorAll('.ep-risk-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const risk = editorState.copyrightRisks[idx];
      if (!risk) return;
      const doc = getEditorDoc();
      const el = doc?.querySelector(risk.selector);
      if (el) {
        addPatch({ type: 'element-remove', selector: risk.selector, attribute: null, oldValue: el.outerHTML.slice(0, 200), newValue: '' });
        el.remove();
      }
      editorState.copyrightRisks.splice(idx, 1);
      renderCopyrightPanel(content, false);
    });
  });

  content.querySelectorAll('.ep-risk-scroll').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const risk = editorState.copyrightRisks[idx];
      if (!risk) return;
      const doc = getEditorDoc();
      const el = doc?.querySelector(risk.selector);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  content.querySelector('#ep-fix-all')?.addEventListener('click', () => {
    const doc = getEditorDoc();
    if (!doc) return;
    const toRemove = [];
    [...editorState.copyrightRisks].forEach(risk => {
      const el = doc.querySelector(risk.selector);
      if (!el) return;
      if (risk.type === 'copyright-notice' || risk.type === 'trademark-symbol') {
        const newText = el.textContent.replace(/[™®℠]/g, '').replace(/©\s*\d{4}[^.]*\.?/gi, '').replace(/all\s+rights?\s+reserved\.?/gi, '').trim();
        if (newText !== el.textContent) {
          addPatch({ type: 'text', selector: risk.selector, attribute: null, oldValue: el.textContent, newValue: newText });
          el.textContent = newText;
        }
        toRemove.push(risk);
      } else if (risk.type === 'external-link') {
        const oldHref = el.getAttribute('href');
        el.setAttribute('href', '#');
        addPatch({ type: 'attr', selector: risk.selector, attribute: 'href', oldValue: oldHref, newValue: '#' });
        toRemove.push(risk);
      } else if (risk.type === 'brand-logo-img' || risk.type === 'brand-logo-svg') {
        // Remove brand logo elements from the DOM directly
        addPatch({ type: 'element-remove', selector: risk.selector, attribute: null, oldValue: el.outerHTML.slice(0, 200), newValue: '' });
        el.remove();
        toRemove.push(risk);
      }
    });
    // Remove fixed risks from the array
    toRemove.forEach(r => {
      const idx = editorState.copyrightRisks.indexOf(r);
      if (idx >= 0) editorState.copyrightRisks.splice(idx, 1);
    });
    renderCopyrightPanel(content, false);
    showSaveToast('Copyright issues fixed!');
  });
}

function renderTextPanel(content) {
  const doc = getEditorDoc();
  if (doc) extractEditableText(doc);

  const buildItems = (items, groupLabel) => {
    if (!items.length) return '';
    return `<div class="editor-section-title">${groupLabel}</div>` +
      items.map(item => `
        <div class="editor-text-item" data-text-id="${item.id}">
          <div class="editor-text-tag">${item.tag}</div>
          <div class="editor-text-preview">${escHtml(item.text.slice(0, 120))}${item.text.length > 120 ? '…' : ''}</div>
          <div class="editor-text-edit-wrap">
            <textarea class="editor-text-textarea" rows="3">${escHtml(item.text)}</textarea>
            <div class="editor-text-btns">
              <button class="btn-editor-xs primary ep-text-save" data-id="${item.id}">✓ Apply</button>
              <button class="btn-editor-xs neutral ep-text-ai" data-id="${item.id}" ${item.tag === 'P' || item.tag === 'LI' ? 'style="display:none"' : ''}>✨ AI Rewrite</button>
              <button class="btn-editor-xs neutral ep-text-cancel" data-id="${item.id}">Cancel</button>
            </div>
          </div>
        </div>`).join('');
  };

  content.innerHTML =
    buildItems(editorState.headlines, 'Headlines') +
    buildItems(editorState.ctaBlocks, 'CTAs & Buttons') +
    buildItems(editorState.bodyBlocks, 'Body Text');

  if (!content.innerHTML.trim()) {
    content.innerHTML = '<div class="editor-loading">No editable text found on page.</div>';
    return;
  }

  // Toggle edit mode on click
  content.querySelectorAll('.editor-text-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      item.classList.toggle('editing');
      if (item.classList.contains('editing')) {
        item.querySelector('.editor-text-textarea')?.focus();
      }
    });
  });

  // Apply text change
  content.querySelectorAll('.ep-text-save').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = [...editorState.headlines, ...editorState.ctaBlocks, ...editorState.bodyBlocks].find(x => x.id === id);
      if (!item) return;
      const wrap = btn.closest('.editor-text-item');
      const newText = wrap.querySelector('.editor-text-textarea').value;
      const doc = getEditorDoc();
      const el = doc?.querySelector(item.selector);
      if (el) {
        addPatch({ type: 'text', selector: item.selector, attribute: null, oldValue: item.text, newValue: newText });
        el.textContent = newText;
        item.text = newText;
        wrap.querySelector('.editor-text-preview').textContent = newText.slice(0, 120);
      }
      wrap.classList.remove('editing');
    });
  });

  // AI Rewrite
  content.querySelectorAll('.ep-text-ai').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = editorState.headlines.find(x => x.id === id);
      if (!item) return;
      btn.textContent = '⏳…';
      btn.disabled = true;
      const result = await sendMsg({ action: 'GENERATE_HEADLINES', niche: 'general', offer: item.text });
      btn.textContent = '✨ AI Rewrite';
      btn.disabled = false;
      if (result?.headlines?.[0]) {
        const wrap = btn.closest('.editor-text-item');
        wrap.querySelector('.editor-text-textarea').value = result.headlines[0];
      }
    });
  });

  // Cancel
  content.querySelectorAll('.ep-text-cancel').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.closest('.editor-text-item')?.classList.remove('editing');
    });
  });
}

function renderImagesPanel(content) {
  const doc = getEditorDoc();
  if (!doc) { content.innerHTML = '<div class="editor-loading">Preview not loaded.</div>'; return; }

  const imgs = Array.from(doc.querySelectorAll('img')).filter(img => img.src && img.offsetWidth > 0).slice(0, 30);
  editorState.allImages = imgs.map((img, i) => ({
    id: `img_${i}`, selector: buildUniqueSelector(img), src: img.src, alt: img.alt || '',
  }));

  if (!imgs.length) {
    content.innerHTML = '<div class="editor-loading">No images found on page.</div>';
    return;
  }

  content.innerHTML = `
    <div class="editor-section-title">${imgs.length} Images Found</div>
    <div class="editor-image-grid">
      ${editorState.allImages.map(img => `
        <div class="editor-image-card" data-img-id="${img.id}">
          <img class="editor-image-thumb" src="${img.src}" alt="${escHtml(img.alt)}" onerror="this.style.display='none'">
          <div class="editor-image-alt">${escHtml(img.alt || '(no alt)')}</div>
          <div class="editor-image-actions">
            <label class="btn-editor-xs neutral" style="cursor:pointer;font-size:10px;">
              📁 <input type="file" accept="image/*" class="ep-img-upload" data-id="${img.id}" style="display:none;">
            </label>
            <button class="btn-editor-xs neutral ep-img-url-toggle" data-id="${img.id}" style="font-size:10px;">🔗 URL</button>
            <button class="btn-editor-xs primary ep-img-ai-btn" data-id="${img.id}" style="font-size:10px;">✨ AI</button>
          </div>
          <div class="editor-img-url-row" id="ep-url-row-${img.id}">
            <input type="url" placeholder="https://...image.jpg" class="ep-img-url-input" data-id="${img.id}">
            <button class="btn-editor-xs primary ep-img-url-ok" data-id="${img.id}">OK</button>
          </div>
          <div class="editor-img-ai-status" id="ep-ai-status-${img.id}" style="padding:4px 6px;font-size:10px;color:var(--text4);display:none;"></div>
        </div>`).join('')}
    </div>`;

  // File uploads
  content.querySelectorAll('.ep-img-upload').forEach(input => {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const id = input.dataset.id;
      const imgEntry = editorState.allImages.find(x => x.id === id);
      if (!imgEntry) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        applyImageReplacement(imgEntry, ev.target.result, content);
      };
      reader.readAsDataURL(file);
    });
  });

  // URL toggle & apply
  content.querySelectorAll('.ep-img-url-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = content.querySelector(`#ep-url-row-${btn.dataset.id}`);
      row?.classList.toggle('visible');
    });
  });
  content.querySelectorAll('.ep-img-url-ok').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const url = content.querySelector(`.ep-img-url-input[data-id="${id}"]`).value.trim();
      const imgEntry = editorState.allImages.find(x => x.id === id);
      if (url && imgEntry) applyImageReplacement(imgEntry, url, content);
      content.querySelector(`#ep-url-row-${id}`)?.classList.remove('visible');
    });
  });

  // AI image generation per card
  content.querySelectorAll('.ep-img-ai-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const imgEntry = editorState.allImages.find(x => x.id === id);
      if (!imgEntry) return;
      const statusEl = content.querySelector(`#ep-ai-status-${id}`);
      btn.textContent = '⏳';
      btn.disabled = true;
      if (statusEl) { statusEl.textContent = 'Generating…'; statusEl.style.display = 'block'; }
      const result = await sendMsg({
        action: 'GENERATE_IMAGE',
        subject: imgEntry.alt || 'professional image',
        industry: 'general',
        style: 'modern',
      });
      btn.textContent = '✨ AI';
      btn.disabled = false;
      if (result?.url) {
        applyImageReplacement(imgEntry, result.url, content);
        if (statusEl) { statusEl.textContent = 'AI image applied!'; setTimeout(() => { statusEl.style.display = 'none'; }, 2000); }
      } else {
        if (statusEl) { statusEl.textContent = result?.error || 'Generation failed — sign in to use AI'; setTimeout(() => { statusEl.style.display = 'none'; }, 3000); }
      }
    });
  });
}

function applyImageReplacement(imgEntry, newSrc, content) {
  const doc = getEditorDoc();
  const el = doc?.querySelector(imgEntry.selector);
  if (el) {
    addPatch({ type: 'img-replace', selector: imgEntry.selector, attribute: 'src', oldValue: imgEntry.src, newValue: newSrc });
    el.src = newSrc;
    imgEntry.src = newSrc;
    const thumb = content.querySelector(`.editor-image-card[data-img-id="${imgEntry.id}"] .editor-image-thumb`);
    if (thumb) { thumb.src = newSrc; thumb.style.display = 'block'; }
    showSaveToast('Image replaced!');
  }
}

// ─── Color Wheel Helpers ──────────────────────────────────────────────────────

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function renderColorsPanel(content) {
  const doc = getEditorDoc();
  if (!doc) { content.innerHTML = '<div class="editor-loading">Preview not loaded.</div>'; return; }

  editorState.allColors = extractPageColors(doc);

  if (!editorState.allColors.length) {
    content.innerHTML = '<div class="editor-loading">No color tokens found.</div>';
    return;
  }

  content.innerHTML = `
    <div class="editor-section-title">Page Colors (click to edit)</div>
    <div class="editor-color-grid">
      ${editorState.allColors.map(c => `
        <div class="editor-color-swatch" data-hex="${c.hex}" title="${c.cssVarName || c.hex}"
          style="background:${c.hex};" data-var="${c.cssVarName || ''}"></div>`).join('')}
    </div>
    <div class="editor-color-editor" id="ep-color-editor">
      <div class="editor-section-title" style="margin-bottom:10px;">Editing: <span id="ep-editing-hex">#000000</span></div>

      <!-- Hue ring -->
      <div class="color-wheel-wrap">
        <canvas id="ep-hue-ring" class="color-hue-ring" width="180" height="180"></canvas>
        <div class="color-sl-pad-wrap">
          <canvas id="ep-sl-pad" class="color-sl-pad" width="120" height="120"></canvas>
          <div class="color-sl-cursor" id="ep-sl-cursor"></div>
        </div>
        <div class="color-hue-cursor" id="ep-hue-cursor"></div>
      </div>

      <!-- Preview + hex input -->
      <div class="color-result-row">
        <div class="color-result-preview" id="ep-color-preview" style="background:#000000;"></div>
        <input type="text" class="color-hex-input" id="ep-hex-input" value="#000000" maxlength="7" spellcheck="false">
      </div>

      <button class="editor-btn-apply" id="ep-color-apply" style="margin-top:10px;">Apply Color</button>
    </div>`;

  // State for the interactive wheel
  const wheelState = { h: 0, s: 100, l: 50 };

  function drawHueRing(canvas) {
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const outerR = cx - 2, innerR = outerR - 20;
    for (let deg = 0; deg < 360; deg++) {
      const start = (deg - 1) * Math.PI / 180;
      const end = (deg + 1) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, start, end);
      ctx.closePath();
      ctx.fillStyle = `hsl(${deg},100%,50%)`;
      ctx.fill();
    }
    // Punch inner hole
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawSlPad(canvas, hue) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    // Horizontal: saturation 0→100
    const gradS = ctx.createLinearGradient(0, 0, w, 0);
    gradS.addColorStop(0, `hsl(${hue},0%,50%)`);
    gradS.addColorStop(1, `hsl(${hue},100%,50%)`);
    ctx.fillStyle = gradS;
    ctx.fillRect(0, 0, w, h);
    // Vertical: lightness overlay (white top → black bottom)
    const gradL = ctx.createLinearGradient(0, 0, 0, h);
    gradL.addColorStop(0, 'rgba(255,255,255,1)');
    gradL.addColorStop(0.5, 'rgba(255,255,255,0)');
    gradL.addColorStop(0.5, 'rgba(0,0,0,0)');
    gradL.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradL;
    ctx.fillRect(0, 0, w, h);
  }

  function updateHueCursor(hue) {
    const ring = content.querySelector('#ep-hue-ring');
    const cursor = content.querySelector('#ep-hue-cursor');
    if (!ring || !cursor) return;
    const rect = ring.getBoundingClientRect();
    const cx = ring.width / 2, cy = ring.height / 2;
    const r = cx - 12;
    const rad = (hue - 90) * Math.PI / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    cursor.style.left = (x / ring.width * 100) + '%';
    cursor.style.top = (y / ring.height * 100) + '%';
    cursor.style.background = `hsl(${hue},100%,50%)`;
  }

  function updateSlCursor(s, l) {
    const cursor = content.querySelector('#ep-sl-cursor');
    if (!cursor) return;
    // Map s(0-100) → x, l(0-100) → y but inverted (lightness 100=top, 0=bottom)
    // The pad shows: x=saturation, y=lightness (100 at top, 0 at bottom)
    // But pure white is top-left, pure hue is top-right, black is bottom
    // s: 0-100 → x: 0-100%, l: 0-100 → y: bottom-top
    const xPct = s;
    const yPct = 100 - l * 2; // approximate mapping: l=50 at center, l=100 at top, l=0 at bottom
    cursor.style.left = Math.max(0, Math.min(100, xPct)) + '%';
    cursor.style.top = Math.max(0, Math.min(100, yPct)) + '%';
  }

  function updateFromWheel() {
    const hex = hslToHex(wheelState.h, wheelState.s, wheelState.l);
    content.querySelector('#ep-color-preview').style.background = hex;
    content.querySelector('#ep-hex-input').value = hex;
    content.querySelector('#ep-editing-hex').textContent = hex;
    updateHueCursor(wheelState.h);
    updateSlCursor(wheelState.s, wheelState.l);
    const slPad = content.querySelector('#ep-sl-pad');
    if (slPad) drawSlPad(slPad, wheelState.h);
  }

  function initWheel() {
    const hueRing = content.querySelector('#ep-hue-ring');
    const slPad = content.querySelector('#ep-sl-pad');
    if (!hueRing || !slPad) return;

    drawHueRing(hueRing);
    drawSlPad(slPad, wheelState.h);
    updateHueCursor(wheelState.h);
    updateSlCursor(wheelState.s, wheelState.l);

    // Hue ring interaction
    let draggingHue = false;
    function pickHue(e) {
      const rect = hueRing.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - cx, dy = clientY - cy;
      let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      if (angle < 0) angle += 360;
      wheelState.h = Math.round(angle) % 360;
      updateFromWheel();
    }
    hueRing.addEventListener('mousedown', (e) => { draggingHue = true; pickHue(e); });
    window.addEventListener('mousemove', (e) => { if (draggingHue) pickHue(e); });
    window.addEventListener('mouseup', () => { draggingHue = false; });

    // SL pad interaction
    let draggingSl = false;
    function pickSl(e) {
      const rect = slPad.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      wheelState.s = Math.round(x * 100);
      // y=0 → l=100 (white top), y=1 → l=0 (black bottom); mid hue at y=0.5 → l=50
      wheelState.l = Math.round((1 - y) * 50 + (1 - x) * y * 50 + (1 - y) * x * 0);
      // Simpler: l = (1-y)*100, but clamp
      wheelState.l = Math.round((1 - y) * (100 - x * 50));
      wheelState.l = Math.max(0, Math.min(100, wheelState.l));
      updateFromWheel();
    }
    slPad.addEventListener('mousedown', (e) => { draggingSl = true; pickSl(e); });
    window.addEventListener('mousemove', (e) => { if (draggingSl) pickSl(e); });
    window.addEventListener('mouseup', () => { draggingSl = false; });
  }

  // Swatch click → open editor with that color
  content.querySelectorAll('.editor-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      content.querySelectorAll('.editor-color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      editorState.selectedColorHex = swatch.dataset.hex;
      const editor = content.querySelector('#ep-color-editor');
      editor.classList.add('visible');
      content.querySelector('#ep-editing-hex').textContent = swatch.dataset.hex;
      content.querySelector('#ep-color-preview').style.background = swatch.dataset.hex;
      content.querySelector('#ep-hex-input').value = swatch.dataset.hex.slice(0, 7);
      // Sync wheel to this color's HSL
      const hsl = hexToHsl(swatch.dataset.hex.slice(0, 7).padEnd(7, '0'));
      wheelState.h = hsl.h; wheelState.s = hsl.s; wheelState.l = hsl.l;
      updateFromWheel();
    });
  });

  // Manual hex input
  content.querySelector('#ep-hex-input').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      content.querySelector('#ep-color-preview').style.background = val;
      content.querySelector('#ep-editing-hex').textContent = val;
      const hsl = hexToHsl(val);
      wheelState.h = hsl.h; wheelState.s = hsl.s; wheelState.l = hsl.l;
      updateHueCursor(wheelState.h);
      updateSlCursor(wheelState.s, wheelState.l);
      const slPad = content.querySelector('#ep-sl-pad');
      if (slPad) drawSlPad(slPad, wheelState.h);
    }
  });

  content.querySelector('#ep-color-apply')?.addEventListener('click', () => {
    if (!editorState.selectedColorHex) return;
    const newHex = content.querySelector('#ep-hex-input').value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(newHex)) {
      showSaveToast('Enter a valid hex color (e.g. #FF5733)');
      return;
    }
    const oldHex = editorState.selectedColorHex;
    replaceColorInPage(oldHex, newHex);
    // Update the swatch
    const swatch = content.querySelector(`.editor-color-swatch.selected`);
    if (swatch) { swatch.setAttribute('data-hex', newHex); swatch.style.background = newHex; }
    content.querySelector('#ep-editing-hex').textContent = newHex;
    showSaveToast('Color updated!');
  });

  // Init wheel after DOM is painted
  requestAnimationFrame(() => initWheel());
}

const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway',
  'Playfair Display', 'Merriweather', 'Source Sans Pro', 'Nunito', 'Oswald',
  'DM Sans', 'Outfit', 'Plus Jakarta Sans',
];

function renderFontsPanel(content) {
  const doc = getEditorDoc();
  const fontInfo = doc ? extractFonts(doc) : { bodyFont: '', headingFont: '' };

  // Smart detection: read actual computed sizes from the iframe elements
  let headingSizes = [], bodySizes = [];
  if (doc) {
    const headingSelectors = ['h1', 'h2', 'h3'];
    headingSelectors.forEach(sel => {
      const el = doc.querySelector(sel);
      if (el) {
        const cs = doc.defaultView?.getComputedStyle(el);
        const size = cs?.fontSize;
        if (size) headingSizes.push({ selector: sel, size, detected: cs?.fontFamily?.split(',')[0].replace(/['"]/g, '').trim() });
      }
    });
    const bodySelectors = ['p', 'li', 'button'];
    bodySelectors.forEach(sel => {
      const el = doc.querySelector(sel);
      if (el) {
        const cs = doc.defaultView?.getComputedStyle(el);
        const size = cs?.fontSize;
        if (size) bodySizes.push({ selector: sel, size, detected: cs?.fontFamily?.split(',')[0].replace(/['"]/g, '').trim() });
      }
    });
  }

  const fontOptions = GOOGLE_FONTS.map(f => `<option value="${f}">${f}</option>`).join('');

  const headingSizeHtml = headingSizes.length
    ? headingSizes.map(h => `<div class="editor-font-size-row"><span>${h.selector}</span><span>${h.size}</span>${h.detected ? `<span style="color:var(--text4)">${h.detected}</span>` : ''}</div>`).join('')
    : '';
  const bodySizeHtml = bodySizes.length
    ? bodySizes.map(h => `<div class="editor-font-size-row"><span>${h.selector}</span><span>${h.size}</span>${h.detected ? `<span style="color:var(--text4)">${h.detected}</span>` : ''}</div>`).join('')
    : '';

  content.innerHTML = `
    <div class="editor-section-title">Heading Font</div>
    <div class="editor-font-row">
      <label>H1, H2, H3 — Smart Apply preserves detected sizes</label>
      ${headingSizeHtml ? `<div class="editor-font-size-table">${headingSizeHtml}</div>` : ''}
      <select class="editor-font-select" id="ep-heading-font">${fontOptions}</select>
      <div class="editor-font-preview" id="ep-heading-preview" style="font-family:'Inter',sans-serif;">
        The Quick Brown Fox
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="editor-btn-apply" id="ep-apply-heading" style="flex:1;">Apply</button>
        <button class="editor-btn-apply" id="ep-smart-apply-heading" style="flex:1;background:var(--purple-faint);border:1px solid rgba(217,166,32,0.4);color:#F0BB2D;">✨ Smart Apply</button>
      </div>
    </div>

    <div class="editor-section-title">Body Font</div>
    <div class="editor-font-row">
      <label>Paragraphs, lists, buttons</label>
      ${bodySizeHtml ? `<div class="editor-font-size-table">${bodySizeHtml}</div>` : ''}
      <select class="editor-font-select" id="ep-body-font">${fontOptions}</select>
      <div class="editor-font-preview" id="ep-body-preview" style="font-family:'Inter',sans-serif;">
        The quick brown fox jumps over the lazy dog.
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="editor-btn-apply" id="ep-apply-body" style="flex:1;">Apply</button>
        <button class="editor-btn-apply" id="ep-smart-apply-body" style="flex:1;background:var(--purple-faint);border:1px solid rgba(217,166,32,0.4);color:#F0BB2D;">✨ Smart Apply</button>
      </div>
    </div>

    ${fontInfo.headingFont || fontInfo.bodyFont ? `
      <div class="editor-section-title">Detected Fonts</div>
      <div style="font-size:12px;color:var(--text4);">
        ${fontInfo.headingFont ? `Heading: ${fontInfo.headingFont}<br>` : ''}
        ${fontInfo.bodyFont ? `Body: ${fontInfo.bodyFont}` : ''}
      </div>` : ''}
  `;

  // Live font preview on select change
  content.querySelector('#ep-heading-font').addEventListener('change', (e) => {
    loadGoogleFontForPreview(e.target.value, content.querySelector('#ep-heading-preview'));
  });
  content.querySelector('#ep-body-font').addEventListener('change', (e) => {
    loadGoogleFontForPreview(e.target.value, content.querySelector('#ep-body-preview'));
  });

  content.querySelector('#ep-apply-heading').addEventListener('click', () => {
    const f = content.querySelector('#ep-heading-font').value;
    applyFontChange('heading', f, null);
    showSaveToast(`Heading font set to ${f}!`);
  });
  content.querySelector('#ep-apply-body').addEventListener('click', () => {
    const f = content.querySelector('#ep-body-font').value;
    applyFontChange('body', f, null);
    showSaveToast(`Body font set to ${f}!`);
  });

  // Smart Apply — passes detected sizes so font-size is preserved per element
  content.querySelector('#ep-smart-apply-heading').addEventListener('click', () => {
    const f = content.querySelector('#ep-heading-font').value;
    applyFontChange('heading', f, headingSizes.length ? headingSizes : null);
    showSaveToast(`✨ Smart heading font set to ${f}!`);
  });
  content.querySelector('#ep-smart-apply-body').addEventListener('click', () => {
    const f = content.querySelector('#ep-body-font').value;
    applyFontChange('body', f, bodySizes.length ? bodySizes : null);
    showSaveToast(`✨ Smart body font set to ${f}!`);
  });
}

function loadGoogleFontForPreview(fontFamily, previewEl) {
  const slug = fontFamily.replace(/\s+/g, '+');
  const linkId = `gfp-${slug}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${slug}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }
  if (previewEl) previewEl.style.fontFamily = `'${fontFamily}', sans-serif`;
}

