/* Version 8, use case 3: toast notifications and undoable delete (AI-assisted, see docs). */
(function (root) {
  'use strict';

  let region = null;

  function ensureRegion() {
    if (region && document.body.contains(region)) return region;
    region = document.createElement('div');
    region.className = 'v8-toasts';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
    return region;
  }
  // Create the live region early: screen readers only announce changes to a
  // region that already existed before the message was added.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureRegion);
  else ensureRegion();

  function show(message, opts) {
    opts = opts || {};
    const duration = opts.duration || 6000;
    const toast = document.createElement('div');
    toast.className = 'v8-toast' + (opts.tone ? ' v8-toast--' + opts.tone : '');

    const text = document.createElement('span');
    text.className = 'v8-toast__msg';
    text.textContent = message;
    toast.append(text);

    let finished = false;
    let remaining = duration;
    let started = Date.now();
    let timer = null;

    function finish(reason) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      toast.remove();
      if (reason === 'timeout' && opts.onTimeout) opts.onTimeout();
      if (reason === 'close' && opts.onClose) opts.onClose();
    }
    function start() { started = Date.now(); timer = setTimeout(() => finish('timeout'), remaining); }
    function pause() { clearTimeout(timer); remaining -= Date.now() - started; }

    if (opts.actionLabel) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'v8-toast__action';
      action.textContent = opts.actionLabel;
      action.addEventListener('click', () => { finish('action'); if (opts.onAction) opts.onAction(); });
      toast.append(action);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'v8-toast__close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.addEventListener('click', () => finish('close'));
    toast.append(close);

    toast.addEventListener('mouseenter', pause);
    toast.addEventListener('mouseleave', start);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', start);

    ensureRegion().append(toast);
    start();
    return { dismiss: () => finish('dismiss') }; // removes the toast without running callbacks
  }

  // Deletes waiting for their undo window to end. If the page is closed or
  // left during that window, they are sent on pagehide with keepalive so the
  // browser finishes the request after the page is gone.
  const pending = new Set();
  addEventListener('pagehide', () => {
    for (const run of [...pending]) run({ keepalive: true });
  });

  function deleteWithUndo(opts) {
    const row = opts.element;
    let settled = false;
    const hide = () => (row ? row.classList.add('v8-is-hidden') : opts.hide && opts.hide());
    const restore = () => (row ? row.classList.remove('v8-is-hidden') : opts.restore && opts.restore());

    function run(commitOptions) {
      if (settled) return;
      settled = true;
      pending.delete(run);
      toast.dismiss();
      Promise.resolve()
        .then(() => opts.commit(commitOptions || {}))
        .then(() => { if (opts.onDeleted) opts.onDeleted(); })
        .catch((err) => {
          restore();
          show('Task not deleted: ' + (err && err.message ? err.message : 'the server didn’t respond') + '. It’s back in your list.', { tone: 'error', duration: 8000 });
        });
    }

    hide();
    pending.add(run);
    const toast = show(opts.message || 'Task deleted', {
      actionLabel: 'Undo',
      onAction: () => { settled = true; pending.delete(run); restore(); },
      onTimeout: () => run(),
      onClose: () => run(),
    });
    return { undo: () => { if (!settled) { settled = true; pending.delete(run); toast.dismiss(); restore(); } } };
  }

  root.V8Toast = { show, deleteWithUndo };
})(self);
