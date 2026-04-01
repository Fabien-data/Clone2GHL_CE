/**
 * popup.js — Clone2GHL Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ─── Load current tab info ───────────────────────────────────────────────
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    document.getElementById('page-title').textContent = tab.title || 'Untitled';
    document.getElementById('page-url').textContent = tab.url || '—';
  }

  // ─── Load settings → credits + plan badge ───────────────────────────────
  await loadSettings();

  // ─── Button events ────────────────────────────────────────────────────────
  document.getElementById('btn-clone').addEventListener('click', startClone);

  document.getElementById('btn-dashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  });

  document.getElementById('btn-library').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') + '#library' });
    window.close();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') + '#settings' });
    window.close();
  });
});

async function loadSettings() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    if (!resp?.success) return;
    const s = resp.settings;

    // Plan badge
    const badge = document.getElementById('plan-badge');
    if (badge) {
      badge.textContent = s.plan.toUpperCase();
      badge.className = `plan-badge ${s.plan}`;
    }

    // Credits bar
    const bar = document.getElementById('credits-bar');
    if (bar) {
      if (s.plan === 'free') {
        bar.innerHTML = `<span class="credits-num">${s.credits}</span> free clone${s.credits !== 1 ? 's' : ''} remaining &nbsp;·&nbsp; <button class="upgrade-link" id="upgrade-btn">Upgrade</button>`;
        document.getElementById('upgrade-btn')?.addEventListener('click', () => {
          chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') + '#pricing' });
        });
      } else {
        bar.innerHTML = `<span class="credits-num">${s.plan.charAt(0).toUpperCase() + s.plan.slice(1)}</span> plan — unlimited clones`;
      }
    }

    // Disable AI toggle if no OpenAI key
    if (!s.openaiApiKey) {
      const toggle = document.getElementById('ai-toggle');
      if (toggle) {
        toggle.disabled = true;
        toggle.parentElement.parentElement.style.opacity = '0.5';
        toggle.parentElement.parentElement.title = 'Add your OpenAI API key in Settings to enable AI optimization';
      }
    }
  } catch (e) {
    console.warn('Failed to load settings', e);
  }
}

async function startClone() {
  const btn = document.getElementById('btn-clone');
  const niche = document.getElementById('niche-select').value;
  const optimize = document.getElementById('ai-toggle').checked;

  setLoading(true);
  showStatus('Extracting page…', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    // Trigger extraction via background
    const extractResp = await chrome.runtime.sendMessage({
      action: 'EXTRACT_PAGE',
      tabId: tab.id,
    });

    if (!extractResp?.success) throw new Error(extractResp?.error || 'Failed to extract page');

    showStatus(optimize ? 'Running AI optimization…' : 'Converting to GHL…', 'info');

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

    showStatus('✓ Saved to your dashboard!', 'success');
    btn.textContent = '✓ Done!';

    await loadSettings();

    // Open dashboard after short delay
    setTimeout(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      window.close();
    }, 1200);

  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
    setLoading(false);
  }
}

function showStatus(text, type) {
  const el = document.getElementById('status-box');
  if (!el) return;
  el.textContent = text;
  el.className = `status-box ${type}`;
  el.style.display = 'block';
}

function setLoading(loading) {
  const btn = document.getElementById('btn-clone');
  if (!btn) return;
  if (loading) {
    btn.innerHTML = '<span class="btn-spinner"></span> Cloning…';
    btn.disabled = true;
  } else {
    btn.innerHTML = '⚡ Clone This Page';
    btn.disabled = false;
  }
}
