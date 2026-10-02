// The company's rules, which are this plugin's settings.
//
// Two kinds of rule meet here, and every one of them is a setting so that a
// deployment whose quelio-api is configured differently can match its own:
//
//   - how Quelio *counts* a day: which hours are counted, the two paid short
//     breaks and when each is credited, and the lunch that counts as an hour
//     at least. These have to match the server's config.php, or the local
//     count drifts from Quelio's between two answers.
//   - what the company *allows*: when to arrive, when lunch may start, when
//     one may leave. Quelio counts a day that broke all of them; they are
//     what every suggestion has to fit inside.
//
// Some values are both at once -- the end of the counted day is also the
// latest useful departure, the noon window that decides the lunch deduction
// is also the latest return from lunch -- and are one setting rather than two
// that could disagree.
//
// Settings hold times as "HH:MM" and lengths as minutes; everything below
// reasons in minutes since midnight.

import { parseClock } from './time.js';

/** The defaults: the rules of the company this plugin was written for. */
export const DEFAULTS = Object.freeze({
  /** Only 08:30-18:30 is counted, 08:30-17:30 on Friday. */
  countFrom: '08:30',
  countTo: '18:30',
  countToFriday: '17:30',
  /** Arrive by 09:00. Arriving before the counted day starts counts nothing. */
  arriveBy: '09:00',
  /** Nobody leaves before 16:30, unless the afternoon is off. */
  leaveFrom: '16:30',
  /** The 10:30 and 15:30 breaks last 7 minutes each and are paid ... */
  breakMinutes: 7,
  /** ... the morning one once 12:00 has passed, the afternoon one from 16:00. */
  morningBreakFrom: '12:00',
  afternoonBreakFrom: '16:00',
  /** Lunch starts between 12:00 and 13:00 ... */
  lunchFrom: '12:00',
  lunchStartBy: '13:00',
  /** ... only its part before 14:00 counts toward its hour, and that is the latest return ... */
  lunchEndBy: '14:00',
  /** ... and it counts as an hour at least: badging less is deducted. */
  lunchMinimum: 60,
});

const TIMES = ['countFrom', 'countTo', 'countToFriday', 'arriveBy', 'leaveFrom', 'morningBreakFrom',
  'afternoonBreakFrom', 'lunchFrom', 'lunchStartBy', 'lunchEndBy'];
const LENGTHS = { breakMinutes: [0, 60], lunchMinimum: [0, 180] };

/** A setting as minutes, or null when it is not a usable value. */
function readValue(key, value) {
  if (key in LENGTHS) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    const [low, high] = LENGTHS[key];
    return Number.isInteger(number) && number >= low && number <= high ? number : null;
  }
  return typeof value === 'string' ? parseClock(value) : null;
}

/** The rules as minutes, for values already checked one by one. */
function build(v) {
  return {
    countFrom: v.countFrom,
    /** The end of the counted day, Monday first. */
    countTo: [v.countTo, v.countTo, v.countTo, v.countTo, v.countToFriday],
    arriveBy: v.arriveBy,
    leaveFrom: v.leaveFrom,
    breakMinutes: v.breakMinutes,
    morningBreakFrom: v.morningBreakFrom,
    afternoonBreakFrom: v.afternoonBreakFrom,
    lunchFrom: v.lunchFrom,
    lunchStartBy: v.lunchStartBy,
    lunchEndBy: v.lunchEndBy,
    lunchMinimum: v.lunchMinimum,
  };
}

/** Whether a set of rules describes a day at all, rather than one that ends before it starts. */
function coherent(r) {
  return r.countTo.every((end) => r.countFrom < end)
    && r.countFrom <= r.arriveBy
    && r.lunchFrom <= r.lunchStartBy
    && r.lunchStartBy < r.lunchEndBy;
}

/**
 * The rules out of the plugin's settings.
 *
 * `get(key, fallback)` is `api.settings.get`. A value that cannot be read --
 * "8h30", a negative length, a typo -- is replaced by its default and named
 * in `invalid`; rules that contradict each other, a day that ends before it
 * starts, are all replaced by the defaults. Never throws: a mistake in a
 * setting is a warning, not a bar that stops drawing.
 */
export function readRules(get = () => undefined) {
  const values = {};
  const invalid = [];
  for (const key of [...TIMES, ...Object.keys(LENGTHS)]) {
    let raw;
    try {
      raw = get(key, DEFAULTS[key]);
    } catch {
      raw = undefined;
    }
    const value = raw === undefined || raw === null || raw === '' ? null : readValue(key, raw);
    if (value === null && raw !== undefined && raw !== null && raw !== '') invalid.push(key);
    values[key] = value ?? readValue(key, DEFAULTS[key]);
  }
  const rules = build(values);
  if (coherent(rules)) return { rules, invalid };
  return { rules: DEFAULT_RULES, invalid: [...invalid, 'order'] };
}

export const DEFAULT_RULES = build(Object.fromEntries(
  Object.entries(DEFAULTS).map(([key, value]) => [key, readValue(key, value)])));

/**
 * One day's rules: the week's, with that weekday's end, and what an afternoon
 * off changes.
 *
 * An afternoon off has no 16:30 floor -- leaving is allowed whenever -- plans
 * no lunch, and holds only a morning: it ends when lunch would have to start
 * at the latest. Quelio counts it like any other day; only what is asked of
 * it changes.
 */
export function dayRules(rules = DEFAULT_RULES, weekday = 0, half = false) {
  const countTo = rules.countTo[Math.min(Math.max(0, weekday), 4)];
  return {
    ...rules,
    countTo,
    half,
    /** Nobody is asked to arrive before the counted day starts. */
    arriveFrom: rules.countFrom,
    leaveFrom: half ? 0 : rules.leaveFrom,
    leaveBy: half ? Math.min(rules.lunchStartBy, countTo) : countTo,
    /** A departure badge at or after this ends the day; before it, it is a break. */
    finishedFrom: half ? rules.lunchFrom : rules.leaveFrom,
    takesLunch: !half,
  };
}

/** Monday's rules by default: what a test or a past day reads with when nothing else is said. */
export const DEFAULT_DAY = dayRules(DEFAULT_RULES, 0);

/**
 * The weekly objective when Quelio does not say: 38 hours. Quelio's own
 * `preferences.minutes_objective` is the source whenever it is there.
 */
export const DEFAULT_OBJECTIVE = 38 * 60;

/** A day off counts for its share of the week, an afternoon off for half of it. */
export const WORKING_DAYS = 5;
