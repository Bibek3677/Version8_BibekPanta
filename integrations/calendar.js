'use strict';

// Integration: an iCalendar (.ics) feed of open tasks with due dates.
// Google Calendar, Outlook and Apple Calendar can subscribe to the URL and
// show each task as an all-day event on its due date. Format: RFC 5545.

function escapeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 bytes must be folded onto continuation lines.
function fold(line) {
  const out = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
    }
    current += ch;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compact = (isoDate) => isoDate.replace(/-/g, '');

function nextDay(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildIcs(tasks, { calendarName = 'Lab Task Tracker' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lab Task Tracker//Version 5//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const t of tasks) {
    if (!t.due_date || t.done) continue;
    const description = [
      `Priority: ${t.priority}`,
      t.course_code ? `Course: ${t.course_code}` : null,
      t.notes ? `Notes: ${t.notes}` : null,
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:task-${t.id}@lab-task-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(t.due_date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(t.due_date))}`,
      `SUMMARY:${escapeText((t.course_code ? `[${t.course_code}] ` : '') + t.title)}`,
      `DESCRIPTION:${escapeText(description)}`,
      ...(t.course_code ? [`CATEGORIES:${escapeText(t.course_code)}`] : []),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs };
