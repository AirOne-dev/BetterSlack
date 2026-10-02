// Minutes since midnight, and the few date shapes Quelio uses.
//
// Everything in this plugin reasons in whole minutes since local midnight:
// Kelio stamps a badge to the minute, Quelio answers in "HH:MM", and nothing on
// screen is finer than a minute. Dates are the computer's local ones, which is
// the badge reader's clock for anybody sitting in the same office as it.

const pad = (value) => String(value).padStart(2, '0');

/** "08:42" -> 522. A time of day, so "24:10" is not one. Anything else -> null. */
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * "38:12" -> 2292. A duration, so the hours may run past 23 -- a week's total
 * does. Anything else -> null.
 */
export function parseDuration(text) {
  const match = /^(\d{1,4}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 522 -> "08:42". */
export function formatClock(minutes) {
  const total = Math.max(0, Math.round(minutes));
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

/** Minutes since local midnight, for a Date. */
export function minutesOf(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** Monday 0 ... Sunday 6 -- the order a working week is read in. */
export function weekdayOf(date) {
  return (date.getDay() + 6) % 7;
}

/** The key Quelio files a day under: "02-10-2026". */
export function dayKey(date) {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** "02-10-2026" -> a local Date at midnight, or null. */
export function parseDayKey(key) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(key ?? ''));
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  // Rejects 31-02-2026, which Date would quietly roll into March.
  return dayKey(date) === key ? date : null;
}

/** Local midnight on the Monday of the week holding `date`. */
export function mondayOf(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - weekdayOf(monday));
  return monday;
}

/** The five working days of the week holding `date`, Monday first. */
export function workingDaysOf(date) {
  const monday = mondayOf(date);
  return Array.from({ length: 5 }, (_, index) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
}

/**
 * ISO 8601 week, as "2026-W40" -- the year is the week's, not the date's, so
 * 31 December can belong to week 1 of the next one. Used to tell whether
 * something kept belongs to this week; Quelio's own week keys are never
 * needed, since every day carries its date.
 */
export function isoWeek(date) {
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() + 3 - weekdayOf(thursday));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - weekdayOf(firstThursday));
  const week = 1 + Math.round((thursday - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${thursday.getFullYear()}-W${pad(week)}`;
}
