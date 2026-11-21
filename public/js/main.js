// Entry point: loads data, mounts the dashboard and week planner, and wires
// up the footer and keyboard shortcuts. Loaded as an ES module after the
// classic v8/v9 component scripts (V8DueLabel, V8Dashboard, V8Toast,
// V8Shortcuts, V9Planner, V9Export).
import { $, el, toast } from './dom.js';
import { api, getApiKey, forgetApiKey } from './api.js';
import { visible } from './state.js';
import { loadCourses, initCourses } from './courses.js';
import { loadTasks, initTasks, openEditor, setStatusFilter } from './tasks.js';

// ---------- every task, unfiltered ----------
// The dashboard and the planner both need every task whatever filter the
// list shows. They share one request per refresh instead of making one each.
let allTasksRequest = null;
function allTasks() {
  if (!allTasksRequest) {
    allTasksRequest = api('/api/tasks');
    allTasksRequest.catch(() => { allTasksRequest = null; }); // let the next call retry
  }
  return allTasksRequest.then(visible); // hide tasks waiting in their undo window
}

async function loadStats() {
  const s = await api('/api/stats');
  const summary = $('summary');
  summary.textContent = '';
  if (s.total === 0) return;
  summary.append(el('strong', '', `${s.open} open`), ` of ${s.total} tasks`);
  if (s.overdue > 0) summary.append(', ', el('span', 'late', `${s.overdue} overdue`));
}

// ---------- dashboard (v8) and week planner (v9) ----------
let dashboard = null;
let planner = null;

// Version 9, use case 1: moving a task in the planner saves the new due date
// and offers Undo, which puts the old date back.
async function moveTask(task, date) {
  const from = task.due_date || null;
  const saved = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { due_date: date } });
  await refresh();
  let message = date ? `Moved "${task.title}" to ${V9Planner.describeDate(date)}.` : `Removed the due date from "${task.title}".`;
  if (saved && saved.holiday) message += ` Heads up: that's ${saved.holiday}.`;
  V8Toast.show(message, {
    actionLabel: 'Undo',
    duration: 6000,
    onAction: async () => {
      try {
        await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { due_date: from } });
        toast('Move undone.');
        await refresh();
      } catch (err) {
        toast(err.message, true);
      }
    },
  });
}

function mountViews() {
  dashboard = V8Dashboard.mount($('dashboard'), { load: allTasks });
  planner = V9Planner.mount($('planner'), {
    loadTasks: allTasks,
    loadHolidays: async (year) => (await api(`/api/holidays?year=${year}`)).holidays,
    onMove: moveTask,
    onOpen: openEditor,
    onShowOverdue: () => {
      setStatusFilter('overdue');
      $('list-heading').scrollIntoView({ block: 'start' });
    },
    onError: (err) => toast(`Task not moved: ${err.message}`, true),
  });
}

// Redraws the dashboard and planner from data already loaded (no new request).
function redraw() {
  if (dashboard) dashboard.refresh();
  if (planner) planner.refresh();
}

async function refresh() {
  allTasksRequest = null; // data may have changed: fetch it again
  try {
    if (!dashboard) {
      mountViews(); // mounting loads them for the first time
      await Promise.all([loadCourses(), loadTasks(), loadStats()]);
    } else {
      await Promise.all([loadCourses(), loadTasks(), loadStats(), dashboard.refresh(), planner.refresh()]);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

initTasks({ refresh, redraw });
initCourses({ refresh });

// ---------- footer ----------
async function loadInfo() {
  const { backend } = await api('/api/info');
  $('backend').textContent = backend === 'supabase'
    ? 'Data stored in Supabase (PostgreSQL).'
    : 'Data stored in a local SQLite file.';
}

$('calendar-copy').addEventListener('click', async () => {
  const link = `${location.origin}/api/calendar.ics?key=${encodeURIComponent(getApiKey())}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Calendar link copied. In Google Calendar choose Other calendars > From URL and paste it.');
  } catch {
    prompt('Copy this calendar link:', link);
  }
});

$('forget-key').addEventListener('click', () => {
  forgetApiKey();
  refresh();
});

// ---------- keyboard shortcuts (v8, with v9 additions) ----------
V8Shortcuts.init([
  { key: 'n', description: 'New task (focus the task box)', run: () => $('task-title').focus() },
  { key: '/', description: 'Search tasks', run: () => $('search').focus() },
  { key: 'r', description: 'Reload tasks', run: () => { refresh(); toast('Tasks reloaded.'); } },
  { key: '1', description: 'Show all tasks', run: () => setStatusFilter('all') },
  { key: '2', description: 'Show open tasks', run: () => setStatusFilter('open') },
  { key: '3', description: 'Show overdue tasks', run: () => setStatusFilter('overdue') },
  { key: '4', description: 'Show done tasks', run: () => setStatusFilter('done') },
  { key: 'w', description: 'Go to the week planner', run: () => planner && planner.focus() },
  { key: '[', description: 'Planner: previous week', run: () => planner && planner.shiftWeek(-7) },
  { key: ']', description: 'Planner: next week', run: () => planner && planner.shiftWeek(7) },
  { key: 't', description: 'Planner: this week', run: () => planner && planner.thisWeek() },
]);
$('shortcut-help').addEventListener('click', () => document.querySelector('dialog.v8-help').showModal());

loadInfo().catch(() => {});
refresh();
