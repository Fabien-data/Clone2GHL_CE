/**
 * backend/test/trial.integration.mjs — live HTTP integration test of the trial /
 * upgrade / GHL-webhook flow. Requires the server running on BASE (default :8899)
 * with TRIAL_REQUIRE_GHL=false, GHL_WEBHOOK_SECRET=whsec,
 * GHL_PRODUCT_MAP="Pro Plan=pro:recurring", GHL_CHECKOUT_URL set.
 *
 * Run via test/run-integration.* helper (boots server in a temp data dir).
 */
const BASE = process.env.BASE || 'http://localhost:8899';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); fail++; } };

async function j(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

const email = `it_${Date.now()}@example.com`;

console.log('register + trial bootstrap');
const reg = await j('/api/auth/register', { method: 'POST', body: { email, password: 'password123' } });
ok('register 200 + token', reg.status === 200 && reg.data.token, `status ${reg.status}`);
const token = reg.data.token;

let u = await j('/api/usage', { token });
ok('usage: on trial', u.data.isTrial === true && u.data.state === 'trial', `state ${u.data.state}`);
ok('usage: 6 clones remaining', u.data.clonesRemaining === 6, `got ${u.data.clonesRemaining}`);
ok('usage: ~30 days left', u.data.daysLeft >= 29 && u.data.daysLeft <= 30, `got ${u.data.daysLeft}`);
ok('usage: checkoutUrl present', typeof u.data.checkoutUrl === 'string' && u.data.checkoutUrl.length > 0, u.data.checkoutUrl);
ok('usage: no upgrade yet', u.data.upgradeRequired === false);

console.log('consume 6 trial clones');
for (let i = 1; i <= 6; i++) {
  const c = await j('/api/usage/consume', { method: 'POST', token });
  ok(`consume #${i} ok (remaining ${c.data.clonesRemaining})`, c.status === 200 && c.data.consumed === true && c.data.clonesRemaining === 6 - i, `status ${c.status} rem ${c.data.clonesRemaining}`);
}

console.log('7th consume is blocked + carries upgrade');
const blocked = await j('/api/usage/consume', { method: 'POST', token, body: { ref: 'AFF1' } });
ok('7th → 402', blocked.status === 402, `status ${blocked.status}`);
ok('reason trial_clones_exhausted', blocked.data.reason === 'trial_clones_exhausted', blocked.data.reason);
ok('upgrade.checkoutUrl carries ?ref=AFF1', /[?&]ref=AFF1/.test(blocked.data.upgrade?.checkoutUrl || ''), blocked.data.upgrade?.checkoutUrl);

u = await j('/api/usage', { token });
ok('usage now upgradeRequired', u.data.upgradeRequired === true && u.data.clonesRemaining === 0);

console.log('GHL purchase upgrades the SAME account to paid');
const wh = await j('/api/ghl/webhook?token=whsec', { method: 'POST', body: { email, productName: 'Pro Plan', transactionId: 'tx_it_1' } });
ok('webhook matched → pro', wh.status === 200 && wh.data.matched === true && wh.data.plan === 'pro', JSON.stringify(wh.data));
const wh2 = await j('/api/ghl/webhook?token=whsec', { method: 'POST', body: { email, productName: 'Pro Plan', transactionId: 'tx_it_1' } });
ok('webhook idempotent (duplicate)', wh2.data.duplicate === true);

u = await j('/api/usage', { token });
ok('usage now paid pro', u.data.plan === 'pro' && u.data.state === 'paid' && u.data.upgradeRequired === false, `plan ${u.data.plan} state ${u.data.state}`);
ok('pro clone limit 300', u.data.clonesLimit === 300, `got ${u.data.clonesLimit}`);

console.log('bad token rejected');
const badWh = await j('/api/ghl/webhook?token=WRONG', { method: 'POST', body: { email, productName: 'Pro Plan' } });
ok('webhook bad token → 401', badWh.status === 401, `status ${badWh.status}`);

console.log('trial location binding (one location → one trial)');
// Server runs with TRIAL_REQUIRE_GHL=false here, so /trial/start skips the GHL
// network check and exercises the binding/anti-fraud logic directly.
const regC = await j('/api/auth/register', { method: 'POST', body: { email: `c_${Date.now()}@example.com`, password: 'password123' } });
const regD = await j('/api/auth/register', { method: 'POST', body: { email: `d_${Date.now()}@example.com`, password: 'password123' } });
const tokC = regC.data.token, tokD = regD.data.token;
const LOC = `loc_${Date.now()}`;
const sC = await j('/api/trial/start', { method: 'POST', token: tokC, body: { apiKey: 'k', locationId: LOC } });
ok('C starts trial on LOC', sC.status === 200 && sC.data.started === true, JSON.stringify(sC.data));
const sCagain = await j('/api/trial/start', { method: 'POST', token: tokC, body: { apiKey: 'k', locationId: LOC } });
ok('C re-validating same LOC is idempotent (alreadyStarted)', sCagain.status === 200 && sCagain.data.alreadyStarted === true);
const sD = await j('/api/trial/start', { method: 'POST', token: tokD, body: { apiKey: 'k', locationId: LOC } });
ok('D blocked: location_already_trialed → 409', sD.status === 409 && sD.data.code === 'location_already_trialed', `status ${sD.status} ${JSON.stringify(sD.data)}`);
const sD2 = await j('/api/trial/start', { method: 'POST', token: tokD, body: { apiKey: 'k', locationId: `${LOC}_other` } });
ok('D can start on a different location', sD2.status === 200 && sD2.data.started === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
