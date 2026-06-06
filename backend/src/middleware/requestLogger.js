/**
 * backend/src/middleware/requestLogger.js
 *
 * Structured request logging — one JSON line per request with a request id,
 * method, path, status, duration, and (if authenticated) userId. Replaces the
 * bare console.error sprinkled through routes so production issues are traceable.
 */

import { randomUUID } from 'node:crypto';

export function requestLogger(req, res, next) {
  const start = Date.now();
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);

  res.on('finish', () => {
    const line = {
      t: new Date().toISOString(),
      id: req.id,
      method: req.method,
      path: req.originalUrl?.split('?')[0],
      status: res.statusCode,
      ms: Date.now() - start,
      userId: req.user?.userId || null,
    };
    // Single JSON line — easy to grep / ship to a log aggregator.
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    console[level === 'error' ? 'error' : 'log'](JSON.stringify({ level, ...line }));
  });

  next();
}
