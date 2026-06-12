/**
 * backend/test/smoke.test.mjs — dependency-free unit tests for pure logic.
 * Run: node test/smoke.test.mjs
 */
import assert from 'node:assert/strict';
import { effectivePlan } from '../src/config.js';
import { hashToken, compareToken, safeEqual, generateToken } from '../src/lib/tokens.js';
import { generateActivationCode, normalizeCode, hashCode, compareCode } from '../src/lib/activation.js';
import { validateBody, EMAIL_RE } from '../src/lib/validate.js';
import { computeEntitlement, ensureTrialInitialized, appendRef, TRIAL_DAYS } from '../src/lib/entitlement.js';
import { runPreflight } from '../src/lib/preflight.js';
import { isRefund } from '../src/routes/ghl.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log('config.effectivePlan');
test('active pro stays pro', () => assert.equal(effectivePlan({ plan: 'pro', subscriptionSource: 'ghl', currentPeriodEnd: new Date(Date.now() + 86400000).toISOString() }), 'pro'));
test('lapsed ghl sub → free', () => assert.equal(effectivePlan({ plan: 'pro', subscriptionSource: 'ghl', currentPeriodEnd: '2020-01-01T00:00:00.000Z' }), 'free'));
test('suspended → free', () => assert.equal(effectivePlan({ plan: 'agency', status: 'suspended' }), 'free'));
test('non-ghl plan ignores expiry', () => assert.equal(effectivePlan({ plan: 'pro' }), 'pro'));
test('missing user → free', () => assert.equal(effectivePlan(null), 'free'));

console.log('tokens');
test('hash+compare round-trips', () => { const t = generateToken(); assert.ok(compareToken(t, hashToken(t))); });
test('wrong token fails', () => assert.equal(compareToken('nope', hashToken(generateToken())), false));
test('safeEqual true/false', () => { assert.ok(safeEqual('abc', 'abc')); assert.equal(safeEqual('abc', 'abd'), false); assert.equal(safeEqual('a', 'ab'), false); });

console.log('activation codes');
test('code format XXXX-XXXX', () => assert.match(generateActivationCode(), /^[A-Z0-9]{4}-[A-Z0-9]{4}$/));
test('normalize strips punctuation/case', () => assert.equal(normalizeCode('ab3k-9tqx'), 'AB3K9TQX'));
test('hash+compare code (case/format-insensitive)', async () => {
  const c = generateActivationCode();
  const h = await hashCode(c);
  assert.ok(await compareCode(c.toLowerCase(), h));
});

console.log('validate');
test('EMAIL_RE basic', () => { assert.ok(EMAIL_RE.test('a@b.co')); assert.equal(EMAIL_RE.test('nope'), false); });
test('validateBody rejects missing required', () => {
  const mw = validateBody({ email: { type: 'string', required: true, email: true } });
  let status = 0, body = null;
  mw({ body: {} }, { status(s) { status = s; return this; }, json(b) { body = b; } }, () => { status = 200; });
  assert.equal(status, 400);
  assert.match(body.error, /required/);
});
test('validateBody passes valid', () => {
  const mw = validateBody({ email: { type: 'string', required: true, email: true }, password: { type: 'string', min: 8 } });
  let nexted = false;
  mw({ body: { email: 'a@b.co', password: 'longenough' } }, { status() { return this; }, json() {} }, () => { nexted = true; });
  assert.ok(nexted);
});

console.log('entitlement.computeEntitlement');
const DAY = 86400000;
const NOW = Date.parse('2026-06-04T00:00:00.000Z');
const freshTrial = { plan: 'free', trialClonesUsed: 0, trialStartedAt: new Date(NOW).toISOString(), trialEndsAt: new Date(NOW + 30 * DAY).toISOString() };
test('fresh trial: active, 6 remaining, ~30 days, no upgrade', () => {
  const e = computeEntitlement(freshTrial, NOW);
  assert.equal(e.state, 'trial');
  assert.equal(e.isTrial, true);
  assert.equal(e.clonesRemaining, 6);
  assert.equal(e.daysLeft, 30);
  assert.equal(e.upgradeRequired, false);
});
test('trial clones exhausted → upgrade', () => {
  const e = computeEntitlement({ ...freshTrial, trialClonesUsed: 6 }, NOW);
  assert.equal(e.upgradeRequired, true);
  assert.equal(e.reason, 'trial_clones_exhausted');
  assert.equal(e.clonesRemaining, 0);
});
test('trial expired by time → trial_expired + upgrade', () => {
  const e = computeEntitlement({ plan: 'free', trialClonesUsed: 1, trialStartedAt: new Date(NOW - 40 * DAY).toISOString(), trialEndsAt: new Date(NOW - 10 * DAY).toISOString() }, NOW);
  assert.equal(e.state, 'trial_expired');
  assert.equal(e.upgradeRequired, true);
});
test('active paid pro → paid, limit 300', () => {
  // currentPeriodEnd must be future vs the REAL clock: effectivePlan() reads
  // Date.now(), not the injected NOW, so a fixed-date window here would rot.
  const e = computeEntitlement({ plan: 'pro', subscriptionSource: 'ghl', currentPeriodEnd: new Date(Date.now() + 5 * DAY).toISOString() }, NOW);
  assert.equal(e.state, 'paid');
  assert.equal(e.clonesLimit, 300);
  assert.equal(e.upgradeRequired, false);
});
test('lapsed paid sub → plan_expired (not a fresh trial)', () => {
  const e = computeEntitlement({ plan: 'pro', subscriptionSource: 'ghl', currentPeriodEnd: new Date(NOW - 5 * DAY).toISOString() }, NOW);
  assert.equal(e.state, 'plan_expired');
  assert.equal(e.reason, 'plan_expired');
  assert.equal(e.isTrial, false);
});

console.log('entitlement.ensureTrialInitialized (idempotent)');
test('starts a window + counter when missing', () => {
  const u = { plan: 'free' };
  const changed = ensureTrialInitialized(u, NOW);
  assert.equal(changed, true);
  assert.ok(u.trialStartedAt && u.trialEndsAt);
  assert.equal(u.trialClonesUsed, 0);
  assert.equal(Date.parse(u.trialEndsAt) - Date.parse(u.trialStartedAt), TRIAL_DAYS * DAY);
});
test('never restarts an existing window or resets the counter', () => {
  const u = { plan: 'free', trialStartedAt: new Date(NOW).toISOString(), trialEndsAt: new Date(NOW + 30 * DAY).toISOString(), trialClonesUsed: 4 };
  ensureTrialInitialized(u, NOW + 5 * DAY);
  assert.equal(u.trialStartedAt, new Date(NOW).toISOString());
  assert.equal(u.trialClonesUsed, 4);
});
test('does not touch paid users', () => {
  const u = { plan: 'pro' };
  assert.equal(ensureTrialInitialized(u, NOW), false);
  assert.equal(u.trialStartedAt, undefined);
});

console.log('entitlement.appendRef');
test('appends ref to a bare URL', () => assert.equal(appendRef('https://x.com/buy', 'ABC'), 'https://x.com/buy?ref=ABC'));
test('uses & when a query already exists', () => assert.equal(appendRef('https://x.com/buy?p=1', 'ABC'), 'https://x.com/buy?p=1&ref=ABC'));
test('no ref → unchanged; no url → empty', () => { assert.equal(appendRef('https://x.com', ''), 'https://x.com'); assert.equal(appendRef('', 'ABC'), ''); });
test('encodes ref', () => assert.equal(appendRef('https://x.com', 'a b&c'), 'https://x.com?ref=a%20b%26c'));

console.log('preflight.runPreflight');
const goodCfg = {
  nodeEnv: 'production',
  jwtSecret: 'a-strong-random-secret-value-1234',
  ghlWebhookSecret: 'whsec', ghlWebhookHmac: '',
  emailProvider: 'resend', emailApiKey: 're_live_123',
  emailFrom: 'Clone2GHL <noreply@clone2ghl.com>',
  ghlProductMap: { 'pro plan': { plan: 'pro', type: 'recurring' } },
  ghlCheckoutUrl: 'https://clone2ghl.com/checkout',
  allowedOrigins: ['https://app.clone2ghl.com'], extensionIds: ['abc'],
};
const probeOk = () => ({ path: '/app/data', mounted: true });
const has = (list, re) => list.some(m => re.test(m));
test('fully-configured prod → no errors, no warnings', () => {
  const { errors, warnings } = runPreflight(goodCfg, probeOk);
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(warnings.length, 0, warnings.join(' | '));
});
test('prod + dev JWT secret → FATAL error', () => {
  const { errors } = runPreflight({ ...goodCfg, jwtSecret: 'dev-secret-change-me' }, probeOk);
  assert.ok(has(errors, /JWT_SECRET/));
});
test('non-prod + dev JWT secret → warning, not error', () => {
  const { errors, warnings } = runPreflight({ ...goodCfg, nodeEnv: 'development', jwtSecret: 'dev-secret-change-me' }, probeOk);
  assert.equal(errors.length, 0);
  assert.ok(has(warnings, /JWT_SECRET/));
});
test('prod + resend without api key → FATAL error', () => {
  const { errors } = runPreflight({ ...goodCfg, emailApiKey: '' }, probeOk);
  assert.ok(has(errors, /EMAIL_API_KEY/));
});
test('prod + empty product map WHILE ghl enabled → FATAL error', () => {
  const { errors } = runPreflight({ ...goodCfg, ghlProductMap: {} }, probeOk);
  assert.ok(has(errors, /GHL_PRODUCT_MAP/));
});
test('empty product map WITHOUT ghl auth → no product-map error (ghl just disabled)', () => {
  const { errors } = runPreflight({ ...goodCfg, ghlProductMap: {}, ghlWebhookSecret: '', ghlWebhookHmac: '' }, probeOk);
  assert.equal(has(errors, /GHL_PRODUCT_MAP/), false);
  assert.ok(has(errors, /GHL webhook auth/));
});
test('soft warnings: test EMAIL_FROM + empty checkout url + ephemeral disk', () => {
  const { warnings } = runPreflight(
    { ...goodCfg, emailFrom: 'Clone2GHL <onboarding@resend.dev>', ghlCheckoutUrl: '' },
    () => ({ path: '/app/data', mounted: false }),
  );
  assert.ok(has(warnings, /resend\.dev/));
  assert.ok(has(warnings, /GHL_CHECKOUT_URL/));
  assert.ok(has(warnings, /mounted volume/));
});

console.log('ghl.isRefund');
test('refund signals are detected', () => {
  assert.ok(isRefund({ type: 'refund' }));
  assert.ok(isRefund({ event: 'payment.refunded' }));
  assert.ok(isRefund({ reason: 'chargeback' }));
  assert.ok(isRefund({ refunded: true }));
});
test('plain cancellations are NOT refunds', () => {
  assert.equal(isRefund({ type: 'subscription.cancelled' }), false);
  assert.equal(isRefund({ status: 'cancelled' }), false);
  assert.equal(isRefund({}), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
