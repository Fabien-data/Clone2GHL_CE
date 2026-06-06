/**
 * backend/test/gate.integration.mjs — verifies the "valid GHL account required"
 * trial gate. Run with TRIAL_REQUIRE_GHL=true (see run-integration.mjs).
 */
const BASE = process.env.BASE || 'http://localhost:8899';
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { console.log(`  ✓ ${n}`); pass++; } else { console.error(`  ✗ ${n}${e ? ' — ' + e : ''}`); fail++; } };

async function j(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const email = `gate_${Date.now()}@example.com`;
const reg = await j('/api/auth/register', { method: 'POST', body: { email, password: 'password123' } });
const token = reg.data.token;
ok('registered', reg.status === 200 && token);

const u = await j('/api/usage', { token });
ok('usage flags trialActivationRequired', u.data.trialActivationRequired === true, JSON.stringify({ tar: u.data.trialActivationRequired, ghl: u.data.ghlValidated }));
ok('ghlValidated false', u.data.ghlValidated === false);

const c = await j('/api/usage/consume', { method: 'POST', token });
ok('consume blocked → 403', c.status === 403, `status ${c.status}`);
ok('code ghl_required', c.data.code === 'ghl_required' && c.data.ghlRequired === true, JSON.stringify(c.data));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
