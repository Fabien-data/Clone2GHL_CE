/**
 * watchlistChecker.js — Clone2GHL Competitor Watchlist
 * Handles storage and network fetch for watched competitor URLs.
 * Imported by background.js via importScripts — NO DOMParser usage (not available in service workers).
 * All DOM parsing and diffing happens in dashboard.js (extension page context).
 */

const WatchlistChecker = (() => {

  // ─── Storage Helpers ────────────────────────────────────────────────────────

  async function getWatchlist() {
    const d = await chrome.storage.local.get('watchlist');
    return d.watchlist || [];
  }

  async function saveWatchlist(list) {
    await chrome.storage.local.set({ watchlist: list });
  }

  async function addEntry(entry) {
    const list = await getWatchlist();
    list.unshift(entry);
    await saveWatchlist(list);
  }

  async function removeEntry(id) {
    const list = await getWatchlist();
    await saveWatchlist(list.filter(e => e.id !== id));
  }

  async function saveEntry(updated) {
    const list = await getWatchlist();
    const idx = list.findIndex(e => e.id === updated.id);
    if (idx >= 0) {
      list[idx] = updated;
    } else {
      list.unshift(updated);
    }
    await saveWatchlist(list);
  }

  // ─── Network Fetch ──────────────────────────────────────────────────────────
  // Returns { html: string, fetchedAt: ISO } or throws.
  // Uses CORS mode — pages that block CORS will throw with a helpful message.

  async function fetchPageHtml(url) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);

    try {
      const resp = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const html = await resp.text();
      return { html, fetchedAt: new Date().toISOString() };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Request timed out after 15 seconds.');
      }
      throw new Error(`Could not fetch page (${err.message}). The page may block external requests.`);
    } finally {
      clearTimeout(tid);
    }
  }

  return { getWatchlist, saveWatchlist, addEntry, removeEntry, saveEntry, fetchPageHtml };
})();
