(function () {
  'use strict';

  // ---------- state ----------
  const state = {
    tasks: [],
    courses: [],
    filter: { status: 'all', course: '', q: '', sort: 'due' },
    editingId: null,
  };
  // Version 8: ids of tasks deleted but still inside their Undo window.
  // Kept outside the task list so a refresh during the window can't bring
  // a "deleted" task back on screen.
  const pendingDeletes = new Set();

  const $ = (id) => document.getElementById(id);
  const taskForm = $('task-form');
  const listEl = $('task-list');
  const emptyEl = $('empty-state');
  const courseListEl = $('course-list');
  const dialog = $('edit-dialog');
  const filterButtons = document.querySelectorAll('.filter');

  // ---------- API key ----------
  // Every API call sends the key in the x-api-key header. The key is kept
  // in this browser's localStorage after you enter it once.
  let apiKey = '';
  try { apiKey = localStorage.getItem('apiKey') || ''; } catch { /* storage blocked */ }
  let keyPrompt = null;

  function askForKey(message) {
    if (keyPrompt) return keyPrompt;
    const dlg = $('key-dialog');
    $('key-error').textContent = message || '';
    $('key-error').hidden = !message;
    $('key-input').value = '';
    dlg.showModal();
    keyPrompt = new Promise((resolve) => {
      $('key-form').onsubmit = (e) => {
        e.preventDefault();
        apiKey = $('key-input').value.trim();
        try { localStorage.setItem('apiKey', apiKey); } catch { /* ignore */ }
        dlg.close();
        keyPrompt = null;
        resolve();
      };
    });
    return keyPrompt;
  }

  // ---------- API helper ----------
  // keepalive lets a request finish after the page is closed (used by the
  // Version 8 undoable delete when you leave during the undo window).
  async function api(path, { method = 'GET', body, keepalive = false } = {}, retried = false) {
    if (!apiKey) await askForKey();
    let res;
    try {
      const headers = { 'x-api-key': apiKey };
      if (body) headers['Content-Type'] = 'application/json';
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive });
    } catch {
      throw new Error('Cannot reach the server. Is it still running in your terminal?');
    }
    if (res.status === 401 && !retried) {
      await askForKey('That API key was not accepted. Check the API_KEY value in your .env file.');
      return api(path, { method, body }, true);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
    return data;
  }

  // ---------- feedback ----------
  // Version 8, use case 3: messages use the stacked V8Toast notifications
  // (dismissible, pause on hover/focus) instead of the single v5 toast.
  function toast(message, isError = false) {
    V8Toast.show(message, isError ? { tone: 'error', duration: 8000 } : { duration: 4000 });
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  // ---------- helpers ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------- loading ----------
  async function loadCourses() {
    state.courses = await api('/api/courses');
    renderCourseSelects();
    renderCourses();
  }

  async function loadTasks() {
    const params = new URLSearchParams();
    const f = state.filter;
    if (f.status !== 'all') params.set('status', f.status);
    if (f.course) params.set('course', f.course);
    if (f.q) params.set('q', f.q);
    params.set('sort', f.sort);
    state.tasks = await api('/api/tasks?' + params.toString());
    renderTasks();
  }

  async function loadStats() {
    const s = await api('/api/stats');
    const summary = $('summary');
    summary.textContent = '';
    if (s.total === 0) return;
    const open = el('strong', '', `${s.open} open`);
    summary.append(open, ` of ${s.total} tasks`);
    if (s.overdue > 0) {
      summary.append(', ', el('span', 'late', `${s.overdue} overdue`));
    }
  }

  // Version 8, use case 1: the dashboard always summarises every task,
  // whatever filter the list is showing, so it loads the unfiltered list.
  // Tasks waiting in their undo window are left out of the counts.
  let dashboard = null;
  function refreshDashboard() {
    if (dashboard) return dashboard.refresh();
    dashboard = V8Dashboard.mount($('dashboard'), {
      load: async () => (await api('/api/tasks')).filter((t) => !pendingDeletes.has(t.id)),
    });
  }

  async function refresh() {
    try {
      await Promise.all([loadCourses(), loadTasks(), loadStats(), refreshDashboard()]);
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- rendering ----------
  function renderCourseSelects() {
    const fill = (select, firstLabel, includeNone) => {
      const current = select.value;
      select.textContent = '';
      select.append(new Option(firstLabel, ''));
      if (includeNone) select.append(new Option('No course', 'none'));
      state.courses.forEach((c) => select.append(new Option(c.code, String(c.id))));
      select.value = [...select.options].some((o) => o.value === current) ? current : '';
    };
    fill($('task-course'), 'No course', false);
    fill($('edit-course'), 'No course', false);
    fill($('filter-course'), 'All courses', true);
  }

  function renderTasks() {
    listEl.textContent = '';

    state.tasks.filter((t) => !pendingDeletes.has(t.id)).forEach((task) => {
      const li = el('li', 'task' + (task.done ? ' is-done' : ''));
      li.dataset.id = task.id;

      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.done;
      checkbox.setAttribute('aria-label', `Mark "${task.title}" as ${task.done ? 'not done' : 'done'}`);

      const body = el('div');
      body.append(el('p', 'task-title', task.title));
      if (task.notes) body.append(el('p', 'task-notes', task.notes));

      const meta = el('div', 'task-meta');
      if (task.course_code) {
        const tag = el('span', 'course-tag', task.course_code);
        tag.title = task.course_name;
        meta.append(tag);
      }
      // Version 8, use case 2: relative due-date label ("Due tomorrow",
      // "Overdue by 3 days"); the full date is in its tooltip.
      const due = V8DueLabel.renderDueLabel(task);
      if (due) meta.append(due);
      if (task.holiday) {
        const tag = el('span', 'holiday', 'Holiday: ' + task.holiday);
        tag.title = 'This due date is a public holiday';
        meta.append(tag);
      }
      meta.append(el('span', 'prio-' + task.priority,
        task.priority.charAt(0).toUpperCase() + task.priority.slice(1) + ' priority'));
      body.append(meta);

      const actions = el('div', 'task-actions');
      const edit = el('button', 'edit', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit "${task.title}"`);
      const del = el('button', 'delete', 'Delete');
      del.type = 'button';
      del.setAttribute('aria-label', `Delete "${task.title}"`);
      actions.append(edit, del);

      li.append(checkbox, body, actions);
      listEl.append(li);
    });

    const filtering = state.filter.status !== 'all' || state.filter.course || state.filter.q;
    if (listEl.children.length === 0) {
      emptyEl.textContent = filtering
        ? 'No tasks match these filters. Try All, or clear the search.'
        : 'No tasks yet. Add your first one above.';
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
    }
  }

  function renderCourses() {
    courseListEl.textContent = '';
    if (state.courses.length === 0) {
      courseListEl.append(el('li', 'empty-state', 'No courses yet. Add one below to group your tasks.'));
      return;
    }
    state.courses.forEach((c) => {
      const li = el('li', 'course-item');
      li.dataset.id = c.id;
      const left = el('div');
      left.append(el('strong', '', c.code), ' ', el('span', '', c.name));
      const count = el('span', 'count',
        c.task_count === 0 ? 'No tasks' : `${c.open_count} open of ${c.task_count}`);
      const right = el('div', 'task-actions');
      const del = el('button', 'delete', 'Delete');
      del.type = 'button';
      del.setAttribute('aria-label', `Delete course ${c.code}`);
      right.append(count, del);
      li.append(left, right);
      courseListEl.append(li);
    });
  }

  // ---------- create ----------
  taskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('task-title').value.trim();
    if (!title) {
      showError($('form-error'), 'Type a task before adding it.');
      $('task-title').focus();
      return;
    }
    const button = taskForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const created = await api('/api/tasks', {
        method: 'POST',
        body: {
          title,
          course_id: $('task-course').value || null,
          due_date: $('task-due').value || null,
          priority: $('task-priority').value,
        },
      });
      showError($('form-error'), '');
      $('task-title').value = '';
      $('task-due').value = '';
      $('task-title').focus();
      toast(created && created.holiday ? `Task added. Heads up: it's due on ${created.holiday}.` : 'Task added.');
      await refresh();
    } catch (err) {
      showError($('form-error'), err.message);
    } finally {
      button.disabled = false;
    }
  });
  $('task-title').addEventListener('input', () => showError($('form-error'), ''));

  // ---------- update (checkbox) and delete ----------
  listEl.addEventListener('change', async (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const id = Number(event.target.closest('.task').dataset.id);
    event.target.disabled = true;
    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: { done: event.target.checked } });
      await refresh();
    } catch (err) {
      event.target.checked = !event.target.checked;
      event.target.disabled = false;
      toast(err.message, true);
    }
  });

  listEl.addEventListener('click', async (event) => {
    const li = event.target.closest('.task');
    if (!li) return;
    const id = Number(li.dataset.id);
    const task = state.tasks.find((t) => t.id === id);

    if (event.target.matches('.edit')) openEditor(task);

    // Version 8, use case 3: delete straight away with a 6-second Undo
    // instead of a confirm() box. The task is only hidden until the toast
    // times out or is closed; then the DELETE request is sent.
    if (event.target.matches('.delete')) {
      V8Toast.deleteWithUndo({
        message: `Deleted "${task.title}"`,
        hide: () => { pendingDeletes.add(id); renderTasks(); refreshDashboard(); },
        restore: () => { pendingDeletes.delete(id); renderTasks(); refreshDashboard(); },
        commit: (opts) => api(`/api/tasks/${id}`, { method: 'DELETE', keepalive: !!opts.keepalive }),
        onDeleted: () => { pendingDeletes.delete(id); refresh(); },
      });
    }
  });

  $('clear-done').addEventListener('click', async () => {
    if (!confirm('Delete every completed task?')) return;
    try {
      const { deleted } = await api('/api/tasks?done=true', { method: 'DELETE' });
      toast(deleted === 0 ? 'No completed tasks to clear.' : `Cleared ${deleted} completed task${deleted === 1 ? '' : 's'}.`);
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- update (edit dialog) ----------
  function openEditor(task) {
    state.editingId = task.id;
    $('edit-title').value = task.title;
    $('edit-notes').value = task.notes || '';
    $('edit-course').value = task.course_id ? String(task.course_id) : '';
    $('edit-due').value = task.due_date || '';
    $('edit-priority').value = task.priority;
    $('edit-done').checked = task.done;
    showError($('edit-error'), '');
    dialog.showModal();
    $('edit-title').focus();
  }

  $('edit-cancel').addEventListener('click', () => dialog.close());

  $('edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('edit-title').value.trim();
    if (!title) {
      showError($('edit-error'), 'The task needs a title.');
      return;
    }
    try {
      await api(`/api/tasks/${state.editingId}`, {
        method: 'PUT',
        body: {
          title,
          notes: $('edit-notes').value,
          course_id: $('edit-course').value || null,
          due_date: $('edit-due').value || null,
          priority: $('edit-priority').value,
          done: $('edit-done').checked,
        },
      });
      dialog.close();
      toast('Changes saved.');
      await refresh();
    } catch (err) {
      showError($('edit-error'), err.message);
    }
  });

  // ---------- courses ----------
  $('course-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/courses', {
        method: 'POST',
        body: { code: $('course-code').value, name: $('course-name').value },
      });
      $('course-code').value = '';
      $('course-name').value = '';
      showError($('course-error'), '');
      toast('Course added.');
      await refresh();
    } catch (err) {
      showError($('course-error'), err.message);
    }
  });

  courseListEl.addEventListener('click', async (event) => {
    if (!event.target.matches('.delete')) return;
    const id = Number(event.target.closest('.course-item').dataset.id);
    const course = state.courses.find((c) => c.id === id);
    if (!confirm(`Delete course ${course.code}?`)) return;
    try {
      await api(`/api/courses/${id}`, { method: 'DELETE' });
      if (state.filter.course === String(id)) state.filter.course = '';
      toast('Course deleted.');
      await refresh();
    } catch (err) {
      showError($('course-error'), err.message);
    }
  });

  // ---------- filters, sort, search ----------
  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.filter.status = button.dataset.status;
      filterButtons.forEach((b) => {
        const active = b === button;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      loadTasks().catch((err) => toast(err.message, true));
    });
  });

  $('filter-course').addEventListener('change', (e) => {
    state.filter.course = e.target.value;
    loadTasks().catch((err) => toast(err.message, true));
  });

  $('sort').addEventListener('change', (e) => {
    state.filter.sort = e.target.value;
    loadTasks().catch((err) => toast(err.message, true));
  });

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filter.q = e.target.value.trim();
      loadTasks().catch((err) => toast(err.message, true));
    }, 250);
  });

  async function loadInfo() {
    const { backend } = await api('/api/info');
    $('backend').textContent = backend === 'supabase'
      ? 'Data stored in Supabase (PostgreSQL).'
      : 'Data stored in a local SQLite file.';
  }

  $('calendar-copy').addEventListener('click', async () => {
    const link = `${location.origin}/api/calendar.ics?key=${encodeURIComponent(apiKey)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Calendar link copied. In Google Calendar choose Other calendars > From URL and paste it.');
    } catch {
      prompt('Copy this calendar link:', link);
    }
  });

  $('forget-key').addEventListener('click', () => {
    try { localStorage.removeItem('apiKey'); } catch { /* ignore */ }
    apiKey = '';
    refresh();
  });

  // ---------- Version 8, use case 4: keyboard shortcuts ----------
  const setStatus = (status) => () => document.querySelector(`.filter[data-status="${status}"]`).click();
  V8Shortcuts.init([
    { key: 'n', description: 'New task (focus the task box)', run: () => $('task-title').focus() },
    { key: '/', description: 'Search tasks', run: () => $('search').focus() },
    { key: 'r', description: 'Reload tasks', run: () => { refresh(); toast('Tasks reloaded.'); } },
    { key: '1', description: 'Show all tasks', run: setStatus('all') },
    { key: '2', description: 'Show open tasks', run: setStatus('open') },
    { key: '3', description: 'Show overdue tasks', run: setStatus('overdue') },
    { key: '4', description: 'Show done tasks', run: setStatus('done') },
  ]);
  $('shortcut-help').addEventListener('click', () => document.querySelector('dialog.v8-help').showModal());

  loadInfo().catch(() => {});

  refresh();
})();
