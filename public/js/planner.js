/* Version 9, use case 1: week planner.
   Shows one week (Monday to Sunday) as a day-by-day agenda. Tasks can be
   rescheduled by dragging them to another day, or with the keyboard using
   the ‹ › buttons on each card. Needs v8/due-label.js loaded first: it reuses
   its time-zone-safe date maths (all calendar dates are handled in UTC). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../v8/due-label.js'));
  else root.V9Planner = factory(root.V8DueLabel);
})(typeof self !== 'undefined' ? self : this, function (Due) {
  'use strict';

  const BUSY_LIMIT = 4; // a day with this many open tasks or more is flagged as busy
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

  // ---------- pure date and grouping functions (unit tested) ----------

  function addDays(iso, n) {
    const d = Due.parseISODate(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Weeks start on Monday. getUTCDay() is 0 for Sunday, so Sunday goes back 6 days.
  function startOfWeek(iso) {
    const weekday = Due.parseISODate(iso).getUTCDay();
    return addDays(iso, -((weekday + 6) % 7));
  }

  function format(iso, style) {
    return Due.parseISODate(iso).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, style));
  }

  function describeDate(iso) {
    return iso ? format(iso, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No due date';
  }

  // "Nov 16 – 22, 2026", "Nov 30 – Dec 6, 2026" or "Dec 28, 2026 – Jan 3, 2027"
  function weekRangeLabel(start) {
    const end = addDays(start, 6);
    const year = (iso) => iso.slice(0, 4);
    if (year(start) !== year(end)) {
      return format(start, { month: 'short', day: 'numeric', year: 'numeric' }) + ' – ' +
        format(end, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    const endPart = start.slice(5, 7) === end.slice(5, 7)
      ? format(end, { day: 'numeric' })
      : format(end, { month: 'short', day: 'numeric' });
    return format(start, { month: 'short', day: 'numeric' }) + ' – ' + endPart + ', ' + year(end);
  }

  // Open tasks first, then high to low priority, then by title.
  function byPlannerOrder(a, b) {
    return (Number(a.done) - Number(b.done)) ||
      (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) ||
      String(a.title).localeCompare(String(b.title));
  }

  // Groups tasks into the seven days starting at weekStart.
  // opts.holidays is a { 'YYYY-MM-DD': 'Holiday name' } map.
  function buildWeek(tasks, weekStart, opts) {
    opts = opts || {};
    const today = opts.today || Due.localToday();
    const holidays = opts.holidays || {};
    const weekEnd = addDays(weekStart, 6);
    const week = { start: weekStart, end: weekEnd, days: [], unscheduled: [], open: 0, overdueEarlier: 0 };

    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      week.days.push({
        date,
        isToday: date === today,
        isPast: date < today, // ISO dates compare correctly as strings
        holiday: holidays[date] || null,
        tasks: [],
        open: 0,
        busy: false,
      });
    }

    for (const t of tasks) {
      const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
      if (!due) {
        if (!t.done) week.unscheduled.push(t);
      } else if (due < weekStart) {
        if (!t.done && due < today) week.overdueEarlier++;
      } else if (due <= weekEnd) {
        const day = week.days[Due.daysBetween(weekStart, due)];
        if (!t.done) { day.open++; week.open++; }
        if (!t.done || opts.showDone) day.tasks.push(t);
      }
    }

    for (const day of week.days) {
      day.tasks.sort(byPlannerOrder);
      day.busy = day.open >= BUSY_LIMIT;
      // Fallback: the server also marks each task with its holiday.
      if (!day.holiday) {
        const marked = day.tasks.find((t) => t.holiday);
        if (marked) day.holiday = marked.holiday;
      }
    }
    week.unscheduled.sort(byPlannerOrder);
    return week;
  }

  // ---------- DOM ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, attrs) {
    const b = el('button', className, text);
    b.type = 'button';
    for (const [k, v] of Object.entries(attrs || {})) b.setAttribute(k, v);
    return b;
  }

  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  // options: loadTasks(), loadHolidays(year), onMove(task, date|null),
  //          onOpen(task), onShowOverdue(), onError(err)
  function mount(container, options) {
    let weekStart = startOfWeek(Due.localToday());
    let showDone = false;
    let tasks = [];
    let loaded = false;
    let moving = false;
    let focusAfter = null;   // { id, act, days } to refocus after a move re-renders
    let draggingId = null;
    const holidayMap = {};   // every holiday loaded so far, by date
    const holidayYears = new Map();

    container.classList.add('v9-plan');

    // Loads the public holidays for the year(s) the week touches. Returns
    // true when new ones arrived so the caller knows to redraw.
    function ensureHolidays(start) {
      const years = [...new Set([start, addDays(start, 6)].map((d) => Number(d.slice(0, 4))))];
      const missing = years.filter((y) => !holidayYears.has(y));
      if (!missing.length || !options.loadHolidays) return Promise.resolve(false);
      return Promise.all(missing.map((year) => {
        const p = Promise.resolve()
          .then(() => options.loadHolidays(year))
          .then((list) => {
            for (const h of list || []) if (h.nationwide !== false && !holidayMap[h.date]) holidayMap[h.date] = h.name;
          })
          .catch(() => holidayYears.delete(year)); // holiday service down: try again next time
        holidayYears.set(year, p);
        return p;
      })).then(() => true);
    }

    async function refresh() {
      container.setAttribute('aria-busy', 'true');
      if (!container.firstChild) container.append(el('p', 'v9-plan__status', 'Loading planner…'));
      try {
        const [list] = await Promise.all([options.loadTasks(), ensureHolidays(weekStart)]);
        tasks = Array.isArray(list) ? list : [];
        loaded = true;
        render();
      } catch (err) {
        const msg = el('p', 'v9-plan__status v9-plan__status--error',
          'The planner couldn’t load: ' + (err && err.message ? err.message : 'unknown error') + '. ');
        const retry = button('v8-btn', 'Try again');
        retry.addEventListener('click', refresh);
        msg.append(retry);
        container.replaceChildren(msg);
      } finally {
        container.removeAttribute('aria-busy');
      }
    }

    function goTo(start) {
      weekStart = startOfWeek(start);
      if (loaded) render();
      ensureHolidays(weekStart).then((changed) => { if (changed && loaded) render(); });
    }

    // Where the "Plan" button on an unscheduled task puts it: today when
    // today is in the week on screen, otherwise that week's Monday.
    function planTarget() {
      const today = Due.localToday();
      return today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart;
    }

    function card(task, date) {
      const li = el('li', 'v9-card v9-card--' + task.priority + (task.done ? ' is-done' : ''));
      li.dataset.id = task.id;
      li.draggable = true;

      const open = button('v9-card__title', task.title, { 'data-act': 'open', title: 'Edit this task' });
      const meta = el('span', 'v9-card__meta');
      if (task.course_code) meta.append(el('span', 'v9-card__course', task.course_code));
      meta.append(el('span', 'v9-card__prio', task.priority.charAt(0).toUpperCase() + task.priority.slice(1) + ' priority'));
      if (task.done) meta.append(el('span', null, 'Done'));
      const body = el('div', 'v9-card__body');
      body.append(open, meta);

      const actions = el('div', 'v9-card__actions');
      if (date) {
        for (const days of [-1, 1]) {
          const to = addDays(date, days);
          actions.append(button('v9-card__move', days < 0 ? '‹' : '›', {
            'data-act': 'move',
            'data-days': String(days),
            'aria-label': `Move "${task.title}" to ${describeDate(to)}`,
            title: `Move to ${describeDate(to)}`,
          }));
        }
      } else {
        const to = planTarget();
        actions.append(button('v9-card__plan', 'Plan', {
          'data-act': 'plan',
          'aria-label': `Plan "${task.title}" for ${describeDate(to)}`,
          title: `Give it a due date of ${describeDate(to)}`,
        }));
      }
      li.append(body, actions);
      return li;
    }

    function dayItem(day) {
      const li = el('li', 'v9-day' + (day.isToday ? ' is-today' : '') + (day.isPast ? ' is-past' : '') + (day.busy ? ' is-busy' : ''));
      li.dataset.drop = day.date;

      const label = el('h3', 'v9-day__label');
      label.append(el('span', 'v9-day__dow', format(day.date, { weekday: 'short' })),
        el('span', 'v9-day__date', format(day.date, { month: 'short', day: 'numeric' })));
      if (day.isToday) label.append(el('span', 'v9-day__today', 'Today'));
      label.setAttribute('aria-label', format(day.date, { weekday: 'long', month: 'long', day: 'numeric' }) +
        (day.isToday ? ', today' : '') + ', ' + plural(day.open, 'open task'));

      const body = el('div', 'v9-day__body');
      if (day.holiday) body.append(el('p', 'v9-day__holiday', 'Holiday: ' + day.holiday));
      if (day.busy) body.append(el('p', 'v9-day__busy', 'Busy day: ' + plural(day.open, 'open task')));
      const list = el('ul', 'v9-day__tasks');
      if (day.tasks.length) list.append(...day.tasks.map((t) => card(t, day.date)));
      else body.append(el('p', 'v9-day__empty', 'Nothing due'));
      body.append(list);

      li.append(label, body);
      return li;
    }

    function render() {
      const week = buildWeek(tasks, weekStart, { holidays: holidayMap, showDone });
      const isThisWeek = weekStart === startOfWeek(Due.localToday());

      const head = el('div', 'v9-plan__head');
      const title = el('h2', 'v9-plan__title', 'Week planner');
      title.id = 'planner-heading';
      title.tabIndex = -1; // so the W shortcut can move focus here
      const nav = el('div', 'v9-plan__nav');
      nav.setAttribute('role', 'group');
      nav.setAttribute('aria-label', 'Change week');
      const thisWeek = button('v8-btn', 'This week', { 'data-nav': '0' });
      thisWeek.disabled = isThisWeek;
      nav.append(
        button('v8-btn', '‹ Prev', { 'data-nav': '-7', 'aria-label': 'Previous week' }),
        thisWeek,
        button('v8-btn', 'Next ›', { 'data-nav': '7', 'aria-label': 'Next week' }));
      head.append(title, nav);

      const range = el('p', 'v9-plan__range');
      range.setAttribute('aria-live', 'polite');
      range.append(el('strong', null, weekRangeLabel(week.start)), ' · ' + plural(week.open, 'open task') + ' due');

      const controls = el('div', 'v9-plan__controls');
      const toggle = el('label', 'v9-plan__toggle');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = showDone;
      box.dataset.act = 'show-done';
      toggle.append(box, ' Show completed');
      const hint = el('p', 'v9-plan__hint', 'Drag a task to another day, or use ‹ › to move it.');
      controls.append(toggle, hint);

      const parts = [head, range, controls];
      if (week.overdueEarlier) {
        const note = el('p', 'v9-plan__note',
          plural(week.overdueEarlier, 'overdue task') + (week.overdueEarlier === 1 ? ' is' : ' are') + ' due before this week. ');
        note.append(button('link-button', 'Show in list', { 'data-act': 'show-overdue' }));
        parts.push(note);
      }

      const days = el('ol', 'v9-plan__days');
      days.append(...week.days.map(dayItem));
      parts.push(days);

      const tray = el('section', 'v9-tray');
      tray.dataset.drop = '';
      tray.setAttribute('aria-labelledby', 'v9-tray-title');
      const trayTitle = el('h3', 'v9-tray__title', 'No due date');
      trayTitle.id = 'v9-tray-title';
      tray.append(trayTitle);
      if (week.unscheduled.length) {
        const list = el('ul', 'v9-day__tasks');
        list.append(...week.unscheduled.map((t) => card(t, null)));
        tray.append(list);
      } else {
        tray.append(el('p', 'v9-day__empty', 'Every open task has a due date. Drag one here to clear its date.'));
      }
      parts.push(tray);

      container.replaceChildren(...parts);
      restoreFocus();
    }

    function restoreFocus() {
      if (!focusAfter) return;
      const { id, act, days } = focusAfter;
      focusAfter = null;
      const cardEl = container.querySelector(`.v9-card[data-id="${id}"]`);
      let target = null;
      if (cardEl) {
        target = cardEl.querySelector(act === 'move' ? `[data-act="move"][data-days="${days}"]` : '[data-act="open"]') ||
          cardEl.querySelector('[data-act="open"]');
      }
      // The task left the week on screen (e.g. moved from Sunday to next Monday).
      (target || container.querySelector('#planner-heading')).focus();
    }

    async function move(task, date, focus) {
      if (moving) return;
      if ((task.due_date || null) === date) return;
      moving = true;
      focusAfter = focus || null;
      const cardEl = container.querySelector(`.v9-card[data-id="${task.id}"]`);
      if (cardEl) { cardEl.classList.add('is-moving'); cardEl.setAttribute('aria-busy', 'true'); }
      try {
        await options.onMove(task, date); // saves, then the app refreshes everything (and this planner)
      } catch (err) {
        focusAfter = null;
        if (cardEl) { cardEl.classList.remove('is-moving'); cardEl.removeAttribute('aria-busy'); }
        if (options.onError) options.onError(err);
      } finally {
        moving = false;
      }
    }

    const findTask = (node) => {
      const cardEl = node.closest('.v9-card');
      return cardEl ? tasks.find((t) => String(t.id) === cardEl.dataset.id) : null;
    };

    // ----- clicks (one listener for the whole planner) -----
    container.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target || !container.contains(target)) return;
      if (target.dataset.nav !== undefined) {
        const n = Number(target.dataset.nav);
        goTo(n === 0 ? Due.localToday() : addDays(weekStart, n));
        return;
      }
      const act = target.dataset.act;
      if (act === 'show-overdue') return options.onShowOverdue && options.onShowOverdue();
      const task = findTask(target);
      if (!task) return;
      if (act === 'open' && options.onOpen) options.onOpen(task);
      if (act === 'move') {
        const days = Number(target.dataset.days);
        move(task, addDays(task.due_date, days), { id: task.id, act, days });
      }
      if (act === 'plan') move(task, planTarget(), { id: task.id, act: 'open' });
    });

    container.addEventListener('change', (event) => {
      if (event.target.dataset.act !== 'show-done') return;
      showDone = event.target.checked;
      render();
      container.querySelector('[data-act="show-done"]').focus();
    });

    // ----- drag and drop -----
    function clearDropTargets() {
      container.querySelectorAll('.is-drop-target').forEach((z) => z.classList.remove('is-drop-target'));
    }

    container.addEventListener('dragstart', (event) => {
      const cardEl = event.target.closest && event.target.closest('.v9-card');
      if (!cardEl || moving) { event.preventDefault(); return; }
      draggingId = cardEl.dataset.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggingId); // Firefox won't start a drag without data
      cardEl.classList.add('is-dragging');
    });

    container.addEventListener('dragend', (event) => {
      draggingId = null;
      const cardEl = event.target.closest && event.target.closest('.v9-card');
      if (cardEl) cardEl.classList.remove('is-dragging');
      clearDropTargets();
    });

    container.addEventListener('dragover', (event) => {
      const zone = draggingId && event.target.closest('[data-drop]');
      if (!zone) return;
      event.preventDefault(); // allows the drop
      event.dataTransfer.dropEffect = 'move';
      if (!zone.classList.contains('is-drop-target')) {
        clearDropTargets();
        zone.classList.add('is-drop-target');
      }
    });

    container.addEventListener('dragleave', (event) => {
      const zone = event.target.closest('[data-drop]');
      if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-drop-target');
    });

    container.addEventListener('drop', (event) => {
      const zone = draggingId && event.target.closest('[data-drop]');
      if (!zone) return;
      event.preventDefault();
      const task = tasks.find((t) => String(t.id) === draggingId);
      clearDropTargets();
      if (task) move(task, zone.dataset.drop || null, { id: task.id, act: 'open' });
    });

    refresh();

    return {
      refresh,
      render: () => { if (loaded) render(); },
      shiftWeek: (days) => goTo(addDays(weekStart, days)),
      thisWeek: () => goTo(Due.localToday()),
      focus: () => { const h = container.querySelector('#planner-heading'); if (h) { h.scrollIntoView({ block: 'start' }); h.focus(); } },
    };
  }

  return { startOfWeek, addDays, weekRangeLabel, describeDate, buildWeek, mount, BUSY_LIMIT };
});
