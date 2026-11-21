'use strict';

// Automated API tests. Each run uses a fresh in-memory database and a fake
// holiday service, so no internet connection is needed and your real data
// is never touched.
//   npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../db');
const { createServer } = require('../server');

const KEY = 'test-key-123';
const LOG = path.join(os.tmpdir(), `tracker-test-${process.pid}.log`);
let server, base, holidayServer, holidayMode = 'ok';

before(async () => {
  // Fake Nager.Date API
  holidayServer = http.createServer((req, res) => {
    if (holidayMode === 'down') { res.writeHead(500); return res.end(); }
    const m = req.url.match(/^\/PublicHolidays\/(\d{4})\/([A-Z]{2})$/);
    if (!m || m[2] === 'ZZ') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { date: `${m[1]}-01-01`, localName: "New Year's Day", name: "New Year's Day", countryCode: m[2], global: true },
      { date: `${m[1]}-11-26`, localName: 'Thanksgiving Day', name: 'Thanksgiving Day', countryCode: m[2], global: true },
    ]));
  });
  await new Promise((r) => holidayServer.listen(0, r));

  server = createServer(openDb(':memory:'), {
    apiKey: KEY,
    logFile: LOG,
    echo: false,
    holidayApiUrl: `http://localhost:${holidayServer.address().port}`,
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => holidayServer.close(r));
  fs.rmSync(LOG, { force: true });
});

async function call(method, p, body, { key = KEY, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (key) h['x-api-key'] = key;
  if (body !== undefined || raw !== undefined) h['Content-Type'] ??= 'application/json';
  const res = await fetch(base + p, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

let courseId, taskId;

/* ---------- authentication ---------- */

test('health check is public and reports the database', async () => {
  const { status, data } = await call('GET', '/api/health', undefined, { key: null });
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
  assert.equal(data.database, 'ok');
});

test('missing or wrong API key returns 401', async () => {
  assert.equal((await call('GET', '/api/tasks', undefined, { key: null })).status, 401);
  assert.equal((await call('GET', '/api/tasks', undefined, { key: 'wrong' })).status, 401);
});

test('Bearer token works as well as x-api-key', async () => {
  const { status } = await call('GET', '/api/tasks', undefined, { key: null, headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal(status, 200);
});

/* ---------- CRUD ---------- */

test('POST creates a course and sets Location', async () => {
  const { status, data, headers } = await call('POST', '/api/courses', { code: 'itc6250', name: 'LCNC development' });
  assert.equal(status, 201);
  assert.equal(data.code, 'ITC6250');
  assert.equal(headers.get('location'), `/api/courses/${data.id}`);
  courseId = data.id;
});

test('duplicate course code returns 409', async () => {
  assert.equal((await call('POST', '/api/courses', { code: 'ITC6250', name: 'Again' })).status, 409);
});

test('PATCH course changes one field; PUT course needs every field', async () => {
  const patched = await call('PATCH', `/api/courses/${courseId}`, { name: 'Renamed' });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.code, 'ITC6250');
  assert.equal((await call('PUT', `/api/courses/${courseId}`, { name: 'No code' })).status, 400);
  const put = await call('PUT', `/api/courses/${courseId}`, { code: 'ITC6250', name: 'LCNC development' });
  assert.equal(put.status, 200);
});

test('POST creates a task, flags a holiday due date', async () => {
  const { status, data } = await call('POST', '/api/tasks', {
    title: '  Build API  ', course_id: courseId, due_date: '2026-11-26', priority: 'high', notes: 'Use REST',
  });
  assert.equal(status, 201);
  assert.equal(data.title, 'Build API');
  assert.equal(data.course_code, 'ITC6250');
  assert.equal(data.holiday, 'Thanksgiving Day');
  taskId = data.id;
});

test('GET returns the list and a single task', async () => {
  const list = await call('GET', '/api/tasks');
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 1);
  assert.equal((await call('GET', `/api/tasks/${taskId}`)).data.title, 'Build API');
});

test('PATCH task changes only what is sent', async () => {
  const { status, data } = await call('PATCH', `/api/tasks/${taskId}`, { done: true });
  assert.equal(status, 200);
  assert.equal(data.done, true);
  assert.equal(data.notes, 'Use REST');
});

test('PUT task replaces it; missing fields go back to defaults', async () => {
  const { status, data } = await call('PUT', `/api/tasks/${taskId}`, { title: 'Build API v2', course_id: courseId });
  assert.equal(status, 200);
  assert.equal(data.title, 'Build API v2');
  assert.equal(data.notes, '');
  assert.equal(data.priority, 'medium');
  assert.equal(data.done, false);
  assert.equal(data.due_date, null);
  assert.equal((await call('PUT', `/api/tasks/${taskId}`, { done: true })).status, 400); // title required
});

test('filters, search and sort', async () => {
  await call('POST', '/api/tasks', { title: 'Write 100% of reflection', due_date: '2020-01-01' });
  assert.equal((await call('GET', '/api/tasks?status=overdue')).data.length, 1);
  assert.equal((await call('GET', '/api/tasks?q=100%25')).data.length, 1);
  assert.equal((await call('GET', '/api/tasks?course=none')).data.length, 1);
  assert.equal((await call('GET', '/api/tasks?sort=bogus')).status, 400);
  assert.equal((await call('GET', '/api/tasks?status=bogus')).status, 400);
});

/* ---------- error handling ---------- */

test('validation errors return 400 with details', async () => {
  for (const body of [{ title: '' }, { title: 'ok', priority: 'urgent' }, { title: 'ok', due_date: '2026-02-30' }, { title: 'ok', course_id: 999 }]) {
    const { status, data } = await call('POST', '/api/tasks', body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.ok(data.error && data.request_id);
  }
});

test('malformed JSON is 400, wrong content type is 415', async () => {
  assert.equal((await call('POST', '/api/tasks', undefined, { raw: '{"title": ' })).status, 400);
  assert.equal((await call('POST', '/api/tasks', undefined, { raw: 'title=x', headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('unknown ids are 404, wrong methods are 405 with Allow', async () => {
  assert.equal((await call('GET', '/api/tasks/99999')).status, 404);
  assert.equal((await call('PATCH', '/api/tasks/99999', { done: true })).status, 404);
  assert.equal((await call('DELETE', '/api/tasks/99999')).status, 404);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  const r = await call('POST', `/api/tasks/${taskId}`, {});
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow'), /PATCH/);
});

test('cannot delete a course that still has tasks', async () => {
  const { status, data } = await call('DELETE', `/api/courses/${courseId}`);
  assert.equal(status, 409);
  assert.match(data.error, /still has 1 task/);
});

/* ---------- integrations ---------- */

test('GET /api/holidays lists holidays from the external API', async () => {
  const { status, data } = await call('GET', '/api/holidays?year=2026&country=us');
  assert.equal(status, 200);
  assert.equal(data.country, 'US');
  assert.equal(data.count, 2);
  assert.equal((await call('GET', '/api/holidays?country=USA')).status, 400);
  assert.equal((await call('GET', '/api/holidays?year=2026&country=ZZ')).status, 404);
});

test('GET /api/holidays/check answers yes or no for a date', async () => {
  const yes = await call('GET', '/api/holidays/check?date=2026-11-26');
  assert.equal(yes.data.is_holiday, true);
  assert.equal(yes.data.holidays[0].name, 'Thanksgiving Day');
  const no = await call('GET', '/api/holidays/check?date=2026-11-27');
  assert.equal(no.data.is_holiday, false);
  assert.equal((await call('GET', '/api/holidays/check?date=nope')).status, 400);
});

test('if the holiday API is down, tasks still work and holidays return 503/502', async () => {
  holidayMode = 'down';
  const r = await call('GET', '/api/holidays?year=2031');
  assert.ok([502, 503].includes(r.status));
  const created = await call('POST', '/api/tasks', { title: 'Offline task', due_date: '2031-11-26' });
  assert.equal(created.status, 201);
  assert.equal(created.data.holiday, null);
  holidayMode = 'ok';
});

test('calendar feed returns iCalendar and accepts ?key=', async () => {
  await call('PATCH', `/api/tasks/${taskId}`, { due_date: '2026-11-26' });
  const res = await fetch(`${base}/api/calendar.ics?key=${KEY}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  const body = await res.text();
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /DTSTART;VALUE=DATE:20261126/);
  assert.match(body, /SUMMARY:\[ITC6250\] Build API v2/);
  assert.equal((await fetch(`${base}/api/calendar.ics`)).status, 401);
  assert.equal((await fetch(`${base}/api/tasks?key=${KEY}`)).status, 401); // ?key only for the feed
});

/* ---------- delete, monitoring ---------- */

test('DELETE task, then the empty course', async () => {
  const tasks = (await call('GET', '/api/tasks')).data;
  for (const t of tasks.filter((t) => t.course_id === courseId)) {
    assert.equal((await call('DELETE', `/api/tasks/${t.id}`)).status, 204);
  }
  assert.equal((await call('DELETE', `/api/courses/${courseId}`)).status, 204);
  assert.equal((await call('GET', `/api/courses/${courseId}`)).status, 404);
});

test('metrics count requests by route', async () => {
  const { status, data } = await call('GET', '/api/metrics');
  assert.equal(status, 200);
  assert.ok(data.total_requests > 10);
  assert.ok(data.by_route['GET /api/tasks/:id']);
  assert.ok(data.by_status['401'] >= 2);
});

test('every request gets an id and is logged without the API key', async () => {
  const r = await call('GET', '/api/stats');
  const id = r.headers.get('x-request-id');
  assert.ok(id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const log = fs.readFileSync(LOG, 'utf8');
  assert.ok(log.includes(id));
  assert.ok(!log.includes(KEY));
});

test('static files are served and path traversal is blocked', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.notEqual((await fetch(base + '/%2e%2e/server.js')).status, 200);
});
