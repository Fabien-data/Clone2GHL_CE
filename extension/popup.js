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

  // One-click activation: opens the dashboard straight on the activation form.
  document.getElementById('btn-activate')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') + '#activate' });
    window.close();
  });

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
    let s = resp.settings;

    // Prefer a fresh sync so a purchase/expiry/trial change on clone2ghl.com is
    // reflected the moment the popup opens. Falls back to cached settings offline.
    if (s?.backendEnabled && s?.backendToken) {
      const synced = await chrome.runtime.sendMessage({ action: 'BACKEND_GET_USAGE' }).catch(() => null);
      if (synced?.success && synced.settings) s = synced.settings;
    }

    // Plan badge
    const badge = document.getElementById('plan-badge');
    if (badge) {
      badge.textContent = (s.plan || 'free').toUpperCase();
      badge.className = `plan-badge ${s.plan}`;
    }

    renderCreditsBar(s);

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

const openUrl = (url) => { chrome.tabs.create({ url }); };
const dash = (hash) => chrome.runtime.getURL('dashboard.html') + (hash || '');

// Renders the plan/trial/upgrade status strip with the right CTA.
function renderCreditsBar(s) {
  const bar = document.getElementById('credits-bar');
  if (!bar) return;

  if (s.plan && s.plan !== 'free') {
    bar.innerHTML = `<span class="credits-num">${s.plan.charAt(0).toUpperCase() + s.plan.slice(1)}</span> plan — unlimited clones`;
    return;
  }

  const upgradeTarget = () => openUrl(C2GUpgrade.appendRef(s.upgradeUrl, s.capturedRef) || dash('#pricing'));

  // Must connect a GHL account before the trial unlocks.
  if (s.trialActivationRequired) {
    bar.innerHTML = `<span>🔗 Connect GoHighLevel to start your free trial</span> &nbsp;·&nbsp; <button class="upgrade-link" id="connect-ghl-btn">Connect</button>`;
    document.getElementById('connect-ghl-btn')?.addEventListener('click', () => openUrl(dash('#settings')));
    return;
  }

  // Trial/plan over → upgrade.
  if (s.upgradeRequired) {
    const why = s.state === 'trial_expired' ? 'Your free trial ended'
      : s.state === 'plan_expired' ? 'Your plan expired'
      : "You're out of free clones";
    bar.innerHTML = `<span style="color:var(--gold-light,#e6b800);">${why}</span> &nbsp;·&nbsp; <button class="upgrade-link" id="upgrade-btn">Upgrade</button>`;
    document.getElementById('upgrade-btn')?.addEventListener('click', upgradeTarget);
    return;
  }

  // Active trial.
  const days = typeof s.daysLeft === 'number' ? ` · ${s.daysLeft} day${s.daysLeft !== 1 ? 's' : ''} left` : '';
  bar.innerHTML = `<span class="credits-num">${s.credits}</span> free clone${s.credits !== 1 ? 's' : ''} remaining${days} &nbsp;·&nbsp; <button class="upgrade-link" id="upgrade-btn">Upgrade</button>`;
  document.getElementById('upgrade-btn')?.addEventListener('click', upgradeTarget);
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

    if (!cloneResp?.success) {
      // Route the failure: connect-GHL (start trial) vs upgrade vs generic error.
      if (cloneResp?.data?.ghlRequired || cloneResp?.status === 403) {
        showConnectGhl(cloneResp?.error);
      } else if (cloneResp?.data?.upgradeRequired || /credit|limit|upgrade|trial|402/i.test(cloneResp?.error || '')) {
        showPaywall(cloneResp?.error, cloneResp?.data?.upgrade?.checkoutUrl);
      } else {
        showStatus(`Error: ${cloneResp?.error || 'Clone failed'}`, 'error');
      }
      setLoading(false);
      return;
    }

    showStatus('✓ Saved to your dashboard!', 'success');
    btn.textContent = '✓ Done!';

    await loadSettings();

    // Open dashboard after short delay
    setTimeout(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      window.close();
    }, 1200);

  } catch (err) {
    // Surface a clear upgrade path when the failure is a credit/quota limit.
    if (/credit|limit|upgrade|trial|402/i.test(err.message || '')) {
      showPaywall(err.message);
    } else {
      showStatus(`Error: ${err.message}`, 'error');
    }
    setLoading(false);
  }
}

// Renders an inline call-to-action in the popup status area. `checkoutUrl` (the
// GHL order page) is preferred; falls back to the in-app pricing tab.
function showPaywall(reason, checkoutUrl) {
  const el = document.getElementById('status-box');
  if (!el) return;
  el.className = 'status-box error';
  el.style.display = 'block';
  el.textContent = '';
  const msg = document.createElement('div');
  msg.style.marginBottom = '8px';
  msg.textContent = reason || "You're out of free clones for now.";
  const btn = document.createElement('button');
  btn.className = 'upgrade-link';
  btn.textContent = 'Upgrade your plan →';
  btn.addEventListener('click', () => {
    openUrl(checkoutUrl || dash('#pricing'));
    window.close();
  });
  el.appendChild(msg);
  el.appendChild(btn);
}

// Prompts the user to connect their GoHighLevel account so the trial can start.
function showConnectGhl(reason) {
  const el = document.getElementById('status-box');
  if (!el) return;
  el.className = 'status-box error';
  el.style.display = 'block';
  el.textContent = '';
  const msg = document.createElement('div');
  msg.style.marginBottom = '8px';
  msg.textContent = reason || 'Connect your GoHighLevel account to start your free trial.';
  const btn = document.createElement('button');
  btn.className = 'upgrade-link';
  btn.textContent = 'Connect GoHighLevel →';
  btn.addEventListener('click', () => {
    openUrl(dash('#settings'));
    window.close();
  });
  el.appendChild(msg);
  el.appendChild(btn);
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
