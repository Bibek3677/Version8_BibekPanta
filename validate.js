'use strict';

// Input validation for the API. Every write goes through here before it
// reaches the database, so bad input gets a clear 400 message instead of a
// raw SQLite constraint error. The CHECK constraints in schema.sql are a
// second line of defence.

const PRIORITIES = ['low', 'medium', 'high'];

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Returns { value, errors }. With partial = true, missing fields are skipped
// (used for PUT, where the client may send only the fields that changed).
function validateTask(input, { partial = false } = {}) {
  const errors = [];
  const value = {};

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { value, errors: ['Request body must be a JSON object.'] };
  }

  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (has('title') || !partial) {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      errors.push('Title is required.');
    } else if (input.title.trim().length > 120) {
      errors.push('Title must be 120 characters or fewer.');
    } else {
      value.title = input.title.trim();
    }
  }

  if (has('notes')) {
    if (input.notes === null) {
      value.notes = '';
    } else if (typeof input.notes !== 'string') {
      errors.push('Notes must be text.');
    } else if (input.notes.length > 1000) {
      errors.push('Notes must be 1000 characters or fewer.');
    } else {
      value.notes = input.notes.trim();
    }
  }

  if (has('due_date')) {
    if (input.due_date === null || input.due_date === '') {
      value.due_date = null;
    } else if (typeof input.due_date !== 'string' || !isRealDate(input.due_date)) {
      errors.push('Due date must be a real date in YYYY-MM-DD format.');
    } else {
      value.due_date = input.due_date;
    }
  }

  if (has('priority')) {
    if (!PRIORITIES.includes(input.priority)) {
      errors.push('Priority must be low, medium or high.');
    } else {
      value.priority = input.priority;
    }
  }

  if (has('done')) {
    if (typeof input.done !== 'boolean') {
      errors.push('Done must be true or false.');
    } else {
      value.done = input.done;
    }
  }

  if (has('course_id')) {
    if (input.course_id === null || input.course_id === '') {
      value.course_id = null;
    } else {
      const n = Number(input.course_id);
      if (!Number.isInteger(n) || n < 1) {
        errors.push('Course id must be a positive whole number.');
      } else {
        value.course_id = n;
      }
    }
  }

  return { value, errors };
}

function validateCourse(input, { partial = false } = {}) {
  const errors = [];
  const value = {};

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { value, errors: ['Request body must be a JSON object.'] };
  }

  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (has('code') || !partial) {
    const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
    if (code.length < 2 || code.length > 20) {
      errors.push('Course code must be 2 to 20 characters.');
    } else if (!/^[A-Z0-9 -]+$/.test(code)) {
      errors.push('Course code can only use letters, numbers, spaces and hyphens.');
    } else {
      value.code = code;
    }
  }

  if (has('name') || !partial) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > 100) {
      errors.push('Course name must be 1 to 100 characters.');
    } else {
      value.name = name;
    }
  }

  return { value, errors };
}

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { validateTask, validateCourse, parseId, PRIORITIES };
