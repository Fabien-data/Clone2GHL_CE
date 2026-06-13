/**
 * extension/test/logic.test.cjs — pure-logic tests for the extension's
 * browser-independent modules (no Chrome APIs needed).
 * Run: node test/logic.test.cjs
 */
const assert = require('node:assert/strict');
const GHLConverter = require('../ghlConverter.js');
const FunnelAnalyzer = require('../funnelAnalyzer.js');
const { appendRef, shouldShowUpgradeBanner, planCheckoutUrl } = require('../upgradeLogic.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log('ghlConverter — form field extraction');
const formHtml = '<form><input type="text" name="fullname" placeholder="Your Name" required>'
  + '<input type="email" name="email" placeholder="Email">'
  + '<input type="hidden" name="src"><textarea name="msg" placeholder="Message"></textarea>'
  + '<button type="submit">Go</button></form>';
const converted = GHLConverter.replaceFormsWithGHLPlaceholder(formHtml, 'F1');
test('emits a GHL form zone', () => assert.match(converted, /c2ghl-form-zone/));
test('preserves visible field labels', () => assert.match(converted, /Your Name/));
test('excludes hidden + submit', () => {
  const fields = JSON.parse(decodeURIComponent(converted.match(/data-fields='([^']+)'/)[1].replace(/&#39;/g, "'")));
  const names = fields.map(f => f.name);
  assert.ok(!names.includes('src'));
  assert.deepEqual(names.sort(), ['email', 'fullname', 'msg']);
});

console.log('funnelAnalyzer — scoreFidelity');
test('rich page scores high (A/B)', () => {
  const css = '@media (max-width:600px){a{}} @font-face{} ' + 'x'.repeat(25000);
  const r = FunnelAnalyzer.scoreFidelity({ html: `<style>${css}</style><div>hi</div>`, styles: css, structure: {} });
  assert.ok(r.score >= 70, `score was ${r.score}`);
  assert.ok(['A', 'B'].includes(r.grade));
});
test('thin page flags issues + low score', () => {
  const r = FunnelAnalyzer.scoreFidelity({ html: '<div>hi</div>', styles: '', structure: {} });
  assert.ok(r.score < 70);
  assert.ok(r.issues.some(i => i.level === 'warn'));
});
test('hot-linked images counted', () => {
  const r = FunnelAnalyzer.scoreFidelity({ html: '<img src="https://x.com/a.png"><img src="https://x.com/b.png">', styles: '', structure: {} });
  assert.equal(r.stats.hotlinkedImages, 2);
});

console.log('ghlConverter — token replacement (smoke)');
test('exports expected API', () => {
  assert.equal(typeof GHLConverter.replaceFormsWithGHLPlaceholder, 'function');
});

console.log('upgradeLogic — appendRef');
test('appends ref to bare URL', () => assert.equal(appendRef('https://x.com/buy', 'ABC'), 'https://x.com/buy?ref=ABC'));
test('uses & with existing query', () => assert.equal(appendRef('https://x.com/buy?p=1', 'ABC'), 'https://x.com/buy?p=1&ref=ABC'));
test('no ref/url is safe', () => { assert.equal(appendRef('https://x.com', ''), 'https://x.com'); assert.equal(appendRef('', 'ABC'), ''); });

console.log('upgradeLogic — shouldShowUpgradeBanner');
test('shows when trial activation required', () => assert.equal(shouldShowUpgradeBanner({ plan: 'free', trialActivationRequired: true }), true));
test('shows when upgrade required', () => assert.equal(shouldShowUpgradeBanner({ plan: 'free', upgradeRequired: true }), true));
test('hidden for active trial', () => assert.equal(shouldShowUpgradeBanner({ plan: 'free', upgradeRequired: false, trialActivationRequired: false }), false));
test('hidden for owner / dev', () => {
  assert.equal(shouldShowUpgradeBanner({ plan: 'owner', upgradeRequired: true }), false);
  assert.equal(shouldShowUpgradeBanner({ plan: 'free', upgradeRequired: true, devMode: true }), false);
});

console.log('upgradeLogic — planCheckoutUrl');
test('prefers the per-plan URL', () => assert.equal(planCheckoutUrl({ pro: 'https://p', starter: 'https://s' }, 'pro', 'https://fb'), 'https://p'));
test('falls back to single URL when plan missing', () => assert.equal(planCheckoutUrl({ starter: 'https://s' }, 'pro', 'https://fb'), 'https://fb'));
test('falls back when map empty/undefined', () => { assert.equal(planCheckoutUrl({}, 'pro', 'https://fb'), 'https://fb'); assert.equal(planCheckoutUrl(undefined, 'pro', 'https://fb'), 'https://fb'); });
test('empty string when nothing configured', () => assert.equal(planCheckoutUrl({}, 'pro', ''), ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
