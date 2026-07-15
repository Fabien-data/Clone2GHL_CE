/**
 * extension/build.mjs — package Chrome and Firefox builds.
 *
 *   C2G_API_BASE=https://api.clone2ghl.com node build.mjs
 *
 * Produces:
 *   dist/chrome/      + dist/clone2ghl-chrome.zip
 *   dist/firefox/     + dist/clone2ghl-firefox.zip   (manifest.firefox.json → manifest.json)
 *
 * Production safety:
 *   - C2G_API_BASE is REQUIRED and must be an https, non-localhost URL. The staged
 *     background.js has its DEFAULT_BACKEND_API_BASE rewritten to it, so a dev URL
 *     (http://localhost:8080) can never ship to the stores by accident.
 *   - Pass --dev (or C2G_ALLOW_DEV_BASE=1) to build a local test package with a
 *     localhost/http base.
 *   - Optional version bump: C2G_VERSION=x.y.z  or  C2G_BUMP=patch|minor|major
 *     (applied to the STAGED manifests only; source is untouched).
 *
 * Zipping uses PowerShell Compress-Archive on Windows, else the `zip` CLI.
 * No npm dependencies required.
 */
import { cp, rm, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');

const argv = process.argv.slice(2);
const ALLOW_DEV_BASE = argv.includes('--dev') || process.env.C2G_ALLOW_DEV_BASE === '1';
const API_BASE = (process.env.C2G_API_BASE || '').trim();

// The exact literal in background.js we rewrite at stage time.
const DEV_BASE_LITERAL = "const DEFAULT_BACKEND_API_BASE = 'http://localhost:8080';";

// Files/dirs never shipped (top-level names).
const EXCLUDE = new Set([
  'dist', 'build.mjs', 'manifest.firefox.json', 'node_modules', 'test', 'docs',
  'INSTALL.md', '.DS_Store', '.gitignore',
]);
const EXCLUDE_EXT = new Set(['.md', '.zip']);

// Nested dev-only / unused assets to delete from the staged build before zipping.
// (EXCLUDE only filters top-level entries; these live inside copied directories.)
const STAGE_PRUNE = [
  'icons/make_icons.html', // dev-only icon generator, not referenced by the extension
  'icons/logo-square.png', // unused asset (the store listing icon is uploaded separately)
];

function included(name) {
  if (EXCLUDE.has(name)) return false;
  if (EXCLUDE_EXT.has(path.extname(name))) return false;
  return true;
}

async function prune(targetDir) {
  for (const rel of STAGE_PRUNE) {
    await rm(path.join(targetDir, ...rel.split('/')), { force: true });
  }
}

// Refuse to package a store build pointed at a dev/non-https backend.
function assertProdApiBase(base) {
  if (ALLOW_DEV_BASE) {
    console.warn('  ⚠ --dev: skipping production API-base guard. Do NOT submit this build to a store.');
    return;
  }
  if (!base) {
    throw new Error('C2G_API_BASE is required. Set it to your production HTTPS backend, e.g.\n  C2G_API_BASE=https://api.clone2ghl.com node build.mjs\n(or pass --dev for a local test build).');
  }
  let url;
  try { url = new URL(base); } catch { throw new Error(`C2G_API_BASE is not a valid URL: ${base}`); }
  if (url.protocol !== 'https:') {
    throw new Error(`C2G_API_BASE must be https (got ${url.protocol}//). Refusing to ship a non-TLS backend.`);
  }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)) {
    throw new Error(`C2G_API_BASE points at localhost (${url.hostname}). Refusing to ship a dev build.`);
  }
}

function bumpVersion(current) {
  if (process.env.C2G_VERSION) return process.env.C2G_VERSION.trim();
  const kind = process.env.C2G_BUMP;
  if (!kind) return current;
  const parts = String(current).split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (kind === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (kind === 'minor') { parts[1]++; parts[2] = 0; }
  else { parts[2]++; } // patch (default)
  return parts.join('.');
}

async function rewriteApiBase(targetDir) {
  if (ALLOW_DEV_BASE && !API_BASE) return; // keep localhost for a local test build
  const bgPath = path.join(targetDir, 'background.js');
  const src = await readFile(bgPath, 'utf8');
  if (!src.includes(DEV_BASE_LITERAL)) {
    throw new Error(`Could not find the API-base literal in background.js to rewrite.\nExpected: ${DEV_BASE_LITERAL}\n(The constant may have been renamed — update build.mjs.)`);
  }
  const replacement = `const DEFAULT_BACKEND_API_BASE = ${JSON.stringify(API_BASE)};`;
  await writeFile(bgPath, src.replace(DEV_BASE_LITERAL, replacement), 'utf8');
}

async function applyVersion(targetDir, newVersion) {
  if (!newVersion) return;
  const mfPath = path.join(targetDir, 'manifest.json');
  const mf = JSON.parse(await readFile(mfPath, 'utf8'));
  mf.version = newVersion;
  await writeFile(mfPath, JSON.stringify(mf, null, 2) + '\n', 'utf8');
}

async function stage(targetDir, { firefox }) {
  await mkdir(targetDir, { recursive: true });
  for (const name of await readdir(root)) {
    if (!included(name)) continue;
    const src = path.join(root, name);
    if ((await stat(src)).isDirectory()) {
      await cp(src, path.join(targetDir, name), { recursive: true });
    } else {
      await cp(src, path.join(targetDir, name));
    }
  }
  if (firefox) {
    // Swap in the Firefox manifest.
    const ff = await readFile(path.join(root, 'manifest.firefox.json'), 'utf8');
    await writeFile(path.join(targetDir, 'manifest.json'), ff);
  }
  // Point the staged build at production (or keep localhost only with --dev).
  await rewriteApiBase(targetDir);
}

function trySpawn(cmd, args, opts = {}) {
  try {
    const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
    return res.status === 0;
  } catch { return false; }
}

function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      if (spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0) return cmd;
    } catch { /* try next */ }
  }
  return null;
}

// Python writes the arcnames exactly as given, so we force forward slashes.
const PY_ZIP = [
  'import sys, os, zipfile',
  'src, dst = sys.argv[1], sys.argv[2]',
  'if os.path.exists(dst): os.remove(dst)',
  "with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:",
  '    for root, dirs, files in os.walk(src):',
  '        dirs.sort(); files.sort()',
  '        for name in files:',
  '            full = os.path.join(root, name)',
  "            rel = os.path.relpath(full, src).replace(os.sep, '/')",
  '            z.write(full, rel)',
].join('\n');

// Build a zip whose entries use POSIX forward-slash separators. This is REQUIRED:
// the ZIP spec (APPNOTE 4.4.17.1) mandates '/', and Chrome rejects backslash paths
// (e.g. "Could not load locale 'en'" when _locales\en\messages.json is stored).
// Windows PowerShell Compress-Archive writes BACKSLASH separators, so it is only a
// last resort here, with a loud warning.
function zipDir(srcDir, zipPath) {
  // 1) `zip` CLI (macOS/Linux/Git-Bash) — emits forward slashes. -X drops extra attrs.
  if (trySpawn('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: srcDir })) return true;
  // 2) Python (cross-platform) — we control the arcname separators explicitly.
  const py = findPython();
  if (py && trySpawn(py, ['-c', PY_ZIP, srcDir, zipPath])) return true;
  // 3) Last resort on Windows: Compress-Archive (NON-COMPLIANT backslash paths).
  if (process.platform === 'win32') {
    console.warn('  ⚠ Falling back to PowerShell Compress-Archive, which writes BACKSLASH paths\n'
      + '    that Chrome may reject. Install the `zip` CLI or Python for a compliant package.');
    const ps = (s) => s.replace(/'/g, "''"); // PS single-quote escaping (paths may contain ')
    if (trySpawn('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${ps(srcDir)}\\*' -DestinationPath '${ps(zipPath)}' -Force`])) return true;
  }
  console.warn(`  ⚠ Could not auto-zip (no zip/python/Compress-Archive). Folder staged at ${srcDir}.`);
  return false;
}

async function main() {
  // Fail BEFORE doing any work if the API base is unsafe.
  assertProdApiBase(API_BASE);

  await rm(dist, { recursive: true, force: true });

  const baseManifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const newVersion = bumpVersion(baseManifest.version);

  const chromeDir = path.join(dist, 'chrome');
  const firefoxDir = path.join(dist, 'firefox');
  console.log(`API base: ${API_BASE || '(dev: localhost)'}`);
  if (newVersion !== baseManifest.version) console.log(`Version: ${baseManifest.version} → ${newVersion} (staged only)`);

  console.log('Staging Chrome build…');   await stage(chromeDir, { firefox: false });  await applyVersion(chromeDir, newVersion);  await prune(chromeDir);
  console.log('Staging Firefox build…');  await stage(firefoxDir, { firefox: true });  await applyVersion(firefoxDir, newVersion);  await prune(firefoxDir);

  console.log('Zipping…');
  zipDir(chromeDir, path.join(dist, 'clone2ghl-chrome.zip'));
  zipDir(firefoxDir, path.join(dist, 'clone2ghl-firefox.zip'));

  console.log('\n✓ Done. Artifacts in extension/dist/');
  console.log('  • clone2ghl-chrome.zip  → Chrome Web Store / Edge Add-ons');
  console.log('  • clone2ghl-firefox.zip → Firefox Add-ons (AMO)');
}

main().catch(e => { console.error(`\n✗ Build failed: ${e.message}`); process.exit(1); });
