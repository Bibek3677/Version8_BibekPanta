/* Version 8, use case 1: progress dashboard (AI-assisted, see docs).
   Needs due-label.js loaded first (it reuses its time-zone-safe date maths). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./due-label.js'));
  else root.V8Dashboard = factory(root.V8DueLabel);
})(typeof self !== 'undefined' ? self : this, function (Due) {
  'use strict';

  const SOON_DAYS = 7; // today plus the next six days, matching the "Due in N days" labels

  function summarize(tasks, today) {
    today = today || Due.localToday();
    const out = { total: tasks.length, open: 0, done: 0, overdue: 0, dueSoon: 0, percent: 0, courses: [] };
    const byCourse = new Map();

    for (const t of tasks) {
      if (t.done) out.done++;
      else {
        out.open++;
        if (t.overdue) out.overdue++;
        else if (t.due_date) {
          const days = Due.daysBetween(today, t.due_date);
          if (days >= 0 && days < SOON_DAYS) out.dueSoon++;
        }
      }
      const key = t.course_code || '';
      if (!byCourse.has(key)) byCourse.set(key, { code: t.course_code || 'No course', name: t.course_name || '', done: 0, total: 0 });
      const c = byCourse.get(key);
      c.total++;
      if (t.done) c.done++;
    }

    out.percent = out.total ? Math.round((out.done / out.total) * 100) : 0;
    out.courses = [...byCourse.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([, c]) => c);
    return out;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function figure(label, value, modifier) {
    const box = el('div', 'v8-dash__figure' + (modifier ? ' v8-dash__figure--' + modifier : ''));
    box.append(el('dt', null, label), el('dd', null, String(value)));
    return box;
  }

  function render(container, s) {
    const head = el('div', 'v8-dash__head');
    head.append(el('h2', 'v8-dash__title', 'Progress'),
      el('p', 'v8-dash__pct', s.total ? s.percent + '% of tasks done' : 'No tasks yet'));

    const figures = el('dl', 'v8-dash__figures');
    figures.append(
      figure('Open', s.open),
      figure('Due this week', s.dueSoon, s.dueSoon ? 'soon' : ''),
      figure('Overdue', s.overdue, s.overdue ? 'overdue' : ''),
      figure('Done', s.done)
    );

    const list = el('ul', 'v8-dash__courses');
    for (const c of s.courses) {
      const li = el('li', 'v8-dash__course');
      const name = el('span', 'v8-dash__code', c.code);
      if (c.name) name.title = c.name;
      const count = el('span', 'v8-dash__count', c.done + ' of ' + c.total + ' done');
      const bar = el('span', 'v8-bar');
      bar.setAttribute('aria-hidden', 'true');
      const fill = el('span', 'v8-bar__fill');
      fill.style.width = (c.total ? (c.done / c.total) * 100 : 0) + '%';
      bar.append(fill);
      li.append(name, count, bar);
      list.append(li);
    }

    container.replaceChildren(head, figures);
    if (s.courses.length) container.append(list);
  }

  function mount(container, options) {
    const load = options.load;
    container.classList.add('v8-dash');
    if (!container.getAttribute('aria-label')) container.setAttribute('aria-label', 'Progress');

    async function refresh() {
      container.setAttribute('aria-busy', 'true');
      if (!container.firstChild) container.append(el('p', 'v8-dash__status', 'Loading progress…'));
      try {
        const tasks = await load();
        render(container, summarize(Array.isArray(tasks) ? tasks : []));
      } catch (err) {
        const msg = el('p', 'v8-dash__status v8-dash__status--error',
          'Progress couldn’t load: ' + (err && err.message ? err.message : 'unknown error') + '. ');
        const retry = el('button', 'v8-btn', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', refresh);
        msg.append(retry);
        container.replaceChildren(msg);
      } finally {
        container.removeAttribute('aria-busy');
      }
    }

    refresh();
    return { refresh };
  }

  return { summarize, mount };
});
