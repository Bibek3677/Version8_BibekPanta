/* Version 9, use case 2: export the task list as a CSV file for Excel or
   Google Sheets. Pure functions (toCSV, fileName) are unit tested. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V9Export = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLUMNS = [
    ['Title', (t) => t.title],
    ['Course', (t) => t.course_code || ''],
    ['Due date', (t) => t.due_date || ''],
    ['Priority', (t) => t.priority],
    ['Status', (t) => (t.done ? 'Done' : t.overdue ? 'Overdue' : 'Open')],
    ['Public holiday', (t) => t.holiday || ''],
    ['Notes', (t) => t.notes || ''],
    ['Created', (t) => (t.created_at || '').slice(0, 10)],
  ];

  // One CSV field (RFC 4180): wrap in quotes when it holds a comma, quote or
  // line break, and double any quotes inside.
  // Spreadsheet apps run a cell that starts with = + - @ (or tab / CR) as a
  // formula, so a task titled "=HYPERLINK(...)" could do something nasty when
  // the file is opened. Those cells get a leading apostrophe (OWASP advice).
  function field(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(tasks) {
    const rows = [COLUMNS.map(([name]) => name)];
    for (const t of tasks) rows.push(COLUMNS.map(([, get]) => get(t)));
    return rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
  }

  function fileName(today, status) {
    const part = status && status !== 'all' ? '-' + status : '';
    return 'tasks' + part + '-' + today + '.csv';
  }

  function localToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Starts the download in the browser and returns the file name.
  function download(tasks, opts) {
    opts = opts || {};
    const name = fileName(localToday(), opts.status);
    // The byte-order mark makes Excel read the file as UTF-8 (accents, emoji).
    const blob = new Blob(['﻿' + toCSV(tasks)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  }

  return { toCSV, field, fileName, download };
});
