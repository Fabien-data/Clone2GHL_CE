/**
 * background.js — Clone2GHL Service Worker
 * Orchestrates: DOM extraction, GHL conversion, AI optimization, storage, API calls.
 */

// Import utility globals via importScripts (classic service worker)
importScripts('ghlApi.js', 'ghlConverter.js', 'aiOptimizer.js', 'funnelAnalyzer.js');

// ─── Storage Helpers ──────────────────────────────────────────────────────────

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || {
    ghlApiKey: '',
    ghlLocationId: '',
    openaiApiKey: '',
    plan: 'free',
    credits: 2,
    theme: 'dark',
  };
}

async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

async function getFunnels() {
  const data = await chrome.storage.local.get('funnels');
  return data.funnels || [];
}

async function saveFunnel(funnel) {
  const funnels = await getFunnels();
  const existingIdx = funnels.findIndex(f => f.id === funnel.id);
  if (existingIdx >= 0) {
    funnels[existingIdx] = { ...funnels[existingIdx], ...funnel, updatedAt: new Date().toISOString() };
  } else {
    funnels.unshift({ ...funnel, createdAt: new Date().toISOString() });
  }
  await chrome.storage.local.set({ funnels });
  return funnel;
}

async function deleteFunnel(id) {
  const funnels = await getFunnels();
  const updated = funnels.filter(f => f.id !== id);
  await chrome.storage.local.set({ funnels: updated });
  return { deleted: true };
}

async function deductCredit() {
  const settings = await getSettings();
  if (settings.plan !== 'free') return true; // paid plans have unlimited
  if (settings.credits <= 0) return false;
  await saveSettings({ credits: settings.credits - 1 });
  return true;
}

function generateId() {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ success: true, ...result }))
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true; // Keep message channel open for async
});

async function handleMessage(message, sender) {
  switch (message.action) {

    // ── Settings ─────────────────────────────────────────────────────────────
    case 'GET_SETTINGS':
      return { settings: await getSettings() };

    case 'SAVE_SETTINGS':
      return { settings: await saveSettings(message.data) };

    case 'VALIDATE_GHL': {
      const s = await getSettings();
      return GHLApi.validateCredentials(message.apiKey || s.ghlApiKey, message.locationId || s.ghlLocationId);
    }

    case 'VALIDATE_OPENAI': {
      return AiOptimizer.validateApiKey(message.apiKey);
    }

    // ── GHL Funnel List (for picker UI) ──────────────────────────────────────
    case 'GET_GHL_FUNNELS': {
      const s = await getSettings();
      if (!s.ghlApiKey || !s.ghlLocationId) throw new Error('GHL credentials not configured.');
      const funnels = await GHLApi.getExistingFunnels(s.ghlApiKey, s.ghlLocationId);
      return { funnels };
    }

    // ── Funnel Storage ────────────────────────────────────────────────────────
    case 'GET_FUNNELS':
      return { funnels: await getFunnels() };

    case 'SAVE_FUNNEL':
      return { funnel: await saveFunnel(message.data) };

    case 'DELETE_FUNNEL':
      return deleteFunnel(message.id);

    // ── Page Cloning ──────────────────────────────────────────────────────────
    case 'CLONE_PAGE': {
      const settings = await getSettings();

      // Credit check
      if (settings.plan === 'free' && settings.credits <= 0) {
        throw new Error('No credits remaining. Upgrade your plan to continue cloning.');
      }

      const { capturedData, niche, optimize, businessName } = message.data;

      // Convert to GHL format
      const converted = GHLConverter.convert(capturedData, {
        replaceForms: true,
        replacePhone: true,
        businessName: businessName || null,
      });

      // Analyze the funnel
      let analysis = null;
      try {
        const structure = message.data.structure || {};
        analysis = FunnelAnalyzer.analyze(structure);
      } catch (e) {
        console.warn('Analysis skipped:', e.message);
      }

      // AI optimization if requested
      let optimizedHtml = null;
      let aiReport = null;
      if (optimize && settings.openaiApiKey) {
        try {
          optimizedHtml = await AiOptimizer.optimizeCopy(
            settings.openaiApiKey,
            converted.ghlHtml,
            niche || (analysis?.detectedNiche) || 'general',
            { businessName }
          );
          if (analysis && settings.openaiApiKey) {
            aiReport = await AiOptimizer.generateIntelligenceReport(
              settings.openaiApiKey,
              message.data.structure || {},
              analysis
            );
          }
        } catch (e) {
          console.warn('AI optimization failed:', e.message);
        }
      }

      // Build funnel record
      const funnel = {
        id: generateId(),
        name: capturedData.meta?.title || 'Cloned Page',
        sourceUrl: capturedData.meta?.url || '',
        niche: niche || analysis?.detectedNiche || 'general',
        status: optimize && optimizedHtml ? 'optimized' : 'draft',
        html: converted.ghlHtml,
        optimizedHtml: optimizedHtml || null,
        analysis: analysis || null,
        aiReport: aiReport || null,
        meta: capturedData.meta || {},
        ghlFunnelId: null,
        ghlPageId: null,
      };

      await saveFunnel(funnel);
      await deductCredit();

      return { funnel };
    }

    // ── AI Optimize Existing ──────────────────────────────────────────────────
    case 'OPTIMIZE_FUNNEL': {
      const { funnelId, niche, businessName } = message.data;
      const settings = await getSettings();
      if (!settings.openaiApiKey) throw new Error('OpenAI API key not configured. Add it in Settings.');

      const funnels = await getFunnels();
      const funnel = funnels.find(f => f.id === funnelId);
      if (!funnel) throw new Error('Funnel not found.');

      const optimizedHtml = await AiOptimizer.optimizeCopy(
        settings.openaiApiKey,
        funnel.html,
        niche || funnel.niche,
        { businessName }
      );

      let aiReport = null;
      if (funnel.analysis) {
        aiReport = await AiOptimizer.generateIntelligenceReport(
          settings.openaiApiKey,
          {},
          funnel.analysis
        ).catch(() => null);
      }

      await saveFunnel({ ...funnel, optimizedHtml, aiReport, status: 'optimized' });
      return { optimizedHtml, aiReport };
    }

    // ── Analyze Existing Funnel ───────────────────────────────────────────────
    case 'ANALYZE_FUNNEL': {
      const structure = message.data;
      const analysis = FunnelAnalyzer.analyze(structure);
      return { analysis };
    }

    // ── Push to GHL ───────────────────────────────────────────────────────────
    case 'PUSH_TO_GHL': {
      const { funnelId, useOptimized } = message.data;
      const settings = await getSettings();

      if (!settings.ghlApiKey) throw new Error('GHL API key not configured. Add it in Settings.');
      if (!settings.ghlLocationId) throw new Error('GHL Location ID not configured. Add it in Settings.');

      const funnels = await getFunnels();
      const funnel = funnels.find(f => f.id === funnelId);
      if (!funnel) throw new Error('Funnel not found.');

      const htmlToUse = (useOptimized && funnel.optimizedHtml) ? funnel.optimizedHtml : funnel.html;

      const result = await GHLApi.pushFunnelToGHL(
        settings.ghlApiKey,
        {
          locationId: settings.ghlLocationId,
          pageName: funnel.name || 'Clone2GHL Page',
          html: htmlToUse,
        },
        (step, total, msg) => {
          // Broadcast progress to any open dashboard
          chrome.runtime.sendMessage({ action: 'GHL_PUSH_PROGRESS', step, total, message: msg })
            .catch(() => {});
        }
      );

      // Update funnel record with GHL IDs
      await saveFunnel({
        ...funnel,
        ghlFunnelId: result.funnelId,
        ghlPageId: result.pageId,
        status: 'exported',
        exportedAt: new Date().toISOString(),
      });

      return result;
    }

    // ── Generate Logo ─────────────────────────────────────────────────────────
    case 'GENERATE_LOGO': {
      const settings = await getSettings();
      if (!settings.openaiApiKey) throw new Error('OpenAI API key not configured. Add it in Settings.');
      return AiOptimizer.generateLogo(settings.openaiApiKey, message.data);
    }

    // ── Generate Headlines ────────────────────────────────────────────────────
    case 'GENERATE_HEADLINES': {
      const settings = await getSettings();
      if (!settings.openaiApiKey) throw new Error('OpenAI API key not configured.');
      const headlines = await AiOptimizer.generateHeadlines(
        settings.openaiApiKey,
        message.niche,
        message.offer
      );
      return { headlines };
    }

    // ── Extract Page (trigger content script) ─────────────────────────────────
    case 'EXTRACT_PAGE': {
      const tabId = message.tabId || sender.tab?.id;
      if (!tabId) throw new Error('No tab ID available');

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractPageInContext,
        world: 'MAIN',
      });

      return results[0]?.result || { error: 'Extraction failed' };
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

// ─── Content Script: extractPageInContext ─────────────────────────────────────
// This function is injected into the page and runs in the page's main world.
function extractPageInContext() {
  function toAbsolute(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
    try { return new URL(url, document.baseURI).href; } catch { return url; }
  }

  // Clone + clean DOM
  const clone = document.documentElement.cloneNode(true);
  const noiseSelectors = ['script', 'noscript', 'iframe', '[id*="cookie"]', '[class*="cookie"]',
    '[id*="chat"]', '[class*="chat"]', '[id*="intercom"]', 'ins.adsbygoogle'];
  for (const sel of noiseSelectors) {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  }
  clone.querySelectorAll('a[href]').forEach(a => {
    a.setAttribute('data-original-href', a.getAttribute('href'));
    a.setAttribute('href', '#');
  });
  clone.querySelectorAll('img[src]').forEach(img => {
    img.setAttribute('src', toAbsolute(img.getAttribute('src')));
  });

  // Get styles
  const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');

  // Structural data
  const headlines = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 10)
    .map(el => ({ tag: el.tagName, text: el.textContent.trim(), level: parseInt(el.tagName[1]) }));
  const ctaButtons = Array.from(document.querySelectorAll('button,a.btn,a.button,[class*="cta"],input[type="submit"]'))
    .slice(0, 10).map(el => ({ text: el.textContent.trim(), tag: el.tagName })).filter(b => b.text.length > 0 && b.text.length < 100);
  const forms = Array.from(document.querySelectorAll('form')).map(form => ({
    fields: Array.from(form.querySelectorAll('input,select,textarea')).map(f => ({
      type: f.type || f.tagName.toLowerCase(), name: f.name || '', placeholder: f.placeholder || '',
    })),
  }));
  const testimonials = Array.from(document.querySelectorAll('[class*="testimonial"],[class*="review"],blockquote'))
    .slice(0, 5).map(el => el.textContent.trim().slice(0, 200));

  return {
    html: clone.outerHTML,
    styles,
    imageSrcs: Array.from(clone.querySelectorAll('img[src]')).map(i => i.src).filter(Boolean),
    meta: {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      url: window.location.href,
      domain: window.location.hostname,
      capturedAt: new Date().toISOString(),
    },
    structure: {
      headlines,
      ctaButtons,
      forms,
      testimonials,
      bodyText: document.body.innerText.slice(0, 5000),
      sections: Array.from(document.querySelectorAll('section,[class*="hero"],[class*="feature"],[class*="testimonial"]'))
        .slice(0, 20).map(el => ({ tag: el.tagName, className: el.className, textLength: el.textContent.trim().length })),
      images: Array.from(document.querySelectorAll('img[src]')).slice(0, 20)
        .map(img => ({ src: toAbsolute(img.src), alt: img.alt })),
      trustSignals: Array.from(document.querySelectorAll('[class*="trust"],[class*="badge"],[class*="guarantee"]'))
        .slice(0, 10).map(el => el.textContent.trim().slice(0, 100)),
      pricingElements: [],
    },
  };
}

// ─── Extension install / update ───────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Set default settings
    await chrome.storage.local.set({
      settings: {
        ghlApiKey: '',
        ghlLocationId: '',
        openaiApiKey: '',
        plan: 'free',
        credits: 2,
        theme: 'dark',
      },
      funnels: [],
    });
    // Open dashboard on first install
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }
});
