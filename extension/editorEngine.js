/**
 * extension/editorEngine.js — advanced Visual Editor engine.
 *
 * Powers the upgraded customizer: click-to-select + element inspector, inline
 * text editing, toolbar-based structural editing (move/duplicate/delete/add),
 * snapshot-based undo/redo, and debounced autosave drafts.
 *
 * Loaded before dashboard.js; both are classic scripts sharing the global
 * scope, so dashboard globals (editorState, getEditorDoc, addPatch,
 * renderEditorPreview, buildUniqueSelector, showSaveToast, escHtml,
 * serializeIframeToHtml, switchEditorPanel, updateEditorUnsavedIndicator)
 * are referenced lazily at call time.
 *
 * Invariants:
 *  - Every mutation flows through commit(): one history snapshot per user
 *    action, dirty flag set, autosave scheduled. commit() is nesting-safe so
 *    batch operations (Fix All, "apply logo to N elements") are ONE undo step.
 *  - The floating toolbar/breadcrumb live in the PARENT document, never inside
 *    the iframe, so they cannot leak into saved HTML.
 *  - All style edits are inline styles or rules in #c2ghl-user-css keyed by
 *    generated c2ghl-el-N classes — both survive serializeIframeToHtml().
 */
(function (global) {
  'use strict';

  const HISTORY_CAP = 30;
  const AUTOSAVE_DEBOUNCE_MS = 4000;
  const IMG_UPLOAD_CAP_BYTES = 400 * 1024;
  const NO_TAG = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'BR', 'TEMPLATE', 'TITLE', 'HEAD']);
  const TEXT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'SPAN', 'A', 'BUTTON', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'LABEL', 'DIV', 'EM', 'STRONG', 'B', 'I', 'SMALL']);
  const BLOCK_TAGS = 'section,header,footer,main,article,aside';
  const SANITIZE_ALLOWED = new Set(['B', 'I', 'U', 'EM', 'STRONG', 'A', 'BR', 'SPAN', 'SMALL', 'SUP', 'SUB']);

  // ── Internal state (per editor session; reset by resetHistory) ──────────────
  let inCommit = false;
  let autosaveTimer = null;
  let pendingRestore = null;          // { scrollY, selectedId } consumed on iframe load
  let inlineEditEl = null;            // element currently contentEditable
  let inlineEditBefore = '';          // its innerHTML before editing
  let inlineEditSnapshotTaken = false;

  // NOTE: `editorState` is a top-level const in dashboard.js — script-level
  // consts live in the shared global lexical scope but do NOT attach to
  // window, so we must reference the bare identifier (resolved at call time,
  // after dashboard.js has loaded).
  function state() { try { return editorState; } catch { return null; } }
  function doc() { return global.getEditorDoc ? global.getEditorDoc() : null; }
  function iframe() { return document.getElementById('editor-iframe'); }
  function toast(msg) { if (global.showSaveToast) global.showSaveToast(msg); }

  // ── Tagging ─────────────────────────────────────────────────────────────────
  function tagAll(d) {
    if (!d || !d.body) return;
    let max = -1;
    d.querySelectorAll('[data-c2ghl-id]').forEach((el) => {
      const m = /^c2g(\d+)$/.exec(el.getAttribute('data-c2ghl-id') || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    let counter = max + 1;
    d.body.querySelectorAll('*').forEach((el) => {
      if (NO_TAG.has(el.tagName)) return;
      if (el.closest('svg') && el.tagName !== 'svg' && el.tagName !== 'SVG') return; // tag the <svg> root only
      if (!el.hasAttribute('data-c2ghl-id')) el.setAttribute('data-c2ghl-id', `c2g${counter++}`);
    });
  }

  // ── Editor styles (iframe-side; stripped on serialize) ─────────────────────
  function injectStyles(d) {
    d.getElementById('c2ghl-bridge')?.remove(); // legacy bridge, if present in old drafts
    d.getElementById('c2ghl-editor-styles')?.remove();
    const style = d.createElement('style');
    style.id = 'c2ghl-editor-styles';
    style.textContent = `
      [data-c2ghl-id] { cursor: pointer !important; }
      .c2ghl-hover { outline: 2px dashed #D9A620 !important; outline-offset: 2px !important; }
      .c2ghl-selected { outline: 2px solid #F0BB2D !important; outline-offset: 2px !important; }
      .c2ghl-risk { outline: 2px solid #EF4444 !important; background: rgba(239,68,68,0.12) !important; }
      .c2ghl-editing { outline: 2px solid #22C55E !important; outline-offset: 2px !important; cursor: text !important; }
    `;
    d.head.appendChild(style);
  }

  // ── Event wiring (parent-attached; no injected script, no CSP issues) ──────
  function attach(d) {
    if (!d || d.__c2ghlAttached) return;
    d.__c2ghlAttached = true;

    d.addEventListener('click', (e) => {
      if (inlineEditEl) {
        if (!inlineEditEl.contains(e.target)) endInlineEdit(true);
        else return; // clicks inside the live edit are the caret moving
      }
      const link = e.target.closest && e.target.closest('a');
      if (link) e.preventDefault();
      const el = e.target.closest ? e.target.closest('[data-c2ghl-id]') : null;
      if (el) {
        e.stopPropagation();
        select(el);
      }
    }, true);

    d.addEventListener('dblclick', (e) => {
      const el = e.target.closest ? e.target.closest('[data-c2ghl-id]') : null;
      if (el) {
        e.preventDefault();
        startInlineEdit(el);
      }
    }, true);

    d.addEventListener('mouseover', (e) => {
      d.querySelectorAll('.c2ghl-hover').forEach((x) => x.classList.remove('c2ghl-hover'));
      const el = e.target.closest ? e.target.closest('[data-c2ghl-id]') : null;
      if (el && !el.classList.contains('c2ghl-selected') && !el.classList.contains('c2ghl-editing')) {
        el.classList.add('c2ghl-hover');
      }
    }, true);

    // Never let cloned forms navigate the preview iframe.
    d.addEventListener('submit', (e) => e.preventDefault(), true);

    let scrollRaf = 0;
    (d.defaultView || d).addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; positionToolbar(); });
    }, { passive: true });
    d.addEventListener('keydown', onKeydown, true);
  }

  function onKeydown(e) {
    const t = e.target;
    const typing = t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (e.key === 'Escape') {
      if (inlineEditEl) { e.preventDefault(); endInlineEdit(false); return; } // Esc = cancel edit
      clearSelection();
      return;
    }
    if (inlineEditEl && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      endInlineEdit(true);
      return;
    }
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if ((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); }
  }

  // ── Selection + breadcrumb ──────────────────────────────────────────────────
  function select(el) {
    const d = doc();
    const s = state();
    if (!d || !el || !s) return;
    d.querySelectorAll('.c2ghl-selected').forEach((x) => x.classList.remove('c2ghl-selected'));
    el.classList.remove('c2ghl-hover');
    el.classList.add('c2ghl-selected');
    s.selectedId = el.getAttribute('data-c2ghl-id') || null;
    renderBreadcrumb(el);
    positionToolbar();
    if (global.switchEditorPanel) global.switchEditorPanel('element');
  }

  function clearSelection() {
    const d = doc();
    if (d) d.querySelectorAll('.c2ghl-selected').forEach((x) => x.classList.remove('c2ghl-selected'));
    if (state()) state().selectedId = null;
    renderBreadcrumb(null);
    positionToolbar();
    const content = document.getElementById('editor-panel-content');
    if (content && state()?.activePanelId === 'element') renderInspector(content);
  }

  function getSelectedEl() {
    const d = doc();
    const id = state()?.selectedId;
    if (!d || !id) return null;
    return d.querySelector(`[data-c2ghl-id="${id}"]`);
  }

  function renderBreadcrumb(el) {
    const bar = document.getElementById('editor-breadcrumb');
    if (!bar) return;
    if (!el) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    const chain = [];
    let cur = el;
    while (cur && cur.tagName !== 'BODY' && chain.length < 6) {
      chain.unshift(cur);
      cur = cur.parentElement;
    }
    bar.style.display = 'flex';
    bar.innerHTML = chain.map((c, i) => {
      const cls = typeof c.className === 'string' && c.className.trim()
        ? '.' + c.className.trim().split(/\s+/).filter((x) => !x.startsWith('c2ghl-'))[0] : '';
      const label = c.tagName.toLowerCase() + (cls && cls !== '.' ? cls.slice(0, 18) : '');
      return `<button class="ee-crumb${i === chain.length - 1 ? ' active' : ''}" data-crumb-id="${c.getAttribute('data-c2ghl-id') || ''}">${global.escHtml ? global.escHtml(label) : label}</button>`;
    }).join('<span class="ee-crumb-sep">›</span>');
    bar.querySelectorAll('.ee-crumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = doc();
        const target = d && d.querySelector(`[data-c2ghl-id="${btn.dataset.crumbId}"]`);
        if (target) {
          select(target);
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  // ── Commit gateway + history ───────────────────────────────────────────────
  function commit(label, mutateFn) {
    const d = doc();
    if (!d) return;
    const nested = inCommit;
    if (!nested) pushHistorySnapshot();
    inCommit = true;
    try {
      mutateFn(d);
    } finally {
      if (!nested) inCommit = false;
    }
    markDirty();
    scheduleAutosave();
  }

  function currentHtml() {
    const d = doc();
    // Keep the doctype so undo/redo re-renders don't fall into quirks mode.
    return d ? '<!DOCTYPE html>' + d.documentElement.outerHTML : (state()?.workingHtml || '');
  }

  function pushHistorySnapshot() {
    const s = state();
    if (!s) return;
    s.historyUndo.push(currentHtml());
    if (s.historyUndo.length > HISTORY_CAP) s.historyUndo.shift();
    s.historyRedo.length = 0;
    updateHistoryButtons();
  }

  function undo() {
    const s = state();
    if (!s || !s.historyUndo.length) return;
    if (inlineEditEl) endInlineEdit(false);
    s.historyRedo.push(currentHtml());
    rerenderFrom(s.historyUndo.pop());
  }

  function redo() {
    const s = state();
    if (!s || !s.historyRedo.length) return;
    if (inlineEditEl) endInlineEdit(false);
    s.historyUndo.push(currentHtml());
    rerenderFrom(s.historyRedo.pop());
  }

  function rerenderFrom(html) {
    const s = state();
    const win = iframe()?.contentWindow;
    pendingRestore = { scrollY: win ? win.scrollY : 0, selectedId: s.selectedId };
    s.workingHtml = html;
    markDirty();
    scheduleAutosave();
    global.renderEditorPreview();
    updateHistoryButtons();
  }

  function resetHistory() {
    const s = state();
    if (!s) return;
    s.historyUndo = [];
    s.historyRedo = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const s = state();
    const u = document.getElementById('editor-btn-undo');
    const r = document.getElementById('editor-btn-redo');
    if (u) u.disabled = !s || !s.historyUndo.length;
    if (r) r.disabled = !s || !s.historyRedo.length;
  }

  function markDirty() {
    const s = state();
    if (!s) return;
    s.dirty = true;
    if (global.updateEditorUnsavedIndicator) global.updateEditorUnsavedIndicator();
  }

  // ── Iframe load orchestration ──────────────────────────────────────────────
  function onIframeLoad(d) {
    const s = state();
    if (!d || !s) return;
    injectStyles(d);
    tagAll(d);
    attach(d);
    ensureToolbar();
    if (pendingRestore) {
      const { scrollY, selectedId } = pendingRestore;
      pendingRestore = null;
      if (selectedId) {
        const el = d.querySelector(`[data-c2ghl-id="${selectedId}"]`);
        if (el) {
          d.querySelectorAll('.c2ghl-selected').forEach((x) => x.classList.remove('c2ghl-selected'));
          el.classList.add('c2ghl-selected');
          s.selectedId = selectedId;
          renderBreadcrumb(el);
        } else {
          s.selectedId = null;
          renderBreadcrumb(null);
        }
      }
      const win = iframe()?.contentWindow;
      if (win) win.scrollTo(0, scrollY || 0);
    } else {
      // fresh render — clear any restored selection classes from snapshots
      const stale = s.selectedId ? d.querySelector(`[data-c2ghl-id="${s.selectedId}"]`) : null;
      if (!stale) {
        s.selectedId = null;
        renderBreadcrumb(null);
      } else {
        renderBreadcrumb(stale);
      }
    }
    positionToolbar();
    updateHistoryButtons();
  }

  // ── Autosave drafts ────────────────────────────────────────────────────────
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveDraftNow, AUTOSAVE_DEBOUNCE_MS);
  }

  async function saveDraftNow() {
    const s = state();
    if (!s || !s.isOpen || !s.dirty) return;
    try {
      const html = global.serializeIframeToHtml();
      let draft;
      if (s.mode === 'cloneSet') {
        if (s.pages[s.activePageIndex]) {
          s.pages[s.activePageIndex].html = html;
          s.pages[s.activePageIndex].dirty = true;
        }
        draft = {
          kind: 'cloneSet',
          refId: s.cloneSetId,
          pageIndex: s.activePageIndex,
          dirtyPages: s.pages.filter((p) => p.dirty).map((p) => ({ index: p.index, name: p.name, html: p.html })),
          savedAt: Date.now(),
        };
      } else {
        draft = { kind: 'funnel', refId: s.funnelId, html, patches: s.patches, savedAt: Date.now() };
      }
      await chrome.storage.local.set({ editorDraft: draft });
    } catch (e) {
      console.warn('[editor] draft autosave failed:', e?.message || e);
    }
  }

  async function loadDraft(kind, refId) {
    try {
      const { editorDraft } = await chrome.storage.local.get('editorDraft');
      if (editorDraft && editorDraft.kind === kind && editorDraft.refId === refId) return editorDraft;
    } catch { /* storage unavailable */ }
    return null;
  }

  async function clearDraft() {
    clearTimeout(autosaveTimer);
    try { await chrome.storage.local.remove('editorDraft'); } catch { /* ignore */ }
  }

  // ── Inline text editing ────────────────────────────────────────────────────
  function isTextEditable(el) {
    if (!el || !TEXT_TAGS.has(el.tagName)) return false;
    if (el.querySelector('img,svg,video,iframe,form,section')) return false;
    return (el.textContent || '').trim().length > 0 || el.children.length === 0;
  }

  function startInlineEdit(el) {
    if (!el || !isTextEditable(el)) return;
    if (inlineEditEl === el) return;
    if (inlineEditEl) endInlineEdit(true);
    pushHistorySnapshot();
    inlineEditSnapshotTaken = true;
    inlineEditEl = el;
    inlineEditBefore = el.innerHTML;
    el.classList.remove('c2ghl-hover');
    el.classList.add('c2ghl-editing');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.focus();
    try {
      const d = el.ownerDocument;
      const range = d.createRange();
      range.selectNodeContents(el);
      const sel = d.defaultView.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch { /* selection best-effort */ }
    el.addEventListener('blur', onInlineBlur);
  }

  function onInlineBlur() { endInlineEdit(true); }

  function endInlineEdit(keepChanges) {
    const el = inlineEditEl;
    if (!el) return;
    inlineEditEl = null;
    el.removeEventListener('blur', onInlineBlur);
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    el.classList.remove('c2ghl-editing');

    if (keepChanges) sanitizeInline(el);
    const changed = keepChanges && el.innerHTML !== inlineEditBefore;
    if (!keepChanges) el.innerHTML = inlineEditBefore;

    if (changed) {
      global.addPatch({
        type: 'html',
        selector: global.buildUniqueSelector(el),
        attribute: null,
        oldValue: inlineEditBefore.slice(0, 400),
        newValue: el.innerHTML.slice(0, 400),
      });
      markDirty();
      scheduleAutosave();
      const content = document.getElementById('editor-panel-content');
      if (content && state()?.activePanelId === 'element') renderInspector(content);
    } else if (inlineEditSnapshotTaken) {
      state()?.historyUndo.pop(); // nothing changed — drop the pre-taken snapshot
      updateHistoryButtons();
    }
    inlineEditSnapshotTaken = false;
    inlineEditBefore = '';
  }

  /** Allowlist sanitizer for contentEditable output. */
  function sanitizeInline(rootEl) {
    const walk = (el) => {
      [...el.children].forEach((child) => {
        walk(child);
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'IFRAME' || child.tagName === 'OBJECT' || child.tagName === 'EMBED') {
          child.remove();
          return;
        }
        // Strip event handlers + javascript: URLs everywhere.
        [...child.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on')) child.removeAttribute(attr.name);
          if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) child.removeAttribute(attr.name);
        });
        if (!SANITIZE_ALLOWED.has(child.tagName) && !child.hasAttribute('data-c2ghl-id')) {
          // Unwrap unknown wrappers pasted in (divs, fonts, etc.) but keep their text.
          while (child.firstChild) el.insertBefore(child.firstChild, child);
          child.remove();
        }
      });
    };
    walk(rootEl);
  }

  // ── Structural editing ─────────────────────────────────────────────────────
  function resolveBlock(el) {
    if (!el) return null;
    const d = el.ownerDocument;
    const semantic = el.closest(BLOCK_TAGS);
    if (semantic && semantic !== d.body) return semantic;
    let cur = el;
    while (cur.parentElement && cur.parentElement !== d.body && cur.parentElement.tagName !== 'MAIN') {
      cur = cur.parentElement;
    }
    return cur === d.body ? null : cur;
  }

  const C2GHL_TEMPLATES = {
    heading: { label: 'Heading', html: '<h2 style="font-size:32px;font-weight:700;margin:24px 0 12px;text-align:center;">New Heading</h2>' },
    paragraph: { label: 'Paragraph', html: '<p style="font-size:16px;line-height:1.6;margin:12px 0;">New paragraph text. Double-click to edit.</p>' },
    button: { label: 'Button', html: '<div style="text-align:center;margin:16px 0;"><a href="#" style="display:inline-block;padding:12px 28px;background:#D9A620;color:#111;border-radius:8px;font-weight:700;text-decoration:none;">Click Here</a></div>' },
    image: { label: 'Image', html: '<div style="text-align:center;margin:16px 0;"><img src="https://placehold.co/600x300?text=Your+Image" alt="Image" style="max-width:100%;border-radius:8px;"></div>' },
    spacer: { label: 'Spacer', html: '<div style="height:48px;"></div>' },
    divider: { label: 'Divider', html: '<hr style="border:none;border-top:1px solid rgba(128,128,128,0.35);margin:24px 0;">' },
    columns: { label: '2 Columns', html: '<div style="display:flex;gap:24px;flex-wrap:wrap;margin:16px 0;"><div style="flex:1;min-width:240px;"><p style="font-size:16px;line-height:1.6;">Left column text.</p></div><div style="flex:1;min-width:240px;"><p style="font-size:16px;line-height:1.6;">Right column text.</p></div></div>' },
    customHtml: { label: 'Custom HTML', html: null },
  };

  function moveBlock(dir) {
    const el = getSelectedEl();
    const block = resolveBlock(el);
    if (!block) return;
    const sib = dir < 0 ? block.previousElementSibling : block.nextElementSibling;
    if (!sib) { toast(dir < 0 ? 'Already at the top' : 'Already at the bottom'); return; }
    commit('move-block', () => {
      if (dir < 0) block.parentNode.insertBefore(block, sib);
      else block.parentNode.insertBefore(sib, block);
      global.addPatch({ type: 'move', selector: global.buildUniqueSelector(block), attribute: null, oldValue: null, newValue: dir < 0 ? 'up' : 'down' });
    });
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    positionToolbar();
  }

  function duplicateBlock() {
    const el = getSelectedEl();
    const block = resolveBlock(el);
    if (!block) return;
    commit('duplicate-block', (d) => {
      const clone = block.cloneNode(true);
      clone.querySelectorAll('[data-c2ghl-id]').forEach((x) => x.removeAttribute('data-c2ghl-id'));
      clone.removeAttribute('data-c2ghl-id');
      clone.classList.remove('c2ghl-selected', 'c2ghl-hover', 'c2ghl-editing');
      block.after(clone);
      tagAll(d);
      global.addPatch({ type: 'duplicate', selector: global.buildUniqueSelector(block), attribute: null, oldValue: null, newValue: 'duplicated' });
      select(clone);
    });
    toast('Block duplicated');
  }

  function deleteBlock() {
    const el = getSelectedEl();
    const block = resolveBlock(el);
    if (!block) return;
    const big = (block.textContent || '').trim().length > 500;
    if (big && !confirm('Delete this entire section?')) return;
    removeElement(block);
  }

  function removeElement(el) {
    if (!el) return;
    commit('delete-element', () => {
      global.addPatch({ type: 'element-remove', selector: global.buildUniqueSelector(el), attribute: null, oldValue: el.outerHTML.slice(0, 200), newValue: '' });
      el.remove();
    });
    clearSelection();
    toast('Element deleted');
  }

  function addTemplate(key) {
    const tpl = C2GHL_TEMPLATES[key];
    if (!tpl) return;
    if (key === 'customHtml') { openCustomHtmlModal(); return; }
    insertHtmlAfterSelection(tpl.html, tpl.label);
  }

  function insertHtmlAfterSelection(html, label) {
    const d = doc();
    if (!d) return;
    const el = getSelectedEl();
    const anchor = resolveBlock(el) || d.body.lastElementChild;
    commit('add-element', () => {
      const holder = d.createElement('template');
      holder.innerHTML = html;
      const nodes = [...holder.content.children];
      if (!nodes.length) return;
      let ref = anchor;
      nodes.forEach((n) => {
        if (ref && ref.parentNode) ref.after(n);
        else d.body.appendChild(n);
        ref = n;
      });
      tagAll(d);
      global.addPatch({ type: 'element-add', selector: 'body', attribute: null, oldValue: null, newValue: label || 'element' });
      const first = nodes[0];
      if (first && first.nodeType === 1) {
        select(first);
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    toast(`${label || 'Element'} added`);
  }

  function openCustomHtmlModal() {
    document.getElementById('ee-html-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'ee-html-modal';
    overlay.innerHTML = `
      <div class="ee-modal-box">
        <div class="ee-modal-title">Insert Custom HTML</div>
        <textarea class="ee-modal-textarea" placeholder="<div>Your HTML here…</div>" rows="8"></textarea>
        <div class="ee-modal-actions">
          <button class="btn-secondary editor-btn-sm" id="ee-html-cancel">Cancel</button>
          <button class="btn-primary editor-btn-sm" id="ee-html-insert">Insert</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const ta = overlay.querySelector('textarea');
    ta.focus();
    overlay.querySelector('#ee-html-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#ee-html-insert').addEventListener('click', () => {
      const html = ta.value.trim();
      overlay.remove();
      if (!html) return;
      // Never allow script/event-handler injection through this door.
      const cleaned = html
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      insertHtmlAfterSelection(cleaned, 'Custom HTML');
    });
  }

  // ── Floating toolbar (parent DOM — can never leak into saved HTML) ─────────
  function ensureToolbar() {
    if (document.getElementById('editor-el-toolbar')) return;
    const container = document.getElementById('editor-preview-container');
    if (!container) return;
    const bar = document.createElement('div');
    bar.id = 'editor-el-toolbar';
    bar.style.display = 'none';
    bar.innerHTML = `
      <button data-act="parent" title="Select parent element">⬆</button>
      <button data-act="up" title="Move block up">▲</button>
      <button data-act="down" title="Move block down">▼</button>
      <button data-act="dup" title="Duplicate block">⧉</button>
      <button data-act="add" title="Add element below">✚</button>
      <button data-act="del" title="Delete block" class="ee-danger">🗑</button>
      <div id="ee-add-menu" style="display:none;"></div>`;
    container.appendChild(bar);

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'up') moveBlock(-1);
      else if (act === 'down') moveBlock(1);
      else if (act === 'dup') duplicateBlock();
      else if (act === 'del') deleteBlock();
      else if (act === 'parent') {
        const el = getSelectedEl();
        if (el?.parentElement && el.parentElement.tagName !== 'BODY' && el.parentElement.tagName !== 'HTML') select(el.parentElement);
      } else if (act === 'add') toggleAddMenu();
    });
  }

  function toggleAddMenu() {
    const menu = document.getElementById('ee-add-menu');
    if (!menu) return;
    if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
    menu.innerHTML = Object.entries(C2GHL_TEMPLATES)
      .map(([key, t]) => `<button data-tpl="${key}">${t.label}</button>`).join('');
    menu.style.display = 'block';
    menu.querySelectorAll('button[data-tpl]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        addTemplate(b.dataset.tpl);
      });
    });
  }

  function positionToolbar() {
    const bar = document.getElementById('editor-el-toolbar');
    if (!bar) return;
    const el = getSelectedEl();
    const frame = iframe();
    const container = document.getElementById('editor-preview-container');
    if (!el || !frame || !container || !state()?.isOpen) {
      bar.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    const top = frameRect.top - contRect.top + rect.top + container.scrollTop;
    const left = frameRect.left - contRect.left + rect.left;
    // Hide when the element is scrolled out of the visible frame.
    if (rect.bottom < 0 || rect.top > frameRect.height) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const barTop = Math.max(0, top - 34);
    bar.style.top = `${barTop}px`;
    bar.style.left = `${Math.max(0, Math.min(left, container.clientWidth - 230))}px`;
  }

  // ── Element inspector ──────────────────────────────────────────────────────
  function ensureUserCssStyle(d) {
    let st = d.getElementById('c2ghl-user-css');
    if (!st) {
      st = d.createElement('style');
      st.id = 'c2ghl-user-css';
      d.head.appendChild(st);
    }
    return st;
  }

  function customCssClassFor(el) {
    const existing = [...el.classList].find((c) => /^c2ghl-el-\d+$/.test(c));
    if (existing) return existing;
    const d = el.ownerDocument;
    let max = 0;
    d.querySelectorAll('[class*="c2ghl-el-"]').forEach((x) => {
      x.classList.forEach((c) => {
        const m = /^c2ghl-el-(\d+)$/.exec(c);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
    });
    const cls = `c2ghl-el-${max + 1}`;
    el.classList.add(cls);
    return cls;
  }

  function getCustomCss(el) {
    const cls = [...el.classList].find((c) => /^c2ghl-el-\d+$/.test(c));
    if (!cls) return '';
    const st = el.ownerDocument.getElementById('c2ghl-user-css');
    if (!st) return '';
    const m = new RegExp(`/\\* ${cls} start \\*/\\s*\\.${cls}\\s*\\{([\\s\\S]*?)\\}\\s*/\\* ${cls} end \\*/`).exec(st.textContent);
    return m ? m[1].trim() : '';
  }

  function setCustomCss(el, cssBody) {
    commit('custom-css', (d) => {
      const cls = customCssClassFor(el);
      const st = ensureUserCssStyle(d);
      const blockRx = new RegExp(`/\\* ${cls} start \\*/[\\s\\S]*?/\\* ${cls} end \\*/\\n?`);
      st.textContent = st.textContent.replace(blockRx, '');
      if (cssBody.trim()) {
        st.textContent += `\n/* ${cls} start */\n.${cls} {\n${cssBody.trim()}\n}\n/* ${cls} end */`;
      }
      global.addPatch({ type: 'custom-css', selector: global.buildUniqueSelector(el), attribute: cls, oldValue: null, newValue: cssBody.slice(0, 300) });
    });
  }

  function applyStyle(el, prop, value, label) {
    commit('style', () => {
      const old = el.style[prop];
      el.style[prop] = value;
      global.addPatch({ type: 'style', selector: global.buildUniqueSelector(el), attribute: prop, oldValue: old, newValue: value });
    });
    if (label) toast(label);
  }

  function applyAttr(el, attr, value) {
    commit('attr', () => {
      const old = el.getAttribute(attr);
      if (value === null || value === '') el.removeAttribute(attr);
      else el.setAttribute(attr, value);
      global.addPatch({ type: 'attr', selector: global.buildUniqueSelector(el), attribute: attr, oldValue: old, newValue: value });
    });
  }

  function hideElement(el) {
    commit('hide', () => {
      el.style.display = 'none';
      el.setAttribute('data-c2ghl-hidden', '1');
      global.addPatch({ type: 'style', selector: global.buildUniqueSelector(el), attribute: 'display', oldValue: '', newValue: 'none' });
    });
    clearSelection();
    toast('Element hidden — see "Hidden elements" in the panel to restore');
  }

  function unhideElement(el) {
    commit('unhide', () => {
      el.style.display = '';
      el.removeAttribute('data-c2ghl-hidden');
      global.addPatch({ type: 'style', selector: global.buildUniqueSelector(el), attribute: 'display', oldValue: 'none', newValue: '' });
    });
  }

  function rgbToHexSafe(v) {
    const fn = global.normalizeToHex;
    return (fn && fn(v)) || '#000000';
  }

  function fieldRow(label, inner) {
    return `<div class="editor-field ee-field"><label>${label}</label>${inner}</div>`;
  }

  function renderInspector(content) {
    const el = getSelectedEl();
    if (!el) {
      content.innerHTML = `
        <div class="ee-empty">
          <div style="font-size:28px;margin-bottom:8px;">🎯</div>
          <div style="font-weight:700;font-size:13px;">Click any element in the preview</div>
          <div style="font-size:12px;color:var(--text4);margin-top:6px;line-height:1.5;">
            Single-click selects an element.<br>Double-click edits text in place.<br>
            Use the floating toolbar to move, duplicate,<br>delete or add blocks.
          </div>
        </div>
        ${renderHiddenList()}`;
      wireHiddenList(content);
      return;
    }

    const d = el.ownerDocument;
    const cs = d.defaultView.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const isImg = tag === 'img';
    const isLink = tag === 'a';
    const isBtn = tag === 'button' || (isLink && /btn|button|cta/i.test(el.className || ''));
    const hasText = isTextEditable(el);
    const esc = global.escHtml || ((s) => s);

    let html = `<div class="editor-section-title">Selected: &lt;${tag}&gt;</div>`;

    if (hasText && !isImg) {
      html += `<div class="editor-section-title ee-sub">Text</div>`;
      html += fieldRow('Content', `<textarea id="ee-text" rows="3">${esc(el.textContent.trim())}</textarea>
        <button class="btn-editor-xs primary" id="ee-text-apply" style="margin-top:6px;">✓ Apply Text</button>`);
      html += `<div class="ee-grid2">
        ${fieldRow('Font size', `<input type="text" id="ee-font-size" placeholder="${esc(cs.fontSize)}" value="">`)}
        ${fieldRow('Weight', `<select id="ee-font-weight"><option value="">(${esc(cs.fontWeight)})</option><option>400</option><option>500</option><option>600</option><option>700</option><option>800</option></select>`)}
        ${fieldRow('Text color', `<input type="color" id="ee-color" value="${rgbToHexSafe(cs.color)}">`)}
        ${fieldRow('Line height', `<input type="text" id="ee-line-height" placeholder="${esc(cs.lineHeight)}" value="">`)}
      </div>`;
    }

    if (isImg) {
      html += `<div class="editor-section-title ee-sub">Image</div>`;
      html += `<div class="ee-img-preview"><img src="${esc(el.src)}" alt=""></div>`;
      html += fieldRow('Image URL', `<input type="url" id="ee-img-src" value="${esc(el.getAttribute('src') || '')}">
        <button class="btn-editor-xs primary" id="ee-img-src-apply" style="margin-top:6px;">✓ Apply URL</button>`);
      html += fieldRow('Upload from disk (max 400 KB)', `<label class="btn-editor-xs neutral" style="cursor:pointer;display:inline-block;">📁 Choose file<input type="file" id="ee-img-upload" accept="image/*" style="display:none;"></label>`);
      html += `<div class="ee-grid2">
        ${fieldRow('Alt text', `<input type="text" id="ee-img-alt" value="${esc(el.getAttribute('alt') || '')}">`)}
        ${fieldRow('Object fit', `<select id="ee-object-fit"><option value="">(default)</option><option>cover</option><option>contain</option><option>fill</option></select>`)}
        ${fieldRow('Width', `<input type="text" id="ee-img-w" placeholder="${esc(cs.width)}">`)}
        ${fieldRow('Border radius', `<input type="text" id="ee-radius-img" placeholder="${esc(cs.borderRadius)}">`)}
      </div>`;
    }

    if (isLink || isBtn) {
      html += `<div class="editor-section-title ee-sub">${isBtn ? 'Button' : 'Link'}</div>`;
      html += fieldRow('Link (href)', `<input type="text" id="ee-href" value="${esc(el.getAttribute('href') || '')}">`);
      html += fieldRow('', `<label class="ee-check"><input type="checkbox" id="ee-target" ${el.getAttribute('target') === '_blank' ? 'checked' : ''}> Open in new tab</label>`);
      if (isBtn) {
        html += `<div class="ee-grid2">
          ${fieldRow('Background', `<input type="color" id="ee-btn-bg" value="${rgbToHexSafe(cs.backgroundColor)}">`)}
          ${fieldRow('Text color', `<input type="color" id="ee-btn-color" value="${rgbToHexSafe(cs.color)}">`)}
          ${fieldRow('Radius', `<input type="text" id="ee-btn-radius" placeholder="${esc(cs.borderRadius)}">`)}
          ${fieldRow('Padding', `<input type="text" id="ee-btn-pad" placeholder="${esc(cs.padding)}">`)}
        </div>`;
      } else if (isLink) {
        html += `<button class="btn-editor-xs neutral" id="ee-make-btn" style="margin-bottom:8px;">Make it a button</button>`;
      }
    }

    html += `<div class="editor-section-title ee-sub">Box</div>
      <div class="ee-grid2">
        ${fieldRow('Background', `<input type="color" id="ee-bg" value="${rgbToHexSafe(cs.backgroundColor)}">`)}
        ${fieldRow('Text align', `<select id="ee-align"><option value="">(${esc(cs.textAlign)})</option><option>left</option><option>center</option><option>right</option></select>`)}
        ${fieldRow('Padding', `<input type="text" id="ee-pad" placeholder="${esc(cs.padding)}">`)}
        ${fieldRow('Margin', `<input type="text" id="ee-margin" placeholder="${esc(cs.margin)}">`)}
        ${fieldRow('Border', `<input type="text" id="ee-border" placeholder="${esc(cs.border || 'none')}" title="e.g. 1px solid #ccc">`)}
        ${fieldRow('Radius', `<input type="text" id="ee-radius" placeholder="${esc(cs.borderRadius)}">`)}
        ${fieldRow('Max width', `<input type="text" id="ee-maxw" placeholder="${esc(cs.maxWidth)}">`)}
        ${fieldRow('Shadow', `<select id="ee-shadow"><option value="">(none)</option><option value="0 2px 8px rgba(0,0,0,0.12)">Soft</option><option value="0 6px 20px rgba(0,0,0,0.18)">Medium</option><option value="0 12px 40px rgba(0,0,0,0.28)">Strong</option></select>`)}
      </div>`;

    html += `<div class="editor-section-title ee-sub">Custom CSS <span style="font-weight:400;color:var(--text4);">(this element)</span></div>
      ${fieldRow('', `<textarea id="ee-css" rows="3" placeholder="letter-spacing: 1px;\ntext-transform: uppercase;">${esc(getCustomCss(el))}</textarea>
      <button class="btn-editor-xs primary" id="ee-css-apply" style="margin-top:6px;">✓ Apply CSS</button>`)}`;

    html += `<div class="ee-actions-row">
      <button class="btn-editor-xs neutral" id="ee-hide">👁 Hide</button>
      <button class="btn-editor-xs danger" id="ee-delete">🗑 Delete element</button>
    </div>`;
    html += renderHiddenList();

    content.innerHTML = html;

    // ── wiring ──
    const $ = (id) => content.querySelector(id);
    const onEnterOrChange = (input, fn) => {
      input.addEventListener('change', () => fn(input.value.trim()));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(input.value.trim()); } });
    };

    $('#ee-text-apply')?.addEventListener('click', () => {
      const v = $('#ee-text').value;
      commit('text', () => {
        global.addPatch({ type: 'text', selector: global.buildUniqueSelector(el), attribute: null, oldValue: el.textContent.slice(0, 200), newValue: v.slice(0, 200) });
        el.textContent = v;
      });
      toast('Text updated');
    });
    if ($('#ee-font-size')) onEnterOrChange($('#ee-font-size'), (v) => v && applyStyle(el, 'fontSize', /^\d+$/.test(v) ? `${v}px` : v));
    $('#ee-font-weight')?.addEventListener('change', (e) => e.target.value && applyStyle(el, 'fontWeight', e.target.value));
    $('#ee-color')?.addEventListener('change', (e) => applyStyle(el, 'color', e.target.value));
    if ($('#ee-line-height')) onEnterOrChange($('#ee-line-height'), (v) => v && applyStyle(el, 'lineHeight', v));

    $('#ee-img-src-apply')?.addEventListener('click', () => {
      const v = $('#ee-img-src').value.trim();
      if (v) { applyAttr(el, 'src', v); toast('Image replaced'); }
    });
    $('#ee-img-upload')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > IMG_UPLOAD_CAP_BYTES) {
        toast(`Image too large (${Math.round(file.size / 1024)} KB) — max 400 KB. Use a URL or compress it first.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => { applyAttr(el, 'src', ev.target.result); renderInspector(content); toast('Image uploaded'); };
      reader.readAsDataURL(file);
    });
    if ($('#ee-img-alt')) onEnterOrChange($('#ee-img-alt'), (v) => applyAttr(el, 'alt', v));
    $('#ee-object-fit')?.addEventListener('change', (e) => e.target.value && applyStyle(el, 'objectFit', e.target.value));
    if ($('#ee-img-w')) onEnterOrChange($('#ee-img-w'), (v) => v && applyStyle(el, 'width', /^\d+$/.test(v) ? `${v}px` : v));
    if ($('#ee-radius-img')) onEnterOrChange($('#ee-radius-img'), (v) => v && applyStyle(el, 'borderRadius', /^\d+$/.test(v) ? `${v}px` : v));

    if ($('#ee-href')) onEnterOrChange($('#ee-href'), (v) => { applyAttr(el, 'href', v); toast('Link updated'); });
    $('#ee-target')?.addEventListener('change', (e) => applyAttr(el, 'target', e.target.checked ? '_blank' : null));
    $('#ee-make-btn')?.addEventListener('click', () => {
      commit('make-button', () => {
        el.style.cssText += ';display:inline-block;padding:12px 28px;background:#D9A620;color:#111;border-radius:8px;font-weight:700;text-decoration:none;';
        global.addPatch({ type: 'style', selector: global.buildUniqueSelector(el), attribute: 'cssText', oldValue: null, newValue: 'button-style' });
      });
      renderInspector(content);
      toast('Styled as a button');
    });
    $('#ee-btn-bg')?.addEventListener('change', (e) => applyStyle(el, 'backgroundColor', e.target.value));
    $('#ee-btn-color')?.addEventListener('change', (e) => applyStyle(el, 'color', e.target.value));
    if ($('#ee-btn-radius')) onEnterOrChange($('#ee-btn-radius'), (v) => v && applyStyle(el, 'borderRadius', /^\d+$/.test(v) ? `${v}px` : v));
    if ($('#ee-btn-pad')) onEnterOrChange($('#ee-btn-pad'), (v) => v && applyStyle(el, 'padding', v));

    $('#ee-bg')?.addEventListener('change', (e) => applyStyle(el, 'backgroundColor', e.target.value));
    $('#ee-align')?.addEventListener('change', (e) => e.target.value && applyStyle(el, 'textAlign', e.target.value));
    if ($('#ee-pad')) onEnterOrChange($('#ee-pad'), (v) => v && applyStyle(el, 'padding', v));
    if ($('#ee-margin')) onEnterOrChange($('#ee-margin'), (v) => v && applyStyle(el, 'margin', v));
    if ($('#ee-border')) onEnterOrChange($('#ee-border'), (v) => v && applyStyle(el, 'border', v));
    if ($('#ee-radius')) onEnterOrChange($('#ee-radius'), (v) => v && applyStyle(el, 'borderRadius', /^\d+$/.test(v) ? `${v}px` : v));
    if ($('#ee-maxw')) onEnterOrChange($('#ee-maxw'), (v) => v && applyStyle(el, 'maxWidth', /^\d+$/.test(v) ? `${v}px` : v));
    $('#ee-shadow')?.addEventListener('change', (e) => applyStyle(el, 'boxShadow', e.target.value || 'none'));

    $('#ee-css-apply')?.addEventListener('click', () => {
      setCustomCss(el, $('#ee-css').value);
      toast('Custom CSS applied');
    });

    $('#ee-hide')?.addEventListener('click', () => { hideElement(el); renderInspector(content); });
    $('#ee-delete')?.addEventListener('click', () => {
      if (!confirm('Delete this element?')) return;
      removeElement(el);
      renderInspector(content);
    });

    wireHiddenList(content);
  }

  function renderHiddenList() {
    const d = doc();
    if (!d) return '';
    const hidden = [...d.querySelectorAll('[data-c2ghl-hidden]')];
    if (!hidden.length) return '';
    const esc = global.escHtml || ((s) => s);
    return `<div class="editor-section-title ee-sub">Hidden elements (${hidden.length})</div>
      <div id="ee-hidden-list">${hidden.map((h) => `
        <div class="ee-hidden-item">
          <span>&lt;${h.tagName.toLowerCase()}&gt; ${esc((h.textContent || '').trim().slice(0, 40) || h.getAttribute('alt') || '')}</span>
          <button class="btn-editor-xs neutral ee-unhide" data-hid="${h.getAttribute('data-c2ghl-id')}">Show</button>
        </div>`).join('')}</div>`;
  }

  function wireHiddenList(content) {
    content.querySelectorAll('.ee-unhide').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = doc();
        const el = d?.querySelector(`[data-c2ghl-id="${btn.dataset.hid}"]`);
        if (el) unhideElement(el);
        renderInspector(content);
      });
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  global.C2GHLEditor = {
    // lifecycle
    onIframeLoad,
    resetHistory,
    updateHistoryButtons,
    // mutation gateway + history
    commit,
    pushHistorySnapshot,
    undo,
    redo,
    markDirty,
    // selection
    select,
    clearSelection,
    getSelectedEl,
    positionToolbar,
    // inline editing
    startInlineEdit,
    endInlineEdit,
    // structure
    resolveBlock,
    addTemplate,
    C2GHL_TEMPLATES,
    // inspector
    renderInspector,
    // drafts
    scheduleAutosave,
    saveDraftNow,
    loadDraft,
    clearDraft,
  };
})(typeof window !== 'undefined' ? window : globalThis);
