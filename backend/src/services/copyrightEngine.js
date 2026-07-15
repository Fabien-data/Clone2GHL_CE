/**
 * copyrightEngine.js — server-side (cheerio) port of the extension's
 * DOM-based copyright strip (extension/copyrightEngine.js is authoritative;
 * keep the RULES table in sync).
 *
 * Runs as a conservative always-on pass in the import pipeline so every
 * backend-normalized page arrives at the paste step without the source
 * site's ©/rights boilerplate.
 *
 * Guarantees (mirrors the extension engine):
 *  - Bounded removal: only the matched character range is spliced out of the
 *    spanning text nodes — adjacent text ("Privacy Policy") always survives,
 *    even for split-tag notices like `©<span>2024</span> Acme`.
 *  - A whole block is removed only when it is a "pure notice" (almost nothing
 *    remains after stripping the ©/rights match).
 *  - Text nodes only — attributes, <script> and <style> content untouched.
 */
import { load } from 'cheerio';

export const RULES = {
  COPYRIGHT_RX: /(?:©|\(c\)|copyright)\s*(?:©\s*)?\d{4}(?:\s*[-–—]\s*(?:\d{4}|present))?\.?/i,
  RIGHTS_RX: /all\s+rights?\s+reserved\.?/i,
  TM_RX: /[™®℠]/g,
};

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe']);
const NOTICE_TAGS = new Set(['p', 'small', 'span', 'div', 'li', 'td', 'footer', 'section', 'em', 'i', 'b', 'strong', 'a', 'h6']);

function textNodesOf($, root) {
  const out = [];
  const walk = (node) => {
    $(node).contents().each((_, c) => {
      if (c.type === 'text') out.push(c);
      else if (c.type === 'tag' && !SKIP_TAGS.has((c.tagName || '').toLowerCase())) walk(c);
    });
  };
  walk(root);
  return out;
}

/** Splice every match of `rx` out of the element's visible text, split-tag safe. */
export function removeMatchedRange($, el, rx) {
  let removed = 0;
  for (let guard = 0; guard < 25; guard++) {
    const nodes = textNodesOf($, el);
    const full = nodes.map((n) => n.data || '').join('');
    const m = rx.exec(full);
    if (!m) break;
    const start = m.index;
    const end = m.index + m[0].length;
    let offset = 0;
    for (const node of nodes) {
      const data = node.data || '';
      const nodeStart = offset;
      const nodeEnd = offset + data.length;
      if (nodeEnd > start && nodeStart < end) {
        const cutFrom = Math.max(0, start - nodeStart);
        const cutTo = Math.min(data.length, end - nodeStart);
        node.data = data.slice(0, cutFrom) + data.slice(cutTo);
      }
      offset = nodeEnd;
    }
    removed++;
  }
  return removed;
}

function removeTmSymbols($, root) {
  let count = 0;
  for (const node of textNodesOf($, root)) {
    RULES.TM_RX.lastIndex = 0;
    if (RULES.TM_RX.test(node.data || '')) {
      node.data = (node.data || '').replace(RULES.TM_RX, '');
      count++;
    }
  }
  return count;
}

export function isPureNotice($, el) {
  const t = $(el).text().trim();
  if (!t || t.length > 200) return false;
  if (!RULES.COPYRIGHT_RX.test(t) && !RULES.RIGHTS_RX.test(t)) return false;
  const residual = t
    .replace(RULES.COPYRIGHT_RX, '')
    .replace(RULES.RIGHTS_RX, '')
    .replace(/[\s·•|,.\-–—:;]+/g, '');
  return residual.length <= 12;
}

function findNoticeElements($) {
  const matches = [];
  $('body *').each((_, el) => {
    if (el.type !== 'tag' || !NOTICE_TAGS.has((el.tagName || '').toLowerCase())) return;
    const t = $(el).text();
    if (t.length > 400) return;
    if (RULES.COPYRIGHT_RX.test(t) || RULES.RIGHTS_RX.test(t)) matches.push(el);
  });
  // Deepest matching element of each chain only.
  return matches.filter((el) => !matches.some((other) => other !== el && $(el).find('*').toArray().includes(other)));
}

/** Conservative strip on a loaded cheerio document. Returns a report. */
export function stripCheerio($) {
  const report = { tmNodes: 0, blocksRemoved: 0, noticesSpliced: 0 };
  const body = $('body').length ? $('body')[0] : $.root()[0];
  if (!body) return report;

  report.tmNodes = removeTmSymbols($, body);
  for (const el of findNoticeElements($)) {
    if (isPureNotice($, el)) {
      $(el).remove();
      report.blocksRemoved++;
    } else {
      const n = removeMatchedRange($, el, RULES.COPYRIGHT_RX) + removeMatchedRange($, el, RULES.RIGHTS_RX);
      if (n) report.noticesSpliced++;
    }
  }
  return report;
}

/** Parse → strip → serialize an HTML string. Never throws. */
export function stripHtml(html) {
  try {
    const $ = load(html || '', { decodeEntities: false });
    const report = stripCheerio($);
    const changed = report.tmNodes + report.blocksRemoved + report.noticesSpliced > 0;
    return { html: changed ? $.html() : html, changed, report };
  } catch (e) {
    return { html, changed: false, report: { error: String(e?.message || e) } };
  }
}
