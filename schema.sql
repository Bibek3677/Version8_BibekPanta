-- Lab Task Tracker, Version 4: database schema (SQLite)
-- Two tables in a one-to-many relationship: one course has many tasks.
-- A task may also have no course (course_id IS NULL) for general to-dos.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE COLLATE NOCASE
                      CHECK (length(code) BETWEEN 2 AND 20),
  name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER REFERENCES courses(id) ON DELETE RESTRICT,
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes       TEXT    NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  due_date    TEXT    CHECK (due_date IS NULL OR date(due_date) = due_date),
  priority    TEXT    NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low', 'medium', 'high')),
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for the columns the app filters and sorts on most.
CREATE INDEX IF NOT EXISTS idx_tasks_course_id ON tasks(course_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date  ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_done      ON tasks(done);
