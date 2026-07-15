/**
 * sse.js — tiny Server-Sent Events hub for import-job progress.
 *
 * The worker calls publish(jobId, event); any client streaming
 * GET /api/import/jobs/:id/stream receives it live. The diagram's "WebSocket OR
 * Polling" → we ship SSE here plus the polling endpoint in routes/import.js.
 * No external deps; works on Express/Fly behind a proxy (X-Accel-Buffering: no).
 */
import { EventEmitter } from 'node:events';

const hub = new EventEmitter();
hub.setMaxListeners(0);

export function publish(jobId, event) {
  try { hub.emit(jobId, event); } catch { /* ignore */ }
}

export function streamJob(req, res, jobId) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* closed */ } };
  send({ type: 'hello', jobId });

  const onEvent = (ev) => {
    send(ev);
    if (ev.type === 'done') cleanup();
  };
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20_000);

  function cleanup() {
    clearInterval(ping);
    hub.off(jobId, onEvent);
    try { res.end(); } catch { /* ignore */ }
  }

  hub.on(jobId, onEvent);
  req.on('close', cleanup);
}
