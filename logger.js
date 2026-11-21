'use strict';

// Request logging and simple monitoring.
// Every API request is written as one JSON line to logs/requests.log, and
// running totals are kept in memory for GET /api/metrics.
// API keys are never written to the log.

const fs = require('node:fs');
const path = require('node:path');

function routePattern(pathname) {
  return pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
}

function createLogger({ file = path.join(__dirname, 'logs', 'requests.log'), echo = true } = {}) {
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  const stream = file ? fs.createWriteStream(file, { flags: 'a' }) : null;

  const metrics = {
    started_at: new Date().toISOString(),
    total_requests: 0,
    by_status: {},
    by_route: {},
    errors_5xx: 0,
    total_ms: 0,
  };

  function write(entry) {
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
    if (stream && !stream.writableEnded) stream.write(line + '\n');
    return line;
  }

  function request({ id, method, pathname, status, ms, ip, error }) {
    const route = `${method} ${routePattern(pathname)}`;
    metrics.total_requests += 1;
    metrics.total_ms += ms;
    metrics.by_status[status] = (metrics.by_status[status] || 0) + 1;
    const r = (metrics.by_route[route] ||= { count: 0, total_ms: 0, errors: 0 });
    r.count += 1;
    r.total_ms += ms;
    if (status >= 400) r.errors += 1;
    if (status >= 500) metrics.errors_5xx += 1;

    write({ level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', request_id: id, method, path: pathname, status, ms, ip, ...(error ? { error } : {}) });
    if (echo) console.log(`${method} ${pathname} ${status} ${ms}ms`);
  }

  function event(level, message) {
    write({ level, message });
    if (echo) console[level === 'error' ? 'error' : 'log'](`[${level}] ${message}`);
  }

  function snapshot() {
    const uptime = Math.round((Date.now() - Date.parse(metrics.started_at)) / 1000);
    const routes = Object.fromEntries(Object.entries(metrics.by_route).map(([k, v]) => [
      k, { count: v.count, errors: v.errors, avg_ms: Math.round(v.total_ms / v.count) },
    ]));
    return {
      started_at: metrics.started_at,
      uptime_seconds: uptime,
      total_requests: metrics.total_requests,
      avg_ms: metrics.total_requests ? Math.round(metrics.total_ms / metrics.total_requests) : 0,
      errors_5xx: metrics.errors_5xx,
      by_status: metrics.by_status,
      by_route: routes,
    };
  }

  function close() {
    return new Promise((resolve) => (stream && !stream.writableEnded ? stream.end(resolve) : resolve()));
  }

  return { request, event, snapshot, close };
}

module.exports = { createLogger };
