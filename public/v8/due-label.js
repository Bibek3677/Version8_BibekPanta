/* Version 8, use case 2: friendly due-date labels (AI-assisted, see docs). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V8DueLabel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;

  function localToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // "YYYY-MM-DD" is a calendar date, not a moment in time. Parsing it with
  // new Date() treats it as midnight UTC, which is the previous evening in
  // the Americas, so every date here is built and formatted in UTC.
  function parseISODate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  function daysBetween(fromISO, toISO) {
    return Math.round((parseISODate(toISO) - parseISODate(fromISO)) / DAY);
  }

  function formatDate(iso, style) {
    return parseISODate(iso).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, style));
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function dueLabel(dueDate, opts) {
    opts = opts || {};
    if (!dueDate || !parseISODate(dueDate)) return null;
    if (opts.done) return { text: 'Done', level: 'done' };
    const today = opts.today || localToday();
    const diff = daysBetween(today, dueDate);
    if (diff < 0) return { text: 'Overdue by ' + plural(-diff, 'day'), level: 'overdue' };
    if (diff === 0) return { text: 'Due today', level: 'urgent' };
    if (diff === 1) return { text: 'Due tomorrow', level: 'urgent' };
    if (diff < 7) return { text: 'Due in ' + diff + ' days', level: 'soon' };
    return { text: 'Due ' + formatDate(dueDate, { weekday: 'short', month: 'short', day: 'numeric' }), level: 'later' };
  }

  function renderDueLabel(task, opts) {
    const label = dueLabel(task.due_date, Object.assign({ done: task.done }, opts));
    if (!label) return null;
    const span = document.createElement('span');
    span.className = 'v8-due v8-due--' + label.level;
    span.textContent = label.text;
    const full = formatDate(task.due_date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    span.title = task.holiday ? full + ' (' + task.holiday + ')' : full;
    return span;
  }

  return { dueLabel, renderDueLabel, localToday, parseISODate, daysBetween };
});
