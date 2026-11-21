// Version 9 unit tests: node --test test/v9.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { startOfWeek, addDays, weekRangeLabel, describeDate, buildWeek, BUSY_LIMIT } = require('../public/v9/planner.js');
const { toCSV, field, fileName } = require('../public/v9/export.js');

// ---------- planner: dates ----------
test('weeks start on Monday, including when today is Sunday', () => {
  assert.equal(startOfWeek('2026-11-16'), '2026-11-16'); // Monday
  assert.equal(startOfWeek('2026-11-19'), '2026-11-16'); // Thursday
  assert.equal(startOfWeek('2026-11-22'), '2026-11-16'); // Sunday belongs to the week before
  assert.equal(startOfWeek('2026-11-23'), '2026-11-23');
});
test('week start across month and year ends', () => {
  assert.equal(startOfWeek('2026-12-01'), '2026-11-30');
  assert.equal(startOfWeek('2027-01-02'), '2026-12-28');
});
test('addDays crosses months, leap days and the daylight-saving change', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31'); // US clocks go back on Nov 1
  assert.equal(addDays('2026-11-16', -7), '2026-11-09');
});
test('week range labels', () => {
  assert.equal(weekRangeLabel('2026-11-16'), 'Nov 16 – 22, 2026');
  assert.equal(weekRangeLabel('2026-11-30'), 'Nov 30 – Dec 6, 2026');
  assert.equal(weekRangeLabel('2026-12-28'), 'Dec 28, 2026 – Jan 3, 2027');
});
test('describeDate', () => {
  assert.equal(describeDate('2026-11-26'), 'Thu, Nov 26');
  assert.equal(describeDate(null), 'No due date');
});

// ---------- planner: grouping ----------
const t = (id, due, extra) => Object.assign({ id, title: 'Task ' + id, due_date: due, done: false, priority: 'medium' }, extra);
const today = '2026-11-18'; // a Wednesday
const week = '2026-11-16';

test('tasks land on the right day; other weeks are left out', () => {
  const w = buildWeek([t(1, '2026-11-16'), t(2, '2026-11-22'), t(3, '2026-11-23'), t(4, '2026-11-15')], week, { today });
  assert.deepEqual(w.days.map((d) => d.tasks.map((x) => x.id)), [[1], [], [], [], [], [], [2]]);
  assert.equal(w.open, 2);
});
test('today and past days are marked', () => {
  const w = buildWeek([], week, { today });
  assert.deepEqual(w.days.map((d) => d.isToday), [false, false, true, false, false, false, false]);
  assert.deepEqual(w.days.map((d) => d.isPast), [true, true, false, false, false, false, false]);
});
test('tasks with no due date go to the tray; done ones do not', () => {
  const w = buildWeek([t(1, null), t(2, null, { done: true })], week, { today });
  assert.deepEqual(w.unscheduled.map((x) => x.id), [1]);
});
test('completed tasks are hidden unless showDone, and never count as open', () => {
  const tasks = [t(1, '2026-11-17', { done: true }), t(2, '2026-11-17')];
  assert.deepEqual(buildWeek(tasks, week, { today }).days[1].tasks.map((x) => x.id), [2]);
  const shown = buildWeek(tasks, week, { today, showDone: true }).days[1];
  assert.deepEqual(shown.tasks.map((x) => x.id), [2, 1]); // open first
  assert.equal(shown.open, 1);
});
test('within a day: high priority first, then by title', () => {
  const w = buildWeek([
    t(1, '2026-11-19', { title: 'b', priority: 'low' }),
    t(2, '2026-11-19', { title: 'z', priority: 'high' }),
    t(3, '2026-11-19', { title: 'a', priority: 'low' }),
  ], week, { today });
  assert.deepEqual(w.days[3].tasks.map((x) => x.id), [2, 3, 1]);
});
test(`a day with ${BUSY_LIMIT} or more open tasks is busy`, () => {
  const many = (n) => Array.from({ length: n }, (_, i) => t(i + 1, '2026-11-20'));
  assert.equal(buildWeek(many(BUSY_LIMIT - 1), week, { today }).days[4].busy, false);
  assert.equal(buildWeek(many(BUSY_LIMIT), week, { today }).days[4].busy, true);
  const doneOnes = many(BUSY_LIMIT).map((x) => Object.assign(x, { done: true }));
  assert.equal(buildWeek(doneOnes, week, { today, showDone: true }).days[4].busy, false);
});
test('holidays come from the map, or from the tasks when the map has none', () => {
  const w = buildWeek([t(1, '2026-11-20', { holiday: 'Made-up Day' })], '2026-11-23', { today, holidays: { '2026-11-26': 'Thanksgiving Day' } });
  assert.equal(w.days[3].holiday, 'Thanksgiving Day');
  const w2 = buildWeek([t(1, '2026-11-20', { holiday: 'Made-up Day' })], week, { today });
  assert.equal(w2.days[4].holiday, 'Made-up Day');
});
test('overdue tasks from earlier weeks are counted, not shown', () => {
  const w = buildWeek([t(1, '2026-11-10'), t(2, '2026-11-11', { done: true }), t(3, '2026-11-17')], week, { today });
  assert.equal(w.overdueEarlier, 1);
  assert.equal(w.open, 1); // only task 3 is in this week
});
test('timestamps in due_date still work', () => {
  const w = buildWeek([t(1, '2026-11-17T00:00:00Z')], week, { today });
  assert.deepEqual(w.days[1].tasks.map((x) => x.id), [1]);
});

// ---------- CSV export ----------
test('plain fields are left alone; commas, quotes and line breaks are quoted', () => {
  assert.equal(field('Read chapter 4'), 'Read chapter 4');
  assert.equal(field('a, b'), '"a, b"');
  assert.equal(field('say "hi"'), '"say ""hi"""');
  assert.equal(field('line 1\nline 2'), '"line 1\nline 2"');
  assert.equal(field(null), '');
});
test('cells that a spreadsheet would run as a formula are neutralised', () => {
  assert.equal(field('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  assert.equal(field('+1'), "'+1");
  assert.equal(field('-draft'), "'-draft");
  assert.equal(field('@sum'), "'@sum");
  assert.equal(field('2026-11-26'), '2026-11-26'); // dates are fine
});
test('toCSV writes a header and one row per task with CRLF endings', () => {
  const csv = toCSV([
    { title: 'Lab 9', course_code: 'ITC6250', due_date: '2026-11-24', priority: 'high', done: false, overdue: false, holiday: null, notes: '', created_at: '2026-11-20T10:00:00Z' },
    { title: 'Old', course_code: null, due_date: '2026-11-01', priority: 'low', done: false, overdue: true, holiday: null, notes: 'x, y', created_at: '2026-10-01T10:00:00Z' },
    { title: 'Finished', course_code: null, due_date: null, priority: 'medium', done: true, overdue: false, holiday: null, notes: '', created_at: '' },
  ]);
  assert.equal(csv,
    'Title,Course,Due date,Priority,Status,Public holiday,Notes,Created\r\n' +
    'Lab 9,ITC6250,2026-11-24,high,Open,,,2026-11-20\r\n' +
    'Old,,2026-11-01,low,Overdue,,"x, y",2026-10-01\r\n' +
    'Finished,,,medium,Done,,,\r\n');
});
test('export file names', () => {
  assert.equal(fileName('2026-11-21', 'all'), 'tasks-2026-11-21.csv');
  assert.equal(fileName('2026-11-21', 'overdue'), 'tasks-overdue-2026-11-21.csv');
});
