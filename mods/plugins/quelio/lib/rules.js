// The two sets of rules this plugin reasons with, kept apart on purpose.
//
// SCHEDULE is what the company allows: when to arrive, when lunch may start and
// end, how long it lasts, when one may leave. Every suggestion has to fit
// inside it, which is the whole point of making one.
//
// COUNTING is how Quelio credits the time once it is spent -- the defaults of
// quelio-api's config.example.php. It is what turns badges into the "paid"
// minutes the weekly objective is measured against. It overlaps SCHEDULE (both
// know about 12:00-14:00 and an hour for lunch) without being the same thing:
// Quelio counts a day that broke every rule, and a rule can be kept without
// changing what Quelio counts.
//
// All times are minutes since midnight.

export const SCHEDULE = Object.freeze({
  /** Arrive between 08:30 and 09:00. */
  arriveFrom: 8 * 60 + 30,
  arriveBy: 9 * 60,
  /** Lunch starts between 12:00 and 13:00, ends by 14:00, lasts an hour at least. */
  lunchFrom: 12 * 60,
  lunchStartBy: 13 * 60,
  lunchEndBy: 14 * 60,
  lunchMinimum: 60,
  /** Nobody leaves before 16:30, whatever is already done. */
  leaveFrom: 16 * 60 + 30,
  /** The latest departure, Monday first: 18:30, and 17:30 on Friday. */
  leaveBy: Object.freeze([18 * 60 + 30, 18 * 60 + 30, 18 * 60 + 30, 18 * 60 + 30, 17 * 60 + 30]),
});

export const COUNTING = Object.freeze({
  /** Badges before 08:30 or after 18:30 count as 08:30 and 18:30 -- on Friday too. */
  dayStart: 8 * 60 + 30,
  dayEnd: 18 * 60 + 30,
  /** Seven minutes for each of the two short breaks, once work reaches 11:00 and 16:00. */
  bonus: 7,
  morningBonusFrom: 11 * 60,
  afternoonBonusFrom: 16 * 60,
  /** A lunch overlapping 12:00-14:00 by less than an hour costs the difference, up to the bonuses. */
  noonFrom: 12 * 60,
  noonTo: 14 * 60,
  noonMinimum: 60,
});

/**
 * The weekly objective when Quelio does not say: 38 hours. Quelio's own
 * `preferences.minutes_objective` is the source whenever it is there.
 */
export const DEFAULT_OBJECTIVE = 38 * 60;

/** A day off counts for its share of the week. */
export const WORKING_DAYS = 5;
