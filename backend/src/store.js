import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'db.json');
const DB_TMP = path.join(DB_DIR, 'db.json.tmp');
const DB_BAK = path.join(DB_DIR, 'db.json.bak');

let writeQueue = Promise.resolve();

const initialData = {
  users: [],
  funnels: [],
  usage: [],
  preferences: [],
  activity: [],
  invoices: [],
  videoJobs: [],
  videoAssets: [],
  customSites: [],
  ghlEvents: [],
  passwordResets: [],
  refreshTokens: [],
  funnelVersions: [],
  trialLocations: [],
  importJobs: [],
};

function withDefaults(data) {
  return {
    users: Array.isArray(data?.users) ? data.users : [],
    funnels: Array.isArray(data?.funnels) ? data.funnels : [],
    usage: Array.isArray(data?.usage) ? data.usage : [],
    preferences: Array.isArray(data?.preferences) ? data.preferences : [],
    activity: Array.isArray(data?.activity) ? data.activity : [],
    invoices: Array.isArray(data?.invoices) ? data.invoices : [],
    videoJobs: Array.isArray(data?.videoJobs) ? data.videoJobs : [],
    videoAssets: Array.isArray(data?.videoAssets) ? data.videoAssets : [],
    customSites: Array.isArray(data?.customSites) ? data.customSites : [],
    ghlEvents: Array.isArray(data?.ghlEvents) ? data.ghlEvents : [],
    passwordResets: Array.isArray(data?.passwordResets) ? data.passwordResets : [],
    refreshTokens: Array.isArray(data?.refreshTokens) ? data.refreshTokens : [],
    funnelVersions: Array.isArray(data?.funnelVersions) ? data.funnelVersions : [],
    trialLocations: Array.isArray(data?.trialLocations) ? data.trialLocations : [],
    importJobs: Array.isArray(data?.importJobs) ? data.importJobs : [],
  };
}

async function ensureDbFile() {
  await mkdir(DB_DIR, { recursive: true });
  try {
    await readFile(DB_PATH, 'utf8');
  } catch {
    await writeFile(DB_PATH, JSON.stringify(initialData, null, 2), 'utf8');
  }
}

export async function readDb() {
  await ensureDbFile();
  const raw = await readFile(DB_PATH, 'utf8');
  try {
    return withDefaults(JSON.parse(raw));
  } catch (err) {
    // db.json is unparseable (e.g. a crash before atomic writes existed). Try the
    // last known-good backup rather than wiping data.
    try {
      const bak = await readFile(DB_BAK, 'utf8');
      console.error('[store] db.json corrupt — recovered from db.json.bak');
      return withDefaults(JSON.parse(bak));
    } catch {
      throw err;
    }
  }
}

export async function writeDb(updater) {
  writeQueue = writeQueue.then(async () => {
    const current = await readDb();
    const next = withDefaults(await updater(current));
    const serialized = JSON.stringify(next, null, 2);

    // Crash-safe write: keep the previous good copy as .bak, write to a temp
    // file, then atomically rename over the live file. A crash mid-write leaves
    // either the old db.json or db.json.tmp intact — never a truncated db.json.
    try {
      await copyFile(DB_PATH, DB_BAK);
    } catch { /* first write — no existing file to back up */ }
    await writeFile(DB_TMP, serialized, 'utf8');
    await rename(DB_TMP, DB_PATH);
  });
  await writeQueue;
}
