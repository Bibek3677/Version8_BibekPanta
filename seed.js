'use strict';

// Fills the database with sample data. Due dates are relative to today so
// there is always a mix of overdue, upcoming and undated tasks to test with.
//   npm run seed   -> wipes data/tracker.db and reseeds it

const path = require('node:path');
const repo = require('./db');

function isoDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function seed(db) {
  repo.transaction(db, () => {
    db.exec('DELETE FROM tasks; DELETE FROM courses; DELETE FROM sqlite_sequence;');

    const itc = repo.createCourse(db, { code: 'ITC6250', name: 'Web and LCNC application development' });
    const stats = repo.createCourse(db, { code: 'STAT5000', name: 'Applied statistics' });
    const personal = repo.createCourse(db, { code: 'PERSONAL', name: 'Personal and admin' });

    const tasks = [
      { course_id: itc.id, title: 'Design the database schema', priority: 'high', due_date: isoDate(-2), done: true },
      { course_id: itc.id, title: 'Connect the front end to the API', priority: 'high', due_date: isoDate(1) },
      { course_id: itc.id, title: 'Take schema screenshot for documentation', priority: 'medium', due_date: isoDate(1) },
      { course_id: itc.id, title: 'Write Lab 4 reflection', notes: 'Mention which AI tools I used.', priority: 'high', due_date: isoDate(2) },
      { course_id: stats.id, title: 'Problem set 3', priority: 'medium', due_date: isoDate(-1) },
      { course_id: stats.id, title: 'Read chapter 6 on regression', priority: 'low', due_date: isoDate(5) },
      { course_id: personal.id, title: 'Renew library card', priority: 'low' },
      { course_id: null, title: 'Back up laptop', priority: 'medium', due_date: isoDate(7) },
    ];
    tasks.forEach((t) => repo.createTask(db, t));
  });
}

module.exports = { seed };

if (require.main === module) {
  const file = path.join(__dirname, 'data', 'tracker.db');
  const db = repo.openDb(file);
  seed(db);
  const s = repo.stats(db);
  console.log(`Seeded ${file}: ${repo.listCourses(db).length} courses, ${s.total} tasks.`);
  db.close();
}
