// Version 8 unit tests: node --test test/v8.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { dueLabel } = require('../public/v8/due-label.js');

const today = '2026-11-16';

test('no due date gives no label', () => {
  assert.equal(dueLabel(null, { today }), null);
  assert.equal(dueLabel('', { today }), null);
});
test('done tasks say Done', () => {
  assert.deepEqual(dueLabel('2026-11-01', { done: true, today }), { text: 'Done', level: 'done' });
});
test('overdue, singular and plural', () => {
  assert.deepEqual(dueLabel('2026-11-15', { today }), { text: 'Overdue by 1 day', level: 'overdue' });
  assert.deepEqual(dueLabel('2026-11-10', { today }), { text: 'Overdue by 6 days', level: 'overdue' });
});
test('today and tomorrow are urgent', () => {
  assert.deepEqual(dueLabel('2026-11-16', { today }), { text: 'Due today', level: 'urgent' });
  assert.deepEqual(dueLabel('2026-11-17', { today }), { text: 'Due tomorrow', level: 'urgent' });
});
test('2 to 6 days is soon', () => {
  assert.deepEqual(dueLabel('2026-11-18', { today }), { text: 'Due in 2 days', level: 'soon' });
  assert.deepEqual(dueLabel('2026-11-22', { today }), { text: 'Due in 6 days', level: 'soon' });
});
test('7 or more days shows the date', () => {
  assert.deepEqual(dueLabel('2026-11-23', { today }), { text: 'Due Mon, Nov 23', level: 'later' });
  assert.deepEqual(dueLabel('2026-11-30', { today }), { text: 'Due Mon, Nov 30', level: 'later' });
});
test('month and year boundaries', () => {
  assert.deepEqual(dueLabel('2027-01-01', { today: '2026-12-31' }), { text: 'Due tomorrow', level: 'urgent' });
  assert.deepEqual(dueLabel('2026-11-30', { today: '2026-12-01' }), { text: 'Overdue by 1 day', level: 'overdue' });
});
test('daylight saving change does not shift the count', () => {
  // US clocks go back on 2026-11-01
  assert.deepEqual(dueLabel('2026-11-02', { today: '2026-10-31' }), { text: 'Due in 2 days', level: 'soon' });
});
test('timestamps and bad input', () => {
  assert.deepEqual(dueLabel('2026-11-17T00:00:00Z', { today }), { text: 'Due tomorrow', level: 'urgent' });
  assert.equal(dueLabel('not-a-date', { today }), null);
});

const { summarize } = require('../public/v8/dashboard.js');
const sample = [
  { course_code: 'ITC6250', course_name: 'Web', done: false, overdue: false, due_date: '2026-11-17' },
  { course_code: 'ITC6250', course_name: 'Web', done: false, overdue: true, due_date: '2026-11-14' },
  { course_code: 'ITC6250', course_name: 'Web', done: true, overdue: false, due_date: '2026-11-10' },
  { course_code: 'ITC6000', course_name: 'DB', done: false, overdue: false, due_date: '2026-11-22' },
  { course_code: 'ITC6000', course_name: 'DB', done: false, overdue: false, due_date: '2026-11-23' },
  { course_code: null, course_name: null, done: false, overdue: false, due_date: null },
];
test('dashboard totals', () => {
  const s = summarize(sample, today);
  assert.deepEqual([s.total, s.open, s.done, s.overdue, s.dueSoon, s.percent], [6, 5, 1, 1, 2, 17]);
});
test('dashboard: due this week matches the labels (day 6 counts, day 7 does not)', () => {
  assert.equal(summarize([sample[3]], today).dueSoon, 1);
  assert.equal(summarize([sample[4]], today).dueSoon, 0);
});
test('dashboard courses sorted, No course last', () => {
  assert.deepEqual(summarize(sample, today).courses.map((c) => [c.code, c.done, c.total]),
    [['ITC6000', 0, 2], ['ITC6250', 1, 3], ['No course', 0, 1]]);
});
test('dashboard with no tasks', () => {
  const s = summarize([], today);
  assert.deepEqual([s.total, s.percent, s.courses.length], [0, 0, 0]);
});
