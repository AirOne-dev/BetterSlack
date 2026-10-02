// From what is held to what is drawn, at one moment.
//
// Pure: the session's state and a date in, everything the bar and the details
// need out. It runs on every repaint -- every few seconds -- which is the
// point: Quelio's answer is an hour old, the clock is not.

import { lunchOf } from './lib/day.js';
import { planWeek } from './lib/planner.js';
import { dayStatus, weekTone } from './lib/status.js';
import { dayKey, formatClock, isoWeek, minutesOf, weekdayOf, workingDaysOf } from './lib/time.js';

/** Which status values are times of day; every other one is a duration. */
const CLOCKS = new Set(['time', 'by', 'from', 'arrival']);

/** Durations, times and percentages in the reader's language. */
export function createFormat(t, locale) {
  const duration = (minutes) => {
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return t('minutes', { m });
    if (m === 0) return t('hours', { h });
    return t('hoursMinutes', { h, mm: String(m).padStart(2, '0') });
  };
  let weekday;
  try {
    weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' });
  } catch {
    weekday = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric' });
  }
  return {
    duration,
    clock: (minutes) => (typeof minutes === 'number' ? formatClock(minutes) : t('none')),
    percent: (fraction) => t('percent', { value: Math.round(Math.max(0, fraction) * 100) }),
    day: (date) => weekday.format(date),
    /** A status, as its sentence. */
    sentence: (status) => {
      const vars = {};
      for (const [key, value] of Object.entries(status.vars ?? {})) {
        vars[key] = CLOCKS.has(key) ? (typeof value === 'number' ? formatClock(value) : t('none')) : duration(value);
      }
      return t(`status_${status.key}`, vars);
    },
  };
}

/**
 * Everything on screen, for `state` (the session's) at `date`.
 *
 * `phase` is what the bar is about: `signedOut`, `expired`, `loading` (what
 * was kept is still being read, or signed in with nothing read yet),
 * `unavailable` (signed in, nothing read, and the last attempt failed) or
 * `ready`.
 */
export function buildView(state, date) {
  const common = {
    username: state.session?.username ?? state.lastUser ?? '',
    address: state.address,
    busy: state.busy,
    failure: state.failure,
  };
  // Before the kept files are read, "signed out" would be a guess, and a wrong one flashes.
  if (!state.ready) return { ...common, phase: 'loading' };
  if (!state.session || !state.address) return { ...common, phase: state.expired ? 'expired' : 'signedOut' };

  // Last week's answer is not this week's: it waits for a refresh instead.
  const hours = state.hours && state.hours.week === isoWeek(date) ? state.hours : null;
  if (!hours) return { ...common, phase: state.failure ? 'unavailable' : 'loading' };

  const weekday = weekdayOf(date);
  const now = minutesOf(date);
  const days = workingDaysOf(date).map((day, index) => {
    const entry = hours.days[dayKey(day)];
    return {
      date: day,
      badges: Array.isArray(entry?.badges) ? entry.badges : [],
      paid: typeof entry?.paid === 'number' ? entry.paid : null,
      off: state.daysOff.includes(index),
    };
  });
  const offset = hours.offset?.day === dayKey(date) ? hours.offset.minutes : 0;
  const week = planWeek({ objective: hours.objective, weekday, now, days, offset });
  const badges = weekday < 5 ? days[weekday].badges : [];
  const status = dayStatus({ week, badges, weekday, now });

  return {
    ...common,
    phase: 'ready',
    weekday,
    now,
    days,
    badges,
    lunch: lunchOf(badges, now),
    week,
    status,
    tone: weekTone(week),
    fetchedAt: hours.fetchedAt,
    objectiveReported: hours.objectiveReported !== false,
    // Something to say about how old this is: the last attempt failed.
    offline: Boolean(state.failure),
  };
}
