/**
 * dashboard.js — Clone2GHL Full Dashboard
 */

// ─── State ────────────────────────────────────────────────────────────────────
let funnelLibrary = [];
let myFunnels = [];
let settings = {};
let currentFunnelId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  setupNavigation();
  setupFunnelsTab();
  setupLibraryTab();
  setupAiToolsTab();
  setupAdIntelTab();
  setupLogoTab();
  setupSettingsTab();
  setupModal();

  // Handle hash navigation (popup links to #library, #settings etc.)
  const hash = window.location.hash.replace('#', '');
  if (hash) switchTab(hash);
});

async function loadAll() {
  // Load settings
  const sr = await sendMsg({ action: 'GET_SETTINGS' });
  settings = sr?.settings || {};

  // Load my funnels
  const fr = await sendMsg({ action: 'GET_FUNNELS' });
  myFunnels = fr?.funnels || [];

  // Load funnel library
  try {
    const resp = await fetch(chrome.runtime.getURL('data/funnelLibrary.json'));
    funnelLibrary = await resp.json();
  } catch { funnelLibrary = []; }

  updateSidebarPlanInfo();
}

// ─── Messaging ────────────────────────────────────────────────────────────────
function sendMsg(message) {
  return chrome.runtime.sendMessage(message).catch(() => ({}));
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
    'ad-intel': 'ad-intel', 'logo-gen': 'logo-gen', settings: 'settings',
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
}

// ─── Sidebar Plan Info ────────────────────────────────────────────────────────
function updateSidebarPlanInfo() {
  const nameEl = document.querySelector('.plan-name');
  const credEl = document.getElementById('sidebar-credits');
  if (!settings) return;

  if (nameEl) nameEl.textContent = `${settings.plan?.charAt(0).toUpperCase() + settings.plan?.slice(1) || 'Free'} Plan`;
  if (credEl) {
    if (settings.plan === 'free') {
      credEl.textContent = `${settings.credits ?? 2} clone${settings.credits !== 1 ? 's' : ''} remaining`;
    } else {
      credEl.textContent = 'Unlimited clones';
    }
  }

  document.getElementById('btn-upgrade-sidebar')?.addEventListener('click', () => switchTab('settings'));
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
        <button class="btn-primary btn-push" data-id="${funnel.id}">→ GHL</button>
        <button class="btn-danger btn-delete" data-id="${funnel.id}">🗑</button>
      </div>
    </div>
  `;

  card.querySelector('.btn-view').addEventListener('click', (e) => {
    e.stopPropagation();
    openFunnelModal(funnel);
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
    alert(`Export failed: ${result?.error || 'Unknown error'}`);
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
    if (!settings.openaiApiKey) return setToolStatus(statusEl, 'OpenAI API key required. Add it in Settings.', 'error');

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

    if (!settings.openaiApiKey) {
      alert('OpenAI API key required. Add it in Settings.');
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
}

function updateFunnelSelects() {
  const selects = ['ai-opt-funnel-select', 'intel-funnel-select'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Select a funnel…</option>' +
      myFunnels.map(f => `<option value="${f.id}">${escHtml(f.name || 'Untitled')}</option>`).join('');
  });
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

    if (!settings.openaiApiKey) {
      setToolStatus(statusEl, 'OpenAI API key required. Add it in Settings.', 'error');
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

  // Toggle visibility of API key inputs
  document.getElementById('toggle-ghl-key')?.addEventListener('click', () => togglePasswordField('ghl-api-key'));
  document.getElementById('toggle-openai-key')?.addEventListener('click', () => togglePasswordField('openai-api-key'));

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
      setStatus(badge, `✓ Connected to: ${result.locationName}`, 'connected');
    } else {
      setStatus(badge, `✗ ${result?.error || 'Connection failed'}`, 'error');
    }
  });

  // GHL save
  document.getElementById('btn-save-ghl')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('ghl-api-key').value.trim();
    const locationId = document.getElementById('ghl-location-id').value.trim();
    await sendMsg({ action: 'SAVE_SETTINGS', data: { ghlApiKey: apiKey, ghlLocationId: locationId } });
    settings.ghlApiKey = apiKey;
    settings.ghlLocationId = locationId;
    showSaveToast('GHL settings saved!');
  });

  // OpenAI validate
  document.getElementById('btn-validate-openai')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('openai-api-key').value.trim();
    const badge = document.getElementById('openai-status-badge');

    if (!apiKey) return setStatus(badge, '⚠ Enter your OpenAI API key first.', 'error');

    setStatus(badge, '<span class="spinner"></span> Testing key…', 'connected');
    const result = await sendMsg({ action: 'VALIDATE_OPENAI', apiKey });

    if (result?.valid) {
      setStatus(badge, '✓ OpenAI API key is valid.', 'connected');
    } else {
      setStatus(badge, `✗ ${result?.error || 'Invalid key'}`, 'error');
    }
  });

  // OpenAI save
  document.getElementById('btn-save-openai')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('openai-api-key').value.trim();
    await sendMsg({ action: 'SAVE_SETTINGS', data: { openaiApiKey: apiKey } });
    settings.openaiApiKey = apiKey;
    showSaveToast('OpenAI key saved!');
  });

  // Current plan display
  const planLabel = document.getElementById('current-plan-label');
  if (planLabel) {
    planLabel.textContent = `Current: ${(settings.plan || 'free').charAt(0).toUpperCase() + (settings.plan || 'free').slice(1)} Plan · ${settings.credits ?? 2} clone${settings.credits !== 1 ? 's' : ''} remaining`;
  }

  // Reset credits button
  document.getElementById('btn-reset-credits')?.addEventListener('click', async () => {
    await sendMsg({ action: 'SAVE_SETTINGS', data: { credits: 999 } });
    settings.credits = 999;
    if (planLabel) planLabel.textContent = `Current: ${(settings.plan || 'free').charAt(0).toUpperCase() + (settings.plan || 'free').slice(1)} Plan · 999 clones remaining`;
    updateSidebarPlanInfo();
    showSaveToast('Credits reset to 999!');
  });
}

function loadSettingsFields() {
  if (settings.ghlApiKey) document.getElementById('ghl-api-key').value = settings.ghlApiKey;
  if (settings.ghlLocationId) document.getElementById('ghl-location-id').value = settings.ghlLocationId;
  if (settings.openaiApiKey) document.getElementById('openai-api-key').value = settings.openaiApiKey;

  if (settings.ghlApiKey && settings.ghlLocationId) {
    setStatus(document.getElementById('ghl-status-badge'), '● GHL credentials saved. Click "Test Connection" to verify.', 'connected');
  }
  if (settings.openaiApiKey) {
    setStatus(document.getElementById('openai-status-badge'), '● OpenAI key saved. Click "Test Key" to verify.', 'connected');
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
});
