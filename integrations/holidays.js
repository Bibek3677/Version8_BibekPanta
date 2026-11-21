'use strict';

// External integration: public holidays from Nager.Date (https://date.nager.at).
// Free, no account or key needed. Results are cached in memory for 12 hours
// so the app makes at most one call per country and year.

const CACHE_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

class IntegrationError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function createHolidayService({
  baseUrl = process.env.HOLIDAY_API_URL || 'https://date.nager.at/api/v3',
  defaultCountry = (process.env.HOLIDAY_COUNTRY || 'US').toUpperCase(),
  log = () => {},
} = {}) {
  const cache = new Map(); // "US-2026" -> { at, holidays }

  async function list(year, country = defaultCountry) {
    const key = `${country}-${year}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.holidays;

    let res;
    try {
      res = await fetch(`${baseUrl}/PublicHolidays/${year}/${country}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      log('warn', `Holiday API unreachable: ${err.message}`);
      throw new IntegrationError('The public holiday service is unreachable right now. Try again later.', 503);
    }
    if (res.status === 404 || res.status === 400) {
      throw new IntegrationError(`No holiday data for country code "${country}".`, 404);
    }
    if (!res.ok) {
      log('warn', `Holiday API returned ${res.status}`);
      throw new IntegrationError(`The public holiday service returned an error (${res.status}).`, 502);
    }

    let raw;
    try {
      raw = await res.json();
    } catch {
      throw new IntegrationError('The public holiday service sent an unreadable response.', 502);
    }
    const holidays = (Array.isArray(raw) ? raw : []).map((h) => ({
      date: h.date,
      name: h.name,
      local_name: h.localName,
      country: h.countryCode,
      nationwide: h.global !== false,
    }));
    cache.set(key, { at: Date.now(), holidays });
    return holidays;
  }

  async function on(date, country = defaultCountry) {
    const holidays = await list(Number(date.slice(0, 4)), country);
    return holidays.filter((h) => h.date === date);
  }

  // Adds a "holiday" field to each task. If the holiday service is down the
  // tasks are still returned, just with holiday: null.
  async function annotate(tasks) {
    const many = Array.isArray(tasks);
    const list_ = (many ? tasks : [tasks]).filter(Boolean);
    const years = [...new Set(list_.filter((t) => t.due_date).map((t) => Number(t.due_date.slice(0, 4))))];
    const byDate = new Map();
    for (const year of years) {
      try {
        for (const h of await list(year)) {
          if (h.nationwide && !byDate.has(h.date)) byDate.set(h.date, h.name);
        }
      } catch {
        // already logged; carry on without holiday info for this year
      }
    }
    for (const t of list_) t.holiday = (t.due_date && byDate.get(t.due_date)) || null;
    return tasks;
  }

  return { list, on, annotate, defaultCountry };
}

module.exports = { createHolidayService, IntegrationError };
