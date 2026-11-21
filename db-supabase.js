'use strict';

// Supabase data layer. Same function names as db.js, but every call goes to
// your Supabase project's auto-generated REST API (PostgREST) with fetch.
// No npm packages needed. The heavier queries (filtered task list, stats)
// run as Postgres functions defined in supabase/schema.sql.

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function openDb() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in your .env file (see .env.example).');
  }
  if (key.startsWith('sb_publishable_')) {
    throw new Error('That is the publishable key. The server needs the secret key (sb_secret_...).');
  }
  return { url, key };
}

class SupabaseError extends Error {
  constructor(message, { status, pgCode } = {}) {
    super(message);
    this.status = status;
    this.pgCode = pgCode;
  }
}

async function request(db, method, path, { body, returnRows = false } = {}) {
  const headers = { apikey: db.key, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs and also go in Authorization.
  // New sb_secret_ keys must only be sent as apikey.
  if (db.key.startsWith('eyJ')) headers.Authorization = `Bearer ${db.key}`;
  if (returnRows) headers.Prefer = 'return=representation';

  let res;
  try {
    res = await fetch(`${db.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new SupabaseError(`Cannot reach Supabase at ${db.url}. Check SUPABASE_URL and your internet connection.`, { status: 502 });
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const pgCode = data && data.code;
    let message = (data && (data.message || data.msg)) || `Supabase returned ${res.status}.`;
    if (res.status === 401 || res.status === 403) {
      message = 'Supabase rejected the API key. Copy the secret key again from Project Settings > API Keys.';
    } else if (pgCode === 'PGRST205' || pgCode === 'PGRST202' || pgCode === '42P01') {
      message = 'The tables or functions are missing. Run supabase/schema.sql in the Supabase SQL Editor first.';
    }
    throw new SupabaseError(message, { status: res.status, pgCode });
  }
  return data;
}

const enc = encodeURIComponent;

function toTask(row) {
  if (!row) return null;
  const today = localToday();
  return { ...row, overdue: !row.done && !!row.due_date && row.due_date < today };
}

/* ---------- courses ---------- */

async function listCourses(db) {
  return request(db, 'GET', '/rest/v1/course_summary?select=*&order=code.asc');
}

async function getCourse(db, id) {
  const rows = await request(db, 'GET', `/rest/v1/courses?id=eq.${enc(id)}&select=id,code,name,created_at`);
  return rows[0] || null;
}

async function createCourse(db, { code, name }) {
  const rows = await request(db, 'POST', '/rest/v1/courses', { body: { code, name }, returnRows: true });
  return rows[0];
}

async function updateCourse(db, id, changes) {
  if (Object.keys(changes).length === 0) return getCourse(db, id);
  const rows = await request(db, 'PATCH', `/rest/v1/courses?id=eq.${enc(id)}`, { body: changes, returnRows: true });
  return rows[0] || null;
}

async function countTasksForCourse(db, id) {
  const rows = await request(db, 'GET', `/rest/v1/course_summary?id=eq.${enc(id)}&select=task_count`);
  return rows[0] ? rows[0].task_count : 0;
}

async function deleteCourse(db, id) {
  const rows = await request(db, 'DELETE', `/rest/v1/courses?id=eq.${enc(id)}`, { returnRows: true });
  return rows.length > 0;
}

/* ---------- tasks ---------- */

async function listTasks(db, { status = 'all', course = '', q = '', sort = 'due' } = {}) {
  const rows = await request(db, 'POST', '/rest/v1/rpc/list_tasks', {
    body: {
      p_status: status,
      p_course: String(course || ''),
      p_q: q,
      p_sort: ['due', 'priority', 'newest'].includes(sort) ? sort : 'due',
      p_today: localToday(),
    },
  });
  return rows.map(toTask);
}

async function getTask(db, id) {
  const rows = await request(db, 'GET', `/rest/v1/task_details?id=eq.${enc(id)}&select=*`);
  return toTask(rows[0]);
}

async function createTask(db, task) {
  const rows = await request(db, 'POST', '/rest/v1/tasks', {
    body: {
      course_id: task.course_id ?? null,
      title: task.title,
      notes: task.notes ?? '',
      due_date: task.due_date ?? null,
      priority: task.priority ?? 'medium',
      done: !!task.done,
    },
    returnRows: true,
  });
  return getTask(db, rows[0].id); // re-read through the view to get course_code/name
}

async function updateTask(db, id, changes) {
  const rows = await request(db, 'PATCH', `/rest/v1/tasks?id=eq.${enc(id)}`, { body: changes, returnRows: true });
  if (rows.length === 0) return null;
  return getTask(db, id);
}

async function deleteTask(db, id) {
  const rows = await request(db, 'DELETE', `/rest/v1/tasks?id=eq.${enc(id)}`, { returnRows: true });
  return rows.length > 0;
}

async function clearCompleted(db) {
  const rows = await request(db, 'DELETE', '/rest/v1/tasks?done=eq.true', { returnRows: true });
  return rows.length;
}

async function stats(db) {
  return request(db, 'POST', '/rest/v1/rpc/task_stats', { body: { p_today: localToday() } });
}

module.exports = {
  backend: 'supabase',
  SupabaseError,
  openDb,
  listCourses, getCourse, createCourse, updateCourse, deleteCourse, countTasksForCourse,
  listTasks, getTask, createTask, updateTask, deleteTask, clearCompleted, stats,
};
