'use strict';

// Lab Task Tracker, Version 8 (Version 5 API + AI-assisted front-end features).
// Serves the front end from /public and a JSON REST API under /api with
// API-key authentication, consistent error responses, rate limiting,
// request logging and a metrics endpoint. Integrates with Supabase
// (database), Nager.Date (public holidays) and calendar apps (.ics feed).
// Uses only built-in Node modules.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node 22.13 or newer is required (you have ${process.versions.node}). Install the current LTS from https://nodejs.org`);
  process.exit(1);
}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Uses Supabase when SUPABASE_URL is set (npm run start:supabase reads it
// from .env); otherwise falls back to the local SQLite file.
const repo = process.env.SUPABASE_URL ? require('./db-supabase') : require('./db');
const { validateTask, validateCourse, parseId } = require('./validate');
const { createHolidayService, IntegrationError } = require('./integrations/holidays');
const { buildIcs } = require('./integrations/calendar');
const { createLogger } = require('./logger');
const { createWebhookService } = require('./integrations/webhooks');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 100 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const TASK_DEFAULTS = { course_id: null, notes: '', due_date: null, priority: 'medium', done: false };

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res, status, data) {
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large (limit 100 KB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve({});
      if (!type.includes('application/json')) {
        return reject(new HttpError(415, 'Send the body as JSON with the header Content-Type: application/json.'));
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function requireValid({ value, errors }) {
  if (errors.length) throw new HttpError(400, errors.join(' '), errors);
  return value;
}

function requireId(raw, label) {
  const id = parseId(raw);
  if (!id) throw new HttpError(400, `${label} id must be a positive whole number.`);
  return id;
}

async function ensureCourseExists(db, courseId) {
  if (courseId != null && !await repo.getCourse(db, courseId)) {
    throw new HttpError(400, `Course ${courseId} does not exist.`);
  }
}

// Turns database and integration errors into friendly HTTP errors.
function translateError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof IntegrationError) return new HttpError(err.status, err.message);
  const msg = String(err && err.message);
  if (err && err.pgCode === '23505') return new HttpError(409, 'A course with that code already exists.');
  if (err && err.pgCode === '23503') return new HttpError(409, 'That change would break a link between a task and its course.');
  if (err && err.pgCode === '23514') return new HttpError(400, 'One of the values is outside the allowed range.');
  if (err && err.constructor && err.constructor.name === 'SupabaseError') return new HttpError(502, err.message);
  if (msg.includes('UNIQUE constraint failed: courses.code')) return new HttpError(409, 'A course with that code already exists.');
  if (msg.includes('FOREIGN KEY constraint failed')) return new HttpError(409, 'That change would break a link between a task and its course.');
  if (msg.includes('CHECK constraint failed')) return new HttpError(400, 'One of the values is outside the allowed range.');
  return err;
}

/* ---------- authentication ---------- */

function sameSecret(a, b) {
  // Compare hashes so the check takes the same time whatever the input.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function presentedKey(req, url, allowQueryKey) {
  const header = req.headers['x-api-key'];
  if (header) return header;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // Calendar apps cannot send headers, so the .ics feed also accepts ?key=
  if (allowQueryKey) return url.searchParams.get('key');
  return null;
}

/* ---------- rate limiting (fixed one-minute window per IP) ---------- */

function createRateLimiter(limitPerMinute) {
  const hits = new Map();
  return function check(ip) {
    const now = Date.now();
    const windowStart = now - (now % 60000);
    const entry = hits.get(ip);
    if (!entry || entry.windowStart !== windowStart) {
      hits.set(ip, { windowStart, count: 1 });
      return { ok: true, remaining: limitPerMinute - 1 };
    }
    entry.count += 1;
    return {
      ok: entry.count <= limitPerMinute,
      remaining: Math.max(0, limitPerMinute - entry.count),
      retryAfter: Math.ceil((windowStart + 60000 - now) / 1000),
    };
  };
}

/* ---------- API routes ---------- */

async function handleApi(ctx, req, res, url) {
  const { db, holidays, logger, webhooks } = ctx;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'tasks', '3']
  const [, resource, rawId, extra] = parts;
  const method = req.method;

  if (extra !== undefined) throw new HttpError(404, `No endpoint at ${url.pathname}.`);

  const notAllowed = (allowed) => {
    res.setHeader('Allow', allowed.join(', '));
    return new HttpError(405, `${method} is not allowed on ${url.pathname}. Allowed: ${allowed.join(', ')}.`);
  };

  // ----- public: health check (used for monitoring, no key needed) -----
  if (resource === 'health' && !rawId) {
    if (method !== 'GET') throw notAllowed(['GET']);
    let database = 'ok';
    try {
      await repo.stats(db);
    } catch {
      database = 'unreachable';
    }
    return sendJson(res, database === 'ok' ? 200 : 503, {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      backend: repo.backend,
      version: '8.0.0',
      time: new Date().toISOString(),
    });
  }

  // ----- everything below needs a valid API key -----
  const key = presentedKey(req, url, resource === 'calendar.ics');
  if (!key) {
    res.setHeader('WWW-Authenticate', 'ApiKey header="x-api-key"');
    throw new HttpError(401, 'Missing API key. Send it in the x-api-key header.');
  }
  if (!sameSecret(key, ctx.apiKey)) throw new HttpError(401, 'Invalid API key.');

  if (resource === 'info' && !rawId) {
    if (method !== 'GET') throw notAllowed(['GET']);
    return sendJson(res, 200, { backend: repo.backend, holiday_country: holidays.defaultCountry });
  }

  if (resource === 'stats' && !rawId) {
    if (method !== 'GET') throw notAllowed(['GET']);
    return sendJson(res, 200, await repo.stats(db));
  }

  if (resource === 'metrics' && !rawId) {
    if (method !== 'GET') throw notAllowed(['GET']);
    return sendJson(res, 200, logger.snapshot());
  }

  // ----- integration: public holidays -----
  if (resource === 'holidays') {
    if (method !== 'GET') throw notAllowed(['GET']);
    const country = (url.searchParams.get('country') || holidays.defaultCountry).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Country must be a two-letter code such as US or GB.');

    if (!rawId) {
      const year = Number(url.searchParams.get('year') || new Date().getFullYear());
      if (!Number.isInteger(year) || year < 1975 || year > 2075) throw new HttpError(400, 'Year must be between 1975 and 2075.');
      const list = await holidays.list(year, country);
      return sendJson(res, 200, { country, year, count: list.length, holidays: list });
    }
    if (rawId === 'check') {
      const date = url.searchParams.get('date') || '';
      const { errors } = validateTask({ title: 'x', due_date: date });
      if (!date || errors.length) throw new HttpError(400, 'Send a real date as ?date=YYYY-MM-DD.');
      const matches = await holidays.on(date, country);
      return sendJson(res, 200, { date, country, is_holiday: matches.length > 0, holidays: matches });
    }
    throw new HttpError(404, `No endpoint at ${url.pathname}.`);
  }

  // ----- integration: calendar feed -----
  if (resource === 'calendar.ics' && !rawId) {
    if (method !== 'GET') throw notAllowed(['GET']);
    const tasks = await repo.listTasks(db, { status: 'open', sort: 'due' });
    return send(res, 200, buildIcs(tasks), 'text/calendar; charset=utf-8');
  }

  // ----- courses -----
  if (resource === 'courses') {
    if (!rawId) {
      if (method === 'GET') return sendJson(res, 200, await repo.listCourses(db));
      if (method === 'POST') {
        const course = requireValid(validateCourse(await readJson(req)));
        const created = await repo.createCourse(db, course);
        res.setHeader('Location', `/api/courses/${created.id}`);
        return sendJson(res, 201, created);
      }
      throw notAllowed(['GET', 'POST']);
    }
    const id = requireId(rawId, 'Course');
    if (method === 'GET') {
      const course = await repo.getCourse(db, id);
      if (!course) throw new HttpError(404, `Course ${id} was not found.`);
      return sendJson(res, 200, course);
    }
    if (method === 'PUT' || method === 'PATCH') {
      // PUT replaces the whole course (code and name required);
      // PATCH changes only the fields that are sent.
      const changes = requireValid(validateCourse(await readJson(req), { partial: method === 'PATCH' }));
      if (Object.keys(changes).length === 0) throw new HttpError(400, 'Send at least one field to change.');
      const course = await repo.updateCourse(db, id, changes);
      if (!course) throw new HttpError(404, `Course ${id} was not found.`);
      return sendJson(res, 200, course);
    }
    if (method === 'DELETE') {
      if (!await repo.getCourse(db, id)) throw new HttpError(404, `Course ${id} was not found.`);
      const n = await repo.countTasksForCourse(db, id);
      if (n > 0) throw new HttpError(409, `This course still has ${n} task${n === 1 ? '' : 's'}. Move or delete them first.`);
      await repo.deleteCourse(db, id);
      return sendJson(res, 204);
    }
    throw notAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
  }

  // ----- tasks -----
  if (resource === 'tasks') {
    if (!rawId) {
      if (method === 'GET') {
        const status = url.searchParams.get('status') || 'all';
        if (!['all', 'open', 'done', 'overdue'].includes(status)) {
          throw new HttpError(400, 'Status must be all, open, done or overdue.');
        }
        const rawCourse = url.searchParams.get('course') || '';
        const course = rawCourse === '' || rawCourse === 'none' ? rawCourse : requireId(rawCourse, 'Course');
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        const sort = url.searchParams.get('sort') || 'due';
        if (!['due', 'priority', 'newest'].includes(sort)) throw new HttpError(400, 'Sort must be due, priority or newest.');
        const tasks = await repo.listTasks(db, { status, course, q, sort });
        return sendJson(res, 200, await holidays.annotate(tasks));
      }
      if (method === 'POST') {
        const task = requireValid(validateTask(await readJson(req)));
        await ensureCourseExists(db, task.course_id);
        const created = await holidays.annotate(await repo.createTask(db, task));
        webhooks.emit('task.created', { task: created });
        res.setHeader('Location', `/api/tasks/${created.id}`);
        return sendJson(res, 201, created);
      }
      if (method === 'DELETE') {
        if (url.searchParams.get('done') !== 'true') {
          throw new HttpError(400, 'To delete all completed tasks, call DELETE /api/tasks?done=true.');
        }
        const deleted = await repo.clearCompleted(db);
        if (deleted > 0) webhooks.emit('tasks.cleared', { deleted });
        return sendJson(res, 200, { deleted });
      }
      throw notAllowed(['GET', 'POST', 'DELETE']);
    }
    const id = requireId(rawId, 'Task');
    if (method === 'GET') {
      const task = await repo.getTask(db, id);
      if (!task) throw new HttpError(404, `Task ${id} was not found.`);
      return sendJson(res, 200, await holidays.annotate(task));
    }
    if (method === 'PATCH') {
      const changes = requireValid(validateTask(await readJson(req), { partial: true }));
      if (Object.keys(changes).length === 0) throw new HttpError(400, 'Send at least one field to change.');
      await ensureCourseExists(db, changes.course_id);
      const before = await repo.getTask(db, id);
      const task = await repo.updateTask(db, id, changes);
      if (!task) throw new HttpError(404, `Task ${id} was not found.`);
      return sendTaskUpdate(res, webhooks, before, await holidays.annotate(task));
    }
    if (method === 'PUT') {
      // Full replacement: title is required and any field left out goes
      // back to its default.
      const value = requireValid(validateTask(await readJson(req)));
      const full = { ...TASK_DEFAULTS, ...value };
      await ensureCourseExists(db, full.course_id);
      const before = await repo.getTask(db, id);
      const task = await repo.updateTask(db, id, full);
      if (!task) throw new HttpError(404, `Task ${id} was not found.`);
      return sendTaskUpdate(res, webhooks, before, await holidays.annotate(task));
    }
    if (method === 'DELETE') {
      const existing = await repo.getTask(db, id);
      if (!existing || !await repo.deleteTask(db, id)) throw new HttpError(404, `Task ${id} was not found.`);
      webhooks.emit('task.deleted', { task: existing });
      return sendJson(res, 204);
    }
    throw notAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
  }

  throw new HttpError(404, `No endpoint at ${url.pathname}.`);
}

// Sends the updated task and tells webhook listeners what kind of change it
// was: "task.completed" / "task.reopened" when done flips, else "task.updated".
function sendTaskUpdate(res, webhooks, before, task) {
  let event = 'task.updated';
  if (before && !before.done && task.done) event = 'task.completed';
  else if (before && before.done && !task.done) event = 'task.reopened';
  webhooks.emit(event, { task, previous: before || null });
  return sendJson(res, 200, task);
}

/* ---------- static files ---------- */

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.resolve(PUBLIC_DIR, '.' + rel);

  // Block path traversal such as /../server.js
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

/* ---------- server ---------- */

function createServer(db, options = {}) {
  const logger = options.logger || createLogger({ file: options.logFile, echo: options.echo !== false });
  const ctx = {
    db,
    logger,
    apiKey: options.apiKey,
    holidays: options.holidays || createHolidayService({ baseUrl: options.holidayApiUrl, log: logger.event }),
    webhooks: options.webhooks || createWebhookService({ url: options.webhookUrl, log: logger.event }),
  };
  if (!ctx.apiKey) throw new Error('createServer needs an apiKey.');
  const rateLimit = createRateLimiter(options.rateLimitPerMinute || 120);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);

    const started = process.hrtime.bigint();
    const requestId = crypto.randomUUID();
    const ip = req.socket.remoteAddress;
    res.setHeader('X-Request-Id', requestId);
    let errorMessage;

    res.on('finish', () => {
      const ms = Number((process.hrtime.bigint() - started) / 1000000n);
      logger.request({ id: requestId, method: req.method, pathname: url.pathname, status: res.statusCode, ms, ip, error: errorMessage });
    });

    try {
      const limit = rateLimit(ip);
      res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
      if (!limit.ok) {
        res.setHeader('Retry-After', String(limit.retryAfter));
        throw new HttpError(429, `Too many requests. Try again in ${limit.retryAfter} seconds.`);
      }
      await handleApi(ctx, req, res, url);
    } catch (rawErr) {
      const err = translateError(rawErr);
      if (err instanceof HttpError) {
        errorMessage = err.message;
        sendJson(res, err.status, { error: err.message, details: err.details, status: err.status, request_id: requestId });
      } else {
        errorMessage = String(err && err.stack || err);
        logger.event('error', errorMessage);
        sendJson(res, 500, { error: 'Something went wrong on the server. Check logs/requests.log for details.', status: 500, request_id: requestId });
      }
    }
  });
  server.on('close', () => logger.close());
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  (async () => {
    let apiKey = process.env.API_KEY;
    if (!apiKey) {
      apiKey = crypto.randomBytes(18).toString('base64url');
      console.log('No API_KEY in .env, so a temporary one was generated for this run:');
      console.log(`  ${apiKey}`);
      console.log('Add API_KEY=... to your .env file to keep the same key between runs.\n');
    }

    let db;
    if (repo.backend === 'supabase') {
      try {
        db = repo.openDb();
        await repo.stats(db); // fail fast if the URL, key or schema is wrong
      } catch (err) {
        console.error('Could not connect to Supabase: ' + err.message);
        process.exit(1);
      }
      console.log(`Connected to Supabase project ${db.url}`);
    } else {
      const dbFile = process.env.DB_FILE || path.join(__dirname, 'data', 'tracker.db');
      db = repo.openDb(dbFile);
      if (repo.stats(db).total === 0 && repo.listCourses(db).length === 0) {
        require('./seed').seed(db);
        console.log('Empty database found, so sample data was added.');
      }
      console.log(`Using local SQLite file ${dbFile}`);
    }

    const port = Number(process.env.PORT) || 3000;
    const server = createServer(db, { apiKey });
    server.listen(port, () => {
      console.log(`Lab Task Tracker v8 running at http://localhost:${port}`);
      console.log(`Health check: http://localhost:${port}/api/health`);
      console.log(process.env.WEBHOOK_URL ? 'Task events are sent to WEBHOOK_URL.' : 'No WEBHOOK_URL set, so task events are not sent anywhere.');
      console.log('Requests are logged to logs/requests.log. Press Ctrl+C to stop.\n');
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Close the other server window, or on Windows run: set PORT=3001 && npm run start:supabase`);
        process.exit(1);
      }
      throw err;
    });

    const shutdown = () => {
      server.close(() => {
        if (repo.backend === 'sqlite') db.close();
        process.exit(0);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })();
}
