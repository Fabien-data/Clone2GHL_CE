/**
 * contentScript.js — Clone2GHL
 * Injected into all pages. Injects the floating "Clone to GHL" button.
 * Does NOT do heavy DOM extraction (that runs via scripting.executeScript in background.js).
 */

(function () {
  'use strict';

  const BUTTON_ID = 'c2ghl-clone-btn';
  const PANEL_ID = 'c2ghl-panel';
  const STYLE_ID = 'c2ghl-styles';

  // ─── Guard: Don't inject on chrome:// or extension pages ──────────────────
  if (
    window.location.protocol === 'chrome-extension:' ||
    window.location.protocol === 'chrome:' ||
    window.location.protocol === 'about:'
  ) return;

  // ─── Only inject once ──────────────────────────────────────────────────────
  if (document.getElementById(BUTTON_ID)) return;

  // ─── Inject Styles ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        background: linear-gradient(135deg, #D9A620, #4A3200);
        color: white;
        border: none;
        border-radius: 50px;
        padding: 12px 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(217, 166, 32, 0.5);
        transition: all 0.2s ease;
        letter-spacing: 0.2px;
        user-select: none;
      }
      #${BUTTON_ID}:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 28px rgba(217, 166, 32, 0.6);
        background: linear-gradient(135deg, #F0BB2D, #D9A620);
      }
      #${BUTTON_ID}:active {
        transform: translateY(0);
      }
      #${BUTTON_ID} .c2ghl-icon {
        font-size: 18px;
        line-height: 1;
      }
      #${BUTTON_ID} .c2ghl-dismiss {
        margin-left: 4px;
        font-size: 16px;
        opacity: 0.7;
        padding: 2px 4px;
        border-radius: 4px;
        line-height: 1;
      }
      #${BUTTON_ID} .c2ghl-dismiss:hover {
        opacity: 1;
        background: rgba(255,255,255,0.2);
      }

      #${PANEL_ID} {
        position: fixed;
        bottom: 80px;
        right: 24px;
        z-index: 2147483647;
        width: 320px;
        background: #1F1F1F;
        border: 1px solid rgba(217, 166, 32, 0.3);
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        color: white;
        overflow: hidden;
        animation: c2ghl-slide-in 0.2s ease;
      }
      @keyframes c2ghl-slide-in {
        from { opacity: 0; transform: translateY(10px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .c2ghl-panel-header {
        background: linear-gradient(135deg, #D9A620, #4A3200);
        padding: 16px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .c2ghl-panel-title {
        font-size: 15px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .c2ghl-panel-close {
        background: none;
        border: none;
        color: rgba(255,255,255,0.8);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 0;
      }
      .c2ghl-panel-close:hover { color: white; }
      .c2ghl-panel-body {
        padding: 20px;
      }
      .c2ghl-url-preview {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: 10px 14px;
        font-size: 12px;
        color: #9CA3AF;
        margin-bottom: 16px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .c2ghl-label {
        font-size: 12px;
        color: #9CA3AF;
        margin-bottom: 6px;
        font-weight: 500;
      }
      .c2ghl-select {
        width: 100%;
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.15);
        color: white;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        margin-bottom: 12px;
        outline: none;
        cursor: pointer;
        appearance: auto;
      }
      .c2ghl-select option { background: #1F1F1F; color: white; }
      .c2ghl-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        padding: 10px 14px;
        margin-bottom: 16px;
      }
      .c2ghl-toggle-label { font-size: 13px; color: #D1D5DB; }
      .c2ghl-toggle-sub { font-size: 11px; color: #6B7280; }
      .c2ghl-toggle {
        position: relative;
        width: 40px;
        height: 22px;
        flex-shrink: 0;
      }
      .c2ghl-toggle input { opacity: 0; width: 0; height: 0; }
      .c2ghl-toggle-slider {
        position: absolute;
        inset: 0;
        background: #374151;
        border-radius: 22px;
        cursor: pointer;
        transition: .2s;
      }
      .c2ghl-toggle-slider::before {
        content: '';
        position: absolute;
        height: 16px;
        width: 16px;
        left: 3px;
        bottom: 3px;
        background: white;
        border-radius: 50%;
        transition: .2s;
      }
      .c2ghl-toggle input:checked + .c2ghl-toggle-slider { background: #D9A620; }
      .c2ghl-toggle input:checked + .c2ghl-toggle-slider::before { transform: translateX(18px); }
      .c2ghl-btn-primary {
        width: 100%;
        background: linear-gradient(135deg, #D9A620, #4A3200);
        color: white;
        border: none;
        padding: 12px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        margin-bottom: 8px;
        transition: .15s;
      }
      .c2ghl-btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
      .c2ghl-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      .c2ghl-btn-secondary {
        width: 100%;
        background: transparent;
        color: #9CA3AF;
        border: 1px solid rgba(255,255,255,0.1);
        padding: 10px;
        border-radius: 8px;
        font-size: 13px;
        cursor: pointer;
        transition: .15s;
      }
      .c2ghl-btn-secondary:hover { background: rgba(255,255,255,0.05); color: white; }
      .c2ghl-status {
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        margin-bottom: 12px;
        display: none;
      }
      .c2ghl-status.info { background: rgba(217,166,32,0.2); border: 1px solid rgba(217,166,32,0.3); color: #F0BB2D; }
      .c2ghl-status.success { background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #6EE7B7; }
      .c2ghl-status.error { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #FCA5A5; }
      .c2ghl-spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: c2ghl-spin 0.6s linear infinite;
        margin-right: 6px;
        vertical-align: middle;
      }
      @keyframes c2ghl-spin { to { transform: rotate(360deg); } }
      .c2ghl-credits {
        text-align: center;
        font-size: 11px;
        color: #6B7280;
        margin-top: 8px;
      }
      .c2ghl-credits span { color: #F59E0B; font-weight: 600; }
      .c2ghl-ready-badge {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; color: #6EE7B7;
        background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3);
        border-radius: 50px; padding: 3px 10px; margin-bottom: 12px;
      }
      .c2ghl-divider { height:1px; background: rgba(255,255,255,0.08); margin: 14px 0; }
      .c2ghl-scan-list {
        max-height: 220px; overflow-y: auto; margin: 8px 0 12px;
        border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
        background: rgba(255,255,255,0.03);
      }
      .c2ghl-scan-item {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 12px; font-size: 12px; color: #D1D5DB;
        border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;
      }
      .c2ghl-scan-item:last-child { border-bottom: none; }
      .c2ghl-scan-item:hover { background: rgba(217,166,32,0.08); }
      .c2ghl-scan-item input { accent-color: #D9A620; width: 15px; height: 15px; flex-shrink: 0; }
      .c2ghl-scan-item .c2ghl-scan-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .c2ghl-scan-actions { display: flex; gap: 8px; }
      .c2ghl-scan-actions .c2ghl-btn-secondary,
      .c2ghl-scan-actions .c2ghl-btn-primary { margin-bottom: 0; }
    `;
    document.documentElement.appendChild(style);
  }

  // ─── Create Floating Button ────────────────────────────────────────────────
  function createFloatingButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Clone this page to GoHighLevel');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = `
      <span class="c2ghl-icon" aria-hidden="true">⚡</span>
      <span>Clone to GHL</span>
      <span class="c2ghl-dismiss" id="c2ghl-dismiss-btn" role="button" aria-label="Dismiss Clone2GHL button" title="Dismiss">×</span>
    `;

    btn.addEventListener('click', (e) => {
      if (e.target.id === 'c2ghl-dismiss-btn' || e.target.closest('#c2ghl-dismiss-btn')) {
        dismissButton();
        return;
      }
      togglePanel();
    });

    document.documentElement.appendChild(btn);
    return btn;
  }

  // ─── Create Clone Panel ────────────────────────────────────────────────────
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    const niches = [
      ['general', 'Select a niche (optional)'],
      ['plumber', 'Plumber'],
      ['electrician', 'Electrician'],
      ['hvac', 'HVAC / AC Repair'],
      ['roofing', 'Roofing'],
      ['cleaning', 'Cleaning Service'],
      ['landscaping', 'Landscaping / Lawn Care'],
      ['solar', 'Solar Energy'],
      ['real_estate', 'Real Estate'],
      ['gym', 'Gym / Fitness'],
      ['dental', 'Dental'],
      ['coaching', 'Coaching / Consulting'],
      ['insurance', 'Insurance'],
      ['legal', 'Legal / Attorney'],
      ['marketing_agency', 'Marketing Agency'],
      ['weight_loss', 'Weight Loss'],
    ];

    panel.innerHTML = `
      <div class="c2ghl-panel-header">
        <div class="c2ghl-panel-title">
          ⚡ Clone2GHL
        </div>
        <button class="c2ghl-panel-close" id="c2ghl-panel-close">×</button>
      </div>
      <div class="c2ghl-panel-body">
        <div class="c2ghl-ready-badge" id="c2ghl-ready-badge">● GHL Page Ready</div>
        <div class="c2ghl-url-preview" id="c2ghl-url-preview">${window.location.href}</div>

        <div class="c2ghl-label">Niche / Industry</div>
        <select class="c2ghl-select" id="c2ghl-niche-select">
          ${niches.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>

        <div class="c2ghl-toggle-row">
          <div>
            <div class="c2ghl-toggle-label">AI Optimize Copy</div>
            <div class="c2ghl-toggle-sub">Rewrite headlines & CTAs with AI</div>
          </div>
          <label class="c2ghl-toggle">
            <input type="checkbox" id="c2ghl-optimize-toggle">
            <span class="c2ghl-toggle-slider"></span>
          </label>
        </div>

        <div class="c2ghl-status" id="c2ghl-status"></div>

        <button class="c2ghl-btn-primary" id="c2ghl-clone-action-btn">
          ⚡ Clone This Page
        </button>
        <button class="c2ghl-btn-secondary" id="c2ghl-scan-btn">
          🧭 Scan &amp; Select Pages
        </button>

        <div id="c2ghl-scan-wrap" style="display:none;">
          <div class="c2ghl-divider"></div>
          <div class="c2ghl-label" id="c2ghl-scan-count">Pages found</div>
          <div class="c2ghl-scan-list" id="c2ghl-scan-list"></div>
          <div class="c2ghl-scan-actions">
            <button class="c2ghl-btn-secondary" id="c2ghl-scan-all" type="button">Select all</button>
            <button class="c2ghl-btn-primary" id="c2ghl-copy-selected" type="button">Copy Selected</button>
          </div>
          <div class="c2ghl-divider"></div>
        </div>

        <button class="c2ghl-btn-secondary" id="c2ghl-open-dashboard-btn">
          Open Dashboard
        </button>

        <div class="c2ghl-credits" id="c2ghl-credits-display">Loading...</div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    // Events
    document.getElementById('c2ghl-panel-close').addEventListener('click', closePanel);
    document.getElementById('c2ghl-clone-action-btn').addEventListener('click', startClone);
    document.getElementById('c2ghl-scan-btn').addEventListener('click', scanSite);
    document.getElementById('c2ghl-scan-all').addEventListener('click', toggleSelectAll);
    document.getElementById('c2ghl-copy-selected').addEventListener('click', copySelected);
    document.getElementById('c2ghl-open-dashboard-btn').addEventListener('click', openDashboard);

    // Detect a GHL-built source → element-wise clone yields the highest fidelity.
    const badge = document.getElementById('c2ghl-ready-badge');
    if (badge && isGhlBuilt()) {
      badge.textContent = '● GHL site detected — element-wise clone';
      badge.title = 'This page looks GHL-built; Clone2GHL will reconstruct it element-by-element.';
    }

    loadCredits();
    return panel;
  }

  // Lightweight check for GHL/LeadConnector build markers (no full-DOM scan).
  function isGhlBuilt() {
    try {
      if (document.querySelector('script[src*="leadconnectorhq"], script[src*="msgsndr"], [class*="hl-"], [class*="c-section"], [data-hl-page], [id*="hl_"]')) return true;
      const gen = document.querySelector('meta[name="generator"]');
      return gen ? /highlevel|gohighlevel|leadconnector/i.test(gen.content || '') : false;
    } catch { return false; }
  }

  // ─── Panel State ───────────────────────────────────────────────────────────
  let panelVisible = false;

  function togglePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) { createPanel(); panelVisible = true; return; }
    panelVisible = !panelVisible;
    panel.style.display = panelVisible ? 'block' : 'none';
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) { panel.style.display = 'none'; panelVisible = false; }
  }

  function dismissButton() {
    const btn = document.getElementById(BUTTON_ID);
    const panel = document.getElementById(PANEL_ID);
    if (btn) btn.remove();
    if (panel) panel.remove();
  }

  function showStatus(message, type = 'info') {
    const el = document.getElementById('c2ghl-status');
    if (!el) return;
    el.textContent = message;
    el.className = `c2ghl-status ${type}`;
    el.style.display = 'block';
  }

  function setLoading(loading) {
    const btn = document.getElementById('c2ghl-clone-action-btn');
    if (!btn) return;
    if (loading) {
      btn.innerHTML = '<span class="c2ghl-spinner"></span> Cloning…';
      btn.disabled = true;
    } else {
      btn.innerHTML = '⚡ Clone This Page';
      btn.disabled = false;
    }
  }

  async function loadCredits() {
    const el = document.getElementById('c2ghl-credits-display');
    if (!el) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      if (resp?.success && resp.settings) {
        const s = resp.settings;
        if (s.plan === 'free') {
          el.innerHTML = `Free plan: <span>${s.credits} clone${s.credits !== 1 ? 's' : ''}</span> remaining`;
        } else {
          el.innerHTML = `Plan: <span>${s.plan.charAt(0).toUpperCase() + s.plan.slice(1)}</span> — Unlimited`;
        }
      }
    } catch { el.textContent = ''; }
  }

  // ─── Clone Action ──────────────────────────────────────────────────────────
  async function startClone() {
    const niche = document.getElementById('c2ghl-niche-select')?.value || 'general';
    const optimize = document.getElementById('c2ghl-optimize-toggle')?.checked || false;

    setLoading(true);
    showStatus('Extracting page structure…', 'info');

    try {
      // Step 1: Tell background to extract this tab
      const extractResp = await chrome.runtime.sendMessage({
        action: 'EXTRACT_PAGE',
        tabId: null, // background uses sender.tab.id
      });

      if (!extractResp?.success) throw new Error(extractResp?.error || 'Extraction failed');

      showStatus(optimize ? 'Extracted. Running AI optimization…' : 'Extracted. Converting for GHL…', 'info');

      // Step 2: Clone + convert + optionally optimize
      const cloneResp = await chrome.runtime.sendMessage({
        action: 'CLONE_PAGE',
        data: {
          capturedData: extractResp,
          structure: extractResp.structure,
          niche,
          optimize,
        },
      });

      if (!cloneResp?.success) throw new Error(cloneResp?.error || 'Clone failed');

      showStatus('✓ Cloned! Opening your dashboard — next: push it to GoHighLevel.', 'success');
      setLoading(false);
      loadCredits();

      // Auto-open dashboard after 1.5s
      setTimeout(() => {
        openDashboard();
        closePanel();
      }, 1500);

    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error');
      setLoading(false);
    }
  }

  function openDashboard() {
    chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' }).catch(() => {
      window.open(chrome.runtime.getURL('dashboard.html'), '_blank');
    });
  }

  // ─── Scan & Select Pages (multi-page Copy Selected) ─────────────────────────
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function scanSite() {
    const btn = document.getElementById('c2ghl-scan-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
    showStatus('Scanning this site for pages…', 'info');
    try {
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(Boolean);
      const resp = await chrome.runtime.sendMessage({ action: 'SCAN_SITE', data: { url: location.href, pageLinks: links } });
      if (!resp?.success) throw new Error(resp?.error || 'Scan failed');
      renderScanList(resp.pages || []);
      showStatus(`Found ${(resp.pages || []).length} page(s). Pick the ones to clone.`, 'info');
    } catch (err) {
      showStatus(`Scan error: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '🧭 Scan &amp; Select Pages'; }
    }
  }

  function renderScanList(pages) {
    const wrap = document.getElementById('c2ghl-scan-wrap');
    const list = document.getElementById('c2ghl-scan-list');
    const count = document.getElementById('c2ghl-scan-count');
    if (!wrap || !list) return;
    const here = location.href.replace(/#.*$/, '').replace(/\/$/, '');
    list.innerHTML = pages.map((p) => {
      const checked = (p.url.replace(/\/$/, '') === here) ? 'checked' : '';
      return `<label class="c2ghl-scan-item" title="${escapeHtml(p.url)}">
        <input type="checkbox" class="c2ghl-scan-check" value="${escapeHtml(p.url)}" ${checked}>
        <span class="c2ghl-scan-path">${escapeHtml(p.title || p.path || p.url)}</span>
      </label>`;
    }).join('') || '<div style="padding:12px;font-size:12px;color:#9CA3AF;">No pages found. Try cloning this single page instead.</div>';
    if (count) count.textContent = `${pages.length} page(s) found`;
    wrap.style.display = 'block';
  }

  function toggleSelectAll() {
    const checks = Array.from(document.querySelectorAll('.c2ghl-scan-check'));
    const allOn = checks.every(c => c.checked);
    checks.forEach(c => { c.checked = !allOn; });
  }

  async function copySelected() {
    const urls = Array.from(document.querySelectorAll('.c2ghl-scan-check:checked')).map(c => c.value);
    if (!urls.length) { showStatus('Select at least one page first.', 'error'); return; }
    const btn = document.getElementById('c2ghl-copy-selected');
    if (btn) { btn.disabled = true; btn.textContent = 'Capturing…'; }
    showStatus(`Capturing ${urls.length} page(s)…`, 'info');
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CAPTURE_SELECTED', data: { urls } });
      if (!resp?.success) throw new Error(resp?.error || 'Capture failed');
      const n = resp.cloneSet?.count ?? urls.length;
      const dropped = resp.cloneSet?.dropped?.length || 0;
      const failed = resp.cloneSet?.errors?.length || 0;
      let msg = `✓ ${n} page(s) ready to paste. Open your GHL builder, then click “Paste N Pages” in the dashboard.`;
      if (failed) msg += ` (${failed} failed)`;
      if (dropped) msg += ` (${dropped} dropped — too large)`;
      showStatus(msg, 'success');
    } catch (err) {
      showStatus(`Capture error: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Copy Selected'; }
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    createFloatingButton();

    // Auto-enable the builder automation on white-label GHL domains (e.g.
    // app.youragency.com). When we detect the GHL app on a non-default host, ask
    // the background to register the builder scripts there + inject this tab.
    try {
      if (/^app\./i.test(location.host) && location.host !== 'app.gohighlevel.com' && isGhlBuilt()) {
        chrome.runtime.sendMessage({ action: 'REGISTER_GHL_DOMAIN', host: location.host }).catch(() => {});
      }
    } catch (_) { /* ignore */ }

    // Listen for messages from background/popup to trigger clone programmatically
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'SHOW_CLONE_PANEL') {
        if (!document.getElementById(PANEL_ID)) createPanel();
        document.getElementById(PANEL_ID).style.display = 'block';
        panelVisible = true;
        if (message.niche) {
          const sel = document.getElementById('c2ghl-niche-select');
          if (sel) sel.value = message.niche;
        }
        sendResponse({ success: true });
      }
      // Live capture progress while "Copy Selected" runs in the background.
      if (message.action === 'CAPTURE_PROGRESS' && document.getElementById('c2ghl-status')) {
        showStatus(message.message || `Capturing ${message.step}/${message.total}…`, 'info');
      }
    });
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
