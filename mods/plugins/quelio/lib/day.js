// One day's badges, read at a moment.
//
// Badges alternate in and out, so the list is the whole story: an odd count
// means somebody is working right now, an even one that they are out -- at
// lunch, on a break, or gone for the day. Everything here is a function of the
// badges and of `now`, which is what lets the screen move with the clock
// between two answers from Quelio rather than standing still for an hour.

import { DEFAULT_DAY } from './rules.js';
import { parseClock } from './time.js';

/**
 * Quelio's "HH:MM" strings as sorted minutes.
 *
 * Duplicates are kept: Quelio pairs badges strictly in order, and dropping a
 * double tap would pair every badge after it with the wrong partner.
 */
export function readBadges(hours) {
  if (!Array.isArray(hours)) return [];
  return hours
    .map((value) => (typeof value === 'number' ? value : parseClock(value)))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < 24 * 60)
    .sort((a, b) => a - b);
}

/**
 * The first completed break overlapping the noon window, as the minutes it
 * overlaps -- quelio-api's `calculateNoonBreak`, which is what decides the
 * deduction. A break still in progress is not one yet: it has no return badge.
 */
function noonBreak(badges, day) {
  for (let i = 1; i + 1 < badges.length; i += 2) {
    const from = badges[i];
    const to = badges[i + 1];
    if (from < day.lunchEndBy && to > day.lunchFrom) {
      return Math.min(to, day.lunchEndBy) - Math.max(from, day.lunchFrom);
    }
  }
  return null;
}

/**
 * The paid minutes Quelio credits for these badges -- its
 * `calculateDailyDetails`, step for step: effective time inside the counted
 * day, plus each paid break once the day has reached the minute it is
 * credited from, minus what lunch fell short of its hour, never more than
 * those breaks gave.
 *
 * `until` closes a segment still open, which Quelio does only for the current
 * day; pass null for a day that is over, and an unclosed badge then counts for
 * nothing, as it does in Quelio. `day` is `dayRules(...)` for the weekday the
 * badges belong to, since the counted day ends earlier on Friday.
 */
export function credit(badges, until = null, day = DEFAULT_DAY) {
  const clamp = (minute) => Math.max(Math.min(minute, day.countTo), day.countFrom);
  let effective = 0;
  let morning = false;
  let afternoon = false;
  const count = (from, to) => {
    const start = clamp(from);
    const end = clamp(to);
    effective += Math.max(0, end - start);
    if (end >= day.morningBreakFrom) morning = true;
    if (end >= day.afternoonBreakFrom) afternoon = true;
  };

  const last = badges.length - 1;
  if (badges.length % 2 === 1 && until !== null) count(badges[last], Math.max(until, badges[last]));
  for (let i = 0; i + 1 < badges.length; i += 2) count(badges[i], badges[i + 1]);

  const bonus = (morning ? day.breakMinutes : 0) + (afternoon ? day.breakMinutes : 0);
  const noon = noonBreak(badges, day);
  const deduction = noon !== null && noon < day.lunchMinimum
    ? Math.min(day.lunchMinimum - noon, bonus)
    : 0;
  return { effective, bonus, deduction, paid: effective + bonus - deduction };
}

/**
 * Lunch, if there has been one: the first break -- finished, or still going on
 * at `now` -- that overlaps the lunch window. An afternoon off has none: the
 * badge out at noon is the end of the day.
 *
 * `credited` is the part of it inside the window, which is the part that
 * counts toward the hour: a lunch started at 11:50 has only been credited from
 * 12:00, so it can end at 13:00 at the earliest, exactly as Quelio sees it.
 *
 * A lunch started after the latest start (`late`) cannot reach its hour before
 * the window closes, and nothing after the window is credited -- so its
 * earliest useful return is the window's end, not an hour after it began.
 */
export function lunchOf(badges, now, day = DEFAULT_DAY) {
  if (day.takesLunch === false) return null;
  for (let i = 1; i < badges.length; i += 2) {
    const from = badges[i];
    const to = i + 1 < badges.length ? badges[i + 1] : null;
    const end = to ?? now;
    if (end === null || end === undefined || end <= from) continue;
    if (from >= day.lunchEndBy || end <= day.lunchFrom) continue;
    const credited = Math.max(0, Math.min(end, day.lunchEndBy) - Math.max(from, day.lunchFrom));
    return {
      from,
      to,
      open: to === null,
      duration: end - from,
      credited,
      earliestReturn: Math.min(Math.max(from, day.lunchFrom) + day.lunchMinimum, day.lunchEndBy),
      minimumMet: credited >= day.lunchMinimum,
      late: from > day.lunchStartBy,
    };
  }
  return null;
}

/**
 * Out, and not coming back today: the last badge was a departure at or after
 * the earliest allowed one, or the latest has passed. A lunch still going on
 * is never the end of a day.
 */
export function isFinished(badges, now, day = DEFAULT_DAY) {
  if (badges.length === 0 || badges.length % 2 === 1) return false;
  if (lunchOf(badges, now, day)?.open) return false;
  return badges[badges.length - 1] >= day.finishedFrom || now >= day.leaveBy;
}

/**
 * The badges the day would end with if its owner left at `leaveAt` and kept
 * every rule from `now` on: arriving now if they have not, coming back from
 * lunch as soon as the hour is up -- or now, from any other break -- and
 * taking a full hour's lunch if they have not had one and still can.
 *
 * A lunch that can no longer start in time is not invented: Quelio counts no
 * break as no deduction, and planning a lunch the rules no longer allow would
 * suggest a departure later than the truth.
 */
export function planDay(badges, now, leaveAt, day = DEFAULT_DAY) {
  const plan = [...badges];
  const lunch = lunchOf(badges, now, day);
  if (plan.length === 0) plan.push(Math.max(now, day.arriveFrom));
  else if (plan.length % 2 === 0) plan.push(lunch?.open ? Math.max(now, lunch.earliestReturn) : now);

  const back = plan[plan.length - 1];
  if (!lunch && day.takesLunch !== false) {
    const start = Math.max(back, now, day.lunchFrom);
    if (start <= day.lunchStartBy && start + day.lunchMinimum < leaveAt) {
      plan.push(start, start + day.lunchMinimum);
    }
  }
  plan.push(Math.max(leaveAt, plan[plan.length - 1]));
  return plan;
}

/** Paid minutes at the end of the day, leaving at `leaveAt`. */
export function paidIfLeaving(badges, now, leaveAt, offset = 0, day = DEFAULT_DAY) {
  return credit(planDay(badges, now, leaveAt, day), null, day).paid + offset;
}

/** Minutes of work between `now` and `leaveAt`, breaks taken out. */
export function workLeft(badges, now, leaveAt, day = DEFAULT_DAY) {
  const plan = planDay(badges, now, leaveAt, day);
  let total = 0;
  for (let i = 0; i + 1 < plan.length; i += 2) {
    total += Math.max(0, Math.min(plan[i + 1], leaveAt) - Math.max(plan[i], now));
  }
  return total;
}

/**
 * How far this machine's reading of today is from Quelio's.
 *
 * Quelio answers with its own count for the day, made on its own clock at the
 * moment it answered; this plugin recomputes the same count locally so it can
 * keep moving afterwards. If a deployment counts differently -- another bonus,
 * other bounds -- the two disagree, and the difference is carried forward so
 * Quelio's number stays the truth and only the clock's progress is local.
 *
 * `from` and `to` are the minutes the request was sent and answered: a count
 * anywhere between the two is agreement, not a difference.
 */
export function anchorOffset(badges, reported, from, to, day = DEFAULT_DAY) {
  if (typeof reported !== 'number') return 0;
  const early = credit(badges, from, day).paid;
  const late = credit(badges, to, day).paid;
  if (reported >= Math.min(early, late) && reported <= Math.max(early, late)) return 0;
  return reported - late;
}
