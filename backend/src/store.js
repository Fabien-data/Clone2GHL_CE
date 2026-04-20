import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'db.json');

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
  return withDefaults(JSON.parse(raw));
}

export async function writeDb(updater) {
  writeQueue = writeQueue.then(async () => {
    const current = await readDb();
    const next = withDefaults(await updater(current));
    await writeFile(DB_PATH, JSON.stringify(next, null, 2), 'utf8');
  });
  await writeQueue;
}
