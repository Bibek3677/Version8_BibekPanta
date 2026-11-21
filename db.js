'use strict';

// Data access layer. All SQL lives here and every query is parameterised
// (values are passed as ? placeholders, never pasted into the SQL string),
// which protects against SQL injection.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

function openDb(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;'); // SQLite leaves this off unless asked
  db.exec(SCHEMA_SQL);
  return db;
}

// Wraps several statements so they all succeed or all roll back.
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ---------- courses ---------- */

function listCourses(db) {
  return db.prepare(`
    SELECT c.id, c.code, c.name, c.created_at,
           COUNT(t.id)                                AS task_count,
           COALESCE(SUM(CASE WHEN t.done = 0 THEN 1 END), 0) AS open_count
    FROM courses c
    LEFT JOIN tasks t ON t.course_id = c.id
    GROUP BY c.id
    ORDER BY c.code
  `).all();
}

function getCourse(db, id) {
  return db.prepare('SELECT id, code, name, created_at FROM courses WHERE id = ?').get(id) || null;
}

function createCourse(db, { code, name }) {
  const info = db.prepare('INSERT INTO courses (code, name) VALUES (?, ?)').run(code, name);
  return getCourse(db, Number(info.lastInsertRowid));
}

function updateCourse(db, id, changes) {
  const current = getCourse(db, id);
  if (!current) return null;
  const next = { ...current, ...changes };
  db.prepare('UPDATE courses SET code = ?, name = ? WHERE id = ?').run(next.code, next.name, id);
  return getCourse(db, id);
}

function countTasksForCourse(db, id) {
  return db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE course_id = ?').get(id).n;
}

function deleteCourse(db, id) {
  return db.prepare('DELETE FROM courses WHERE id = ?').run(id).changes > 0;
}

/* ---------- tasks ---------- */

const TASK_SELECT = `
  SELECT t.id, t.course_id, t.title, t.notes, t.due_date, t.priority, t.done,
         t.created_at, t.updated_at,
         c.code AS course_code, c.name AS course_name,
         (t.done = 0 AND t.due_date IS NOT NULL
            AND t.due_date < date('now', 'localtime')) AS overdue
  FROM tasks t
  LEFT JOIN courses c ON c.id = t.course_id
`;

// Only these ORDER BY clauses can ever be used, so a sort value from the
// URL cannot inject SQL.
const SORTS = {
  due: `t.done ASC, t.due_date IS NULL, t.due_date ASC,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.id`,
  priority: `t.done ASC,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        t.due_date IS NULL, t.due_date ASC, t.id`,
  newest: 't.created_at DESC, t.id DESC',
};

function toTask(row) {
  if (!row) return null;
  return { ...row, done: row.done === 1, overdue: row.overdue === 1 };
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

function listTasks(db, { status = 'all', course = '', q = '', sort = 'due' } = {}) {
  const where = [];
  const params = [];

  if (status === 'open') where.push('t.done = 0');
  else if (status === 'done') where.push('t.done = 1');
  else if (status === 'overdue') {
    where.push("t.done = 0 AND t.due_date IS NOT NULL AND t.due_date < date('now', 'localtime')");
  }

  if (course === 'none') {
    where.push('t.course_id IS NULL');
  } else if (course) {
    where.push('t.course_id = ?');
    params.push(course);
  }

  if (q) {
    const like = '%' + escapeLike(q) + '%';
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }

  const sql = TASK_SELECT
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY ' + (SORTS[sort] || SORTS.due);

  return db.prepare(sql).all(...params).map(toTask);
}

function getTask(db, id) {
  return toTask(db.prepare(TASK_SELECT + ' WHERE t.id = ?').get(id));
}

function createTask(db, task) {
  const info = db.prepare(`
    INSERT INTO tasks (course_id, title, notes, due_date, priority, done)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    task.course_id ?? null,
    task.title,
    task.notes ?? '',
    task.due_date ?? null,
    task.priority ?? 'medium',
    task.done ? 1 : 0
  );
  return getTask(db, Number(info.lastInsertRowid));
}

function updateTask(db, id, changes) {
  const current = getTask(db, id);
  if (!current) return null;
  const next = { ...current, ...changes };
  db.prepare(`
    UPDATE tasks
    SET course_id = ?, title = ?, notes = ?, due_date = ?, priority = ?, done = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(next.course_id, next.title, next.notes, next.due_date, next.priority, next.done ? 1 : 0, id);
  return getTask(db, id);
}

function deleteTask(db, id) {
  return db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
}

function clearCompleted(db) {
  return db.prepare('DELETE FROM tasks WHERE done = 1').run().changes;
}

function stats(db) {
  return db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(done = 0), 0) AS open,
           COALESCE(SUM(done = 1), 0) AS done,
           COALESCE(SUM(done = 0 AND due_date IS NOT NULL
                        AND due_date < date('now', 'localtime')), 0) AS overdue
    FROM tasks
  `).get();
}

module.exports = {
  openDb, transaction,
  listCourses, getCourse, createCourse, updateCourse, deleteCourse, countTasksForCourse,
  listTasks, getTask, createTask, updateTask, deleteTask, clearCompleted, stats,
};
module.exports.backend = 'sqlite';
