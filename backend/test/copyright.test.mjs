/**
 * backend/test/copyright.test.mjs — unit tests for the server-side copyright
 * strip (src/services/copyrightEngine.js). Run: node test/copyright.test.mjs
 */
import assert from 'node:assert/strict';
import { stripHtml, isPureNotice, RULES } from '../src/services/copyrightEngine.js';
import { load } from 'cheerio';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log('copyrightEngine.stripHtml');

test('removes a plain footer notice block', () => {
  const { html, changed } = stripHtml('<footer><p>© 2024 Acme Inc. All rights reserved.</p></footer>');
  assert.ok(changed);
  assert.ok(!/© 2024/.test(html));
  assert.ok(!/All rights reserved/i.test(html));
});

test('split-tag notice (©<span>2024</span>) is caught', () => {
  const { html, changed } = stripHtml('<p>©<span>2024</span> Acme Co.</p>');
  assert.ok(changed);
  assert.ok(!/©/.test(html));
  assert.ok(!/2024/.test(html));
});

test('adjacent text survives — "Privacy Policy" kept', () => {
  const src = '<footer><p>© 2024 Acme · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a></p></footer>';
  const { html } = stripHtml(src);
  assert.ok(/Privacy Policy/.test(html), 'Privacy Policy must survive');
  assert.ok(/Terms/.test(html), 'Terms must survive');
  assert.ok(!/© 2024/.test(html), 'notice itself removed');
});

test('legitimate sentence after year range is not swallowed', () => {
  const src = '<p>Copyright 2020-2024 Acme. We build great plumbing funnels for local businesses.</p>';
  const { html } = stripHtml(src);
  assert.ok(/We build great plumbing funnels/.test(html));
});

test('meta attribute content="© 2024" untouched', () => {
  const src = '<head><meta name="copyright" content="© 2024 Acme"></head><body><p>hello</p></body>';
  const { html } = stripHtml(src);
  assert.ok(/content="© 2024 Acme"/.test(html));
});

test('™ inside <script> untouched, ™ in text removed', () => {
  const src = '<body><script>var brand = "Acme™";</script><p>Acme™ rocks</p></body>';
  const { html } = stripHtml(src);
  assert.ok(/var brand = "Acme™"/.test(html), 'script content untouched');
  assert.ok(/<p>Acme rocks<\/p>/.test(html), 'text ™ removed');
});

test('® and ℠ symbols removed from text', () => {
  const { html } = stripHtml('<p>Acme® and Beta℠</p>');
  assert.ok(!/[®℠]/.test(html));
});

test('"All rights reserved" standalone removed, sibling paragraph kept', () => {
  const src = '<div><p>All rights reserved.</p><p>Contact us today!</p></div>';
  const { html } = stripHtml(src);
  assert.ok(!/All rights reserved/i.test(html));
  assert.ok(/Contact us today!/.test(html));
});

test('no notice → unchanged html returned as-is', () => {
  const src = '<p>Just a normal page.</p>';
  const { html, changed } = stripHtml(src);
  assert.equal(changed, false);
  assert.equal(html, src);
});

test('never throws on malformed input', () => {
  const { changed } = stripHtml('<div><p>© 2024 broken');
  assert.equal(typeof changed, 'boolean');
});

console.log('copyrightEngine.isPureNotice');

test('pure notice detected', () => {
  const $ = load('<p id="t">© 2024 Acme Inc. All rights reserved.</p>');
  assert.equal(isPureNotice($, $('#t')[0]), true);
});

test('notice with nav links is NOT pure (bounded splice instead)', () => {
  const $ = load('<p id="t">© 2024 Acme · Privacy Policy · Terms of Service</p>');
  assert.equal(isPureNotice($, $('#t')[0]), false);
});

console.log('RULES coverage');

test('(c) form and "present" ranges match', () => {
  assert.ok(RULES.COPYRIGHT_RX.test('(c) 2019-present Acme'));
  assert.ok(RULES.COPYRIGHT_RX.test('Copyright © 2024'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
