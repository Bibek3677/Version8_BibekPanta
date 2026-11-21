'use strict';

// Outgoing webhook tests (the Make.com integration). A fake webhook receiver
// records what the app sends; no internet connection is needed.
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
const LOG = path.join(os.tmpdir(), `tracker-webhook-test-${process.pid}.log`);
let server, base, receiver;
const received = [];
let waiters = [];

before(async () => {
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200);
      res.end('Accepted');
      waiters.forEach((w) => w());
      waiters = [];
    });
  });
  await new Promise((r) => receiver.listen(0, r));

  server = createServer(openDb(':memory:'), {
    apiKey: KEY,
    logFile: LOG,
    echo: false,
    holidays: { defaultCountry: 'US', annotate: async (t) => t },
    webhookUrl: `http://localhost:${receiver.address().port}/hook`,
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => receiver.close(r));
  fs.rmSync(LOG, { force: true });
});

async function call(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { 'x-api-key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// Waits until `count` events have arrived (webhooks are sent in the background).
async function eventsAfter(count) {
  const deadline = Date.now() + 2000;
  while (received.length < count) {
    if (Date.now() > deadline) throw new Error(`Expected ${count} webhook events, got ${received.length}`);
    await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
  }
  return received.slice(0, count);
}

test('task changes are sent to the webhook with the right event names', async () => {
  const created = await call('POST', '/api/tasks', { title: 'Webhook demo', priority: 'high' });
  assert.equal(created.status, 201);
  const id = created.data.id;

  await call('PATCH', `/api/tasks/${id}`, { notes: 'edited' });
  await call('PATCH', `/api/tasks/${id}`, { done: true });
  await call('PATCH', `/api/tasks/${id}`, { done: false });
  await call('DELETE', `/api/tasks/${id}`);

  const events = await eventsAfter(5);
  assert.deepEqual(events.map((e) => e.event),
    ['task.created', 'task.updated', 'task.completed', 'task.reopened', 'task.deleted']);
  assert.equal(events[0].task.title, 'Webhook demo');
  assert.equal(events[0].source, 'lab-task-tracker-v5');
  assert.ok(!Number.isNaN(Date.parse(events[0].occurred_at)));
  assert.equal(events[2].previous.done, false);
  assert.equal(events[4].task.id, id);
});

test('failed requests do not send webhook events', async () => {
  const before = received.length;
  assert.equal((await call('POST', '/api/tasks', { title: '' })).status, 400);
  assert.equal((await call('DELETE', '/api/tasks/99999')).status, 404);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(received.length, before);
});
