/**
 * backend/test/run-integration.mjs — boots the server in a throwaway data dir,
 * runs trial.integration.mjs against it, then tears the server down. Cross-platform.
 *   node test/run-integration.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '../src/server.js');
const testPath = path.resolve(__dirname, process.argv[2] || 'trial.integration.mjs');
const PORT = Number(process.env.PORT || 8899);
const BASE = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'c2g-it-'));

const env = {
  ...process.env,
  PORT: String(PORT),
  NODE_ENV: 'test',
  JWT_SECRET: 'integration-test-secret',
  TRIAL_REQUIRE_GHL: process.env.TRIAL_REQUIRE_GHL || 'false', // default: exercise trial without a live GHL location
  GHL_WEBHOOK_SECRET: 'whsec',
  GHL_PRODUCT_MAP: 'Pro Plan=pro:recurring',
  GHL_CHECKOUT_URL: 'https://clone2ghl.com/checkout',
  GHL_CHECKOUT_URLS: 'starter=https://buy.test/s,pro=https://buy.test/p,agency=https://buy.test/a',
  OWNER_EMAILS: 'owner@example.com',
};

console.log(`Booting server (data dir: ${dataDir})…`);
const server = spawn(process.execPath, [serverPath], { cwd: dataDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

function shutdown(code) {
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
  process.exit(code);
}

const healthy = await waitForHealth();
if (!healthy) {
  console.error('Server did not become healthy. Log:\n' + serverLog);
  shutdown(1);
}

const test = spawn(process.execPath, [testPath], { env: { ...env, BASE }, stdio: 'inherit' });
test.on('exit', (code) => {
  if (code !== 0) console.error('\nServer log:\n' + serverLog);
  shutdown(code ?? 1);
});
