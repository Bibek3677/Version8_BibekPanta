'use strict';

// External integration: outgoing webhooks (for example to a Make.com
// "Custom webhook" trigger). When a task changes, the app POSTs a JSON event
// to WEBHOOK_URL so an automation platform can react to it.
//
// Delivery is fire-and-forget: the API response never waits for the webhook,
// and a slow or failing webhook only produces a warning in the log.

const TIMEOUT_MS = 5000;

function createWebhookService({
  url = process.env.WEBHOOK_URL || '',
  log = () => {},
} = {}) {
  const enabled = /^https?:\/\//.test(url);
  // Events are delivered one at a time, in the order they happened, so the
  // receiver never sees "task.completed" before the "task.created" it follows.
  let queue = Promise.resolve();

  function emit(event, data) {
    if (!enabled) return;
    const body = JSON.stringify({
      event,                       // e.g. "task.created"
      occurred_at: new Date().toISOString(),
      source: 'lab-task-tracker-v5',
      ...data,                     // e.g. { task: {...} }
    });
    queue = queue.then(() => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) log('warn', `Webhook ${event} got HTTP ${res.status}`);
      })
      .catch((err) => log('warn', `Webhook ${event} failed: ${err.message}`)));
  }

  return { enabled, emit };
}

module.exports = { createWebhookService };
