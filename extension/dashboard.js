/**
 * dashboard.js — Clone2GHL Full Dashboard
 */

// ─── State ────────────────────────────────────────────────────────────────────
let funnelLibrary = [];
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
  setupModal();
  setupDevModeToggle();
  setupOwnerButtons();
  setupVisualEditor();

  // Handle hash navigation (popup links to #library, #settings etc.)
  const hash = window.location.hash.replace('#', '');
  if (hash) switchTab(hash);
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

  // Load funnel library
  try {
    const resp = await fetch(chrome.runtime.getURL('data/funnelLibrary.json'));
    funnelLibrary = await resp.json();
  } catch { funnelLibrary = []; }

  // Load watchlist
  const wlResult = await sendMsg({ action: 'WATCHLIST_GET' });
  watchlist = wlResult?.watchlist || [];

  updateSidebarPlanInfo();
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

function switchTab(tabName) {
  const tabMap = {
    funnels: 'funnels', library: 'library', 'ai-tools': 'ai-tools',
    watchlist: 'watchlist',
    'video-gen': 'video-gen', 'ad-intel': 'ad-intel', 'logo-gen': 'logo-gen',
    settings: 'settings', account: 'account',
    pricing: 'settings',
  };
  const tab = tabMap[tabName] || tabName;

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

function renderFunnels() {
  const grid = document.getElementById('funnels-grid');
  const empty = document.getElementById('funnels-empty');
  if (!grid || !empty) return;

  if (myFunnels.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  myFunnels.forEach(funnel => {
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

  card.innerHTML = `
    <div class="funnel-card-preview">
      ${nicheEmoji}
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
        <button class="btn-secondary btn-customize" data-id="${funnel.id}">✏️ Edit</button>
        <button class="btn-primary btn-push" data-id="${funnel.id}">→ GHL</button>
        <button class="btn-danger btn-delete" data-id="${funnel.id}">🗑</button>
      </div>
    </div>
  `;

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
  // Always refresh from storage so stale in-memory state can't cause a false pass.
  const sr = await sendMsg({ action: 'GET_SETTINGS' });
  settings = sr?.settings || settings;

  if (!settings.ghlApiKey || !settings.ghlLocationId) {
    alert('Please configure your GHL API key and Location ID in Settings first.');
    switchTab('settings');
    return;
  }

  const originalText = btnEl.textContent;
  btnEl.innerHTML = '<span class="spinner"></span> Exporting…';
  btnEl.disabled = true;

  const result = await sendMsg({ action: 'PUSH_TO_GHL', data: { funnelId, useOptimized: true } });

  btnEl.disabled = false;

  if (!result?.success) {
    alert(buildPushErrorMessage(result?.error || 'Unknown error'));
    btnEl.textContent = originalText;
    return;
  }

  if (result.success === 'html_only' || result.success === 'partial') {
    btnEl.textContent = '⚠ Check GHL';
    const msg = (result.warning || 'Partial export.') +
      '\n\nClick OK to open the GHL builder. You can also Download HTML from "View" to paste it in manually.';
    if (confirm(msg)) chrome.tabs.create({ url: result.ghlBuilderUrl });
  } else {
    btnEl.textContent = '✓ Exported!';
    const label = result.funnelName ? ` to funnel "${result.funnelName}"` : '';
    if (confirm(`Page exported${label}! Open in GHL builder?`)) {
      chrome.tabs.create({ url: result.ghlBuilderUrl });
    }
  }

  const fr = await sendMsg({ action: 'GET_FUNNELS' });
  myFunnels = fr?.funnels || [];
  renderFunnels();
}

function buildPushErrorMessage(rawError) {
  const err = String(rawError || '').toLowerCase();
  let advice = 'Try again in a few seconds.';

  if (err.includes('location id')) {
    advice = 'Open Settings and verify your GHL Location ID exactly matches your GHL account.';
  } else if (err.includes('invalid private integration') || err.includes('api key') || err.includes('401') || err.includes('invalid') || err.includes('unauthorized')) {
    advice = 'Your GHL Private Integration Token is invalid or expired. Go to GHL → Settings → Integrations → API Keys, create a new Private Integration Token with Funnels scope, paste it in Settings here, then click Test Connection before exporting.';
  } else if (err.includes('timed out') || err.includes('network')) {
    advice = 'Check your internet connection, then retry export. If this continues, use Download HTML as fallback.';
  } else if (err.includes('no funnels found')) {
    advice = 'Create at least one funnel in GoHighLevel first, then retry export.';
  } else if (err.includes('quota') || err.includes('storage limit')) {
    advice = 'Delete older saved funnels in My Funnels to free storage, then retry.';
  }

  return `Export failed:\n${rawError}\n\nNext step:\n${advice}`;
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

async function cloneFromLibrary(tpl) {
  // Save the library template as a funnel in the user's "My Funnels"
  const funnel = {
    id: `lib_${tpl.id}_${Date.now()}`,
    name: tpl.name,
    sourceUrl: 'Library Template',
    niche: tpl.niche,
    status: 'draft',
    html: tpl.html,
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

function previewTemplate(tpl) {
  const blob = new Blob([tpl.html], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
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
    updateSidebarPlanInfo();
    refreshPlanLabel();
    await loadBackendAccountData();
    setStatus(badge, `✓ Signed in as ${result.user?.email || email}`, 'connected');
    showSaveToast('Backend account created and connected.');
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
    updateSidebarPlanInfo();
    refreshPlanLabel();
    await loadBackendAccountData();
    setStatus(badge, `✓ Signed in as ${result.user?.email || email}`, 'connected');
    showSaveToast('Backend sign-in successful.');
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
    showSaveToast('Credits reset to 999!');
  });

}

// ─── My Account Tab ───────────────────────────────────────────────────────────
function setupAccountTab() {
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
  if (settings.backendApiBase) document.getElementById('backend-api-base').value = settings.backendApiBase;

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
    .replace(/"/g, '&quot;');
}

function nicheToEmoji(niche) {
  const map = {
    plumber: '🔧', electrician: '⚡', hvac: '❄️', roofing: '🏠', cleaning: '🧹',
    landscaping: '🌱', solar: '☀️', real_estate: '🏡', gym: '💪', dental: '🦷',
    coaching: '🚀', insurance: '🛡️', legal: '⚖️', marketing_agency: '📈',
    weight_loss: '🥗', general: '📄',
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
    .c2ghl-hover { outline:2px solid #7C3AED !important; outline-offset:2px !important; }
    .c2ghl-selected { outline:2px solid #F97316 !important; }
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

function applyFontChange(target, fontFamily) {
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
    ov.textContent = ov.textContent.replace(/h1,h2,h3[^}]+}/g, '');
    ov.textContent += `\nh1, h2, h3 { font-family: '${fontFamily}', sans-serif !important; }`;
  } else {
    ov.textContent = ov.textContent.replace(/body,p,li[^}]+}/g, '');
    ov.textContent += `\nbody, p, li, span, a, button { font-family: '${fontFamily}', sans-serif !important; }`;
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
      addPatch({ type: 'text', selector: 'body', attribute: null, oldValue: 'tagline', newValue: tagline });
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

function renderCopyrightPanel(content) {
  const risks = runCopyrightAudit();
  highlightRiskElements();

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
      renderCopyrightPanel(content);
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
    [...editorState.copyrightRisks].forEach(risk => {
      const el = doc.querySelector(risk.selector);
      if (!el) return;
      if (risk.type === 'copyright-notice' || risk.type === 'trademark-symbol') {
        const newText = el.textContent.replace(/[™®℠]/g, '').replace(/©\s*\d{4}[^.]*\.?/gi, '').replace(/all\s+rights?\s+reserved\.?/gi, '').trim();
        if (newText !== el.textContent) {
          addPatch({ type: 'text', selector: risk.selector, attribute: null, oldValue: el.textContent, newValue: newText });
          el.textContent = newText;
        }
      } else if (risk.type === 'external-link') {
        el.removeAttribute('href');
        el.setAttribute('href', '#');
        addPatch({ type: 'attr', selector: risk.selector, attribute: 'href', oldValue: el.getAttribute('href'), newValue: '#' });
      }
    });
    editorState.copyrightRisks = editorState.copyrightRisks.filter(r => ['brand-logo-img','brand-logo-svg'].includes(r.type));
    renderCopyrightPanel(content);
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
          </div>
          <div class="editor-img-url-row" id="ep-url-row-${img.id}">
            <input type="url" placeholder="https://...image.jpg" class="ep-img-url-input" data-id="${img.id}">
            <button class="btn-editor-xs primary ep-img-url-ok" data-id="${img.id}">OK</button>
          </div>
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
    <div class="editor-color-detail" id="ep-color-detail">
      <label>Replace color</label>
      <div class="editor-color-hex" id="ep-color-hex-label">#000000</div>
      <div class="editor-color-var" id="ep-color-var-label"></div>
      <input type="color" id="ep-color-picker" value="#000000">
      <button class="editor-btn-apply" id="ep-color-apply" style="margin-top:8px;">Apply Color</button>
    </div>`;

  content.querySelectorAll('.editor-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      content.querySelectorAll('.editor-color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      editorState.selectedColorHex = swatch.dataset.hex;
      const detail = content.querySelector('#ep-color-detail');
      detail.classList.add('visible');
      detail.querySelector('#ep-color-hex-label').textContent = swatch.dataset.hex;
      detail.querySelector('#ep-color-var-label').textContent = swatch.dataset.var || '';
      detail.querySelector('#ep-color-picker').value = swatch.dataset.hex.slice(0, 7);
    });
  });

  content.querySelector('#ep-color-apply')?.addEventListener('click', () => {
    if (!editorState.selectedColorHex) return;
    const newHex = content.querySelector('#ep-color-picker').value;
    const oldHex = editorState.selectedColorHex;
    replaceColorInPage(oldHex, newHex);
    // Update swatch
    content.querySelector(`.editor-color-swatch[data-hex="${oldHex}"]`)?.setAttribute('data-hex', newHex);
    content.querySelector(`.editor-color-swatch[data-hex="${newHex}"]`)?.setAttribute('style', `background:${newHex};`);
    content.querySelector('#ep-color-hex-label').textContent = newHex;
    showSaveToast('Color updated!');
  });
}

const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway',
  'Playfair Display', 'Merriweather', 'Source Sans Pro', 'Nunito', 'Oswald',
  'DM Sans', 'Outfit', 'Plus Jakarta Sans',
];

function renderFontsPanel(content) {
  const doc = getEditorDoc();
  const fontInfo = doc ? extractFonts(doc) : { bodyFont: '', headingFont: '' };

  const fontOptions = GOOGLE_FONTS.map(f => `<option value="${f}">${f}</option>`).join('');

  content.innerHTML = `
    <div class="editor-section-title">Heading Font</div>
    <div class="editor-font-row">
      <label>Choose font for H1, H2, H3</label>
      <select class="editor-font-select" id="ep-heading-font">${fontOptions}</select>
      <div class="editor-font-preview" id="ep-heading-preview" style="font-family:'Inter',sans-serif;">
        The Quick Brown Fox
      </div>
      <button class="editor-btn-apply" id="ep-apply-heading" style="margin-top:8px;">Apply to Headings</button>
    </div>

    <div class="editor-section-title">Body Font</div>
    <div class="editor-font-row">
      <label>Choose font for paragraphs & body</label>
      <select class="editor-font-select" id="ep-body-font">${fontOptions}</select>
      <div class="editor-font-preview" id="ep-body-preview" style="font-family:'Inter',sans-serif;">
        The quick brown fox jumps over the lazy dog.
      </div>
      <button class="editor-btn-apply" id="ep-apply-body" style="margin-top:8px;">Apply to Body</button>
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
    const f = e.target.value;
    loadGoogleFontForPreview(f, content.querySelector('#ep-heading-preview'));
  });
  content.querySelector('#ep-body-font').addEventListener('change', (e) => {
    const f = e.target.value;
    loadGoogleFontForPreview(f, content.querySelector('#ep-body-preview'));
  });

  content.querySelector('#ep-apply-heading').addEventListener('click', () => {
    const f = content.querySelector('#ep-heading-font').value;
    applyFontChange('heading', f);
    showSaveToast(`Heading font set to ${f}!`);
  });
  content.querySelector('#ep-apply-body').addEventListener('click', () => {
    const f = content.querySelector('#ep-body-font').value;
    applyFontChange('body', f);
    showSaveToast(`Body font set to ${f}!`);
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

