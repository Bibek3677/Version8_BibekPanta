// Tasks: the filtered task list, the add form, the edit dialog, ticking,
// undoable delete, filters/sort/search and (Version 9) CSV export.
import { $, el, showError, toast, plural } from './dom.js';
import { api } from './api.js';
import { state, pendingDeletes, visible } from './state.js';

const listEl = $('task-list');
const emptyEl = $('empty-state');
const editDialog = $('edit-dialog');

export async function loadTasks() {
  const f = state.filter;
  const params = new URLSearchParams();
  if (f.status !== 'all') params.set('status', f.status);
  if (f.course) params.set('course', f.course);
  if (f.q) params.set('q', f.q);
  params.set('sort', f.sort);
  state.tasks = await api('/api/tasks?' + params.toString());
  renderTasks();
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function renderTask(task) {
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
  const due = V8DueLabel.renderDueLabel(task); // "Due tomorrow", full date in tooltip
  if (due) meta.append(due);
  if (task.holiday) {
    const tag = el('span', 'holiday', 'Holiday: ' + task.holiday);
    tag.title = 'This due date is a public holiday';
    meta.append(tag);
  }
  meta.append(el('span', 'prio-' + task.priority, capitalize(task.priority) + ' priority'));
  body.append(meta);

  const actions = el('div', 'task-actions');
  for (const [cls, label] of [['edit', 'Edit'], ['delete', 'Delete']]) {
    const button = el('button', cls, label);
    button.type = 'button';
    button.setAttribute('aria-label', `${label} "${task.title}"`);
    actions.append(button);
  }

  li.append(checkbox, body, actions);
  return li;
}

export function renderTasks() {
  const tasks = visible(state.tasks);
  listEl.replaceChildren(...tasks.map(renderTask));

  const f = state.filter;
  const filtering = f.status !== 'all' || f.course || f.q;
  emptyEl.hidden = tasks.length > 0;
  emptyEl.textContent = filtering
    ? 'No tasks match these filters. Try All, or clear the search.'
    : 'No tasks yet. Add your first one above.';
}

export function openEditor(task) {
  state.editingId = task.id;
  $('edit-title').value = task.title;
  $('edit-notes').value = task.notes || '';
  $('edit-course').value = task.course_id ? String(task.course_id) : '';
  $('edit-due').value = task.due_date || '';
  $('edit-priority').value = task.priority;
  $('edit-done').checked = task.done;
  showError($('edit-error'), '');
  editDialog.showModal();
  $('edit-title').focus();
}

export function setStatusFilter(status) {
  state.filter.status = status;
  document.querySelectorAll('.filter').forEach((b) => {
    const active = b.dataset.status === status;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  return loadTasks().catch((err) => toast(err.message, true));
}

// refresh() reloads everything; redraw() only redraws the dashboard and
// planner from the data already loaded (used while a delete can be undone).
export function initTasks({ refresh, redraw }) {
  const taskForm = $('task-form');

  // ----- create -----
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

  // ----- tick off -----
  listEl.addEventListener('change', async (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const box = event.target;
    const id = Number(box.closest('.task').dataset.id);
    box.disabled = true;
    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: { done: box.checked } });
      await refresh();
    } catch (err) {
      box.checked = !box.checked;
      box.disabled = false;
      toast(err.message, true);
    }
  });

  // ----- edit and undoable delete -----
  listEl.addEventListener('click', (event) => {
    const li = event.target.closest('.task');
    if (!li) return;
    const id = Number(li.dataset.id);
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    if (event.target.matches('.edit')) openEditor(task);

    // Delete straight away with a 6-second Undo instead of a confirm() box.
    // The task is only hidden until the toast times out or is closed; then
    // the DELETE request is sent.
    if (event.target.matches('.delete')) {
      V8Toast.deleteWithUndo({
        message: `Deleted "${task.title}"`,
        hide: () => { pendingDeletes.add(id); renderTasks(); redraw(); },
        restore: () => { pendingDeletes.delete(id); renderTasks(); redraw(); },
        commit: (opts) => api(`/api/tasks/${id}`, { method: 'DELETE', keepalive: !!opts.keepalive }),
        onDeleted: () => { pendingDeletes.delete(id); refresh(); },
      });
    }
  });

  $('clear-done').addEventListener('click', async () => {
    if (!confirm('Delete every completed task?')) return;
    try {
      const { deleted } = await api('/api/tasks?done=true', { method: 'DELETE' });
      toast(deleted === 0 ? 'No completed tasks to clear.' : `Cleared ${plural(deleted, 'completed task')}.`);
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ----- edit dialog -----
  $('edit-cancel').addEventListener('click', () => editDialog.close());

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
      editDialog.close();
      toast('Changes saved.');
      await refresh();
    } catch (err) {
      showError($('edit-error'), err.message);
    }
  });

  // ----- filters, sort, search -----
  document.querySelectorAll('.filter').forEach((button) => {
    button.addEventListener('click', () => setStatusFilter(button.dataset.status));
  });

  const reload = () => loadTasks().catch((err) => toast(err.message, true));
  $('filter-course').addEventListener('change', (e) => { state.filter.course = e.target.value; reload(); });
  $('sort').addEventListener('change', (e) => { state.filter.sort = e.target.value; reload(); });

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.filter.q = e.target.value.trim(); reload(); }, 250);
  });

  // ----- Version 9, use case 2: export the list as it is shown -----
  $('export-csv').addEventListener('click', () => {
    const tasks = visible(state.tasks);
    if (tasks.length === 0) {
      toast('There are no tasks in this list to export.');
      return;
    }
    const name = V9Export.download(tasks, { status: state.filter.status });
    toast(`Exported ${plural(tasks.length, 'task')} to ${name}.`);
  });
}
