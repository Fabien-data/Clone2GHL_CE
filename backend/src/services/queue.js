/**
 * queue.js — minimal concurrency-limited, non-blocking task runner.
 *
 * Default: in-process (works on today's single-instance Fly deploy). Jobs are
 * persisted in the store, so an in-flight job that dies on restart is recoverable
 * (see resumeStuckJobs in importWorker). When `config.redisUrl` is set you can swap
 * this for BullMQ — the worker is written to be backend-agnostic (a job is just an
 * id + persisted record), so only this file needs to change.
 */
import { config } from '../config.js';

const MAX = Math.max(1, config.importConcurrency || 2);
let active = 0;
const pending = [];

function pump() {
  while (active < MAX && pending.length) {
    const fn = pending.shift();
    active++;
    Promise.resolve()
      .then(fn)
      .catch((e) => console.error('[queue] task failed:', e?.message))
      .finally(() => { active--; pump(); });
  }
}

/** Schedule a task to run as soon as a slot frees. Returns immediately. */
export function schedule(fn) {
  pending.push(fn);
  pump();
}

export function queueDepth() { return { active, pending: pending.length, max: MAX }; }
