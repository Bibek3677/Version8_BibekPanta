# Lab Task Tracker v5: API reference

Base URL: `http://localhost:3000/api`

**Authentication.** Every endpoint except `GET /health` needs the API key
from `.env` (`API_KEY=...`), sent as either header:

    x-api-key: <your key>
    Authorization: Bearer <your key>

The calendar feed alone also accepts `?key=<your key>`, because calendar
apps cannot send headers.

**Formats.** Request and response bodies are JSON
(`Content-Type: application/json`). Dates are `YYYY-MM-DD`.

**Errors** always look like this, with the matching HTTP status:

```json
{ "error": "Title is required.", "details": ["Title is required."], "status": 400, "request_id": "4bdc0b3a-..." }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input (details explain which field) |
| 401 | Missing or wrong API key |
| 404 | No such task, course or endpoint |
| 405 | Method not allowed (see the `Allow` header) |
| 409 | Conflict: duplicate course code, or deleting a course that has tasks |
| 413 / 415 | Body too large / not JSON |
| 429 | More than 120 requests a minute (see `Retry-After`) |
| 502 / 503 | An external service (Supabase or the holiday API) failed |

Every response carries an `X-Request-Id` header that matches the line in
`logs/requests.log`.

## Endpoints by workflow

| Workflow | Method | Endpoint | Input | Output |
|---|---|---|---|---|
| Check the service is up | GET | `/health` | none | `{status, database, backend, version, time}` |
| See usage and errors | GET | `/metrics` | none | `{total_requests, avg_ms, by_status, by_route, ...}` |
| See my tasks | GET | `/tasks` | query: `status` (all, open, done, overdue), `course` (id or `none`), `q`, `sort` (due, priority, newest) | array of Task |
| Open one task | GET | `/tasks/:id` | none | Task |
| Add a task | POST | `/tasks` | `{title*, course_id, due_date, priority, notes, done}` | 201 + Task, `Location` header |
| Tick a task off / change one thing | PATCH | `/tasks/:id` | any subset of task fields | Task |
| Edit a task in full | PUT | `/tasks/:id` | `{title*, ...}`; fields left out reset to defaults | Task |
| Remove a task | DELETE | `/tasks/:id` | none | 204 |
| Clear completed tasks | DELETE | `/tasks?done=true` | none | `{deleted}` |
| See my courses | GET | `/courses` | none | array of Course with `task_count`, `open_count` |
| Open one course | GET | `/courses/:id` | none | Course |
| Add a course | POST | `/courses` | `{code*, name*}` | 201 + Course |
| Rename a course | PATCH | `/courses/:id` | `{code}` and/or `{name}` | Course |
| Replace a course | PUT | `/courses/:id` | `{code*, name*}` | Course |
| Remove a course | DELETE | `/courses/:id` | none | 204, or 409 if it has tasks |
| Plan around holidays | GET | `/holidays` | query: `year`, `country` (default US) | `{country, year, count, holidays[]}` |
| Check one date | GET | `/holidays/check` | query: `date*`, `country` | `{date, country, is_holiday, holidays[]}` |
| See tasks in my calendar | GET | `/calendar.ics` | query: `key` | `text/calendar` (iCalendar) |
| Summary line | GET | `/stats` | none | `{total, open, done, overdue}` |

`*` = required.

## Shapes

**Task**

```json
{
  "id": 12,
  "course_id": 1,
  "course_code": "ITC6250",
  "course_name": "Web and LCNC application development",
  "title": "Test the API in Postman",
  "notes": "",
  "due_date": "2026-11-26",
  "priority": "high",
  "done": false,
  "overdue": false,
  "holiday": "Thanksgiving Day",
  "created_at": "2026-10-21T18:05:57Z",
  "updated_at": "2026-10-21T18:05:57Z"
}
```

`overdue` and `holiday` are calculated, not stored. `holiday` is `null`
when the date is not a public holiday or the holiday service is down.

**Course**

```json
{ "id": 1, "code": "ITC6250", "name": "Web and LCNC application development", "created_at": "...", "task_count": 3, "open_count": 2 }
```

## Integrations

| System | Type | What it provides | Endpoint(s) |
|---|---|---|---|
| Supabase (PostgreSQL) | Internal, consumed | Stores tasks and courses | all task and course routes |
| Nager.Date public holiday API | External, consumed | Holiday names and dates by country | `/holidays`, `/holidays/check`, `holiday` field on tasks |
| Calendar apps (Google, Outlook, Apple) | External, provided | iCalendar feed of open tasks with due dates | `/calendar.ics` |
| Make.com (or any automation tool) | External, both ways | Make calls the API above; the app POSTs task events to Make | outgoing webhook to `WEBHOOK_URL` |

## Outgoing webhooks (Make.com)

When `WEBHOOK_URL` is set in `.env`, the app POSTs a JSON event to it after
every successful task change. Events are sent in order, in the background:
the API response never waits for them, and a failed delivery is only logged
as a warning.

| Event | When | Extra fields |
|---|---|---|
| `task.created` | POST /tasks | `task` |
| `task.updated` | PUT or PATCH that doesn't change `done` | `task`, `previous` |
| `task.completed` | `done` changed false → true | `task`, `previous` |
| `task.reopened` | `done` changed true → false | `task`, `previous` |
| `task.deleted` | DELETE /tasks/:id | `task` (as it was) |
| `tasks.cleared` | DELETE /tasks?done=true removed at least one | `deleted` (count) |

Example body:

```json
{
  "event": "task.completed",
  "occurred_at": "2026-11-08T15:20:00.000Z",
  "source": "lab-task-tracker-v5",
  "task": { "id": 12, "title": "Lab 5 report", "done": true, "priority": "high", "due_date": "2026-11-10", "course_code": "ITC6250", "...": "..." },
  "previous": { "id": 12, "done": false, "...": "..." }
}
```

For Make to call the API, the server must be reachable from the internet.
For local development, run a tunnel:

    cloudflared tunnel --url http://localhost:3000

and use the printed `https://….trycloudflare.com` address as the base URL,
with header `x-api-key: <API_KEY>`.
