# Lab Task Tracker, Version 8

ITC6250 Lab Exercise 8: AI-assisted application development.

Version 8 keeps the Version 5 REST API unchanged and adds four front-end
features built with AI-generated code (see the documentation file for the
use cases, prompts, testing notes and reflection):

1. **Progress dashboard** (`public/v8/dashboard.js`): open / due this week /
   overdue / done counts and a progress bar per course, for all tasks
   regardless of the current filter.
2. **Friendly due-date labels** (`public/v8/due-label.js`): "Due tomorrow",
   "Overdue by 3 days", colour-coded, full date in the tooltip. Date maths
   is done in UTC so labels don't shift a day in US time zones or across
   daylight-saving changes.
3. **Toasts and undoable delete** (`public/v8/toast.js`): stacked,
   dismissible notifications; deleting a task no longer asks "are you
   sure?" but gives 6 seconds to Undo.
4. **Keyboard shortcuts** (`public/v8/shortcuts.js`): `N` new task, `/`
   search, `R` reload, `1`-`4` status filters, `?` shows the list.

Styles are in `public/v8/v8.css` and reuse the colours from `styles.css`.
Unit tests for the date labels and dashboard maths: `test/v8.test.cjs`
(run with the rest by `npm test`).

---

The rest of this file describes the Version 5 back end, which Version 8
uses unchanged.

Version 5 turns the task tracker's back end into a documented RESTful API
with API-key authentication, consistent error handling, rate limiting,
request logging and a metrics endpoint, and connects it to three systems:

- **Supabase** (internal): stores tasks and courses.
- **Nager.Date** (external): public holidays, so the app warns you when a
  task is due on one.
- **Calendar apps** (external): an `.ics` feed so open tasks appear in
  Google Calendar, Outlook or Apple Calendar.

Full endpoint reference with input and output formats: `docs/api.md`.

## Requirements

Node.js 22.13 or newer. No `npm install` needed.

## Run it

1. Copy `.env.example` to `.env` (or copy your Version 4 `.env` and add the
   `API_KEY` and `HOLIDAY_COUNTRY` lines). Fill in your Supabase URL and
   secret key, and make up a long random `API_KEY`.
2. Start the server:

       npm run start:supabase

3. Open http://localhost:3000 and enter your `API_KEY` when asked.

The database schema is the same as Version 4 (`supabase/schema.sql`), so
nothing needs to change in Supabase.

Offline version (local SQLite, no Supabase): `npm start`.

## Connect to Make.com

- **App → Make:** in Make, add a **Webhooks › Custom webhook** trigger, copy
  its URL into `WEBHOOK_URL=` in `.env`, and restart the server. Every task
  change is sent as an event (`task.created`, `task.completed`, ...). See
  "Outgoing webhooks" in `docs/api.md`.
- **Make → App:** Make runs in the cloud, so expose the server first:
  `cloudflared tunnel --url http://localhost:3000`. In Make, use an
  **HTTP › Make a request** module with the printed `https://….trycloudflare.com`
  URL (e.g. `POST /api/tasks`) and a header `x-api-key: <your API_KEY>`.
  The quick-tunnel URL changes every time you restart it.

## Test it

- **Postman:** import `postman/Lab_Task_Tracker_v5.postman_collection.json`,
  open the collection's **Variables** tab, set `apiKey` to your `API_KEY`,
  then click **Run collection**. 27 requests, each with test assertions.
- **Automated:** `npm test` runs 23 tests offline, using a fake holiday
  service and a throwaway database.

## Monitoring

- `GET /api/health` (no key) reports whether the server and database are up.
- `GET /api/metrics` shows request counts, average response time and errors
  per endpoint.
- Every request is written to `logs/requests.log` as one JSON line with a
  request id, status and timing. API keys are never logged.

## Project structure

    server.js                 Routes, authentication, error handling, rate limiting
    logger.js                 Request log and metrics
    integrations/holidays.js  Nager.Date client with caching, timeout and fallback
    integrations/calendar.js  iCalendar (.ics) feed builder
    integrations/webhooks.js  Outgoing task events (Make.com webhook)
    db-supabase.js            Supabase data layer (used when SUPABASE_URL is set)
    db.js, schema.sql         Local SQLite data layer
    validate.js               Input validation
    public/                   Front end
    postman/                  Postman collection
    test/                     Automated tests
    docs/api.md               API reference
    supabase/                 Supabase schema and seed SQL (unchanged from v4)

## AI assistance

Parts of this code were generated with Claude (Anthropic); see the
documentation file.
